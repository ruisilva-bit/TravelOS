import { describe, expect, it } from "vitest";

import {
  isStaffPermissionId,
  OWNER_ROLE_PERMISSION_IDS,
  PERMISSION_REGISTRY_VERSION,
  permissionDefinitionFor,
} from "../../src/index.js";

const tripAccessManage = "trip.access.manage";
const stage7CleanupPermissions = [
  "trip.withdraw_publication",
  "runtime_acceptance.fixture.manage",
] as const;

describe("Stage 7 TripAccessGrant Staff capability", () => {
  it("advances the permission registry to version 6", () => {
    expect(PERMISSION_REGISTRY_VERSION).toBe(6);
  });

  it("defines the grant-management capability at Agency scope", () => {
    expect(isStaffPermissionId(tripAccessManage)).toBe(true);
    if (isStaffPermissionId(tripAccessManage)) {
      expect(permissionDefinitionFor(tripAccessManage)).toEqual({
        id: tripAccessManage,
        allowedScopeKinds: ["AGENCY"],
        allowedAccessLevels: ["ALL"],
      });
    }
  });

  it("includes the capability in the default Owner permission set", () => {
    expect(OWNER_ROLE_PERMISSION_IDS).toContain(tripAccessManage);
  });

  it("defines withdrawal and fixture-management permissions at Agency scope", () => {
    for (const permissionId of stage7CleanupPermissions) {
      expect(isStaffPermissionId(permissionId)).toBe(true);
      if (isStaffPermissionId(permissionId)) {
        expect(permissionDefinitionFor(permissionId)).toEqual({
          id: permissionId,
          allowedScopeKinds: ["AGENCY"],
          allowedAccessLevels: ["ALL"],
        });
      }
    }
  });

  it("includes both cleanup capabilities in the default Owner permission set", () => {
    expect(OWNER_ROLE_PERMISSION_IDS).toEqual(
      expect.arrayContaining([...stage7CleanupPermissions]),
    );
  });
});
