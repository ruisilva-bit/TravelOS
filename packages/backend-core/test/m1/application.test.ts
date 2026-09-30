import { describe, expect, it } from "vitest";

import {
  createM1StaffTripOperations,
  M1StaffAuthorizationError,
  M1InputValidationError,
  type M1OperationalSliceRepository,
  type StaffAuthorizationSnapshot,
  type StaffPermissionId,
  type StaffSessionAuthorizationProof,
} from "../../src/index.js";
import {
  createM1TripSlice,
  updateM1Accommodation,
  updateM1InternalSupplierNote,
  validateCreateM1TripSliceInput,
  type CreateM1TripSliceInput,
} from "../../src/modules/trip-operations/application/m1-trip-slice.js";

const syntheticEmail = ["rui", "example.test"].join(String.fromCharCode(64));

const agencyId = "00000000-0000-4000-8000-000000000001" as CreateM1TripSliceInput["agencyId"];

const input = (): CreateM1TripSliceInput => ({
  agencyId,
  person: { givenName: "Rui", familyName: "Silva", email: syntheticEmail },
  customer: { displayName: "Silva Travel" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: {
    title: "Lisbon to Porto",
    startDate: "2026-09-25",
    endDate: "2026-09-28",
    state: "DRAFT",
  },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Outbound flight",
    description: "Scheduled outbound flight",
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
    baggage: "1 checked bag",
    seat: null,
    customerBookingReference: "BOOK-1",
  },
  accommodation: {
    title: "Porto hotel",
    description: "Three nights in Porto",
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
    roomDescription: "Double room",
    boardType: "BREAKFAST",
    customerBookingReference: "HOTEL-1",
  },
  reservation: {
    supplierName: "Example Supplier",
    supplierReference: "SUP-1",
    customerBookingReference: "CUST-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: { minorUnits: 12345n, currency: "EUR", scale: 2 },
    internalNote: "Supplier net cost",
  },
});

