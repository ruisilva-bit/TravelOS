import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  STAFF_AUTH_BASE_PATH,
  type AuthRealm,
  type AuthSurfacePolicy,
} from "@travelos/auth-adapters";
import {
  asOpaqueId,
  createM1StaffTripOperations,
  type M1OperationalSliceRepository,
  type M1TripSlice,
  type StaffAuthorizationSnapshot,
  type StaffPermissionId,
} from "@travelos/backend-core";

import { createAdminApi } from "../src/app.js";
import { createAdminStaffSessionResolver } from "../src/m1-session-resolver.js";

const agencyId = "00000000-0000-7000-8000-000000000001";
const syntheticEmail = ["synthetic", "example.test"].join(String.fromCharCode(64));
const expectedHost = "admin.example.test";
const canonicalOrigin = `https://${expectedHost}`;
const policy: AuthSurfacePolicy = { canonicalOrigin, expectedHost };
const staffCookie = "travelos-dev-staff-session=synthetic-session";
const staffPrincipalId = "staff-1";

const validCreateBody = () => ({
  agencyId,
  person: { givenName: "Synthetic", familyName: "Traveller", email: syntheticEmail },
  customer: { displayName: "Example Travel" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: { title: "API trip", startDate: "2026-09-25", endDate: "2026-09-28", state: "DRAFT" },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Flight",
    description: "Synthetic flight",
    carrier: "Example Air",
    flightNumber: "EA100",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: {
      localDate: "2026-09-25",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T08:00:00Z",
    },
    arrival: {
      localDate: "2026-09-25",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T09:00:00Z",
    },
    terminal: null,
    cabin: "ECONOMY",
    baggage: "1 bag",
    seat: null,
    customerBookingReference: "BOOK-1",
  },
  accommodation: {
    title: "Hotel",
    description: "Synthetic hotel",
    propertyName: "Example Hotel",
    checkIn: {
      localDate: "2026-09-25",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T14:00:00Z",
    },
    checkOut: {
      localDate: "2026-09-28",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-28T10:00:00Z",
    },
    roomDescription: "Double",
    boardType: "BREAKFAST",
    customerBookingReference: "HOTEL-1",
  },
  reservation: {
    supplierName: "Supplier",
    supplierReference: "SUP-1",
    customerBookingReference: "CUST-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: { minorUnits: "12345", currency: "EUR", scale: 2 },
    internalNote: "internal",
  },
});

const id = (last: number) =>
  asOpaqueId(`00000000-0000-7000-8000-${last.toString().padStart(12, "0")}`);
const agency = asOpaqueId(agencyId);
const tripId = id(10);
const personId = id(11);
const customerId = id(12);
const travellerId = id(13);

const createPermissions = [
  "customer.view",
  "traveller.view_sensitive",
  "trip.view",
  "reservation.view",
  "finance.view_costs",
  "customer.edit",
  "traveller.edit",
  "trip.edit",
  "reservation.edit",
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];

const authorizedSnapshot: StaffAuthorizationSnapshot = {
  staffPrincipalId,
  agencyId,
  membershipState: "ACTIVE",
  authorizationEpoch: 1n,
  assignments: createPermissions.map((permissionId) => ({
    agencyId: agency,
    permissionId,
    scopeKind: "AGENCY",
    organizationUnitId: null,
    accessLevel: "ALL",
    active: true,
  })),
};

const authorizedTripSlice: M1TripSlice = {
  person: {
    id: personId,
    agencyId: agency,
    givenName: "Synthetic",
    familyName: "Traveller",
    email: syntheticEmail,
    lockVersion: 0n,
  },
  customer: { id: customerId, agencyId: agency, displayName: "Example Travel", lockVersion: 0n },
  customerPerson: {
    agencyId: agency,
    customerId,
    personId,
    role: "PRIMARY_CONTACT",
    isPrimary: true,
  },
  traveller: { id: travellerId, agencyId: agency, tripId, personId, role: "PRIMARY_TRAVELLER" },
  trip: {
    id: tripId,
    agencyId: agency,
    title: "API trip",
    startDate: "2026-09-25",
    endDate: "2026-09-28",
    state: "DRAFT",
    workspaceRevision: 1n,
    lockVersion: 1n,
  },
  flights: [],
  accommodations: [],
  reservations: [],
  reservationItemLinks: [],
  supplierCosts: [],
};

