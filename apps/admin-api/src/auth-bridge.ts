import {
  authRequestPathMatchesBase,
  dispatchAuthRealmRequest,
  STAFF_AUTH_BASE_PATH,
  type AuthRealm,
  type AuthSurfacePolicy,
} from "@travelos/auth-adapters";
import {
  authorizeStaffRequest,
  STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS,
} from "@travelos/backend-core";
import type { StaffTripOperations } from "@travelos/backend-core";
import type { StaffTripWorkspaceOperations } from "@travelos/backend-core";
import type { StaffTripWorkspaceWriteOperations } from "@travelos/backend-core";
import type { StaffTripPreviewOperations } from "@travelos/backend-core";
import type { StaffShareLinkOperations } from "@travelos/backend-core";
import type { StaffInvitationOperations } from "@travelos/backend-core";
import type {
  StaffAgencyProfileOperations,
  StaffCrmOperations,
  StaffQuoteOperations,
} from "@travelos/backend-core";
import type { StaffLeadOperations } from "@travelos/backend-core";
import { AdminStaffSessionContextSchema } from "@travelos/contracts/admin";
import type { StaffAccessRepository } from "@travelos/database";

import { ADMIN_PRIVATE_NO_STORE } from "./http-security.js";
import {
  headersFor,
  requestUrlFor,
  surfaceRejectionStatus as boundarySurfaceRejectionStatus,
} from "./request-boundary.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerAdminStaffInvitationRoutes } from "./staff-invitation-routes.js";
import type { StaffInvitationRateLimiter } from "./staff-invitation-rate-limit.js";

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
  put(path: string, handler: HttpHandler): void;
}

interface NestHttpApplication {
  getHttpAdapter(): { getInstance(): unknown };
}

export interface AdminAuthBridgeOptions {
  readonly realm: AuthRealm;
  readonly policy: AuthSurfacePolicy;
  readonly environment?: "DEVELOPMENT" | "INTERNAL" | "PRODUCTION";
  readonly staffAccessRepository: Pick<StaffAccessRepository, "getStaffAuthorizationSnapshot">;
  readonly tripOperations?: StaffTripOperations;
  readonly workspaceOperations?: StaffTripWorkspaceOperations;
  readonly workspaceWriteOperations?: StaffTripWorkspaceWriteOperations;
  readonly previewOperations?: StaffTripPreviewOperations;
  readonly shareLinkOperations?: StaffShareLinkOperations;
  readonly leadOperations?: StaffLeadOperations;
  readonly crmOperations?: StaffCrmOperations;
  readonly quoteOperations?: StaffQuoteOperations;
  readonly agencyProfileOperations?: StaffAgencyProfileOperations;
  readonly staffInvitationOperations?: StaffInvitationOperations;
  readonly staffInvitationRateLimiter?: StaffInvitationRateLimiter;
}

type SetCookieHeaders = Headers & { readonly getSetCookie?: () => string[] };

const surfaceRejectionStatus = (request: IncomingHttpRequest, policy: AuthSurfacePolicy) =>
  boundarySurfaceRejectionStatus(request, policy, {
    requireRoutableUrl: false,
    requireCanonicalOrigin: false,
    rejectQueryString: false,
  });

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
    if (name.toLowerCase() !== "set-cookie" && name.toLowerCase() !== "cache-control") {
      response.setHeader(name, value);
    }
  });
  if (cookies.length > 0) response.setHeader("set-cookie", cookies);
  response.setHeader("Cache-Control", ADMIN_PRIVATE_NO_STORE);
  response.status(status).end(body);
};

const authRouteMatches = (
  request: IncomingHttpRequest,
  options: AdminAuthBridgeOptions,
): boolean => {
  const requestUrl = request.originalUrl ?? request.url;
  const target = requestUrlFor(request, options.policy);
  return (
    target !== null &&
    options.realm.basePath === STAFF_AUTH_BASE_PATH &&
    authRequestPathMatchesBase(requestUrl, target, STAFF_AUTH_BASE_PATH)
  );
};

