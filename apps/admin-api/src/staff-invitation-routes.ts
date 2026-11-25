import {
  asOpaqueId,
  StaffInvitationAcceptanceRejectedError,
  StaffInvitationAuthorizationError,
  StaffInvitationInputError,
  StaffInvitationInvariantError,
  type StaffInvitationMetadata,
  type StaffInvitationOperations,
} from "@travelos/backend-core";
import {
  AdminOpaqueIdSchema,
  AdminStaffInvitationAcceptV1RequestSchema,
  AdminStaffInvitationIssueV1RequestSchema,
  AdminStaffInvitationListV1QuerySchema,
  AdminStaffInvitationListV1ResponseSchema,
  AdminStaffInvitationMetadataV1Schema,
  AdminStaffInvitationOneTimeV1ResponseSchema,
} from "@travelos/contracts/admin";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";

import { ADMIN_PRIVATE_NO_STORE } from "./http-security.js";
import {
  headersFor,
  surfaceRejectionStatus as boundarySurfaceRejectionStatus,
} from "./request-boundary.js";
import {
  trustedStaffInvitationClientKey,
  type StaffInvitationRateLimiter,
} from "./staff-invitation-rate-limit.js";

interface IncomingHttpRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly params?: Readonly<Record<string, string | undefined>>;
  readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rawHeaders?: readonly string[];
  readonly socket?: { readonly remoteAddress?: string };
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

interface AdminStaffInvitationExpressApplication {
  get(path: string, handler: HttpHandler): void;
  post(path: string, handler: HttpHandler): void;
}

export interface AdminStaffInvitationRouteOptions {
  readonly policy: AuthSurfacePolicy;
  readonly operations: StaffInvitationOperations;
  readonly rateLimiter: StaffInvitationRateLimiter;
}

const surfaceRejectionStatus = (
  request: IncomingHttpRequest,
  policy: AuthSurfacePolicy,
  requireOrigin: boolean,
): 400 | 403 | 404 | null =>
  boundarySurfaceRejectionStatus(request, policy, {
    requireRoutableUrl: true,
    requireCanonicalOrigin: requireOrigin,
    rejectQueryString: requireOrigin,
  });

const badRequest = (response: OutgoingHttpResponse): void => {
  response.status(400).json({ error: "invalid_request" });
};

const instantFor = (epochMs: number): string => {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new Error("Invitation metadata contains an invalid instant");
  }
  return new Date(epochMs).toISOString();
};

const metadataDtoFor = (metadata: StaffInvitationMetadata) =>
  AdminStaffInvitationMetadataV1Schema.parse({
    invitationId: metadata.invitationId,
    targetEmail: metadata.targetEmail,
    status: metadata.status,
    createdAt: instantFor(metadata.createdAtEpochMs),
    expiresAt: instantFor(metadata.expiresAtEpochMs),
    consumedAt: metadata.consumedAtEpochMs === null ? null : instantFor(metadata.consumedAtEpochMs),
    revokedAt: metadata.revokedAtEpochMs === null ? null : instantFor(metadata.revokedAtEpochMs),
  });

const oneTimeDtoFor = (response: Awaited<ReturnType<StaffInvitationOperations["issue"]>>) =>
  AdminStaffInvitationOneTimeV1ResponseSchema.parse({
    invitation: metadataDtoFor(response.invitation),
    token: response.token,
  });

const writeManagementError = (response: OutgoingHttpResponse, error: unknown): void => {
  if (error instanceof StaffInvitationAuthorizationError) {
    response.status(error.code === "UNAUTHENTICATED" ? 401 : 403).end();
    return;
  }
  if (error instanceof StaffInvitationInputError) {
    badRequest(response);
    return;
  }
  if (
    error instanceof StaffInvitationAcceptanceRejectedError ||
    error instanceof StaffInvitationInvariantError
  ) {
    response.status(404).end();
    return;
  }
  response.status(500).end();
};

const beginManagementRequest = (
  request: IncomingHttpRequest,
  response: OutgoingHttpResponse,
  policy: AuthSurfacePolicy,
  requireOrigin: boolean,
): Headers | null => {
  response.setHeader("Cache-Control", ADMIN_PRIVATE_NO_STORE);
  const rejection = surfaceRejectionStatus(request, policy, requireOrigin);
  if (rejection === null) return headersFor(request);
  if (rejection === 400) badRequest(response);
  else response.status(rejection).end();
  return null;
};

