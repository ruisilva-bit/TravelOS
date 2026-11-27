import { describe, expect, it, vi } from "vitest";

import {
  asOpaqueId,
  createMoney,
  createStaffTripOperations,
  createStaffTripWorkspaceOperations,
  createScheduledLocalDateTime,
  OptimisticConflictError,
  TransactionConflictError,
  TripNotFoundError,
  type StaffTripWorkspaceWriteOperations,
  type TripSlice,
  type TripWorkspace,
  type OperationalSliceRepository,
  type StaffAuthorizationSnapshot,
  type StaffPermissionId,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";
import { registerAdminRoutes, type AdminExpressApplication } from "../src/admin-routes.js";

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

const slice: TripSlice = {
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

const workspaceCreateBody = () => ({
  customer: { displayName: "Silva Travel" },
  primaryTraveller: { givenName: "Rui", familyName: "Silva" },
  trip: { title: "Lisboa a Porto", startDate: "2026-09-25", endDate: "2026-09-28" },
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
  type Handler = Parameters<AdminExpressApplication["post"]>[1];
  const handlers = new Map<string, Handler>();
  const application: AdminExpressApplication = {
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
  };
  const sessionResolver = {
    resolveStaffSession: vi.fn().mockResolvedValue({
      sessionId: "synthetic-session",
      staffPrincipalId: "staff-1",
      agencyId: sessionAgencyId,
      authorizationEpoch: 1n,
      expiresAtEpochMs: Date.now() + 60_000,
      recentMfaVerifiedAtEpochMs: null,
    }),
  };
  const repository = {
    createTripWorkspace: vi.fn().mockResolvedValue(slice.trip),
    createTripSlice: vi.fn().mockResolvedValue(slice),
    getTripSlice: vi.fn().mockResolvedValue(slice),
    updateAccommodation: vi.fn().mockResolvedValue(slice),
    updateInternalSupplierNote: vi.fn().mockResolvedValue(slice),
  };
  const authorizationRepository = {
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
  };
  const tripOperations = createStaffTripOperations({
    repository: repository as unknown as OperationalSliceRepository,
    authorizationRepository,
    sessionResolver,
  });
  const rawWorkspace = Object.assign(
    { trip: slice.trip, flights: slice.flights, accommodations: slice.accommodations },
    {
      person: slice.person,
      customer: slice.customer,
      reservations: slice.reservations,
      supplierCosts: slice.supplierCosts,
      INTERNAL_ONLY: "not-for-customer-or-workspace",
    },
  ) as unknown as TripWorkspace;
  const workspaceRepository = {
    listTrips: vi.fn().mockResolvedValue({ items: [slice.trip], nextCursor: null }),
    readTripWorkspace: vi.fn().mockResolvedValue(rawWorkspace),
  };
  const workspaceWriteOperations = {
    createFlight: vi.fn().mockResolvedValue(rawWorkspace),
    updateFlight: vi.fn().mockResolvedValue(rawWorkspace),
    createAccommodation: vi.fn().mockResolvedValue(rawWorkspace),
    updateAccommodation: vi.fn().mockResolvedValue(rawWorkspace),
    updateTrip: vi.fn().mockResolvedValue(rawWorkspace),
  } as unknown as StaffTripWorkspaceWriteOperations;
  const workspaceOperations = createStaffTripWorkspaceOperations({
    repository: workspaceRepository,
    authorizationRepository,
    sessionResolver,
  });
  registerAdminRoutes(application, {
    policy,
    tripOperations,
    workspaceOperations,
    workspaceWriteOperations: workspaceWriteOperations,
  });
  const invoke = async (
    key: string,
    body: unknown,
    params: Readonly<Record<string, string>> = {},
    headers: Record<string, string | string[] | undefined> = {
      host: "admin.example.test",
      origin: "https://admin.example.test",
      cookie: "session=opaque",
    },
    query: Readonly<Record<string, string | readonly string[] | undefined>> = {},
  ) => {
    const handler = handlers.get(key);
    if (handler === undefined) throw new Error(`Missing handler ${key}`);
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      headers: new Map<string, string | readonly string[]>(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string | readonly string[]) {
        this.headers.set(name.toLowerCase(), value);
      },
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
        query,
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
  return {
    handlers,
    invoke,
    repository,
    sessionResolver,
    workspaceRepository,
    workspaceWriteOperations,
  };
};

describe("Admin Stage 5 routes", () => {
  it("requires strict contracts and authorizes the create path", async () => {
    const harness = makeHarness();
    const response = await harness.invoke("POST /api/admin/trips", {
      ...requestBody(),
      unexpected: true,
    });
    expect(response.statusCode).toBe(400);
    expect(harness.repository.createTripSlice).not.toHaveBeenCalled();

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
    expect(harness.repository.createTripSlice).toHaveBeenCalledOnce();
  });

  it("accepts only a forwarded host that corroborates the configured Admin host", async () => {
    const harness = makeHarness();
    const accepted = await harness.invoke(
      "POST /api/admin/trips",
      requestBody(),
      {},
      {
        host: "admin.example.test",
        origin: "https://admin.example.test",
        cookie: "session=opaque",
        "x-forwarded-host": "admin.example.test",
      },
    );
    expect(accepted.statusCode).toBe(201);
    expect(harness.repository.createTripSlice).toHaveBeenCalledOnce();

    const conflicting = makeHarness();
    const rejected = await conflicting.invoke(
      "POST /api/admin/trips",
      requestBody(),
      {},
      {
        host: "admin.example.test",
        origin: "https://admin.example.test",
        cookie: "session=opaque",
        "x-forwarded-host": "attacker.example.test",
      },
    );
    expect(rejected.statusCode).toBe(403);
    expect(conflicting.repository.createTripSlice).not.toHaveBeenCalled();
  });

  it("rejects missing, opaque, duplicate, or sibling Origins before resolving a mutation session", async () => {
    const invalidOrigins: readonly (string | string[] | undefined)[] = [
      undefined,
      "null",
      "https://attacker.example.test",
      "https://admin.example.test/path",
      ["https://admin.example.test", "https://attacker.example.test"],
    ];

    for (const origin of invalidOrigins) {
      const harness = makeHarness();
      const response = await harness.invoke(
        "POST /api/admin/trips",
        requestBody(),
        {},
        {
          host: "admin.example.test",
          origin,
          cookie: "session=opaque",
        },
      );
      expect(response.statusCode).toBe(403);
      expect(harness.sessionResolver.resolveStaffSession).not.toHaveBeenCalled();
      expect(harness.repository.createTripSlice).not.toHaveBeenCalled();
    }
  });

  it("does not let cost visibility alone create INTERNAL_ONLY supplier cost", async () => {
    const harness = makeHarness(agencyId, ["agency.manage_settings", "finance.view_costs"]);
    const response = await harness.invoke("POST /api/admin/trips", requestBody());
    expect(response.statusCode).toBe(403);
    expect(harness.repository.createTripSlice).not.toHaveBeenCalled();
  });

  it("denies composite reads without the Stage 5 product view capabilities", async () => {
    const harness = makeHarness(agencyId, ["agency.view", "finance.view_costs"]);
    const response = await harness.invoke("GET /api/admin/trips/:tripId", {}, { tripId });
    expect(response.statusCode).toBe(403);
    expect(harness.repository.getTripSlice).not.toHaveBeenCalled();
  });

  it("fails closed for a session bound to a different Agency", async () => {
    const harness = makeHarness("00000000-0000-7000-8000-000000000099");
    const response = await harness.invoke("POST /api/admin/trips", requestBody());
    expect(response.statusCode).toBe(403);
    expect(harness.repository.createTripSlice).not.toHaveBeenCalled();
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
          sessionId: "synthetic-session",
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
      .mockRejectedValue(new OptimisticConflictError());
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
      .mockRejectedValue(new TransactionConflictError());
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

describe("Admin Trip workspace V1 routes", () => {
  it("creates_a_minimal_workspace_with_session_scope_and_empty_itinerary", async () => {
    const harness = makeHarness(agencyId, [
      "customer.edit",
      "traveller.edit",
      "trip.edit",
      "trip.view",
    ]);
    const route = "POST /api/admin/trips/workspace";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const response = await harness.invoke(route, workspaceCreateBody());

    expect(response.statusCode).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(harness.repository.createTripWorkspace).toHaveBeenCalledWith(
      {
        customer: { displayName: "Silva Travel" },
        primaryTraveller: { givenName: "Rui", familyName: "Silva" },
        trip: { title: "Lisboa a Porto", startDate: "2026-09-25", endDate: "2026-09-28" },
      },
      expect.objectContaining({
        session: expect.objectContaining({ agencyId }),
        requiredPermissionIds: expect.arrayContaining([
          "customer.edit",
          "traveller.edit",
          "trip.edit",
          "trip.view",
        ]),
      }),
    );
    expect(response.body).toEqual({
      trip: {
        id: tripId,
        agencyId: agency,
        title: "API trip",
        startDate: "2026-09-25",
        endDate: "2026-09-28",
        state: "DRAFT",
        workspaceRevision: "1",
        lockVersion: "9007199254740993",
      },
      flights: [],
      accommodations: [],
    });
    expect(JSON.stringify(response.body)).not.toContain("Silva Travel");
    expect(JSON.stringify(response.body)).not.toContain("Rui");
  });

  it("rejects_client_supplied_scope_and_itinerary_fields_before_authentication", async () => {
    const harness = makeHarness();
    const route = "POST /api/admin/trips/workspace";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    for (const extra of [{ agencyId }, { reservation: { supplierName: "Supplier" } }]) {
      const response = await harness.invoke(route, { ...workspaceCreateBody(), ...extra });
      expect(response.statusCode).toBe(400);
    }
    expect(harness.sessionResolver.resolveStaffSession).not.toHaveBeenCalled();
    expect(harness.repository.createTripWorkspace).not.toHaveBeenCalled();
  });

  it("lists_trips_with_strict_cursor_query_and_no_store", async () => {
    const harness = makeHarness(agencyId, ["trip.view"]);
    const route = "GET /api/admin/trips";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const response = await harness.invoke(route, undefined, {}, undefined, {
      limit: "17",
      cursor: flightId,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(harness.workspaceRepository.listTrips).toHaveBeenCalledWith(
      agency,
      17,
      flightId,
      expect.objectContaining({
        session: expect.objectContaining({ agencyId: agency }),
        requiredPermissionIds: ["trip.view"],
      }),
    );
    expect(response.body).toEqual({
      items: [
        {
          id: tripId,
          agencyId: agency,
          title: "API trip",
          startDate: "2026-09-25",
          endDate: "2026-09-28",
          state: "DRAFT",
          workspaceRevision: "1",
          lockVersion: "9007199254740993",
        },
      ],
      nextCursor: null,
    });
  });

  it("reads_only_the_workspace_allowlist", async () => {
    const harness = makeHarness(agencyId, ["trip.view"]);
    const route = "GET /api/admin/trips/:tripId/workspace";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const response = await harness.invoke(route, undefined, { tripId });

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(harness.workspaceRepository.readTripWorkspace).toHaveBeenCalledWith(
      agency,
      tripId,
      expect.objectContaining({
        session: expect.objectContaining({ agencyId: agency }),
        requiredPermissionIds: ["trip.view"],
      }),
    );
    const body = response.body as {
      readonly trip: Record<string, unknown>;
      readonly flights: readonly Record<string, unknown>[];
      readonly accommodations: readonly Record<string, unknown>[];
    };
    expect(Object.keys(body).toSorted()).toEqual(["accommodations", "flights", "trip"]);
    expect(Object.keys(body.trip).toSorted()).toEqual([
      "agencyId",
      "endDate",
      "id",
      "lockVersion",
      "startDate",
      "state",
      "title",
      "workspaceRevision",
    ]);
    expect(Object.keys(body.flights[0] ?? {}).toSorted()).toEqual([
      "agencyId",
      "arrival",
      "arrivalAirport",
      "baggage",
      "cabin",
      "carrier",
      "customerBookingReference",
      "departure",
      "departureAirport",
      "description",
      "family",
      "flightNumber",
      "id",
      "lockVersion",
      "seat",
      "sortOrder",
      "state",
      "terminal",
      "title",
      "tripId",
    ]);
    expect(Object.keys(body.accommodations[0] ?? {}).toSorted()).toEqual([
      "agencyId",
      "boardType",
      "checkIn",
      "checkOut",
      "customerBookingReference",
      "description",
      "family",
      "id",
      "lockVersion",
      "propertyName",
      "roomDescription",
      "sortOrder",
      "state",
      "title",
      "tripId",
    ]);
    expect(JSON.stringify(response.body)).not.toContain("not-for-customer-or-workspace");
    expect(JSON.stringify(response.body)).not.toContain("supplierCosts");
    expect(JSON.stringify(response.body)).not.toContain(syntheticEmail);
  });

  it("returns_404_for_another_agency_trip", async () => {
    const harness = makeHarness(agencyId, ["trip.view"]);
    harness.workspaceRepository.readTripWorkspace.mockResolvedValue(null);
    const route = "GET /api/admin/trips/:tripId/workspace";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const response = await harness.invoke(route, undefined, { tripId });

    expect(response.statusCode).toBe(404);
    expect(harness.workspaceRepository.readTripWorkspace).toHaveBeenCalledOnce();
    expect(response.body).toBeUndefined();
  });

  it("rejects_unknown_or_out_of_range_list_queries", async () => {
    const invalidQueries: readonly Readonly<
      Record<string, string | readonly string[] | undefined>
    >[] = [
      { limit: "0" },
      { limit: "51" },
      { limit: "not-a-number" },
      { unexpected: "value" },
      { cursor: [flightId, accommodationId] },
      { cursor: "malformed" },
    ];

    for (const query of invalidQueries) {
      const harness = makeHarness(agencyId, ["trip.view"]);
      const route = "GET /api/admin/trips";
      expect(harness.handlers.has(route)).toBe(true);
      if (!harness.handlers.has(route)) return;

      const response = await harness.invoke(route, undefined, {}, undefined, query);

      expect(response.statusCode).toBe(400);
      expect(harness.workspaceRepository.listTrips).not.toHaveBeenCalled();
    }
  });
});

describe("Admin Trip workspace write V1 routes", () => {
  it("creates_a_flight_using_the_trip_path_and_expected_workspace_revision", async () => {
    const harness = makeHarness(agencyId, ["trip.edit", "trip.view"]);
    const route = "POST /api/admin/trips/:tripId/workspace/flights";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const flight = requestBody().flight;
    const response = await harness.invoke(
      route,
      { expectedWorkspaceRevision: "7", flight },
      { tripId },
    );

    expect(response.statusCode).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(harness.workspaceWriteOperations.createFlight).toHaveBeenCalledWith(
      "session=opaque",
      tripId,
      { expectedWorkspaceRevision: 7n, flight },
    );
    expect(response.body).toMatchObject({ trip: { id: tripId }, flights: [{ id: flightId }] });
  });

  it("updates_a_flight_using_both_optimistic_versions_and_path_scope", async () => {
    const harness = makeHarness(agencyId, ["trip.edit", "trip.view"]);
    const route = "PATCH /api/admin/trips/:tripId/workspace/flights/:itemId";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const flight = requestBody().flight;
    const response = await harness.invoke(
      route,
      { expectedWorkspaceRevision: "8", expectedLockVersion: "9", flight },
      { tripId, itemId: flightId },
    );

    expect(response.statusCode).toBe(200);
    expect(harness.workspaceWriteOperations.updateFlight).toHaveBeenCalledWith(
      "session=opaque",
      tripId,
      flightId,
      { expectedWorkspaceRevision: 8n, expectedLockVersion: 9n, flight },
    );
  });

  it("creates_an_accommodation_using_the_trip_path_and_expected_workspace_revision", async () => {
    const harness = makeHarness(agencyId, ["trip.edit", "trip.view"]);
    const route = "POST /api/admin/trips/:tripId/workspace/accommodations";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const accommodation = requestBody().accommodation;
    const response = await harness.invoke(
      route,
      { expectedWorkspaceRevision: "10", accommodation },
      { tripId },
    );

    expect(response.statusCode).toBe(201);
    expect(harness.workspaceWriteOperations.createAccommodation).toHaveBeenCalledWith(
      "session=opaque",
      tripId,
      { expectedWorkspaceRevision: 10n, accommodation },
    );
  });

  it("updates_an_accommodation_using_both_optimistic_versions_and_path_scope", async () => {
    const harness = makeHarness(agencyId, ["trip.edit", "trip.view"]);
    const route = "PATCH /api/admin/trips/:tripId/workspace/accommodations/:itemId";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const accommodation = requestBody().accommodation;
    const response = await harness.invoke(
      route,
      { expectedWorkspaceRevision: "11", expectedLockVersion: "12", accommodation },
      { tripId, itemId: accommodationId },
    );

    expect(response.statusCode).toBe(200);
    expect(harness.workspaceWriteOperations.updateAccommodation).toHaveBeenCalledWith(
      "session=opaque",
      tripId,
      accommodationId,
      { expectedWorkspaceRevision: 11n, expectedLockVersion: 12n, accommodation },
    );
  });

  it("updates_trip_details_using_both_optimistic_versions", async () => {
    const harness = makeHarness(agencyId, ["trip.edit", "trip.view"]);
    const route = "PATCH /api/admin/trips/:tripId/workspace";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const trip = { title: "Lisboa e Porto", startDate: "2026-09-25", endDate: "2026-09-28" };
    const response = await harness.invoke(
      route,
      { expectedWorkspaceRevision: "13", expectedLockVersion: "14", trip },
      { tripId },
    );

    expect(response.statusCode).toBe(200);
    expect(harness.workspaceWriteOperations.updateTrip).toHaveBeenCalledWith(
      "session=opaque",
      tripId,
      { expectedWorkspaceRevision: 13n, expectedLockVersion: 14n, trip },
    );
  });

  it("rejects_unknown_fields_before_resolving_the_staff_session", async () => {
    const harness = makeHarness();
    const route = "POST /api/admin/trips/:tripId/workspace/flights";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const response = await harness.invoke(
      route,
      { expectedWorkspaceRevision: "7", flight: requestBody().flight, agencyId },
      { tripId },
    );

    expect(response.statusCode).toBe(400);
    expect(harness.sessionResolver.resolveStaffSession).not.toHaveBeenCalled();
    expect(harness.workspaceWriteOperations.createFlight).not.toHaveBeenCalled();
  });

  it("rejects_mutations_without_the_canonical_origin_before_calling_operations", async () => {
    const harness = makeHarness(agencyId, ["trip.edit", "trip.view"]);
    const route = "PATCH /api/admin/trips/:tripId/workspace";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const response = await harness.invoke(
      route,
      {
        expectedWorkspaceRevision: "13",
        expectedLockVersion: "14",
        trip: { title: "Lisboa e Porto", startDate: "2026-09-25", endDate: "2026-09-28" },
      },
      { tripId },
      {
        host: "admin.example.test",
        origin: "https://attacker.example.test",
        cookie: "session=opaque",
      },
    );

    expect(response.statusCode).toBe(403);
    expect(harness.sessionResolver.resolveStaffSession).not.toHaveBeenCalled();
    expect(harness.workspaceWriteOperations.updateTrip).not.toHaveBeenCalled();
  });

  it("maps_a_stale_workspace_write_to_the_typed_conflict_response", async () => {
    const harness = makeHarness(agencyId, ["trip.edit", "trip.view"]);
    vi.mocked(harness.workspaceWriteOperations.updateTrip).mockRejectedValue(
      new OptimisticConflictError(),
    );
    const route = "PATCH /api/admin/trips/:tripId/workspace";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const response = await harness.invoke(
      route,
      {
        expectedWorkspaceRevision: "13",
        expectedLockVersion: "14",
        trip: { title: "Lisboa e Porto", startDate: "2026-09-25", endDate: "2026-09-28" },
      },
      { tripId },
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: "optimistic_conflict" });
  });

  it("conceals_cross_trip_item_updates_as_not_found", async () => {
    const harness = makeHarness(agencyId, ["trip.edit", "trip.view"]);
    vi.mocked(harness.workspaceWriteOperations.updateFlight).mockRejectedValue(
      new TripNotFoundError(),
    );
    const route = "PATCH /api/admin/trips/:tripId/workspace/flights/:itemId";
    expect(harness.handlers.has(route)).toBe(true);
    if (!harness.handlers.has(route)) return;

    const response = await harness.invoke(
      route,
      { expectedWorkspaceRevision: "8", expectedLockVersion: "9", flight: requestBody().flight },
      { tripId, itemId: flightId },
    );

    expect(response.statusCode).toBe(404);
    expect(response.body).toBeUndefined();
  });
});
