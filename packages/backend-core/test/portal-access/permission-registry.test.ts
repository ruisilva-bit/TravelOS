import { describe, expect, it } from "vitest";

import {
  isStaffPermissionId,
  OWNER_ROLE_PERMISSION_IDS,
  PERMISSION_REGISTRY_VERSION,
  permissionDefinitionFor,
} from "../../src/index.js";

const tripAccessManage = "trip.access.manage";

describe("Stage 7 TripAccessGrant Staff capability", () => {
  it("advances the permission registry to version 5", () => {
    expect(PERMISSION_REGISTRY_VERSION).toBe(5);
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
});
