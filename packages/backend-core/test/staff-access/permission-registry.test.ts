import { describe, expect, it } from "vitest";

import {
  isStaffPermissionId,
  OWNER_ROLE_PERMISSION_IDS,
  PERMISSION_REGISTRY_VERSION,
  permissionDefinitionFor,
  TRIP_OPERATIONS_ROLE_PERMISSION_IDS,
} from "../../src/index.js";

describe("Staff permission registry", () => {
  it("keeps the registry version for the M2 Sales capabilities", () => {
    expect(PERMISSION_REGISTRY_VERSION).toBe(8);
  });

  it("no longer defines the customer-grant, withdrawal and runtime-acceptance permissions", () => {
    for (const permissionId of [
      "trip.access.manage",
      "trip.withdraw_publication",
      "runtime_acceptance.fixture.manage",
    ]) {
      expect(isStaffPermissionId(permissionId)).toBe(false);
      expect(OWNER_ROLE_PERMISSION_IDS).not.toContain(permissionId);
      expect(TRIP_OPERATIONS_ROLE_PERMISSION_IDS).not.toContain(permissionId);
    }
  });
});

describe("M2 slice 1 Sales Lead capabilities", () => {
  it("registers sales.view and sales.edit at Agency scope", () => {
    for (const permissionId of ["sales.view", "sales.edit"] as const) {
      expect(isStaffPermissionId(permissionId)).toBe(true);
      expect(permissionDefinitionFor(permissionId)).toEqual({
        id: permissionId,
        allowedScopeKinds: ["AGENCY"],
        allowedAccessLevels: ["ALL"],
      });
    }
  });

  it("grants both capabilities to Owner but leaves trip-operations-v1 without Sales", () => {
    expect(OWNER_ROLE_PERMISSION_IDS).toEqual(expect.arrayContaining(["sales.view", "sales.edit"]));
    expect([...TRIP_OPERATIONS_ROLE_PERMISSION_IDS].toSorted()).toEqual([
      "agency.view",
      "customer.edit",
      "traveller.edit",
      "trip.edit",
      "trip.preview",
      "trip.publish",
      "trip.view",
    ]);
  });
});