const startAuthorizedAdminApi = async (failCreate = false) => {
  const session = {
    realm: "STAFF" as const,
    sessionId: "synthetic-session-id",
    principalId: staffPrincipalId,
    expiresAtEpochMs: Date.now() + 60_000,
    agencyId,
    authorizationEpoch: 1n,
    recentMfaVerifiedAtEpochMs: null,
  };
  const getServerSession = vi.fn(async (request: Request) =>
    request.headers.get("cookie") === staffCookie ? session : null,
  );
  const realm: AuthRealm = {
    kind: "STAFF",
    basePath: STAFF_AUTH_BASE_PATH,
    cookieName: "travelos-dev-staff-session",
    secureTransportRequired: false,
    async handle() {
      return new Response("staff-auth", { status: 200 });
    },
    getServerSession,
  };
  const createM1TripSlice = vi.fn().mockResolvedValue(authorizedTripSlice);
  if (failCreate) createM1TripSlice.mockRejectedValue(new Error("synthetic application failure"));
  const repository: M1OperationalSliceRepository = {
    createM1TripSlice,
    getM1TripSlice: vi.fn().mockResolvedValue(authorizedTripSlice),
    updateAccommodation: vi.fn().mockResolvedValue(authorizedTripSlice),
    updateInternalSupplierNote: vi.fn().mockResolvedValue(authorizedTripSlice),
  };
  const staffAccessRepository = {
    getStaffAuthorizationSnapshot: vi.fn().mockResolvedValue(authorizedSnapshot),
  };
  const m1Operations = createM1StaffTripOperations({
    repository,
    authorizationRepository: staffAccessRepository,
    sessionResolver: createAdminStaffSessionResolver(realm, policy),
  });
  const application = await createAdminApi({
    expectedHost,
    auth: { realm, policy, staffAccessRepository, m1Operations },
  });
  return { application, repository, getServerSession };
};

