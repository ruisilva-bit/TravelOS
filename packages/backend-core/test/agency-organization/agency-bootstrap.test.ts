import { describe, expect, it, vi } from "vitest";

import {
  bootstrapRootAgency,
  PERMISSION_REGISTRY_VERSION,
  permissionDefinitionFor,
  ROOT_AGENCY_OWNER_TEMPLATE,
  type RootAgencyBootstrapPort,
} from "../../src/index.js";

const validAgencyId = "abcdef12-3456-7abc-8def-000000000001";
const input = {
  agencyId: validAgencyId,
  bootstrapReference: "agency-bootstrap:test",
  slug: "agency-test",
};

const makePort = (agencyId = validAgencyId): RootAgencyBootstrapPort => ({
  ensureRootAgency: vi.fn(async (value) => ({
    agencyId,
    bootstrapReference: value.bootstrapReference,
    slug: value.slug,
    created: true,
    ownerRoleId: "role-test",
    permissionRegistryVersion: PERMISSION_REGISTRY_VERSION,
  })),
});

describe("root Agency bootstrap identifiers", () => {
  it("rejects noncanonical or non-v7 input before persistence", async () => {
    const port = makePort();

    for (const agencyId of [
      validAgencyId.toUpperCase(),
      ` ${validAgencyId}`,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-7000-7000-000000000001",
      "00000000-0000-7000-8000-00000000000g",
    ]) {
      await expect(bootstrapRootAgency(port, { ...input, agencyId })).rejects.toThrow(
        "canonical lowercase UUIDv7",
      );
    }

    expect(port.ensureRootAgency).not.toHaveBeenCalled();
  });

  it("rejects an incompatible persisted Agency identifier", async () => {
    const port = makePort("00000000-0000-4000-8000-000000000001");

    await expect(bootstrapRootAgency(port, input)).rejects.toThrow("incompatible record");
    expect(port.ensureRootAgency).toHaveBeenCalledOnce();
  });

  it("preserves the Stage 5 cost-mutation capability after the Stage 7 registry extension", () => {
    expect(PERMISSION_REGISTRY_VERSION).toBe(6);
    expect(permissionDefinitionFor("finance.manage_costs")).toEqual({
      id: "finance.manage_costs",
      allowedScopeKinds: ["AGENCY"],
      allowedAccessLevels: ["ALL"],
    });
    expect(ROOT_AGENCY_OWNER_TEMPLATE.permissionIds).toContain("finance.manage_costs");
    for (const permissionId of ["staff.view", "finance.view_prices"] as const) {
      expect(permissionDefinitionFor(permissionId)).toEqual({
        id: permissionId,
        allowedScopeKinds: ["AGENCY"],
        allowedAccessLevels: ["ALL"],
      });
    }
  });
});
