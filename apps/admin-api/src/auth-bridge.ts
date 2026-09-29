import {
  dispatchAuthRealmRequest,
  type AuthRealm,
  type AuthSurfacePolicy,
} from "@travelos/auth-adapters";
import { authorizeStaffRequest } from "@travelos/backend-core";
import { AdminStaffSessionContextSchema } from "@travelos/contracts/admin";
import type { M1OperationalSliceRepository, StaffAccessRepository } from "@travelos/database";

import { registerAdminM1Routes } from "./m1-routes.js";

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
  post(path: string, handler: HttpHandler): void;
  patch(path: string, handler: HttpHandler): void;
}

interface NestHttpApplication {
  getHttpAdapter(): { getInstance(): unknown };
}

export interface AdminAuthBridgeOptions {
  readonly realm: AuthRealm;
  readonly policy: AuthSurfacePolicy;
  readonly staffAccessRepository: Pick<StaffAccessRepository, "getStaffAuthorizationSnapshot">;
  readonly m1Repository?: M1OperationalSliceRepository;
}

type SetCookieHeaders = Headers & { readonly getSetCookie?: () => string[] };

const headersFor = (request: IncomingHttpRequest): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      const separator = name.toLowerCase() === "cookie" ? "; " : ", ";
      headers.set(name, value.join(separator));
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
  options: AdminAuthBridgeOptions,
): boolean => {
  const target = requestUrlFor(request, options.policy);
  return (
    target !== null &&
    (target.pathname === options.realm.basePath ||
      target.pathname.startsWith(`${options.realm.basePath}/`))
  );
};

const bridgeHandler =
  (options: AdminAuthBridgeOptions): HttpHandler =>
  (request, response, next) => {
    if (!authRouteMatches(request, options)) {
      next();
      return;
    }
    response.setHeader("cache-control", "no-store, private");
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

const sessionRequestFor = (
  request: IncomingHttpRequest,
  policy: AuthSurfacePolicy,
): Request | null => {
  const target = requestUrlFor(request, policy);
  return target === null ? null : new Request(target, { headers: headersFor(request) });
};

const staffSessionContextHandler =
  (options: AdminAuthBridgeOptions): HttpHandler =>
  (request, response, next) => {
    response.setHeader("cache-control", "no-store, private");
    const rejection = surfaceRejectionStatus(request, options.policy);
    if (rejection !== null) {
      response.status(rejection).end();
      return;
    }
    const sessionRequest = sessionRequestFor(request, options.policy);
    if (sessionRequest === null) {
      response.status(404).end();
      return;
    }
    void options.realm
      .getServerSession(sessionRequest)
      .then(async (session) => {
        const proof =
          session === null || session.agencyId === null || session.authorizationEpoch === null
            ? null
            : {
                staffPrincipalId: session.principalId,
                agencyId: session.agencyId,
                authorizationEpoch: session.authorizationEpoch,
                expiresAtEpochMs: session.expiresAtEpochMs,
                recentMfaVerifiedAtEpochMs: session.recentMfaVerifiedAtEpochMs,
              };
        if (proof === null) {
          response.status(401).end();
          return;
        }
        const snapshot = await options.staffAccessRepository.getStaffAuthorizationSnapshot(
          proof.staffPrincipalId,
        );
        const decision = authorizeStaffRequest({
          session: proof,
          snapshot,
          permissionId: "agency.view",
          target: {
            agencyId: proof?.agencyId ?? "",
            organizationUnitAncestorIds: [],
            requiredAccessLevel: "ALL",
          },
          nowEpochMs: Date.now(),
          recentMfaMaximumAgeMs: null,
        });
        if (decision.result === "DENY") {
          response.status(decision.reason === "UNAUTHENTICATED" ? 401 : 403).end();
          return;
        }
        response.json(
          AdminStaffSessionContextSchema.parse({
            principalId: proof.staffPrincipalId,
            agencyId: proof.agencyId,
            authorizationEpoch: proof.authorizationEpoch.toString(),
            recentMfaVerifiedAtEpochMs: proof.recentMfaVerifiedAtEpochMs,
          }),
        );
      })
      .catch(next);
  };

/** Registers only Staff auth mechanics plus one permission-checked context endpoint. */
export const registerAdminAuthBridge = (
  application: NestHttpApplication,
  options: AdminAuthBridgeOptions,
): void => {
  if (options.realm.kind !== "STAFF") {
    throw new Error("Admin authentication bridge requires the Staff realm");
  }
  const http = application.getHttpAdapter().getInstance() as ExpressLikeApplication;
  http.use(bridgeHandler(options));
  http.get("/api/staff/session-context", staffSessionContextHandler(options));
  if (options.m1Repository !== undefined) {
    registerAdminM1Routes(http, {
      realm: options.realm,
      policy: options.policy,
      staffAccessRepository: options.staffAccessRepository,
      m1Repository: options.m1Repository,
    });
  }
};
