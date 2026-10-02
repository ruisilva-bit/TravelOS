import { describe, expect, it, vi } from "vitest";

import {
  asOpaqueId,
  createMoney,
  createM1StaffTripOperations,
  createScheduledLocalDateTime,
  M1OptimisticConflictError,
  M1TransactionConflictError,
  type M1TripSlice,
  type M1OperationalSliceRepository,
  type StaffAuthorizationSnapshot,
  type StaffPermissionId,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";
import { registerAdminM1Routes, type AdminM1ExpressApplication } from "../src/m1-routes.js";

const syntheticEmail = ["rui", "example.test"].join(String.fromCharCode(64));

const agencyId = "00000000-0000-7000-8000-000000000001";
const id = (last: number) =>
  asOpaqueId(`00000000-0000-7000-8000-${last.toString().padStart(12, "0")}`);
const agency = asOpaqueId(agencyId);
const tripId = id(10);
const flightId = id(11);
const accommodationId = id(12);
const reservationId = id(13);
const personId = id(14);
const customerId = id(15);
const travellerId = id(16);
const supplierCostId = id(17);
const grantedPermissions = [
  "agency.view",
  "agency.manage_settings",
  "finance.view_costs",
  "finance.manage_costs",
  "customer.view",
  "customer.edit",
  "traveller.view_sensitive",
  "traveller.edit",
  "trip.view",
  "trip.edit",
  "reservation.view",
  "reservation.edit",
] as const satisfies readonly StaffPermissionId[];

const slice: M1TripSlice = {
  person: {
    id: personId,
    agencyId: agency,
    givenName: "Rui",
    familyName: "Silva",
    email: syntheticEmail,
    lockVersion: 0n,
  },
  customer: { id: customerId, agencyId: agency, displayName: "Silva Travel", lockVersion: 0n },
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
    lockVersion: 9_007_199_254_740_993n,
  },
  flights: [
    {
      id: flightId,
      agencyId: agency,
      tripId,
      family: "FLIGHT",
      state: "CONFIRMED",
      sortOrder: 1,
      title: "Flight",
      description: "Synthetic flight",
      customerBookingReference: "BOOK-1",
      lockVersion: 0n,
      carrier: "Example Air",
      flightNumber: "EA100",
      departureAirport: "LIS",
      arrivalAirport: "OPO",
      departure: createScheduledLocalDateTime({
        localDate: "2026-09-25",
        localTime: "09:00",
        timezoneName: "Europe/Lisbon",
        instant: "2026-09-25T08:00:00Z",
      }),
      arrival: createScheduledLocalDateTime({
        localDate: "2026-09-25",
        localTime: "10:00",
        timezoneName: "Europe/Lisbon",
        instant: "2026-09-25T09:00:00Z",
      }),
      terminal: null,
      cabin: "ECONOMY",
      baggage: "1 bag",
      seat: null,
    },
  ],
  accommodations: [
    {
      id: accommodationId,
      agencyId: agency,
      tripId,
      family: "ACCOMMODATION",
      state: "CONFIRMED",
      sortOrder: 2,
      title: "Hotel",
      description: "Synthetic hotel",
      customerBookingReference: "HOTEL-1",
      lockVersion: 9_007_199_254_740_993n,
      propertyName: "Example Hotel",
      checkIn: createScheduledLocalDateTime({
        localDate: "2026-09-25",
        localTime: "15:00",
        timezoneName: "Europe/Lisbon",
        instant: "2026-09-25T14:00:00Z",
      }),
      checkOut: createScheduledLocalDateTime({
        localDate: "2026-09-28",
        localTime: "11:00",
        timezoneName: "Europe/Lisbon",
        instant: "2026-09-28T10:00:00Z",
      }),
      roomDescription: "Double",
      boardType: "BREAKFAST",
    },
  ],
  reservations: [
    {
      id: reservationId,
      agencyId: agency,
      tripId,
      supplierName: "Supplier",
      supplierReference: "SUP-1",
      customerBookingReference: "CUST-1",
      state: "CONFIRMED",
      lockVersion: 0n,
    },
  ],
  reservationItemLinks: [
    { agencyId: agency, tripId, reservationId, itineraryItemId: flightId, linkRole: "PRIMARY" },
    {
      agencyId: agency,
      tripId,
      reservationId,
      itineraryItemId: accommodationId,
      linkRole: "SECONDARY",
    },
  ],
  supplierCosts: [
    {
      id: supplierCostId,
      agencyId: agency,
      tripId,
      reservationId,
      amount: createMoney("12345", "EUR", 2),
      internalNote: "internal",
      classification: "INTERNAL_ONLY",
      lockVersion: 0n,
    },
  ],
};

