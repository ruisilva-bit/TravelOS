import { describe, expect, it, vi } from "vitest";
import { asOpaqueId } from "../../src/shared-kernel/opaque-id.js";
import type { M1StaffAuthorizationError } from "../../src/modules/trip-operations/application/m1-staff-operations.js";
import { createM1StaffTripAccessOperations } from "../../src/modules/portal-access/application/staff-trip-access-operations.js";
import type { StaffPermissionId } from "../../src/staff-access/permission-registry.js";

const agencyId = asOpaqueId("abcdef12-3456-7abc-8def-000000000001");
const fixtureRunId = asOpaqueId("abcdef12-3456-7abc-8def-000000000002");
const principalId = "synthetic-portal-principal-1";
const nowEpochMs = Date.parse("2026-10-20T12:00:00.000Z");
const requiredPermissions = [
  "runtime_acceptance.fixture.manage",
  "trip.access.manage",
] as const satisfies readonly StaffPermissionId[];
const result = {
  portalPrincipalId: principalId,
  retiredAt: "2026-10-20T12:00:00.000Z",
  authorizationEpoch: 2n,
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
    issueTripAccessGrant: vi.fn(async () => null),
    revokeTripAccessGrant: vi.fn(async () => null),
    retireFixturePortalPrincipal: vi.fn(
      async (
        _command: unknown,
        _proof: {
          readonly session: { readonly staffPrincipalId: string; readonly agencyId: string };
          readonly requiredPermissionIds: readonly StaffPermissionId[];
        },
      ) => result,
    ),
  };
  const operations = createM1StaffTripAccessOperations({
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

type Retire = (
  cookieHeader: unknown,
  targetFixtureRunId: unknown,
  targetPrincipalId: unknown,
) => Promise<unknown>;
const retireFrom = (operations: unknown): Retire =>
  (operations as { readonly retireFixturePortalPrincipal: Retire }).retireFixturePortalPrincipal;

describe("registered runtime-acceptance Portal principal retirement", () => {
  it("requires both fixture and Trip-access permissions plus recent MFA", async () => {
    const missingPermission = makeContext({ permissions: ["trip.access.manage"] });
    await expect(
      retireFrom(missingPermission.operations)("staff-cookie", fixtureRunId, principalId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<M1StaffAuthorizationError>);
    expect(missingPermission.repository.retireFixturePortalPrincipal).not.toHaveBeenCalled();

    const staleMfa = makeContext({ recentMfaVerifiedAtEpochMs: nowEpochMs - 301_000 });
    await expect(
      retireFrom(staleMfa.operations)("staff-cookie", fixtureRunId, principalId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<M1StaffAuthorizationError>);
    expect(staleMfa.repository.retireFixturePortalPrincipal).not.toHaveBeenCalled();
  });

  it("derives Agency and Staff actor from the authenticated session and retires only the linked principal", async () => {
    const context = makeContext();

    await expect(
      retireFrom(context.operations)("staff-cookie", fixtureRunId, principalId),
    ).resolves.toEqual(result);
    const [command, proof] = vi.mocked(context.repository.retireFixturePortalPrincipal).mock
      .calls[0]!;
    expect(command).toEqual({
      agencyId,
      fixtureRunId,
      portalPrincipalId: principalId,
      reason: "RUNTIME_ACCEPTANCE_CLEANUP",
    });
    expect(proof).toMatchObject({
      session: { staffPrincipalId: "staff-principal-1", agencyId },
      requiredPermissionIds: requiredPermissions,
    });
  });
});
