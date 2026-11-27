import {
  authorizeStaffRequest,
  type StaffAuthorizationOperationProof,
  type StaffAuthorizationSnapshot,
  type StaffSessionAuthorizationProof,
} from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { TripSlice, Trip } from "../domain/trip-slice.js";
import {
  validateCreateTripWorkspaceInput,
  validateCreateTripSliceInput,
  validateUpdateAccommodationInput,
  validateUpdateInternalSupplierNoteInput,
  type CreateTripWorkspaceInput,
  type CreateTripSliceInput,
  type OperationalSliceRepository,
  type UpdateAccommodationInput,
  type UpdateInternalNoteInput,
} from "./trip-slice.js";

export interface StaffSessionResolver {
  /** Resolves an untrusted cookie with the Staff auth realm; callers never provide identity claims. */
  resolveStaffSession(cookieHeader: string): Promise<unknown>;
}

export interface StaffAuthorizationRepository {
  getStaffAuthorizationSnapshot(
    staffPrincipalId: string,
    agencyId: OpaqueId,
  ): Promise<StaffAuthorizationSnapshot | null>;
}

export interface StaffTripOperations {
  createTripWorkspace(cookieHeader: unknown, input: CreateTripWorkspaceInput): Promise<Trip>;
  createTripSlice(cookieHeader: unknown, input: CreateTripSliceInput): Promise<TripSlice>;
  readTripSlice(cookieHeader: unknown, tripId: OpaqueId): Promise<TripSlice | null>;
  updateAccommodation(cookieHeader: unknown, input: UpdateAccommodationInput): Promise<TripSlice>;
  updateInternalSupplierNote(
    cookieHeader: unknown,
    input: UpdateInternalNoteInput,
  ): Promise<TripSlice>;
}

export interface StaffAuthorizationDependencies {
  readonly authorizationRepository: StaffAuthorizationRepository;
  readonly sessionResolver: StaffSessionResolver;
  readonly nowEpochMs?: () => number;
}

export interface StaffTripOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: OperationalSliceRepository;
}

export class StaffAuthorizationError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN";

  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(
      code === "UNAUTHENTICATED"
        ? "Staff authentication is required"
        : "Staff authorization denied",
    );
    this.name = "M1StaffAuthorizationError";
    this.code = code;
  }
}

const COMPOSITE_READ_PERMISSIONS = Object.freeze([
  "customer.view",
  "traveller.view_sensitive",
  "trip.view",
  "reservation.view",
  "finance.view_costs",
] as const satisfies readonly StaffPermissionId[]);

const CREATE_PERMISSIONS = Object.freeze([
  ...COMPOSITE_READ_PERMISSIONS,
  "customer.edit",
  "traveller.edit",
  "trip.edit",
  "reservation.edit",
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[]);

const TRIP_WORKSPACE_CREATE_PERMISSIONS = Object.freeze([
  "customer.edit",
  "traveller.edit",
  "trip.edit",
  "trip.view",
] as const satisfies readonly StaffPermissionId[]);

const ACCOMMODATION_EDIT_PERMISSIONS = Object.freeze([
  ...COMPOSITE_READ_PERMISSIONS,
  "trip.edit",
] as const satisfies readonly StaffPermissionId[]);

const INTERNAL_NOTE_EDIT_PERMISSIONS = Object.freeze([
  ...COMPOSITE_READ_PERMISSIONS,
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[]);

/** Fixed policy per operation; persistence adapters enforce it independently of caller input. */
export const OPERATION_PERMISSION_REQUIREMENTS = Object.freeze({
  CREATE: CREATE_PERMISSIONS,
  WORKSPACE_CREATE: TRIP_WORKSPACE_CREATE_PERMISSIONS,
  READ: COMPOSITE_READ_PERMISSIONS,
  ACCOMMODATION_EDIT: ACCOMMODATION_EDIT_PERMISSIONS,
  INTERNAL_NOTE_EDIT: INTERNAL_NOTE_EDIT_PERMISSIONS,
});

const sessionProofFrom = (value: unknown): StaffSessionAuthorizationProof | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).toSorted().join("\u0000");
  const expectedKeys = [
    "agencyId",
    "authorizationEpoch",
    "expiresAtEpochMs",
    "recentMfaVerifiedAtEpochMs",
    "sessionId",
    "staffPrincipalId",
  ]
    .toSorted()
    .join("\u0000");
  if (actualKeys !== expectedKeys) return null;
  if (
    typeof record.sessionId !== "string" ||
    record.sessionId.length === 0 ||
    typeof record.staffPrincipalId !== "string" ||
    record.staffPrincipalId.length === 0 ||
    typeof record.agencyId !== "string" ||
    typeof record.authorizationEpoch !== "bigint" ||
    record.authorizationEpoch < 0n ||
    typeof record.expiresAtEpochMs !== "number" ||
    !Number.isFinite(record.expiresAtEpochMs) ||
    (record.recentMfaVerifiedAtEpochMs !== null &&
      (typeof record.recentMfaVerifiedAtEpochMs !== "number" ||
        !Number.isFinite(record.recentMfaVerifiedAtEpochMs)))
  ) {
    return null;
  }
  try {
    asOpaqueId(record.agencyId);
  } catch {
    return null;
  }
  return {
    sessionId: record.sessionId,
    staffPrincipalId: record.staffPrincipalId,
    agencyId: record.agencyId,
    authorizationEpoch: record.authorizationEpoch,
    expiresAtEpochMs: record.expiresAtEpochMs,
    recentMfaVerifiedAtEpochMs: record.recentMfaVerifiedAtEpochMs,
  };
};