describe("Admin Stage 5 composed HTTP body parsing", () => {
  it("parses JSON before the raw Stage 5 write routes are reached", async () => {
    const realm = {
      kind: "STAFF",
      basePath: STAFF_AUTH_BASE_PATH,
      getServerSession: vi.fn().mockResolvedValue(null),
    } as unknown as AuthRealm;
    const m1Repository: M1OperationalSliceRepository = {
      createM1TripSlice: vi.fn(),
      getM1TripSlice: vi.fn(),
      updateAccommodation: vi.fn(),
      updateInternalSupplierNote: vi.fn(),
    };
    const m1Operations = createM1StaffTripOperations({
      repository: m1Repository,
      authorizationRepository: {
        getStaffAuthorizationSnapshot: vi.fn().mockResolvedValue(null),
      },
      sessionResolver: { resolveStaffSession: vi.fn().mockResolvedValue(null) },
    });
    const application = await createAdminApi({
      expectedHost: "admin.example.test",
      auth: {
        realm,
        policy: {
          canonicalOrigin: "https://admin.example.test",
          expectedHost: "admin.example.test",
        },
        staffAccessRepository: { getStaffAuthorizationSnapshot: vi.fn().mockResolvedValue(null) },
        m1Operations,
      },
    });
    try {
      const rejectedBeforeParsing = await request(application.getHttpServer())
        .post("/api/admin/trips")
        .set("Host", "attacker.example.test")
        .set("Content-Type", "application/json")
        .send("{");
      expect(rejectedBeforeParsing.status).toBe(404);
      expect(rejectedBeforeParsing.text).toBe("");
      expect(m1Repository.createM1TripSlice).not.toHaveBeenCalled();

      const response = await request(application.getHttpServer())
        .post("/api/admin/trips")
        .set("Host", expectedHost)
        .set("X-Forwarded-Host", expectedHost)
        .set("Origin", canonicalOrigin)
        .send(validCreateBody());
      expect(response.status).toBe(401);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(m1Repository.createM1TripSlice).not.toHaveBeenCalled();

      const invalidRoleResponse = await request(application.getHttpServer())
        .post("/api/admin/trips")
        .set("Host", expectedHost)
        .set("Origin", canonicalOrigin)
        .send({ ...validCreateBody(), travellerRole: "TRAVELLER" });
      expect(invalidRoleResponse.status).toBe(400);
      expect(invalidRoleResponse.headers["cache-control"]).toBe("private, no-store");
      expect(m1Repository.createM1TripSlice).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("rejects unsafe-origin mutations before parsing and allows an authenticated same-origin create", async () => {
    const { application, repository, getServerSession } = await startAuthorizedAdminApi();
    const server = application.getHttpServer();
    try {
      const missingOrigin = await request(server)
        .post("/api/admin/trips")
        .set("Host", expectedHost)
        .set("Cookie", staffCookie)
        .set("X-Forwarded-Origin", canonicalOrigin)
        .set("Forwarded", `host=${expectedHost};proto=https`)
        .set("Content-Type", "application/json")
        .send("{");
      expect(missingOrigin.status).toBe(403);
      expect(missingOrigin.text).toBe("");
      expect(missingOrigin.headers["cache-control"]).toBe("private, no-store");

      const mutationRequests = [
        ["POST", () => request(server).post("/api/admin/trips")],
        ["PUT", () => request(server).put("/api/admin/trips")],
        ["PATCH", () => request(server).patch("/api/admin/itinerary/accommodations/not-an-id")],
        ["DELETE", () => request(server).delete("/api/admin/trips")],
      ] as const;
      for (const [method, makeRequest] of mutationRequests) {
        const response = await makeRequest()
          .set("Host", expectedHost)
          .set("Origin", "https://attacker.example.test")
          .set("X-Forwarded-Origin", canonicalOrigin)
          .set("Content-Type", "application/json")
          .send("{");
        expect(response.status, method).toBe(403);
        expect(response.text, method).toBe("");
        expect(response.headers["cache-control"], method).toBe("private, no-store");
      }

      const malformedOrigin = await request(server)
        .post("/api/admin/trips")
        .set("Host", expectedHost)
        .set("Origin", "https://admin.example.test/path")
        .set("Content-Type", "application/json")
        .send("{");
      expect(malformedOrigin.status).toBe(403);
      expect(malformedOrigin.headers["cache-control"]).toBe("private, no-store");

      const hostRejection = await request(server)
        .post("/api/admin/trips")
        .set("Host", "attacker.example.test")
        .set("X-Forwarded-Host", expectedHost)
        .set("Origin", canonicalOrigin)
        .set("Content-Type", "application/json")
        .send("{");
      expect(hostRejection.status).toBe(404);
      expect(hostRejection.text).toBe("");
      expect(hostRejection.headers["cache-control"]).toBe("private, no-store");

      expect(getServerSession).not.toHaveBeenCalled();
      expect(repository.createM1TripSlice).not.toHaveBeenCalled();
      expect(repository.updateAccommodation).not.toHaveBeenCalled();
      expect(repository.updateInternalSupplierNote).not.toHaveBeenCalled();

      const accepted = await request(server)
        .post("/api/admin/trips")
        .set("Host", expectedHost)
        .set("Origin", canonicalOrigin)
        .set("Cookie", staffCookie)
        .send(validCreateBody());
      expect(accepted.status).toBe(201);
      expect(accepted.headers["cache-control"]).toBe("private, no-store");
      expect(accepted.body.trip).toMatchObject({ id: tripId.toString(), workspaceRevision: "1" });
      expect(getServerSession).toHaveBeenCalledOnce();
      expect(repository.createM1TripSlice).toHaveBeenCalledOnce();
    } finally {
      await application.close();
    }
  });

  it("keeps application failures private and non-storable", async () => {
    const { application, repository } = await startAuthorizedAdminApi(true);
    try {
      const response = await request(application.getHttpServer())
        .post("/api/admin/trips")
        .set("Host", expectedHost)
        .set("Origin", canonicalOrigin)
        .set("Cookie", staffCookie)
        .send(validCreateBody());
      expect(response.status).toBe(500);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(repository.createM1TripSlice).toHaveBeenCalledOnce();
    } finally {
      await application.close();
    }
  });
});