const isEmptyBody = (body: unknown): boolean =>
  body === undefined ||
  (typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).length === 0);

const acceptError = (response: OutgoingHttpResponse, error: unknown): void => {
  if (error instanceof StaffInvitationInputError) {
    badRequest(response);
    return;
  }
  if (
    error instanceof StaffInvitationAcceptanceRejectedError ||
    error instanceof StaffInvitationInvariantError
  ) {
    response.status(404).end();
    return;
  }
  response.status(500).end();
};

export const registerAdminStaffInvitationRoutes = (
  application: AdminStaffInvitationExpressApplication,
  options: AdminStaffInvitationRouteOptions,
): void => {
  application.get("/api/admin/staff/invitations", (request, response) => {
    const headers = beginManagementRequest(request, response, options.policy, false);
    if (headers === null) return;

    const parsedQuery = AdminStaffInvitationListV1QuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      badRequest(response);
      return;
    }
    void options.operations
      .list(headers.get("cookie"), {
        limit: parsedQuery.data.limit,
        cursor: parsedQuery.data.cursor === null ? null : asOpaqueId(parsedQuery.data.cursor),
      })
      .then((result) =>
        AdminStaffInvitationListV1ResponseSchema.parse({
          items: result.items.map(metadataDtoFor),
          nextCursor: result.nextCursor,
        }),
      )
      .then((result) => response.status(200).json(result))
      .catch((error: unknown) => writeManagementError(response, error));
  });

  application.post("/api/admin/staff/invitations", (request, response) => {
    const headers = beginManagementRequest(request, response, options.policy, true);
    if (headers === null) return;

    const parsedBody = AdminStaffInvitationIssueV1RequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      badRequest(response);
      return;
    }
    void options.operations
      .issue(headers.get("cookie"), { targetEmail: parsedBody.data.targetEmail })
      .then(oneTimeDtoFor)
      .then((result) => response.status(201).json(result))
      .catch((error: unknown) => writeManagementError(response, error));
  });

  application.post("/api/admin/staff/invitations/:invitationId/reissue", (request, response) => {
    const headers = beginManagementRequest(request, response, options.policy, true);
    if (headers === null) return;
    if (!isEmptyBody(request.body)) {
      badRequest(response);
      return;
    }
    const parsedId = AdminOpaqueIdSchema.safeParse(request.params?.invitationId);
    if (!parsedId.success) {
      badRequest(response);
      return;
    }
    void options.operations
      .reissue(headers.get("cookie"), asOpaqueId(parsedId.data))
      .then(oneTimeDtoFor)
      .then((result) => response.status(200).json(result))
      .catch((error: unknown) => writeManagementError(response, error));
  });

  application.post("/api/admin/staff/invitations/:invitationId/revoke", (request, response) => {
    const headers = beginManagementRequest(request, response, options.policy, true);
    if (headers === null) return;
    if (!isEmptyBody(request.body)) {
      badRequest(response);
      return;
    }
    const parsedId = AdminOpaqueIdSchema.safeParse(request.params?.invitationId);
    if (!parsedId.success) {
      badRequest(response);
      return;
    }
    void options.operations
      .revoke(headers.get("cookie"), asOpaqueId(parsedId.data))
      .then(metadataDtoFor)
      .then((result) => response.status(200).json(result))
      .catch((error: unknown) => writeManagementError(response, error));
  });

  application.post("/api/staff/invitations/accept", (request, response) => {
    response.setHeader("Cache-Control", ADMIN_PRIVATE_NO_STORE);
    const rejection = surfaceRejectionStatus(request, options.policy, true);
    if (rejection !== null) {
      if (rejection === 400) badRequest(response);
      else response.status(rejection).end();
      return;
    }

    const rateLimit = options.rateLimiter.begin(trustedStaffInvitationClientKey(request));
    if (!rateLimit.allowed) {
      response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      response.status(429).json({ error: "rate_limited" });
      return;
    }

    const parsedBody = AdminStaffInvitationAcceptV1RequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      rateLimit.complete("REJECTED");
      badRequest(response);
      return;
    }

    void options.operations
      .accept({
        token: parsedBody.data.token,
        name: parsedBody.data.name,
        password: parsedBody.data.password,
      })
      .then(() => {
        rateLimit.complete("ACCEPTED");
        response.status(204).end();
      })
      .catch((error: unknown) => {
        rateLimit.complete("REJECTED");
        acceptError(response, error);
      });
  });
};
