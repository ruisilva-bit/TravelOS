import {
  dispatchAuthRealmRequest,
  type PortalAuthRealm,
  type AuthSurfacePolicy,
} from "@travelos/auth-adapters/portal";
import { PortalAuthenticatedSessionSchema } from "@travelos/contracts/portal";
import { portalPrincipalIdentityFromSession } from "@travelos/portal-safe-core/portal-access";

interface IncomingHttpRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
}

interface OutgoingHttpResponse {
  status(statusCode: number): OutgoingHttpResponse;
  setHeader(name: string, value: string | readonly string[]): void;
  end(body?: Uint8Array): void;
  json(body: unknown): void;
}

type Next = (error?: unknown) => void;
type HttpHandler = (
  request: IncomingHttpRequest,
  response: OutgoingHttpResponse,
  next: Next,
) => void;

interface ExpressLikeApplication {
  use(handler: HttpHandler): void;
  get(path: string, handler: HttpHandler): void;
}

interface NestHttpApplication {
  getHttpAdapter(): { getInstance(): unknown };
}

export interface PortalAuthBridgeOptions {
  readonly realm: PortalAuthRealm;
  readonly policy: AuthSurfacePolicy;
}

type SetCookieHeaders = Headers & { readonly getSetCookie?: () => string[] };

const headersFor = (request: IncomingHttpRequest): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      headers.set(name, value.join(name.toLowerCase() === "cookie" ? "; " : ", "));
    } else {
      headers.set(name, value);
    }
  }
  return headers;
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

const surfaceRejectionStatus = (
  request: IncomingHttpRequest,
  policy: AuthSurfacePolicy,
): 403 | 404 | null => {
  const headers = headersFor(request);
  if (headers.get("host") !== policy.expectedHost) return 404;
  if (headers.has("authorization") || headers.has("x-forwarded-host")) return 403;
  return null;
};

const writeBridgeResponse = (
  response: OutgoingHttpResponse,
  status: number,
  headers: Headers,
  body: Uint8Array,
): void => {
  const setCookieHeaders = headers as SetCookieHeaders;
  const cookies =
    setCookieHeaders.getSetCookie?.() ??
    [headers.get("set-cookie")].flatMap((value) => (value === null ? [] : [value]));
  headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") response.setHeader(name, value);
  });
  if (cookies.length > 0) response.setHeader("set-cookie", cookies);
  response.status(status).end(body);
};

const authRouteMatches = (
  request: IncomingHttpRequest,
  options: PortalAuthBridgeOptions,
): boolean => {
  const target = requestUrlFor(request, options.policy);
  return (
    target !== null &&
    (target.pathname === options.realm.basePath ||
      target.pathname.startsWith(`${options.realm.basePath}/`))
  );
};

const bridgeHandler =
  (options: PortalAuthBridgeOptions): HttpHandler =>
  (request, response, next) => {
    if (!authRouteMatches(request, options)) {
      next();
      return;
    }
    const rejection = surfaceRejectionStatus(request, options.policy);
    if (rejection !== null) {
      response.status(rejection).end();
      return;
    }
    void dispatchAuthRealmRequest(options.realm, options.policy, {
      method: request.method,
      url: request.originalUrl ?? request.url,
      headers: headersFor(request),
      body: request.body,
    })
      .then((result) => writeBridgeResponse(response, result.status, result.headers, result.body))
      .catch(next);
  };

const portalSessionContextHandler =
  (options: PortalAuthBridgeOptions): HttpHandler =>
  (request, response, next) => {
    const rejection = surfaceRejectionStatus(request, options.policy);
    if (rejection !== null) {
      response.status(rejection).end();
      return;
    }
    const target = requestUrlFor(request, options.policy);
    if (target === null) {
      response.status(404).end();
      return;
    }
    void options.realm
      .getServerSession(new Request(target, { headers: headersFor(request) }))
      .then((session) => {
        const identity = portalPrincipalIdentityFromSession(session);
        if (identity === null) {
          response.status(401).end();
          return;
        }
        response.setHeader("cache-control", "no-store, private");
        response.json(
          PortalAuthenticatedSessionSchema.parse({
            authenticated: true,
            portalPrincipalId: identity.portalPrincipalId,
          }),
        );
      })
      .catch(next);
  };

/** Registers the Portal's identity-only Stage 4 surface; it has no workspace access path. */
export const registerPortalAuthBridge = (
  application: NestHttpApplication,
  options: PortalAuthBridgeOptions,
): void => {
  if (options.realm.kind !== "PORTAL") {
    throw new Error("Portal authentication bridge requires the Portal realm");
  }
  const http = application.getHttpAdapter().getInstance() as ExpressLikeApplication;
  http.use(bridgeHandler(options));
  http.get("/api/portal/session-context", portalSessionContextHandler(options));
};
