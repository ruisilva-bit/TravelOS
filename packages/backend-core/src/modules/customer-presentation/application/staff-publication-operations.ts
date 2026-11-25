import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "../../trip-operations/application/staff-trip-operations.js";
import type { TripPublicationCandidate } from "./projection.js";

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

export interface PublishTripRequest {
  readonly expectedWorkspaceRevision: bigint;
  readonly expectedProjectionHash: string;
  readonly idempotencyKey: string;
}

export interface WithdrawActivePublicationRequest {
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface TripPublicationWithdrawalResult {
  readonly status: "WITHDRAWN" | "ALREADY_WITHDRAWN";
  readonly tripId: OpaqueId;
  readonly publicationId: OpaqueId | null;
  readonly version: number | null;
  readonly withdrawnAt: string | null;
}

export interface PublicationHistoryEntry {
  readonly version: number;
  readonly publishedAt: string;
  readonly actorReference: string;
  readonly schemaVersion: 1;
  readonly projectionHash: string;
  readonly isActive: boolean;
}

export interface PublicationHistoryPage {
  readonly entries: readonly PublicationHistoryEntry[];
  readonly nextCursor: string | null;
}

export interface TripPublicationResult {
  readonly publicationId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly version: number;
  readonly publishedAt: string;
  readonly schemaVersion: 1;
  readonly projectionHash: string;
  readonly isActive: boolean;
  readonly projection: TripPublicationCandidate["projection"];
}

export interface StaffTripPublicationRepository {
  previewTrip(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripPublicationCandidate>;
  publishTrip(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    request: PublishTripRequest,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripPublicationResult>;
  listPublicationHistory(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
    beforeVersion: number | null,
  ): Promise<PublicationHistoryPage>;
  withdrawActivePublication(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    request: WithdrawActivePublicationRequest,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripPublicationWithdrawalResult>;
}

export interface StaffTripPublicationOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: StaffTripPublicationRepository;
}

export interface StaffTripPublicationOperations {
  previewTrip(cookieHeader: unknown, tripId: unknown): Promise<TripPublicationCandidate>;
  publishTrip(
    cookieHeader: unknown,
    tripId: unknown,
    request: unknown,
  ): Promise<TripPublicationResult>;
  listPublicationHistory(
    cookieHeader: unknown,
    tripId: unknown,
    beforeVersion?: unknown,
  ): Promise<PublicationHistoryPage>;
  withdrawActivePublication(
    cookieHeader: unknown,
    tripId: unknown,
    input: unknown,
  ): Promise<TripPublicationWithdrawalResult>;
}

export class StalePublicationCandidateError extends Error {
  readonly code = "STALE_PUBLICATION_CANDIDATE" as const;

  constructor() {
    super("The trip workspace changed after this publication candidate was previewed");
    this.name = "StalePublicationCandidateError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT" as const;

  constructor() {
    super("The idempotency key was already used for a different publish request");
    this.name = "IdempotencyConflictError";
  }
}

export class StaffPublicationInputError extends Error {
  readonly code = "INVALID_PUBLICATION_REQUEST" as const;

  constructor() {
    super("The publication request is invalid");
    this.name = "M1StaffPublicationInputError";
  }
}

const PREVIEW_PERMISSIONS = Object.freeze([
  "trip.view",
  "trip.preview",
] as const satisfies readonly StaffPermissionId[]);
const PUBLISH_PERMISSIONS = Object.freeze([
  "trip.view",
  "trip.publish",
] as const satisfies readonly StaffPermissionId[]);
const WITHDRAW_PERMISSIONS = Object.freeze([
  "trip.view",
  "trip.withdraw_publication",
] as const satisfies readonly StaffPermissionId[]);
const RECENT_MFA_MAXIMUM_AGE_MS = 5 * 60 * 1_000;

const parseTripId = (value: unknown): OpaqueId => {
  if (typeof value !== "string") throw new StaffPublicationInputError();
  try {
    return asOpaqueId(value);
  } catch {
    throw new StaffPublicationInputError();
  }
};

const parsePublishRequest = (value: unknown): PublishTripRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StaffPublicationInputError();
  }
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).toSorted().join("\u0000") !==
      ["expectedProjectionHash", "expectedWorkspaceRevision", "idempotencyKey"]
        .toSorted()
        .join("\u0000") ||
    typeof request.expectedWorkspaceRevision !== "string" ||
    !/^(0|[1-9][0-9]*)$/u.test(request.expectedWorkspaceRevision) ||
    typeof request.expectedProjectionHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(request.expectedProjectionHash) ||
    typeof request.idempotencyKey !== "string" ||
    request.idempotencyKey.length < 1 ||
    request.idempotencyKey.length > 128 ||
    containsControlCharacter(request.idempotencyKey)
  ) {
    throw new StaffPublicationInputError();
  }
  let expectedWorkspaceRevision: bigint;
  try {
    expectedWorkspaceRevision = BigInt(request.expectedWorkspaceRevision);
  } catch {
    throw new StaffPublicationInputError();
  }
  return {
    expectedWorkspaceRevision,
    expectedProjectionHash: request.expectedProjectionHash,
    idempotencyKey: request.idempotencyKey,
  };
};

