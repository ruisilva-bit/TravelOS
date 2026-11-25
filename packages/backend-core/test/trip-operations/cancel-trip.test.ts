import { describe, expect, it, vi } from "vitest";
import { asOpaqueId } from "../../src/shared-kernel/opaque-id.js";
import { createStaffTripOperations } from "../../src/modules/trip-operations/application/staff-trip-operations.js";
import {
  InputValidationError,
  OptimisticConflictError,
} from "../../src/modules/trip-operations/application/trip-slice.js";
import type { StaffPermissionId } from "../../src/staff-access/permission-registry.js";

const agencyId = asOpaqueId("abcdef12-3456-7abc-8def-000000000001");
const tripId = asOpaqueId("abcdef12-3456-7abc-8def-000000000002");
const nowEpochMs = Date.parse("2026-10-20T12:00:00.000Z");
const requiredPermissions = [
  "customer.view",
  "traveller.view_sensitive",
  "trip.view",
  "reservation.view",
  "finance.view_costs",
  "trip.edit",
] as const satisfies readonly StaffPermissionId[];

const cancelledSlice = {
  trip: {
    id: tripId,
    agencyId,
    title: "Synthetic acceptance trip",
    startDate: "2026-10-20",
    endDate: "2026-10-21",
    state: "CANCELLED",
    workspaceRevision: 4n,
    lockVersion: 3n,
  },
} as never;

const makeContext = ({
  permissions = requiredPermissions,
  recentMfaVerifiedAtEpochMs = nowEpochMs - 60_000,
  cancelResult = cancelledSlice,
  cancelError,
}: {
  readonly permissions?: readonly StaffPermissionId[];
  readonly recentMfaVerifiedAtEpochMs?: number | null;
  readonly cancelResult?: unknown;
  readonly cancelError?: Error;
} = {}) => {
  const session = {
    sessionId: "staff-session-1",
    staffPrincipalId: "staff-principal-1",
    agencyId,
    authorizationEpoch: 1n,
    expiresAtEpochMs: nowEpochMs + 60_000,
    recentMfaVerifiedAtEpochMs,
  };
  const repository = {
    createTripSlice: vi.fn(async () => cancelledSlice),
    getTripSlice: vi.fn(async () => cancelledSlice),
    updateAccommodation: vi.fn(async () => cancelledSlice),
    updateInternalSupplierNote: vi.fn(async () => cancelledSlice),
    cancelTrip: vi.fn(
      async (
        _command: unknown,
        _proof: {
          readonly session: { readonly staffPrincipalId: string; readonly agencyId: string };
          readonly requiredPermissionIds: readonly StaffPermissionId[];
        },
      ) => {
        if (cancelError !== undefined) throw cancelError;
        return cancelResult;
      },
    ),
  };
  const operations = createStaffTripOperations({
    repository: repository as never,
    authorizationRepository: {
      getStaffAuthorizationSnapshot: vi.fn(async () => ({
        staffPrincipalId: session.staffPrincipalId,
        agencyId,
        membershipState: "ACTIVE" as const,
        authorizationEpoch: session.authorizationEpoch,
        assignments: permissions.map((permissionId) => ({
          agencyId,
          permissionId,
          scopeKind: "AGENCY" as const,
          organizationUnitId: null,
          accessLevel: "ALL" as const,
          active: true,
        })),
      })),
    },
    sessionResolver: { resolveStaffSession: vi.fn(async () => session) },
    nowEpochMs: () => nowEpochMs,
  });
  return { operations, repository };
};

type CancelTrip = (cookieHeader: unknown, input: unknown) => Promise<unknown>;
const cancelTripFrom = (operations: unknown): CancelTrip =>
  (operations as { readonly cancelTrip: CancelTrip }).cancelTrip;

describe("supported Staff Trip cancellation", () => {
  it("rejects stale versions and unsupported terminal states with typed errors", async () => {
    const stale = makeContext({ cancelError: new OptimisticConflictError() });
    await expect(
      cancelTripFrom(stale.operations)("staff-cookie", {
        tripId,
        expectedLockVersion: "2",
        idempotencyKey: "cancel-001",
      }),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONFLICT" });

    const completedError = Object.assign(new Error("Trip state cannot be cancelled"), {
      code: "UNSUPPORTED_TRIP_STATE",
    });
    const completed = makeContext({ cancelError: completedError });
    await expect(
      cancelTripFrom(completed.operations)("staff-cookie", {
        tripId,
        expectedLockVersion: "3",
        idempotencyKey: "cancel-002",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TRIP_STATE" });
  });

  it("returns the cancelled Trip for a repeated cancellation", async () => {
    const context = makeContext();
    const cancelTrip = cancelTripFrom(context.operations);
    const input = { tripId, expectedLockVersion: "3", idempotencyKey: "cancel-repeat" };

    await expect(cancelTrip("staff-cookie", input)).resolves.toEqual(cancelledSlice);
    await expect(cancelTrip("staff-cookie", input)).resolves.toEqual(cancelledSlice);
    expect(context.repository.cancelTrip).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown fields, malformed versions and missing recent MFA before persistence", async () => {
    const context = makeContext();
    const cancelTrip = cancelTripFrom(context.operations);

    await expect(
      cancelTrip("staff-cookie", {
        tripId,
        expectedLockVersion: "3",
        idempotencyKey: "cancel-003",
        agencyId,
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      cancelTrip("staff-cookie", {
        tripId,
        expectedLockVersion: "03",
        idempotencyKey: "cancel-004",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);

    const staleMfa = makeContext({ recentMfaVerifiedAtEpochMs: nowEpochMs - 301_000 });
    await expect(
      cancelTripFrom(staleMfa.operations)("staff-cookie", {
        tripId,
        expectedLockVersion: "3",
        idempotencyKey: "cancel-005",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(context.repository.cancelTrip).not.toHaveBeenCalled();
    expect(staleMfa.repository.cancelTrip).not.toHaveBeenCalled();
  });

  it("requires trip.edit in the authenticated Agency and passes the verified proof", async () => {
    const context = makeContext({
      permissions: requiredPermissions.filter((id) => id !== "trip.edit"),
    });
    const cancelTrip = cancelTripFrom(context.operations);

    await expect(
      cancelTrip("staff-cookie", {
        tripId,
        expectedLockVersion: "3",
        idempotencyKey: "cancel-006",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(context.repository.cancelTrip).not.toHaveBeenCalled();

    const allowed = makeContext();
    await cancelTripFrom(allowed.operations)("staff-cookie", {
      tripId,
      expectedLockVersion: "3",
      idempotencyKey: "cancel-007",
    });
    const [command, proof] = vi.mocked(allowed.repository.cancelTrip).mock.calls[0]!;
    expect(command).toMatchObject({
      tripId,
      expectedLockVersion: 3n,
      idempotencyKey: "cancel-007",
    });
    expect(proof.session.staffPrincipalId).toBe("staff-principal-1");
    expect(proof.session.agencyId).toBe(agencyId);
    expect(proof.requiredPermissionIds).toEqual(requiredPermissions);
  });
});