const cookieFrom = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8_192 ||
    value.includes("\u0000") ||
    /[\r\n]/u.test(value)
  ) {
    throw new StaffAuthorizationError("UNAUTHENTICATED");
  }
  return value;
};

export const authorizeOperation = async (
  dependencies: StaffAuthorizationDependencies,
  cookieHeader: unknown,
  targetAgencyId: OpaqueId | null,
  permissionIds: readonly StaffPermissionId[],
  recentMfaMaximumAgeMs: number | null = null,
): Promise<StaffAuthorizationOperationProof> => {
  const cookie = cookieFrom(cookieHeader);
  const session = sessionProofFrom(await dependencies.sessionResolver.resolveStaffSession(cookie));
  if (session === null) throw new StaffAuthorizationError("UNAUTHENTICATED");

  const sessionAgencyId = asOpaqueId(session.agencyId);
  if (targetAgencyId !== null && targetAgencyId !== sessionAgencyId) {
    throw new StaffAuthorizationError("FORBIDDEN");
  }

  const snapshot = await dependencies.authorizationRepository.getStaffAuthorizationSnapshot(
    session.staffPrincipalId,
    sessionAgencyId,
  );
  const nowEpochMs = (dependencies.nowEpochMs ?? Date.now)();
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    throw new Error("M1 Staff authorization clock is invalid");
  }
  for (const permissionId of permissionIds) {
    const decision = authorizeStaffRequest({
      session,
      snapshot,
      permissionId,
      target: {
        agencyId: sessionAgencyId,
        organizationUnitAncestorIds: [],
        requiredAccessLevel: "ALL",
      },
      nowEpochMs,
      recentMfaMaximumAgeMs,
    });
    if (decision.result === "DENY") {
      throw new StaffAuthorizationError(
        decision.reason === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
      );
    }
  }
  return {
    session,
    requiredPermissionIds: permissionIds,
    nowEpochMs,
  };
};

export const createStaffTripOperations = (
  dependencies: StaffTripOperationsDependencies,
): StaffTripOperations => {
  const operations: StaffTripOperations = {
    async createTripWorkspace(cookieHeader, input) {
      const normalizedInput = validateCreateTripWorkspaceInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        TRIP_WORKSPACE_CREATE_PERMISSIONS,
      );
      return dependencies.repository.createTripWorkspace(normalizedInput, authorization);
    },

    async createTripSlice(cookieHeader, input) {
      const normalizedInput = validateCreateTripSliceInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        normalizedInput.agencyId,
        CREATE_PERMISSIONS,
      );
      return dependencies.repository.createTripSlice(normalizedInput, authorization);
    },

    async readTripSlice(cookieHeader, tripId) {
      const normalizedTripId = asOpaqueId(tripId);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        COMPOSITE_READ_PERMISSIONS,
      );
      return dependencies.repository.getTripSlice(
        asOpaqueId(authorization.session.agencyId),
        normalizedTripId,
        authorization,
      );
    },

    async updateAccommodation(cookieHeader, input) {
      const normalizedInput = validateUpdateAccommodationInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        normalizedInput.agencyId,
        ACCOMMODATION_EDIT_PERMISSIONS,
      );
      return dependencies.repository.updateAccommodation(normalizedInput, authorization);
    },

    async updateInternalSupplierNote(cookieHeader, input) {
      const normalizedInput = validateUpdateInternalSupplierNoteInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        normalizedInput.agencyId,
        INTERNAL_NOTE_EDIT_PERMISSIONS,
      );
      return dependencies.repository.updateInternalSupplierNote(normalizedInput, authorization);
    },
  };
  return Object.freeze(operations);
};