const parseWithdrawalRequest = (value: unknown): WithdrawActivePublicationRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StaffPublicationInputError();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new StaffPublicationInputError();
  }
  const request = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(request);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.toSorted().join("\u0000") !== ["idempotencyKey", "reason"].join("\u0000") ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(request, key);
      return (
        descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
      );
    }) ||
    typeof request.reason !== "string" ||
    typeof request.idempotencyKey !== "string"
  ) {
    throw new StaffPublicationInputError();
  }
  const reason = request.reason.trim();
  if (
    reason.length < 1 ||
    reason.length > 500 ||
    containsControlCharacter(reason) ||
    request.idempotencyKey.length < 1 ||
    request.idempotencyKey.length > 128 ||
    containsControlCharacter(request.idempotencyKey)
  ) {
    throw new StaffPublicationInputError();
  }
  return { reason, idempotencyKey: request.idempotencyKey };
};

const parseHistoryCursor = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new StaffPublicationInputError();
  }
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version > 2_147_483_647) {
    throw new StaffPublicationInputError();
  }
  return version;
};

const authorizePublicationOperation = (
  dependencies: StaffTripPublicationOperationsDependencies,
  cookieHeader: unknown,
  permissionIds: readonly StaffPermissionId[],
  requireRecentMfa: boolean,
) =>
  authorizeOperation(
    dependencies,
    cookieHeader,
    null,
    permissionIds,
    requireRecentMfa ? RECENT_MFA_MAXIMUM_AGE_MS : null,
  );

export const createStaffTripPublicationOperations = (
  dependencies: StaffTripPublicationOperationsDependencies,
): StaffTripPublicationOperations => {
  const operations: StaffTripPublicationOperations = {
    async previewTrip(cookieHeader, tripIdValue) {
      const tripId = parseTripId(tripIdValue);
      const authorization = await authorizePublicationOperation(
        dependencies,
        cookieHeader,
        PREVIEW_PERMISSIONS,
        false,
      );
      return dependencies.repository.previewTrip(
        asOpaqueId(authorization.session.agencyId),
        tripId,
        authorization,
      );
    },
    async publishTrip(cookieHeader, tripIdValue, requestValue) {
      const tripId = parseTripId(tripIdValue);
      const request = parsePublishRequest(requestValue);
      const authorization = await authorizePublicationOperation(
        dependencies,
        cookieHeader,
        PUBLISH_PERMISSIONS,
        true,
      );
      return dependencies.repository.publishTrip(
        asOpaqueId(authorization.session.agencyId),
        tripId,
        request,
        authorization,
      );
    },
    async listPublicationHistory(cookieHeader, tripIdValue, cursorValue) {
      const tripId = parseTripId(tripIdValue);
      const beforeVersion = parseHistoryCursor(cursorValue);
      const authorization = await authorizePublicationOperation(
        dependencies,
        cookieHeader,
        PREVIEW_PERMISSIONS,
        false,
      );
      return dependencies.repository.listPublicationHistory(
        asOpaqueId(authorization.session.agencyId),
        tripId,
        authorization,
        beforeVersion,
      );
    },
    async withdrawActivePublication(cookieHeader, tripIdValue, requestValue) {
      const tripId = parseTripId(tripIdValue);
      const request = parseWithdrawalRequest(requestValue);
      const authorization = await authorizePublicationOperation(
        dependencies,
        cookieHeader,
        WITHDRAW_PERMISSIONS,
        true,
      );
      return dependencies.repository.withdrawActivePublication(
        asOpaqueId(authorization.session.agencyId),
        tripId,
        request,
        authorization,
      );
    },
  };
  return Object.freeze(operations);
};
