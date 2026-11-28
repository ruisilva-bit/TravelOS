import {
  asOpaqueId,
  InputValidationError,
  OptimisticConflictError,
  TransactionConflictError,
  StaffAuthorizationError,
  StaffPublicationInputError,
  ShareLinkInputError,
  ShareLinkNotFoundError,
  TripNotFoundError,
  IdempotencyConflictError,
  TripPublicationNotFoundError,
  LeadIdempotencyConflictError,
  LeadNotFoundError,
  LeadNotOpenError,
  CrmIdempotencyConflictError,
  CrmNotFoundError,
  type StaffCrmOperations,
  type StaffLeadOperations,
  type StaffTripWorkspaceWriteOperations,
  type StaffTripOperations,
  type StaffTripWorkspaceOperations,
  type StaffTripPreviewOperations,
  type StaffShareLinkOperations,
  type StaffQuoteOperations,
  QuoteNotFoundError,
  QuoteStaleError,
  QuoteRuleError,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";

import { ADMIN_PRIVATE_NO_STORE } from "./http-security.js";
import { surfaceRejectionStatus as boundarySurfaceRejectionStatus } from "./request-boundary.js";

export interface IncomingHttpRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly rawHeaders?: readonly string[];
  readonly params?: Readonly<Record<string, string | undefined>>;
  readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface OutgoingHttpResponse {
  status(statusCode: number): OutgoingHttpResponse;
  setHeader(name: string, value: string | readonly string[]): void;
  end(body?: Uint8Array): void;
  json(body: unknown): void;
}

export type Next = (error?: unknown) => void;
export type HttpHandler = (
  request: IncomingHttpRequest,
  response: OutgoingHttpResponse,
  next: Next,
) => void;

export interface AdminExpressApplication {
  get(path: string, handler: HttpHandler): void;
  post(path: string, handler: HttpHandler): void;
  patch(path: string, handler: HttpHandler): void;
  put(path: string, handler: HttpHandler): void;
  /** Optional so existing harnesses stay valid; quote routes require it when registered. */
  delete?(path: string, handler: HttpHandler): void;
}

export interface AdminRouteOptions {
  readonly policy: AuthSurfacePolicy;
  readonly tripOperations: StaffTripOperations;
  readonly workspaceOperations?: StaffTripWorkspaceOperations;
  readonly workspaceWriteOperations?: StaffTripWorkspaceWriteOperations;
  readonly previewOperations?: StaffTripPreviewOperations;
  readonly shareLinkOperations?: StaffShareLinkOperations;
  readonly leadOperations?: StaffLeadOperations;
  readonly crmOperations?: StaffCrmOperations;
  readonly quoteOperations?: StaffQuoteOperations;
}

/** Admin route policy: URL, Host, Authorization, X-Forwarded-Host and (when required) Origin. */
export const surfaceRejectionStatus = (
  request: IncomingHttpRequest,
  policy: AuthSurfacePolicy,
  requireCanonicalOrigin: boolean,
): 400 | 403 | 404 | null =>
  boundarySurfaceRejectionStatus(request, policy, {
    requireRoutableUrl: true,
    requireCanonicalOrigin,
    rejectQueryString: false,
  });

export const send = (response: OutgoingHttpResponse, status: number, body: unknown): void => {
  response.status(status).json(body);
};

export const badRequest = (response: OutgoingHttpResponse): void =>
  send(response, 400, { error: "invalid_request" });

export const idFrom = (value: string | undefined): ReturnType<typeof asOpaqueId> | null => {
  if (value === undefined) return null;
  try {
    return asOpaqueId(value);
  } catch {
    return null;
  }
};

export const runHandler = (
  work: () => Promise<void>,
  response: OutgoingHttpResponse,
  next: Next,
): void => {
  response.setHeader("Cache-Control", ADMIN_PRIVATE_NO_STORE);
  void work().catch((error: unknown) => {
    if (error instanceof StaffAuthorizationError) {
      response.status(error.code === "UNAUTHENTICATED" ? 401 : 403).end();
      return;
    }
    if (error instanceof OptimisticConflictError) {
      send(response, 409, { error: "optimistic_conflict" });
      return;
    }
    if (error instanceof TransactionConflictError) {
      send(response, 409, { error: "transaction_conflict" });
      return;
    }
    if (error instanceof IdempotencyConflictError) {
      send(response, 409, { error: "IDEMPOTENCY_KEY_CONFLICT" });
      return;
    }
    if (error instanceof LeadNotOpenError) {
      send(response, 409, { error: error.code });
      return;
    }
    if (error instanceof LeadIdempotencyConflictError) {
      send(response, 409, { error: error.code });
      return;
    }
    if (error instanceof LeadNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof CrmIdempotencyConflictError) {
      send(response, 409, { error: error.code });
      return;
    }
    if (error instanceof CrmNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof QuoteNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof QuoteStaleError) {
      send(response, 409, { error: "optimistic_conflict" });
      return;
    }
    if (error instanceof QuoteRuleError) {
      send(response, 409, { error: error.code });
      return;
    }
    if (error instanceof ShareLinkNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof ShareLinkInputError) {
      badRequest(response);
      return;
    }
    if (error instanceof TripPublicationNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof TripNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof StaffPublicationInputError) {
      badRequest(response);
      return;
    }
    if (error instanceof InputValidationError) {
      badRequest(response);
      return;
    }
    next(error);
  });
};
