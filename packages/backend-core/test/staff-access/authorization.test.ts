import { describe, expect, it } from "vitest";

import {
  authorizeStaffRequest,
  protectsLastActiveOwner,
  type StaffAuthorizationRequest,
} from "../../src/staff-access/authorization.js";

const nowEpochMs = 1_700_000_000_000;
const agencyId = "00000000-0000-4000-8000-000000000001";
const principalId = "staff-principal-1";

const request = (
  overrides: Partial<StaffAuthorizationRequest> = {},
): StaffAuthorizationRequest => ({
  session: {
    staffPrincipalId: principalId,
    agencyId,
    authorizationEpoch: 7n,
    expiresAtEpochMs: nowEpochMs + 60_000,
    recentMfaVerifiedAtEpochMs: nowEpochMs - 1_000,
  },
  snapshot: {
    staffPrincipalId: principalId,
    agencyId,
    membershipState: "ACTIVE",
    authorizationEpoch: 7n,
    assignments: [
      {
        permissionId: "agency.view",
        scopeKind: "AGENCY",
        organizationUnitId: null,
        accessLevel: "ALL",
        active: true,
      },
    ],
  },
  permissionId: "agency.view",
  target: { agencyId, organizationUnitAncestorIds: [], requiredAccessLevel: "ALL" },
  nowEpochMs,
  recentMfaMaximumAgeMs: null,
  ...overrides,
});

describe("Staff authorization default-deny", () => {
  it("denies unauthenticated, missing, inactive, wrong-Agency, stale-epoch and missing-permission cases", () => {
    expect(authorizeStaffRequest(request({ session: null }))).toEqual({
      result: "DENY",
      reason: "UNAUTHENTICATED",
    });
    expect(authorizeStaffRequest(request({ snapshot: null }))).toEqual({
      result: "DENY",
      reason: "NO_MEMBERSHIP",
    });
    expect(
      authorizeStaffRequest(
        request({ snapshot: { ...request().snapshot!, membershipState: "DISABLED" } }),
      ),
    ).toEqual({ result: "DENY", reason: "INACTIVE_MEMBERSHIP" });
    expect(
      authorizeStaffRequest(
        request({
          target: {
            agencyId: "00000000-0000-4000-8000-000000000002",
            organizationUnitAncestorIds: [],
            requiredAccessLevel: "ALL",
          },
        }),
      ),
    ).toEqual({ result: "DENY", reason: "WRONG_AGENCY" });
    expect(
      authorizeStaffRequest(
        request({ snapshot: { ...request().snapshot!, authorizationEpoch: 8n } }),
      ),
    ).toEqual({ result: "DENY", reason: "AUTHORIZATION_EPOCH_MISMATCH" });
    expect(
      authorizeStaffRequest(request({ snapshot: { ...request().snapshot!, assignments: [] } })),
    ).toEqual({
      result: "DENY",
      reason: "MISSING_PERMISSION",
    });
  });

  it("requires a current MFA proof only when the command declares it", () => {
    expect(
      authorizeStaffRequest(
        request({
          recentMfaMaximumAgeMs: 30_000,
          session: { ...request().session!, recentMfaVerifiedAtEpochMs: nowEpochMs - 31_000 },
        }),
      ),
    ).toEqual({ result: "DENY", reason: "MISSING_RECENT_MFA" });
    expect(
      authorizeStaffRequest(
        request({
          recentMfaMaximumAgeMs: 30_000,
          session: { ...request().session!, recentMfaVerifiedAtEpochMs: nowEpochMs - 1_000 },
        }),
      ),
    ).toEqual({ result: "ALLOW", permissionId: "agency.view" });
  });

  it("protects exactly the last active Owner without blocking unrelated changes", () => {
    expect(
      protectsLastActiveOwner({
        activeOwnerMembershipCount: 1,
        operationRemovesOwnerMembership: true,
      }),
    ).toBe(true);
    expect(
      protectsLastActiveOwner({
        activeOwnerMembershipCount: 2,
        operationRemovesOwnerMembership: true,
      }),
    ).toBe(false);
    expect(
      protectsLastActiveOwner({
        activeOwnerMembershipCount: 1,
        operationRemovesOwnerMembership: false,
      }),
    ).toBe(false);
  });
});
