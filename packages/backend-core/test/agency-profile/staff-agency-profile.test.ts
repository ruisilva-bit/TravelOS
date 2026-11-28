import { describe, expect, it, vi } from "vitest";

import {
  AgencyProfileNotFoundError,
  InputValidationError,
  OptimisticConflictError,
  StaffAuthorizationError,
  agencyContactProfile,
  asOpaqueId,
  createStaffAgencyProfileOperations,
  validateAgencyProfileDraft,
  type AgencyProfile,
  type AgencyProfileRepository,
  type OpaqueId,
  type StaffPermissionId,
} from "../../src/index.js";

const id = (n: number): OpaqueId =>
  asOpaqueId(`abcdef12-3456-7abc-8def-${n.toString().padStart(12, "0")}`);

const agencyId = id(1);
const nowEpochMs = Date.parse("2026-11-28T10:00:00.000Z");
const cookie = "staff-session-cookie";

const profile = (overrides: Partial<AgencyProfile> = {}): AgencyProfile => ({
  agencyId,
  displayName: "Agência Exemplo",
  email: "contacto@agencia.example.test",
  phone: "+351 210 000 000",
  website: "https://agencia.example.test",
  lockVersion: 3n,
  ...overrides,
});

const makeOperations = (
  permissions: readonly StaffPermissionId[],
  repositoryOverrides: Partial<AgencyProfileRepository> = {},
) => {
  const repository: AgencyProfileRepository = {
    readProfile: vi.fn(async () => profile()),
    updateProfile: vi.fn(async () => profile({ lockVersion: 4n })),
    ...repositoryOverrides,
  };
  const authorizationRepository = {
    getStaffAuthorizationSnapshot: vi.fn(async () => ({
      staffPrincipalId: "staff-principal-1",
      agencyId,
      membershipState: "ACTIVE" as const,
      authorizationEpoch: 2n,
      assignments: permissions.map((permissionId) => ({
        agencyId,
        permissionId,
        scopeKind: "AGENCY" as const,
        organizationUnitId: null,
        accessLevel: "ALL" as const,
        active: true,
      })),
    })),
  };
  const operations = createStaffAgencyProfileOperations({
    repository,
    authorizationRepository,
    sessionResolver: {
      resolveStaffSession: vi.fn(async () => ({
        sessionId: "staff-session-1",
        staffPrincipalId: "staff-principal-1",
        agencyId,
        authorizationEpoch: 2n,
        expiresAtEpochMs: nowEpochMs + 60_000,
        recentMfaVerifiedAtEpochMs: null,
      })),
    },
    nowEpochMs: () => nowEpochMs,
  });
  return { operations, repository };
};

const validDraft = {
  displayName: "  Agência Exemplo  ",
  email: "contacto@agencia.example.test",
  phone: "+351 210 000 000",
  website: "https://agencia.example.test",
};

describe("agency profile validation", () => {
  it("trims the name and turns blank optional fields into null", () => {
    expect(
      validateAgencyProfileDraft({ ...validDraft, email: "  ", phone: "", website: null }),
    ).toEqual({
      displayName: "Agência Exemplo",
      email: null,
      phone: null,
      website: null,
    });
  });

  it("rejects a blank or over-long display name", () => {
    expect(() => validateAgencyProfileDraft({ ...validDraft, displayName: "   " })).toThrow(
      InputValidationError,
    );
    expect(() =>
      validateAgencyProfileDraft({ ...validDraft, displayName: "A".repeat(121) }),
    ).toThrow(InputValidationError);
  });

  it("rejects malformed contact fields and non-https websites", () => {
    expect(() => validateAgencyProfileDraft({ ...validDraft, email: "not-an-email" })).toThrow(
      InputValidationError,
    );
    expect(() => validateAgencyProfileDraft({ ...validDraft, phone: "call me <b>" })).toThrow(
      InputValidationError,
    );
    expect(() =>
      validateAgencyProfileDraft({ ...validDraft, website: "http://agencia.example.test" }),
    ).toThrow(InputValidationError);
  });

  it("rejects unknown shapes and control characters", () => {
    expect(() => validateAgencyProfileDraft("nope")).toThrow(InputValidationError);
    expect(() =>
      validateAgencyProfileDraft({ ...validDraft, displayName: "Agência\u0007" }),
    ).toThrow(InputValidationError);
  });

  it("projects only the customer-facing contact fields", () => {
    expect(agencyContactProfile(profile({ website: null, phone: null }))).toEqual({
      displayName: "Agência Exemplo",
      email: "contacto@agencia.example.test",
    });
  });
});

describe("staff agency profile operations", () => {
  it("reads the profile for a caller holding agency.view", async () => {
    const { operations } = makeOperations(["agency.view"]);
    await expect(operations.getProfile(cookie)).resolves.toMatchObject({
      displayName: "Agência Exemplo",
    });
  });

  it("denies a read without agency.view before touching the repository", async () => {
    const { operations, repository } = makeOperations([]);
    await expect(operations.getProfile(cookie)).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(vi.mocked(repository.readProfile)).not.toHaveBeenCalled();
  });

  it("denies an update without agency.manage_settings, even with agency.view", async () => {
    const { operations, repository } = makeOperations(["agency.view"]);
    await expect(
      operations.updateProfile(cookie, { expectedLockVersion: 3n, profile: validDraft }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(vi.mocked(repository.updateProfile)).not.toHaveBeenCalled();
  });

  it("writes a valid update with the expected lock version", async () => {
    const { operations, repository } = makeOperations(["agency.view", "agency.manage_settings"]);
    const updated = await operations.updateProfile(cookie, {
      expectedLockVersion: 3n,
      profile: validDraft,
    });
    expect(updated.lockVersion).toBe(4n);
    expect(vi.mocked(repository.updateProfile)).toHaveBeenCalledWith(
      agencyId,
      3n,
      {
        displayName: "Agência Exemplo",
        email: "contacto@agencia.example.test",
        phone: "+351 210 000 000",
        website: "https://agencia.example.test",
      },
      expect.objectContaining({ session: expect.objectContaining({ agencyId }) }),
    );
  });

  it("rejects an invalid draft before any write", async () => {
    const { operations, repository } = makeOperations(["agency.manage_settings"]);
    await expect(
      operations.updateProfile(cookie, {
        expectedLockVersion: 3n,
        profile: { ...validDraft, website: "http://insecure.example.test" },
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(vi.mocked(repository.updateProfile)).not.toHaveBeenCalled();
  });

  it("rejects a non-positive expected lock version", async () => {
    const { operations } = makeOperations(["agency.manage_settings"]);
    await expect(
      operations.updateProfile(cookie, { expectedLockVersion: 0n, profile: validDraft }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("surfaces a stale lock version as an optimistic conflict", async () => {
    const { operations } = makeOperations(["agency.manage_settings"], {
      updateProfile: vi.fn(async () => {
        throw new OptimisticConflictError();
      }),
    });
    await expect(
      operations.updateProfile(cookie, { expectedLockVersion: 1n, profile: validDraft }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);
  });

  it("fails closed when the Agency row is missing", async () => {
    const { operations } = makeOperations(["agency.view"], {
      readProfile: vi.fn(async () => null),
    });
    await expect(operations.getProfile(cookie)).rejects.toBeInstanceOf(AgencyProfileNotFoundError);
  });
});
