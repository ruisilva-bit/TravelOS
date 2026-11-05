import {
  PortalAuthorizedTripListV1QuerySchema,
  PortalAuthorizedTripListV1ResponseSchema,
  PortalTripSnapshotV1Schema,
} from "@travelos/contracts/portal";
import {
  hostHeaderMatchesExpectedHost,
  type AuthSurfacePolicy,
  type PortalAuthRealm,
} from "@travelos/auth-adapters/portal";
import {
  listAuthorizedPortalTrips,
  readCurrentPortalTripSnapshot,
  type CurrentAuthorizedPortalTripListReader,
  type CurrentPublishedPortalTripSnapshotReader,
} from "@travelos/portal-safe-core/customer-presentation";

interface IncomingHttpRequest {
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface OutgoingHttpResponse {
  status(statusCode: number): OutgoingHttpResponse;
  setHeader(name: string, value: string): void;
  end(): void;
  json(body: unknown): void;
}

type Next = (error?: unknown) => void;
type HttpHandler = (
  request: IncomingHttpRequest,
  response: OutgoingHttpResponse,
  next: Next,
) => void;

interface ExpressLikeApplication {
  get(path: string, handler: HttpHandler): void;
}

interface NestHttpApplication {
  getHttpAdapter(): { getInstance(): unknown };
}

export interface PortalTripRouteOptions {
  readonly realm: PortalAuthRealm;
  readonly policy: AuthSurfacePolicy;
  readonly reader?: CurrentPublishedPortalTripSnapshotReader;
  readonly listReader?: CurrentAuthorizedPortalTripListReader;
}

const TRIP_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const CURRENT_TRIP_ROUTE = "/api/portal/trips/:tripId";
const AUTHORIZED_TRIP_LIST_ROUTE = "/api/portal/trips";
const CACHE_CONTROL = "no-store, private";

const singleHeader = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null => {
  const value = headers[name];
  return typeof value === "string" ? value : null;
};

const requestUrlFor = (request: IncomingHttpRequest, policy: AuthSurfacePolicy): URL | null => {
  try {
    const canonicalOrigin = new URL(policy.canonicalOrigin);
    const target = new URL(request.originalUrl ?? request.url, canonicalOrigin);
    return target.origin === canonicalOrigin.origin ? target : null;
  } catch {
    return null;
  }
};

const cookieHeadersFor = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Headers => {
  const result = new Headers();
  const cookies = headers.cookie;
  if (typeof cookies === "string") result.set("cookie", cookies);
  if (Array.isArray(cookies)) result.set("cookie", cookies.join("; "));
  return result;
};

const writeEmpty = (response: OutgoingHttpResponse, statusCode: number): void => {
  response.status(statusCode).end();
};

const tripHandler =
  (
    options: PortalTripRouteOptions & { readonly reader: CurrentPublishedPortalTripSnapshotReader },
  ): HttpHandler =>
  (request, response) => {
    response.setHeader("cache-control", CACHE_CONTROL);

    const target = requestUrlFor(request, options.policy);
    if (
      target === null ||
      !hostHeaderMatchesExpectedHost(
        singleHeader(request.headers, "host"),
        options.policy.expectedHost,
      )
    ) {
      writeEmpty(response, 404);
      return;
    }

    if (
      request.headers.authorization !== undefined ||
      request.headers["x-forwarded-host"] !== undefined
    ) {
      writeEmpty(response, 403);
      return;
    }

    if (target.search !== "" || target.hash !== "") {
      writeEmpty(response, 400);
      return;
    }

    const tripId = target.pathname.slice("/api/portal/trips/".length);
    if (!TRIP_ID_PATTERN.test(tripId)) {
      writeEmpty(response, 400);
      return;
    }

    void options.realm
      .getServerSession(new Request(target, { headers: cookieHeadersFor(request.headers) }))
      .then(async (session) => {
        if (session === null) {
          writeEmpty(response, 401);
          return;
        }

        const snapshot = await readCurrentPortalTripSnapshot({
          session,
          tripId,
          nowEpochMs: Date.now(),
          reader: options.reader,
        });
        if (snapshot === null) {
          writeEmpty(response, 404);
          return;
        }

        response.status(200).json(PortalTripSnapshotV1Schema.parse(snapshot));
      })
      .catch(() => {
        response.status(500).json({ error: "internal_error" });
      });
  };

const tripListQueryFor = (target: URL): Record<string, string> | null => {
  const query = Object.create(null) as Record<string, string>;
  const keys = new Set<string>();
  for (const [key, value] of target.searchParams) {
    if (keys.has(key)) return null;
    keys.add(key);
    query[key] = value;
  }
  return query;
};

const tripListHandler =
  (options: PortalTripRouteOptions): HttpHandler =>
  (request, response) => {
    response.setHeader("cache-control", CACHE_CONTROL);

    const target = requestUrlFor(request, options.policy);
    if (
      target === null ||
      !hostHeaderMatchesExpectedHost(
        singleHeader(request.headers, "host"),
        options.policy.expectedHost,
      )
    ) {
      writeEmpty(response, 404);
      return;
    }

    if (
      request.headers.authorization !== undefined ||
      request.headers["x-forwarded-host"] !== undefined
    ) {
      writeEmpty(response, 403);
      return;
    }

    if (target.hash !== "") {
      writeEmpty(response, 400);
      return;
    }

    const rawQuery = tripListQueryFor(target);
    const parsedQuery =
      rawQuery === null ? null : PortalAuthorizedTripListV1QuerySchema.safeParse(rawQuery);
    if (parsedQuery === null || !parsedQuery.success) {
      writeEmpty(response, 400);
      return;
    }

    const listReader = options.listReader;
    if (listReader === undefined) {
      writeEmpty(response, 404);
      return;
    }

    void options.realm
      .getServerSession(new Request(target, { headers: cookieHeadersFor(request.headers) }))
      .then(async (session) => {
        if (session === null) {
          writeEmpty(response, 401);
          return;
        }

        const page = await listAuthorizedPortalTrips({
          session,
          nowEpochMs: Date.now(),
          limit: parsedQuery.data.limit,
          cursor: parsedQuery.data.cursor,
          reader: listReader,
        });
        if (page === null) {
          writeEmpty(response, 401);
          return;
        }

        response.status(200).json(PortalAuthorizedTripListV1ResponseSchema.parse(page));
      })
      .catch(() => {
        response.status(500).json({ error: "internal_error" });
      });
  };

/** Registers the single current immutable-snapshot read route; it has no workspace fallback. */
export const registerPortalTripRoutes = (
  application: NestHttpApplication,
  options: PortalTripRouteOptions,
): void => {
  if (options.realm.kind !== "PORTAL") {
    throw new Error("Portal Trip routes require the Portal realm");
  }
  if (options.reader === undefined && options.listReader === undefined) {
    throw new Error("Portal Trip routes require at least one scoped snapshot reader");
  }
  const http = application.getHttpAdapter().getInstance() as ExpressLikeApplication;
  if (options.listReader !== undefined) {
    http.get(AUTHORIZED_TRIP_LIST_ROUTE, tripListHandler(options));
  }
  if (options.reader !== undefined) {
    http.get(CURRENT_TRIP_ROUTE, tripHandler({ ...options, reader: options.reader }));
  }
};
