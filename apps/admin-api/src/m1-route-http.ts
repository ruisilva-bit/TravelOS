import {
  asOpaqueId,
  M1InputValidationError,
  M1RuntimeAcceptanceFixtureConflictError,
  M1RuntimeAcceptanceFixtureNotFoundError,
  M1OptimisticConflictError,
  M1TransactionConflictError,
  M1StaffAuthorizationError,
  M1StaffPublicationInputError,
  M1TripNotFoundError,
  StalePublicationCandidateError,
  IdempotencyConflictError,
  TripPublicationNotFoundError,
  M1StaffTripAccessNotFoundError,
  type M1StaffTripWorkspaceWriteOperations,
  type M1StaffTripAccessOperations,
  type M1StaffTripOperations,
  type M1StaffTripWorkspaceOperations,
  type M1StaffTripPublicationOperations,
  type M1RuntimeAcceptanceFixtureOperations,
} from "@travelos/backend-core";
import { AdminRuntimeAcceptanceFixtureConflictV1ResponseSchema } from "@travelos/contracts/admin";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";

import { ADMIN_PRIVATE_NO_STORE } from "./http-security.js";
import { surfaceRejectionStatus as boundarySurfaceRejectionStatus } from "./request-boundary.js";

export interface IncomingHttpRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
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

export interface AdminM1ExpressApplication {
  get(path: string, handler: HttpHandler): void;
  post(path: string, handler: HttpHandler): void;
  patch(path: string, handler: HttpHandler): void;
}

export interface AdminM1RouteOptions {
  readonly policy: AuthSurfacePolicy;
  readonly m1Operations: M1StaffTripOperations;
  readonly m1WorkspaceOperations?: M1StaffTripWorkspaceOperations;
  readonly m1WorkspaceWriteOperations?: M1StaffTripWorkspaceWriteOperations;
  readonly m1TripAccessOperations?: M1StaffTripAccessOperations;
  readonly m1PublicationOperations?: M1StaffTripPublicationOperations;
  readonly runtimeAcceptanceFixtureOperations?: AdminRuntimeAcceptanceFixtureRouteOperations;
}

export interface AdminRuntimeAcceptanceFixtureRouteOperations {
  readonly createFixtureTrip: M1StaffTripOperations["createRuntimeAcceptanceFixtureTrip"];
  readonly cleanupFixture: M1RuntimeAcceptanceFixtureOperations["cleanupFixture"];
}

/** Admin M1 route policy: URL, Host, Authorization, X-Forwarded-Host and (when required) Origin. */
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
    if (error instanceof M1StaffAuthorizationError) {
      response.status(error.code === "UNAUTHENTICATED" ? 401 : 403).end();
      return;
    }
    if (error instanceof M1OptimisticConflictError) {
      send(response, 409, { error: "optimistic_conflict" });
      return;
    }
    if (error instanceof M1TransactionConflictError) {
      send(response, 409, { error: "transaction_conflict" });
      return;
    }
    if (error instanceof StalePublicationCandidateError) {
      send(response, 409, { error: "STALE_PUBLICATION_CANDIDATE" });
      return;
    }
    if (error instanceof IdempotencyConflictError) {
      send(response, 409, { error: "IDEMPOTENCY_KEY_CONFLICT" });
      return;
    }
    if (error instanceof TripPublicationNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof M1TripNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof M1StaffTripAccessNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof M1RuntimeAcceptanceFixtureNotFoundError) {
      response.status(404).end();
      return;
    }
    if (error instanceof M1RuntimeAcceptanceFixtureConflictError) {
      const conflictResponse =
        error.recoveryFixtureRunId === null
          ? { error: "runtime_acceptance_fixture_conflict" as const }
          : {
              error: "runtime_acceptance_fixture_conflict" as const,
              recoveryFixtureRunId: error.recoveryFixtureRunId,
            };
      send(
        response,
        409,
        AdminRuntimeAcceptanceFixtureConflictV1ResponseSchema.parse(conflictResponse),
      );
      return;
    }
    if (error instanceof M1StaffPublicationInputError) {
      badRequest(response);
      return;
    }
    if (error instanceof M1InputValidationError) {
      badRequest(response);
      return;
    }
    next(error);
  });
};
