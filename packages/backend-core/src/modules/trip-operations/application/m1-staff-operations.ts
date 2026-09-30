import {
  authorizeStaffRequest,
  type StaffAuthorizationSnapshot,
  type StaffSessionAuthorizationProof,
} from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { M1TripSlice } from "../domain/m1-slice.js";
import {
  validateCreateM1TripSliceInput,
  validateUpdateM1AccommodationInput,
  validateUpdateM1InternalSupplierNoteInput,
  type CreateM1TripSliceInput,
  type M1OperationalSliceRepository,
  type UpdateAccommodationInput,
  type UpdateInternalNoteInput,
} from "./m1-trip-slice.js";

export interface M1StaffSessionResolver {
  /** Resolves an untrusted cookie with the Staff auth realm; callers never provide identity claims. */
  resolveStaffSession(cookieHeader: string): Promise<unknown>;
}

export interface M1StaffAuthorizationRepository {
  getStaffAuthorizationSnapshot(
    staffPrincipalId: string,
  ): Promise<StaffAuthorizationSnapshot | null>;
}

export interface M1StaffTripOperations {
  createTripSlice(cookieHeader: unknown, input: CreateM1TripSliceInput): Promise<M1TripSlice>;
  readTripSlice(cookieHeader: unknown, tripId: OpaqueId): Promise<M1TripSlice | null>;
  updateAccommodation(cookieHeader: unknown, input: UpdateAccommodationInput): Promise<M1TripSlice>;
  updateInternalSupplierNote(
    cookieHeader: unknown,
    input: UpdateInternalNoteInput,
  ): Promise<M1TripSlice>;
}

export interface M1StaffTripOperationsDependencies {
  readonly repository: M1OperationalSliceRepository;
  readonly authorizationRepository: M1StaffAuthorizationRepository;
  readonly sessionResolver: M1StaffSessionResolver;
  readonly nowEpochMs?: () => number;
}

export class M1StaffAuthorizationError extends Error {
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

const M1_COMPOSITE_READ_PERMISSIONS = [
  "customer.view",
  "traveller.view_sensitive",
  "trip.view",
  "reservation.view",
  "finance.view_costs",
] as const satisfies readonly StaffPermissionId[];

const M1_CREATE_PERMISSIONS = [
  ...M1_COMPOSITE_READ_PERMISSIONS,
  "customer.edit",
  "traveller.edit",
  "trip.edit",
  "reservation.edit",
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];

const M1_ACCOMMODATION_EDIT_PERMISSIONS = [
  ...M1_COMPOSITE_READ_PERMISSIONS,
  "trip.edit",
] as const satisfies readonly StaffPermissionId[];

const M1_INTERNAL_NOTE_EDIT_PERMISSIONS = [
  ...M1_COMPOSITE_READ_PERMISSIONS,
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];

const sessionProofFrom = (value: unknown): StaffSessionAuthorizationProof | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).toSorted().join("\u0000");
  const expectedKeys = [
    "agencyId",
    "authorizationEpoch",
    "expiresAtEpochMs",
    "recentMfaVerifiedAtEpochMs",
    "staffPrincipalId",
  ]
    .toSorted()
    .join("\u0000");
  if (actualKeys !== expectedKeys) return null;
  if (
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
    throw new M1StaffAuthorizationError("UNAUTHENTICATED");
  }
  return value;
};

const authorizeM1Operation = async (
  dependencies: M1StaffTripOperationsDependencies,
  cookieHeader: unknown,
  targetAgencyId: OpaqueId | null,
  permissionIds: readonly StaffPermissionId[],
): Promise<OpaqueId> => {
  const cookie = cookieFrom(cookieHeader);
  const session = sessionProofFrom(await dependencies.sessionResolver.resolveStaffSession(cookie));
  if (session === null) throw new M1StaffAuthorizationError("UNAUTHENTICATED");

  const sessionAgencyId = asOpaqueId(session.agencyId);
  if (targetAgencyId !== null && targetAgencyId !== sessionAgencyId) {
    throw new M1StaffAuthorizationError("FORBIDDEN");
  }

  const snapshot = await dependencies.authorizationRepository.getStaffAuthorizationSnapshot(
    session.staffPrincipalId,
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
      recentMfaMaximumAgeMs: null,
    });
    if (decision.result === "DENY") {
      throw new M1StaffAuthorizationError(
        decision.reason === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
      );
    }
  }
  return sessionAgencyId;
};

export const createM1StaffTripOperations = (
  dependencies: M1StaffTripOperationsDependencies,
): M1StaffTripOperations => {
  const operations: M1StaffTripOperations = {
    async createTripSlice(cookieHeader, input) {
      const normalizedInput = validateCreateM1TripSliceInput(input);
      await authorizeM1Operation(
        dependencies,
        cookieHeader,
        normalizedInput.agencyId,
        M1_CREATE_PERMISSIONS,
      );
      return dependencies.repository.createM1TripSlice(normalizedInput);
    },

    async readTripSlice(cookieHeader, tripId) {
      const normalizedTripId = asOpaqueId(tripId);
      const agencyId = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_COMPOSITE_READ_PERMISSIONS,
      );
      return dependencies.repository.getM1TripSlice(agencyId, normalizedTripId);
    },

    async updateAccommodation(cookieHeader, input) {
      const normalizedInput = validateUpdateM1AccommodationInput(input);
      await authorizeM1Operation(
        dependencies,
        cookieHeader,
        normalizedInput.agencyId,
        M1_ACCOMMODATION_EDIT_PERMISSIONS,
      );
      return dependencies.repository.updateAccommodation(normalizedInput);
    },

    async updateInternalSupplierNote(cookieHeader, input) {
      const normalizedInput = validateUpdateM1InternalSupplierNoteInput(input);
      await authorizeM1Operation(
        dependencies,
        cookieHeader,
        normalizedInput.agencyId,
        M1_INTERNAL_NOTE_EDIT_PERMISSIONS,
      );
      return dependencies.repository.updateInternalSupplierNote(normalizedInput);
    },
  };
  return Object.freeze(operations);
};