describe("Stage 5 M1 application invariants", () => {
  it("validates the full continuity and structured itinerary input before persistence", () => {
    expect(() => validateCreateM1TripSliceInput(input())).not.toThrow();
  });

  it("rejects same-airport flights, inverted times and invalid trip dates", () => {
    expect(() =>
      validateCreateM1TripSliceInput({
        ...input(),
        trip: { ...input().trip, startDate: "2026-09-29" },
      }),
    ).toThrow("Trip start date");
    expect(() =>
      validateCreateM1TripSliceInput({
        ...input(),
        flight: { ...input().flight, arrivalAirport: "LIS" },
      }),
    ).toThrow("airports must differ");
    expect(() =>
      validateCreateM1TripSliceInput({
        ...input(),
        accommodation: { ...input().accommodation, checkOut: input().accommodation.checkIn },
      }),
    ).toThrow("check-in must be before check-out");
    expect(() =>
      validateCreateM1TripSliceInput({
        ...input(),
        flight: { ...input().flight, arrivalAirport: "LIS" },
      }),
    ).toThrow(M1InputValidationError);
  });

  it("rejects non-primary traveller roles before the repository boundary", () => {
    expect(() =>
      validateCreateM1TripSliceInput({
        ...input(),
        travellerRole: "TRAVELLER" as never,
      }),
    ).toThrow("requires a PRIMARY_TRAVELLER");
  });

  it("rejects unknown fields and contract-invalid values before the repository boundary", async () => {
    const calls = { create: 0, updateAccommodation: 0, updateInternalNote: 0 };
    const repository = {
      async createM1TripSlice(value: CreateM1TripSliceInput) {
        calls.create += 1;
        return { value } as never;
      },
      async getM1TripSlice() {
        return null;
      },
      async updateAccommodation() {
        calls.updateAccommodation += 1;
        return undefined as never;
      },
      async updateInternalSupplierNote() {
        calls.updateInternalNote += 1;
        return undefined as never;
      },
    };
    await expect(
      createM1TripSlice(repository, { ...input(), unexpected: true } as never),
    ).rejects.toThrow(M1InputValidationError);
    await expect(
      createM1TripSlice(repository, {
        ...input(),
        flight: { ...input().flight, description: "x".repeat(10_001) },
      }),
    ).rejects.toThrow(M1InputValidationError);
    await expect(
      createM1TripSlice(repository, {
        ...input(),
        trip: { ...input().trip, state: "BROKEN" },
      } as never),
    ).rejects.toThrow(M1InputValidationError);
    await expect(
      updateM1Accommodation(repository, {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 0n,
        title: "x".repeat(301),
        description: "valid description",
      }),
    ).rejects.toThrow(M1InputValidationError);
    await expect(
      updateM1Accommodation(repository, {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 1 as never,
        title: "valid title",
        description: "valid description",
      }),
    ).rejects.toThrow(M1InputValidationError);
    await expect(
      updateM1InternalSupplierNote(repository, {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: -1n,
        internalNote: "valid note",
      }),
    ).rejects.toThrow(M1InputValidationError);
    await expect(
      updateM1InternalSupplierNote(repository, {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 9_223_372_036_854_775_808n,
        internalNote: "valid note",
      }),
    ).rejects.toThrow(M1InputValidationError);
    await expect(
      updateM1InternalSupplierNote(repository, {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 0n,
        internalNote: "x".repeat(10_001),
      }),
    ).rejects.toThrow(M1InputValidationError);
    expect(calls).toEqual({ create: 0, updateAccommodation: 0, updateInternalNote: 0 });
  });

  it("reconstructs Money at the exported application boundary", () => {
    expect(() =>
      validateCreateM1TripSliceInput({
        ...input(),
        supplierCost: {
          ...input().supplierCost,
          amount: { minorUnits: 12345, currency: "EUR", scale: 2 } as never,
        },
      }),
    ).toThrow("Money JSON has invalid primitive types");
    expect(() =>
      validateCreateM1TripSliceInput({
        ...input(),
        supplierCost: {
          ...input().supplierCost,
          amount: {
            minorUnits: 12345n,
            currency: "EUR",
            scale: 2,
            extra: true,
          } as never,
        },
      }),
    ).toThrow("Money contains an unknown or missing field");
  });

  it("orders supported millisecond instants without precision loss", () => {
    expect(() =>
      validateCreateM1TripSliceInput({
        ...input(),
        flight: {
          ...input().flight,
          departure: { ...input().flight.departure, instant: "2026-09-25T08:00:00.123Z" },
          arrival: {
            ...input().flight.arrival,
            localTime: "09:00",
            instant: "2026-09-25T08:00:00.124Z",
          },
        },
      }),
    ).not.toThrow();
  });

  it("keeps application persistence behind the repository port", async () => {
    const repository = {
      async createM1TripSlice(value: CreateM1TripSliceInput) {
        return { value } as never;
      },
      async getM1TripSlice() {
        return null;
      },
      async updateAccommodation() {
        return undefined as never;
      },
      async updateInternalSupplierNote() {
        return undefined as never;
      },
    };
    await expect(createM1TripSlice(repository, input())).resolves.toMatchObject({ value: input() });
  });

  it("passes reconstructed JSON Money to the repository port", async () => {
    const captured: { value: CreateM1TripSliceInput | null } = { value: null };
    const repository = {
      async createM1TripSlice(value: CreateM1TripSliceInput) {
        captured.value = value;
        return { value } as never;
      },
      async getM1TripSlice() {
        return null;
      },
      async updateAccommodation() {
        return undefined as never;
      },
      async updateInternalSupplierNote() {
        return undefined as never;
      },
    };
    await createM1TripSlice(repository, {
      ...input(),
      supplierCost: {
        ...input().supplierCost,
        amount: { minorUnits: "12345", currency: "EUR", scale: 2 } as never,
      },
    });
    expect(captured.value?.supplierCost.amount).toEqual({
      minorUnits: 12345n,
      currency: "EUR",
      scale: 2,
    });
  });

  it("authenticates direct application invocation from a cookie, not caller-supplied identity claims", async () => {
    const nowEpochMs = 1_700_000_000_000;
    const requiredPermissions = [
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
    const session: StaffSessionAuthorizationProof = {
      staffPrincipalId: "staff-principal-1",
      agencyId,
      authorizationEpoch: 7n,
      expiresAtEpochMs: nowEpochMs + 60_000,
      recentMfaVerifiedAtEpochMs: null,
    };
    const snapshot: StaffAuthorizationSnapshot = {
      staffPrincipalId: session.staffPrincipalId,
      agencyId,
      membershipState: "ACTIVE",
      authorizationEpoch: session.authorizationEpoch,
      assignments: requiredPermissions.map((permissionId) => ({
        permissionId,
        scopeKind: "AGENCY",
        organizationUnitId: null,
        accessLevel: "ALL",
        active: true,
      })),
    };
    const calls: string[] = [];
    const repository: M1OperationalSliceRepository = {
      async createM1TripSlice(value) {
        calls.push("workspace:create");
        return { value } as never;
      },
      async getM1TripSlice() {
        calls.push("workspace:read");
        return null;
      },
      async updateAccommodation() {
        calls.push("workspace:update-accommodation");
        return undefined as never;
      },
      async updateInternalSupplierNote() {
        calls.push("workspace:update-internal-note");
        return undefined as never;
      },
    };
    const operations = createM1StaffTripOperations({
      repository,
      authorizationRepository: {
        async getStaffAuthorizationSnapshot(_staffPrincipalId) {
          calls.push("authorization:***");
          return snapshot;
        },
      },
      sessionResolver: {
        async resolveStaffSession(cookieHeader) {
          calls.push(`session:${cookieHeader}`);
          return session;
        },
      },
      nowEpochMs: () => nowEpochMs,
    });

    await expect(operations.createTripSlice(null, input())).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      operations.createTripSlice(
        {
          staffPrincipalId: session.staffPrincipalId,
          agencyId,
          authorizationEpoch: 7n,
        } as never,
        input(),
      ),
    ).rejects.toBeInstanceOf(M1StaffAuthorizationError);
    expect(calls).toEqual([]);

    await operations.createTripSlice("staff-session-cookie=opaque", input());
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("session:staff-session-cookie=opaque");
    expect(calls[1]).toMatch(/^authorization:/u);
    expect(calls[2]).toBe("workspace:create");
  });

  it("denies inactive, missing-permission and cross-Agency direct calls before workspace access", async () => {
    const nowEpochMs = 1_700_000_000_000;
    const session: StaffSessionAuthorizationProof = {
      staffPrincipalId: "staff-principal-1",
      agencyId,
      authorizationEpoch: 7n,
      expiresAtEpochMs: nowEpochMs + 60_000,
      recentMfaVerifiedAtEpochMs: null,
    };
    const workspaceCalls: string[] = [];
    const repository: M1OperationalSliceRepository = {
      async createM1TripSlice() {
        workspaceCalls.push("create");
        return undefined as never;
      },
      async getM1TripSlice() {
        workspaceCalls.push("read");
        return null;
      },
      async updateAccommodation() {
        workspaceCalls.push("update-accommodation");
        return undefined as never;
      },
      async updateInternalSupplierNote() {
        workspaceCalls.push("update-internal-note");
        return undefined as never;
      },
    };
    const makeOperations = (snapshot: StaffAuthorizationSnapshot | null) =>
      createM1StaffTripOperations({
        repository,
        authorizationRepository: {
          async getStaffAuthorizationSnapshot() {
            return snapshot;
          },
        },
        sessionResolver: {
          async resolveStaffSession() {
            return session;
          },
        },
        nowEpochMs: () => nowEpochMs,
      });
    const inactiveSnapshot: StaffAuthorizationSnapshot = {
      staffPrincipalId: session.staffPrincipalId,
      agencyId,
      membershipState: "DISABLED",
      authorizationEpoch: session.authorizationEpoch,
      assignments: [],
    };

    await expect(
      makeOperations(inactiveSnapshot).readTripSlice("staff-session-cookie=opaque", agencyId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      makeOperations(null).readTripSlice("staff-session-cookie=opaque", agencyId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      makeOperations({ ...inactiveSnapshot, membershipState: "ACTIVE" }).createTripSlice(
        "staff-session-cookie=opaque",
        input(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const otherAgencyId =
      "00000000-0000-4000-8000-000000000002" as CreateM1TripSliceInput["agencyId"];
    await expect(
      makeOperations(inactiveSnapshot).createTripSlice("staff-session-cookie=opaque", {
        ...input(),
        agencyId: otherAgencyId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const readPermissions = [
      "customer.view",
      "traveller.view_sensitive",
      "trip.view",
      "reservation.view",
      "finance.view_costs",
    ] as const satisfies readonly StaffPermissionId[];
    const readOnlySnapshot: StaffAuthorizationSnapshot = {
      ...inactiveSnapshot,
      membershipState: "ACTIVE",
      assignments: readPermissions.map((permissionId) => ({
        permissionId,
        scopeKind: "AGENCY",
        organizationUnitId: null,
        accessLevel: "ALL",
        active: true,
      })),
    };
    const readOnlyOperations = makeOperations(readOnlySnapshot);
    await expect(
      readOnlyOperations.updateAccommodation("staff-session-cookie=opaque", {
        agencyId,
        tripId: "00000000-0000-4000-8000-000000000020" as CreateM1TripSliceInput["agencyId"],
        itemId: "00000000-0000-4000-8000-000000000021" as CreateM1TripSliceInput["agencyId"],
        expectedLockVersion: 0n,
        title: "Updated hotel",
        description: "Updated description",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      readOnlyOperations.updateInternalSupplierNote("staff-session-cookie=opaque", {
        agencyId,
        tripId: "00000000-0000-4000-8000-000000000020" as CreateM1TripSliceInput["agencyId"],
        reservationId: "00000000-0000-4000-8000-000000000022" as CreateM1TripSliceInput["agencyId"],
        expectedLockVersion: 0n,
        internalNote: "Unauthorized change",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(workspaceCalls).toEqual([]);
  });
});