const requestBody = () => ({
  agencyId,
  person: { givenName: "Rui", familyName: "Silva", email: syntheticEmail },
  customer: { displayName: "Silva Travel" },
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

const snapshot: StaffAuthorizationSnapshot = {
  staffPrincipalId: "staff-1",
  agencyId,
  membershipState: "ACTIVE",
  authorizationEpoch: 1n,
  assignments: grantedPermissions.map((permissionId) => ({
    agencyId,
    permissionId,
    scopeKind: "AGENCY",
    organizationUnitId: null,
    accessLevel: "ALL",
    active: true,
  })),
};

const policy: AuthSurfacePolicy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};

const makeHarness = (
  sessionAgencyId = agencyId,
  permissionIds: readonly StaffPermissionId[] = grantedPermissions,
) => {
  type Handler = Parameters<AdminM1ExpressApplication["post"]>[1];
  const handlers = new Map<string, Handler>();
  const application: AdminM1ExpressApplication = {
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
  };
  const sessionResolver = {
    resolveStaffSession: vi.fn().mockResolvedValue({
      staffPrincipalId: "staff-1",
      agencyId: sessionAgencyId,
      authorizationEpoch: 1n,
      expiresAtEpochMs: Date.now() + 60_000,
      recentMfaVerifiedAtEpochMs: null,
    }),
  };
  const repository = {
    createM1TripSlice: vi.fn().mockResolvedValue(slice),
    getM1TripSlice: vi.fn().mockResolvedValue(slice),
    updateAccommodation: vi.fn().mockResolvedValue(slice),
    updateInternalSupplierNote: vi.fn().mockResolvedValue(slice),
  };
  const m1Operations = createM1StaffTripOperations({
    repository: repository as unknown as M1OperationalSliceRepository,
    authorizationRepository: {
      getStaffAuthorizationSnapshot: vi.fn().mockResolvedValue({
        ...snapshot,
        agencyId: sessionAgencyId,
        assignments: permissionIds.map((permissionId) => ({
          agencyId: sessionAgencyId,
          permissionId,
          scopeKind: "AGENCY",
          organizationUnitId: null,
          accessLevel: "ALL",
          active: true,
        })),
      }),
    },
    sessionResolver,
  });
  registerAdminM1Routes(application, {
    policy,
    m1Operations,
  });
  const invoke = async (
    key: string,
    body: unknown,
    params: Readonly<Record<string, string>> = {},
    headers: Record<string, string | string[] | undefined> = {
      host: "admin.example.test",
      cookie: "session=opaque",
    },
  ) => {
    const handler = handlers.get(key);
    if (handler === undefined) throw new Error(`Missing handler ${key}`);
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader() {},
      end() {},
      json(value: unknown) {
        this.body = value;
      },
    };
    let nextError: unknown;
    handler(
      {
        method: key.split(" ")[0] ?? "POST",
        url: "/api/admin/trips",
        originalUrl: "/api/admin/trips",
        headers,
        body,
        params,
      },
      response,
      (error: unknown) => {
        nextError = error;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (nextError !== undefined) throw nextError;
    return response;
  };
  return { handlers, invoke, repository, sessionResolver };
};

describe("Admin Stage 5 routes", () => {
  it("requires strict contracts and authorizes the create path", async () => {
    const harness = makeHarness();
    const response = await harness.invoke("POST /api/admin/trips", {
      ...requestBody(),
      unexpected: true,
    });
    expect(response.statusCode).toBe(400);
    expect(harness.repository.createM1TripSlice).not.toHaveBeenCalled();

    const accepted = await harness.invoke("POST /api/admin/trips", requestBody());
    expect(accepted.statusCode).toBe(201);
    expect(accepted.body).toMatchObject({
      trip: {
        id: tripId,
        workspaceRevision: "1",
        lockVersion: "9007199254740993",
      },
      accommodations: [{ lockVersion: "9007199254740993" }],
      supplierCosts: [{ classification: "INTERNAL_ONLY" }],
    });
    expect(harness.repository.createM1TripSlice).toHaveBeenCalledOnce();
  });

  it("accepts only a forwarded host that corroborates the configured Admin host", async () => {
    const harness = makeHarness();
    const accepted = await harness.invoke(
      "POST /api/admin/trips",
      requestBody(),
      {},
      {
        host: "admin.example.test",
        cookie: "session=opaque",
        "x-forwarded-host": "admin.example.test",
      },
    );
    expect(accepted.statusCode).toBe(201);
    expect(harness.repository.createM1TripSlice).toHaveBeenCalledOnce();

    const conflicting = makeHarness();
    const rejected = await conflicting.invoke(
      "POST /api/admin/trips",
      requestBody(),
      {},
      {
        host: "admin.example.test",
        cookie: "session=opaque",
        "x-forwarded-host": "attacker.example.test",
      },
    );
    expect(rejected.statusCode).toBe(403);
    expect(conflicting.repository.createM1TripSlice).not.toHaveBeenCalled();
  });

  it("does not let cost visibility alone create INTERNAL_ONLY supplier cost", async () => {
    const harness = makeHarness(agencyId, ["agency.manage_settings", "finance.view_costs"]);
    const response = await harness.invoke("POST /api/admin/trips", requestBody());
    expect(response.statusCode).toBe(403);
    expect(harness.repository.createM1TripSlice).not.toHaveBeenCalled();
  });

  it("denies composite reads without the Stage 5 product view capabilities", async () => {
    const harness = makeHarness(agencyId, ["agency.view", "finance.view_costs"]);
    const response = await harness.invoke("GET /api/admin/trips/:tripId", {}, { tripId });
    expect(response.statusCode).toBe(403);
    expect(harness.repository.getM1TripSlice).not.toHaveBeenCalled();
  });

  it("fails closed for a session bound to a different Agency", async () => {
    const harness = makeHarness("00000000-0000-7000-8000-000000000099");
    const response = await harness.invoke("POST /api/admin/trips", requestBody());
    expect(response.statusCode).toBe(403);
    expect(harness.repository.createM1TripSlice).not.toHaveBeenCalled();
  });

  it("does not return INTERNAL_ONLY data to a settings-only accommodation editor", async () => {
    const harness = makeHarness(agencyId, ["agency.manage_settings"]);
    const response = await harness.invoke(
      "PATCH /api/admin/itinerary/accommodations/:itemId",
      {
        agencyId,
        tripId,
        itemId: accommodationId,
        expectedLockVersion: "0",
        title: "Updated hotel",
        description: "Updated description",
      },
      { itemId: accommodationId },
    );
    expect(response.statusCode).toBe(403);
    expect(harness.repository.updateAccommodation).not.toHaveBeenCalled();
  });

  it("parses and returns bigint accommodation versions without Number coercion", async () => {
    const harness = makeHarness(agencyId, grantedPermissions);
    const response = await harness.invoke(
      "PATCH /api/admin/itinerary/accommodations/:itemId",
      {
        agencyId,
        tripId,
        itemId: accommodationId,
        expectedLockVersion: "9007199254740993",
        title: "Updated hotel",
        description: "Updated description",
      },
      { itemId: accommodationId },
    );
    expect(response.statusCode).toBe(200);
    expect(harness.repository.updateAccommodation).toHaveBeenCalledWith(
      expect.objectContaining({ expectedLockVersion: 9_007_199_254_740_993n }),
      expect.objectContaining({
        session: expect.objectContaining({
          staffPrincipalId: "staff-1",
          agencyId,
          authorizationEpoch: 1n,
        }),
        requiredPermissionIds: expect.arrayContaining([
          "customer.view",
          "traveller.view_sensitive",
          "trip.view",
          "reservation.view",
          "finance.view_costs",
          "trip.edit",
        ]),
        nowEpochMs: expect.any(Number),
      }),
    );
    expect(response.body).toMatchObject({
      trip: { lockVersion: "9007199254740993" },
      accommodations: [{ lockVersion: "9007199254740993" }],
    });
  });

  it("does not let cost visibility alone mutate an INTERNAL_ONLY note", async () => {
    const harness = makeHarness(agencyId, ["finance.view_costs"]);
    const response = await harness.invoke(
      "PATCH /api/admin/reservations/:reservationId/internal-note",
      {
        agencyId,
        tripId,
        reservationId,
        expectedLockVersion: "0",
        internalNote: "Updated note",
      },
      { reservationId },
    );
    expect(response.statusCode).toBe(403);
    expect(harness.repository.updateInternalSupplierNote).not.toHaveBeenCalled();
  });

  it("requires and accepts the explicit finance mutation capability for an INTERNAL_ONLY note", async () => {
    const harness = makeHarness(agencyId, grantedPermissions);
    const response = await harness.invoke(
      "PATCH /api/admin/reservations/:reservationId/internal-note",
      {
        agencyId,
        tripId,
        reservationId,
        expectedLockVersion: "0",
        internalNote: "Updated note",
      },
      { reservationId },
    );
    expect(response.statusCode).toBe(200);
    expect(harness.repository.updateInternalSupplierNote).toHaveBeenCalledOnce();
  });

  it("maps a persistence serialization conflict to HTTP 409", async () => {
    const harness = makeHarness(agencyId, grantedPermissions);
    harness.repository.updateInternalSupplierNote = vi
      .fn()
      .mockRejectedValue(new M1OptimisticConflictError());
    const response = await harness.invoke(
      "PATCH /api/admin/reservations/:reservationId/internal-note",
      {
        agencyId,
        tripId,
        reservationId,
        expectedLockVersion: "0",
        internalNote: "Updated note",
      },
      { reservationId },
    );
    expect(response.statusCode).toBe(409);
  });

  it("maps a deadlock transaction conflict to a safe HTTP 409", async () => {
    const harness = makeHarness(agencyId, grantedPermissions);
    harness.repository.updateInternalSupplierNote = vi
      .fn()
      .mockRejectedValue(new M1TransactionConflictError());
    const response = await harness.invoke(
      "PATCH /api/admin/reservations/:reservationId/internal-note",
      {
        agencyId,
        tripId,
        reservationId,
        expectedLockVersion: "0",
        internalNote: "Updated note",
      },
      { reservationId },
    );
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: "transaction_conflict" });
    expect(JSON.stringify(response.body)).not.toContain("40P01");
    expect(JSON.stringify(response.body)).not.toContain("deadlock");
  });
});
