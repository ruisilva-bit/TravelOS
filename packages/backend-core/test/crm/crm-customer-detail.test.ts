import { describe, expect, it, vi } from "vitest";

import {
  asOpaqueId,
  createStaffCrmOperations,
  type CrmCustomerDetailRecord,
  type CrmRepository,
  type OpaqueId,
  type StaffPermissionId,
} from "../../src/index.js";

const id = (n: number): OpaqueId =>
  asOpaqueId(`abcdef12-3456-7abc-8def-${n.toString().padStart(12, "0")}`);

const agencyId = id(1);
const customerId = id(2);
const nowEpochMs = Date.parse("2026-11-28T10:00:00.000Z");
const cookie = "staff-session-cookie";

const detailRecord = (): CrmCustomerDetailRecord => ({
  id: customerId,
  agencyId,
  displayName: "Família Quintela",
  email: null,
  phone: null,
  notes: null,
  lockVersion: 1n,
  createdAt: "2026-11-25T10:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
  people: [
    {
      id: id(3),
      agencyId,
      givenName: "Marta",
      familyName: "Quintela",
      email: null,
      phone: null,
      nationality: "PT",
      notes: null,
      birthDate: "1980-02-01",
      passportNumber: "P1234567",
      passportExpiry: "2031-06-30",
      lockVersion: 0n,
      createdAt: "2026-11-25T10:00:00.000Z",
      updatedAt: "2026-11-25T10:00:00.000Z",
      roles: ["PRIMARY_CONTACT"],
      isPrimary: true,
    },
  ],
  leads: [],
  trips: [],
});

const makeOperations = (permissions: readonly StaffPermissionId[]) => {
  const repository = {
    getCustomer: vi.fn(async () => detailRecord()),
  } as unknown as CrmRepository;
  const operations = createStaffCrmOperations({
    repository,
    authorizationRepository: {
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
    },
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
  return operations;
};

const detailPermissions = ["customer.view", "sales.view", "trip.view"] as const;

describe("customer detail sensitive-view flag", () => {
  it("tells an authorised viewer that sensitive fields may be shown, and keeps the values", async () => {
    const detail = await makeOperations([
      ...detailPermissions,
      "traveller.view_sensitive",
    ]).getCustomer(cookie, customerId);
    expect(detail.canViewSensitive).toBe(true);
    expect(detail.people[0]).toMatchObject({
      birthDate: "1980-02-01",
      passportNumber: "P1234567",
    });
  });

  it("tells a viewer without the grant that sensitive fields are hidden, and blanks them", async () => {
    const detail = await makeOperations([...detailPermissions]).getCustomer(cookie, customerId);
    expect(detail.canViewSensitive).toBe(false);
    expect(detail.people[0]).toMatchObject({
      birthDate: null,
      passportNumber: null,
      passportExpiry: null,
    });
  });
});
