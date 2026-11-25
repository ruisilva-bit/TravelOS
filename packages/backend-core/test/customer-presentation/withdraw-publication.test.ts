import { describe, expect, it, vi } from "vitest";
import { asOpaqueId } from "../../src/shared-kernel/opaque-id.js";
import type { StaffAuthorizationError } from "../../src/modules/trip-operations/application/staff-trip-operations.js";
import { StaffPublicationInputError } from "../../src/modules/customer-presentation/application/staff-publication-operations.js";
import { createStaffTripPublicationOperations } from "../../src/modules/customer-presentation/application/staff-publication-operations.js";
import type { StaffPermissionId } from "../../src/staff-access/permission-registry.js";

const agencyId = asOpaqueId("abcdef12-3456-7abc-8def-000000000001");
const tripId = asOpaqueId("abcdef12-3456-7abc-8def-000000000002");
const publicationId = asOpaqueId("abcdef12-3456-7abc-8def-000000000003");
const nowEpochMs = Date.parse("2026-10-20T12:00:00.000Z");
const requiredPermissions = [
  "trip.view",
  "trip.withdraw_publication",
] as const satisfies readonly StaffPermissionId[];
const withdrawalResult = {
  status: "WITHDRAWN",
  tripId,
  publicationId,
  version: 2,
  withdrawnAt: "2026-10-20T12:00:00.000Z",
};

const makeContext = ({
  permissions = requiredPermissions,
  recentMfaVerifiedAtEpochMs = nowEpochMs - 60_000,
}: {
  readonly permissions?: readonly StaffPermissionId[];
  readonly recentMfaVerifiedAtEpochMs?: number | null;
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
    previewTrip: vi.fn(async () => ({}) as never),
    publishTrip: vi.fn(async () => ({}) as never),
    listPublicationHistory: vi.fn(async () => ({ entries: [], nextCursor: null })),
    withdrawActivePublication: vi.fn(
      async (_agencyId: unknown, _tripId: unknown, _input: unknown, _proof: unknown) =>
        withdrawalResult,
    ),
  };
  const operations = createStaffTripPublicationOperations({
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

type Withdraw = (cookieHeader: unknown, targetTripId: unknown, input: unknown) => Promise<unknown>;
const withdrawFrom = (operations: unknown): Withdraw =>
  (operations as { readonly withdrawActivePublication: Withdraw }).withdrawActivePublication;

describe("Staff active publication withdrawal", () => {
  it("requires a non-empty reason and rejects caller fields outside the allowlist", async () => {
    const context = makeContext();
    const withdraw = withdrawFrom(context.operations);

    await expect(
      withdraw("staff-cookie", tripId, { reason: "  ", idempotencyKey: "withdraw-001" }),
    ).rejects.toBeInstanceOf(StaffPublicationInputError);
    await expect(
      withdraw("staff-cookie", tripId, {
        reason: "acceptance cleanup",
        idempotencyKey: "withdraw-002",
        publicationId,
      }),
    ).rejects.toBeInstanceOf(StaffPublicationInputError);
    expect(context.repository.withdrawActivePublication).not.toHaveBeenCalled();
  });

  it("requires recent MFA and the explicit withdrawal permission", async () => {
    const staleMfa = makeContext({ recentMfaVerifiedAtEpochMs: nowEpochMs - 301_000 });
    await expect(
      withdrawFrom(staleMfa.operations)("staff-cookie", tripId, {
        reason: "acceptance cleanup",
        idempotencyKey: "withdraw-003",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<StaffAuthorizationError>);
    expect(staleMfa.repository.withdrawActivePublication).not.toHaveBeenCalled();

    const missingPermission = makeContext({
      permissions: ["trip.view"],
    });
    await expect(
      withdrawFrom(missingPermission.operations)("staff-cookie", tripId, {
        reason: "acceptance cleanup",
        idempotencyKey: "withdraw-004",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<StaffAuthorizationError>);
    expect(missingPermission.repository.withdrawActivePublication).not.toHaveBeenCalled();
  });

  it("passes the normalized reason and idempotency key under the authenticated Agency", async () => {
    const context = makeContext();
    const request = { reason: "  acceptance cleanup  ", idempotencyKey: "withdraw-005" };

    await expect(
      withdrawFrom(context.operations)("staff-cookie", tripId, request),
    ).resolves.toEqual(withdrawalResult);
    const [targetAgencyId, targetTripId, normalizedRequest, proof] = vi.mocked(
      context.repository.withdrawActivePublication,
    ).mock.calls[0]!;
    expect(targetAgencyId).toBe(agencyId);
    expect(targetTripId).toBe(tripId);
    expect(normalizedRequest).toEqual({
      reason: "acceptance cleanup",
      idempotencyKey: "withdraw-005",
    });
    expect(proof).toMatchObject({
      session: { staffPrincipalId: "staff-principal-1", agencyId },
      requiredPermissionIds: requiredPermissions,
    });
  });
});