const bridgeHandler =
  (options: AdminAuthBridgeOptions): HttpHandler =>
  (request, response, next) => {
    if (!authRouteMatches(request, options)) {
      next();
      return;
    }
    response.setHeader("cache-control", ADMIN_PRIVATE_NO_STORE);
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
    response.setHeader("cache-control", ADMIN_PRIVATE_NO_STORE);
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
                sessionId: session.sessionId,
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
          proof.agencyId,
        );
        const nowEpochMs = Date.now();
        const decision = authorizeStaffRequest({
          session: proof,
          snapshot,
          permissionId: "agency.view",
          target: {
            agencyId: proof?.agencyId ?? "",
            organizationUnitAncestorIds: [],
            requiredAccessLevel: "ALL",
          },
          nowEpochMs,
          recentMfaMaximumAgeMs: null,
        });
        if (decision.result === "DENY") {
          response.status(decision.reason === "UNAUTHENTICATED" ? 401 : 403).end();
          return;
        }
        const invitationDecision = authorizeStaffRequest({
          session: proof,
          snapshot,
          permissionId: "staff.invite",
          target: {
            agencyId: proof.agencyId,
            organizationUnitAncestorIds: [],
            requiredAccessLevel: "ALL",
          },
          nowEpochMs,
          recentMfaMaximumAgeMs: STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS,
        });
        response.json(
          AdminStaffSessionContextSchema.parse({
            principalId: proof.staffPrincipalId,
            agencyId: proof.agencyId,
            authorizationEpoch: proof.authorizationEpoch.toString(),
            recentMfaVerifiedAtEpochMs: proof.recentMfaVerifiedAtEpochMs,
            canInviteStaff: invitationDecision.result === "ALLOW",
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
  if (options.realm.basePath !== STAFF_AUTH_BASE_PATH) {
    throw new Error(
      "Admin authentication bridge requires the canonical Staff authentication prefix",
    );
  }
  const http = application.getHttpAdapter().getInstance() as ExpressLikeApplication;
  http.use(bridgeHandler(options));
  http.get("/api/staff/session-context", staffSessionContextHandler(options));
  if (options.staffInvitationOperations !== undefined) {
    if (options.staffInvitationRateLimiter === undefined) {
      throw new Error("Admin Staff invitation routes require an acceptance rate limiter");
    }
    registerAdminStaffInvitationRoutes(http, {
      policy: options.policy,
      operations: options.staffInvitationOperations,
      rateLimiter: options.staffInvitationRateLimiter,
    });
  } else if (options.staffInvitationRateLimiter !== undefined) {
    throw new Error("Admin Staff invitation rate limiter requires invitation operations");
  }
  if (options.tripOperations !== undefined) {
    registerAdminRoutes(http, {
      policy: options.policy,
      tripOperations: options.tripOperations,
      ...(options.workspaceOperations === undefined
        ? {}
        : { workspaceOperations: options.workspaceOperations }),
      ...(options.workspaceWriteOperations === undefined
        ? {}
        : { workspaceWriteOperations: options.workspaceWriteOperations }),
      ...(options.previewOperations === undefined
        ? {}
        : { previewOperations: options.previewOperations }),
      ...(options.shareLinkOperations === undefined
        ? {}
        : { shareLinkOperations: options.shareLinkOperations }),
      ...(options.leadOperations === undefined ? {} : { leadOperations: options.leadOperations }),
      ...(options.crmOperations === undefined ? {} : { crmOperations: options.crmOperations }),
      ...(options.quoteOperations === undefined
        ? {}
        : { quoteOperations: options.quoteOperations }),
      ...(options.agencyProfileOperations === undefined
        ? {}
        : { agencyProfileOperations: options.agencyProfileOperations }),
    });
  }
};
