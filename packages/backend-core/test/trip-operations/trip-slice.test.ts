import { describe, expect, it } from "vitest";

import {
  createStaffTripOperations,
  StaffAuthorizationError,
  InputValidationError,
  permissionDefinitionFor,
  type OperationalSliceRepository,
  type StaffAuthorizationOperationProof,
  type StaffAuthorizationSnapshot,
  type StaffPermissionId,
  type StaffSessionAuthorizationProof,
} from "../../src/index.js";
import {
  createTripSlice as createTripSliceWithAuthorization,
  readTripSlice as readTripSliceWithAuthorization,
  updateAccommodation as updateAccommodationWithAuthorization,
  updateInternalSupplierNote as updateInternalSupplierNoteWithAuthorization,
  validateCreateTripSliceInput,
  type CreateTripSliceInput,
} from "../../src/modules/trip-operations/application/trip-slice.js";

const syntheticEmail = ["rui", "example.test"].join(String.fromCharCode(64));

const rejectUnexpectedFixtureTripCreation = async (): Promise<never> => {
  throw new Error("Unexpected fixture Trip creation in unit test");
};

const rejectUnexpectedTripWorkspaceCreation = async (): Promise<never> => {
  throw new Error("Unexpected minimal Trip workspace creation in unit test");
};

const agencyId = "00000000-0000-7000-8000-000000000001" as CreateTripSliceInput["agencyId"];

const permissionIds = [
  "customer.view",
  "customer.edit",
  "traveller.view_sensitive",
  "traveller.edit",
  "trip.view",
  "trip.edit",
  "reservation.view",
  "reservation.edit",
  "finance.view_costs",
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];

const readPermissionIds = [
  "customer.view",
  "traveller.view_sensitive",
  "trip.view",
  "reservation.view",
  "finance.view_costs",
] as const satisfies readonly StaffPermissionId[];

const testAuthorization = (
  requiredPermissionIds: readonly StaffPermissionId[],
  authorizationAgencyId: CreateTripSliceInput["agencyId"] = agencyId,
): StaffAuthorizationOperationProof => {
  const nowEpochMs = Date.now();
  return {
    session: {
      sessionId: "test-session",
      staffPrincipalId: "staff-principal-unit-test",
      agencyId: authorizationAgencyId,
      authorizationEpoch: 1n,
      expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
      recentMfaVerifiedAtEpochMs: null,
    },
    requiredPermissionIds,
    nowEpochMs,
  };
};

const createTripSlice = (repository: OperationalSliceRepository, value: CreateTripSliceInput) =>
  createTripSliceWithAuthorization(
    repository,
    value,
    testAuthorization(permissionIds, value.agencyId),
  );

const readTripSlice = (
  repository: OperationalSliceRepository,
  readAgencyId: CreateTripSliceInput["agencyId"],
  tripId: CreateTripSliceInput["agencyId"],
) =>
  readTripSliceWithAuthorization(
    repository,
    readAgencyId,
    tripId,
    testAuthorization(readPermissionIds, readAgencyId),
  );

const updateAccommodation = (
  repository: OperationalSliceRepository,
  value: Parameters<typeof updateAccommodationWithAuthorization>[1],
) =>
  updateAccommodationWithAuthorization(
    repository,
    value,
    testAuthorization([...readPermissionIds, "trip.edit"], value.agencyId),
  );

const updateInternalSupplierNote = (
  repository: OperationalSliceRepository,
  value: Parameters<typeof updateInternalSupplierNoteWithAuthorization>[1],
) =>
  updateInternalSupplierNoteWithAuthorization(
    repository,
    value,
    testAuthorization([...readPermissionIds, "finance.manage_costs"], value.agencyId),
  );

const input = (): CreateTripSliceInput => ({
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

describe("Stage 5 application invariants", () => {
  it("keeps trip-operation permissions Agency-wide until resource ownership is modelled", () => {
    for (const permissionId of permissionIds) {
      expect(permissionDefinitionFor(permissionId)).toMatchObject({
        allowedScopeKinds: ["AGENCY"],
        allowedAccessLevels: ["ALL"],
      });
    }
  });

  it("validates the full continuity and structured itinerary input before persistence", () => {
    expect(() => validateCreateTripSliceInput(input())).not.toThrow();
  });

  it("rejects same-airport flights, inverted times and invalid trip dates", () => {
    expect(() =>
      validateCreateTripSliceInput({
        ...input(),
        trip: { ...input().trip, startDate: "2026-09-29" },
      }),
    ).toThrow("Trip start date");
    expect(() =>
      validateCreateTripSliceInput({
        ...input(),
        flight: { ...input().flight, arrivalAirport: "LIS" },
      }),
    ).toThrow("airports must differ");
    expect(() =>
      validateCreateTripSliceInput({
        ...input(),
        accommodation: { ...input().accommodation, checkOut: input().accommodation.checkIn },
      }),
    ).toThrow("check-in must be before check-out");
    expect(() =>
      validateCreateTripSliceInput({
        ...input(),
        flight: { ...input().flight, arrivalAirport: "LIS" },
      }),
    ).toThrow(InputValidationError);
  });

  it("rejects non-primary traveller roles before the repository boundary", () => {
    expect(() =>
      validateCreateTripSliceInput({
        ...input(),
        travellerRole: "TRAVELLER" as never,
      }),
    ).toThrow("requires a PRIMARY_TRAVELLER");
  });

  it("rejects unknown fields and contract-invalid values before the repository boundary", async () => {
    const calls = { create: 0, updateAccommodation: 0, updateInternalNote: 0 };
    const repository = {
      createTripWorkspace: rejectUnexpectedTripWorkspaceCreation,
      async createTripSlice(value: CreateTripSliceInput) {
        calls.create += 1;
        return { value } as never;
      },
      async getTripSlice() {
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
      async cancelTrip() {
        return undefined as never;
      },
      createRuntimeAcceptanceFixtureTrip: rejectUnexpectedFixtureTripCreation,
    };
    await expect(
      createTripSlice(repository, { ...input(), unexpected: true } as never),
    ).rejects.toThrow(InputValidationError);
    await expect(
      createTripSlice(repository, {
        ...input(),
        flight: { ...input().flight, description: "x".repeat(10_001) },
      }),
    ).rejects.toThrow(InputValidationError);
    await expect(
      createTripSlice(repository, {
        ...input(),
        trip: { ...input().trip, state: "BROKEN" },
      } as never),
    ).rejects.toThrow(InputValidationError);
    await expect(
      updateAccommodation(repository, {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 0n,
        title: "x".repeat(301),
        description: "valid description",
      }),
    ).rejects.toThrow(InputValidationError);
    await expect(
      updateAccommodation(repository, {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 1 as never,
        title: "valid title",
        description: "valid description",
      }),
    ).rejects.toThrow(InputValidationError);
    await expect(
      updateInternalSupplierNote(repository, {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: -1n,
        internalNote: "valid note",
      }),
    ).rejects.toThrow(InputValidationError);
    await expect(
      updateInternalSupplierNote(repository, {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 9_223_372_036_854_775_808n,
        internalNote: "valid note",
      }),
    ).rejects.toThrow(InputValidationError);
    await expect(
      updateInternalSupplierNote(repository, {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 0n,
        internalNote: "x".repeat(10_001),
      }),
    ).rejects.toThrow(InputValidationError);
    expect(calls).toEqual({ create: 0, updateAccommodation: 0, updateInternalNote: 0 });
  });

  it("reconstructs Money at the exported application boundary", () => {
    expect(() =>
      validateCreateTripSliceInput({
        ...input(),
        supplierCost: {
          ...input().supplierCost,
          amount: { minorUnits: 12345, currency: "EUR", scale: 2 } as never,
        },
      }),
    ).toThrow("Money JSON has invalid primitive types");
    expect(() =>
      validateCreateTripSliceInput({
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

  it("rejects malformed create, read and update inputs before every repository call", async () => {
    const calls = { create: 0, read: 0, updateAccommodation: 0, updateInternalNote: 0 };
    const repository: OperationalSliceRepository = {
      createTripWorkspace: rejectUnexpectedTripWorkspaceCreation,
      async createTripSlice() {
        calls.create += 1;
        return undefined as never;
      },
      async getTripSlice() {
        calls.read += 1;
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
      async cancelTrip() {
        return undefined as never;
      },
      createRuntimeAcceptanceFixtureTrip: rejectUnexpectedFixtureTripCreation,
    };
    const base = input();
    const without = (value: object, key: string): Record<string, unknown> =>
      Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
    const nestedRecords = [
      ["person", base.person, "givenName"],
      ["customer", base.customer, "displayName"],
      ["trip", base.trip, "state"],
      ["flight", base.flight, "arrivalAirport"],
      ["accommodation", base.accommodation, "propertyName"],
      ["reservation", base.reservation, "state"],
      ["supplierCost", base.supplierCost, "internalNote"],
    ] as const;
    const withFlightSchedule = (field: "departure" | "arrival", value: unknown): unknown => ({
      ...base,
      flight: { ...base.flight, [field]: value },
    });
    const withAccommodationSchedule = (field: "checkIn" | "checkOut", value: unknown): unknown => ({
      ...base,
      accommodation: { ...base.accommodation, [field]: value },
    });
    const scheduledRecords = [
      {
        value: base.flight.departure,
        requiredKey: "localDate",
        invalidKey: "timezoneName",
        replace: (value: unknown) => withFlightSchedule("departure", value),
      },
      {
        value: base.flight.arrival,
        requiredKey: "localTime",
        invalidKey: "instant",
        replace: (value: unknown) => withFlightSchedule("arrival", value),
      },
      {
        value: base.accommodation.checkIn,
        requiredKey: "timezoneName",
        invalidKey: "instant",
        replace: (value: unknown) => withAccommodationSchedule("checkIn", value),
      },
      {
        value: base.accommodation.checkOut,
        requiredKey: "localDate",
        invalidKey: "localTime",
        replace: (value: unknown) => withAccommodationSchedule("checkOut", value),
      },
    ] as const;
    const malformedCreates: unknown[] = [
      { ...base, agencyId: "00000000-0000-4000-8000-000000000001" },
      { ...base, customerPersonRole: null },
      { ...base, travellerRole: null },
      { ...base, person: { ...base.person, givenName: 7 } },
      { ...base, person: { ...base.person, email: 7 } },
      { ...base, customer: { ...base.customer, displayName: null } },
      { ...base, trip: { ...base.trip, state: null } },
      { ...base, flight: { ...base.flight, departure: { ...base.flight.departure, extra: true } } },
      {
        ...base,
        flight: { ...base.flight, departure: { ...base.flight.departure, instant: null } },
      },
      {
        ...base,
        accommodation: {
          ...base.accommodation,
          checkIn: { ...base.accommodation.checkIn, extra: true },
        },
      },
      { ...base, accommodation: { ...base.accommodation, roomDescription: 7 } },
      { ...base, reservation: { ...base.reservation, customerBookingReference: 7 } },
      {
        ...base,
        supplierCost: {
          ...base.supplierCost,
          amount: { minorUnits: 12345, currency: "EUR", scale: 2 },
        },
      },
    ];
    const accessorPerson = { ...base.person };
    Object.defineProperty(accessorPerson, "givenName", { enumerable: true, get: () => "Rui" });
    malformedCreates.push({ ...base, person: accessorPerson });
    for (const [field, value, requiredKey] of nestedRecords) {
      malformedCreates.push({ ...base, [field]: without(value, requiredKey) });
      malformedCreates.push({ ...base, [field]: { ...value, unknownBoundaryField: true } });
    }
    for (const scheduled of scheduledRecords) {
      const value = scheduled.value as unknown as Record<string, unknown>;
      malformedCreates.push(scheduled.replace(without(value, scheduled.requiredKey)));
      malformedCreates.push(scheduled.replace({ ...value, unknownBoundaryField: true }));
      malformedCreates.push(scheduled.replace({ ...value, [scheduled.invalidKey]: null }));
    }
    const symbolMoney = {
      minorUnits: 12345n,
      currency: "EUR",
      scale: 2,
      [Symbol("untrusted")]: true,
    };
    const inheritedMoney = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      { minorUnits: 12345n, currency: "EUR", scale: 2 },
    );
    const nonEnumerableMoney = { minorUnits: 12345n, currency: "EUR", scale: 2 };
    Object.defineProperty(nonEnumerableMoney, "hidden", { value: true });
    const accessorMoney = { currency: "EUR", scale: 2 };
    Object.defineProperty(accessorMoney, "minorUnits", { enumerable: true, get: () => 12345n });
    for (const amount of [
      symbolMoney,
      inheritedMoney,
      nonEnumerableMoney,
      accessorMoney,
      { minorUnits: "9223372036854775808", currency: "EUR", scale: 2 },
      { minorUnits: "-9223372036854775809", currency: "EUR", scale: 2 },
      { minorUnits: 12345n, currency: "EUR", scale: 0 },
      { minorUnits: 12345n, currency: "UNKNOWN", scale: 2 },
    ]) {
      malformedCreates.push({
        ...base,
        supplierCost: { ...base.supplierCost, amount },
      });
    }
    for (const candidate of malformedCreates) {
      await expect(createTripSlice(repository, candidate as never)).rejects.toBeInstanceOf(
        InputValidationError,
      );
    }

    const invalidAccommodationUpdates: unknown[] = [
      {
        agencyId: "00000000-0000-4000-8000-000000000001",
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 0n,
        title: "Hotel",
        description: "Stay",
      },
      {
        agencyId,
        tripId: "bad-id",
        itemId: agencyId,
        expectedLockVersion: 0n,
        title: "Hotel",
        description: "Stay",
      },
      {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: -1n,
        title: "Hotel",
        description: "Stay",
      },
      {
        agencyId,
        tripId: agencyId,
        itemId: "00000000-0000-4000-8000-000000000002",
        expectedLockVersion: 0n,
        title: "Hotel",
        description: "Stay",
      },
      {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 9_223_372_036_854_775_808n,
        title: "Hotel",
        description: "Stay",
      },
      {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 0n,
        title: null,
        description: "Stay",
      },
      {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 0n,
        title: "Hotel",
        description: 7,
      },
      {
        agencyId,
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 0n,
        title: "Hotel",
        description: "Stay",
        extra: true,
      },
      {
        tripId: agencyId,
        itemId: agencyId,
        expectedLockVersion: 0n,
        title: "Hotel",
        description: "Stay",
      },
    ];
    const invalidInternalNoteUpdates: unknown[] = [
      {
        agencyId,
        tripId: agencyId,
        reservationId: "00000000-0000-4000-8000-000000000003",
        expectedLockVersion: 0n,
        internalNote: "Net",
      },
      {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: -1n,
        internalNote: "Net",
      },
      {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 0 as never,
        internalNote: "Net",
      },
      {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 9_223_372_036_854_775_808n,
        internalNote: "Net",
      },
      {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 0n,
        internalNote: null,
      },
      {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 0n,
        internalNote: 7,
      },
      {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 0n,
        internalNote: "Net",
        extra: true,
      },
      { agencyId, tripId: agencyId, expectedLockVersion: 0n, internalNote: "Net" },
      { tripId: agencyId, reservationId: agencyId, expectedLockVersion: 0n, internalNote: "Net" },
      { agencyId, reservationId: agencyId, expectedLockVersion: 0n, internalNote: "Net" },
    ];
    for (const candidate of invalidAccommodationUpdates) {
      await expect(updateAccommodation(repository, candidate as never)).rejects.toBeInstanceOf(
        InputValidationError,
      );
    }
    for (const candidate of invalidInternalNoteUpdates) {
      await expect(
        updateInternalSupplierNote(repository, candidate as never),
      ).rejects.toBeInstanceOf(InputValidationError);
    }
    await expect(
      readTripSlice(repository, "00000000-0000-4000-8000-000000000001" as never, agencyId),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(readTripSlice(repository, agencyId, "bad-id" as never)).rejects.toBeInstanceOf(
      InputValidationError,
    );

    expect(calls).toEqual({ create: 0, read: 0, updateAccommodation: 0, updateInternalNote: 0 });
    expect(() =>
      validateCreateTripSliceInput({
        ...base,
        supplierCost: {
          ...base.supplierCost,
          amount: { minorUnits: -(2n ** 63n), currency: "EUR", scale: 2 },
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateCreateTripSliceInput({
        ...base,
        supplierCost: {
          ...base.supplierCost,
          amount: { minorUnits: 2n ** 63n - 1n, currency: "EUR", scale: 2 },
        },
      }),
    ).not.toThrow();
  });

  it("orders supported millisecond instants without precision loss", () => {
    expect(() =>
      validateCreateTripSliceInput({
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
      createTripWorkspace: rejectUnexpectedTripWorkspaceCreation,
      async createTripSlice(value: CreateTripSliceInput) {
        return { value } as never;
      },
      async getTripSlice() {
        return null;
      },
      async updateAccommodation() {
        return undefined as never;
      },
      async updateInternalSupplierNote() {
        return undefined as never;
      },
      async cancelTrip() {
        return undefined as never;
      },
      createRuntimeAcceptanceFixtureTrip: rejectUnexpectedFixtureTripCreation,
    };
    await expect(createTripSlice(repository, input())).resolves.toMatchObject({ value: input() });
  });

  it("passes reconstructed JSON Money to the repository port", async () => {
    const captured: { value: CreateTripSliceInput | null } = { value: null };
    const repository = {
      createTripWorkspace: rejectUnexpectedTripWorkspaceCreation,
      async createTripSlice(value: CreateTripSliceInput) {
        captured.value = value;
        return { value } as never;
      },
      async getTripSlice() {
        return null;
      },
      async updateAccommodation() {
        return undefined as never;
      },
      async updateInternalSupplierNote() {
        return undefined as never;
      },
      async cancelTrip() {
        return undefined as never;
      },
      createRuntimeAcceptanceFixtureTrip: rejectUnexpectedFixtureTripCreation,
    };
    await createTripSlice(repository, {
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
      sessionId: "session-1",
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
        agencyId,
        permissionId,
        scopeKind: "AGENCY",
        organizationUnitId: null,
        accessLevel: "ALL",
        active: true,
      })),
    };
    const calls: string[] = [];
    const repository: OperationalSliceRepository = {
      createTripWorkspace: rejectUnexpectedTripWorkspaceCreation,
      async createTripSlice(value) {
        calls.push("workspace:create");
        return { value } as never;
      },
      async getTripSlice() {
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
      async cancelTrip() {
        return undefined as never;
      },
      createRuntimeAcceptanceFixtureTrip: rejectUnexpectedFixtureTripCreation,
    };
    const operations = createStaffTripOperations({
      repository,
      authorizationRepository: {
        async getStaffAuthorizationSnapshot(_staffPrincipalId, requestedAgencyId) {
          calls.push(`authorization:${requestedAgencyId}`);
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
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(calls).toEqual([]);

    await operations.createTripSlice("staff-session-cookie=opaque", input());
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("session:staff-session-cookie=opaque");
    expect(calls[1]).toBe(`authorization:${agencyId}`);
    expect(calls[2]).toBe("workspace:create");
  });

  it("denies inactive, missing-permission and cross-Agency direct calls before workspace access", async () => {
    const nowEpochMs = 1_700_000_000_000;
    const session: StaffSessionAuthorizationProof = {
      sessionId: "session-1",
      staffPrincipalId: "staff-principal-1",
      agencyId,
      authorizationEpoch: 7n,
      expiresAtEpochMs: nowEpochMs + 60_000,
      recentMfaVerifiedAtEpochMs: null,
    };
    const workspaceCalls: string[] = [];
    const repository: OperationalSliceRepository = {
      createTripWorkspace: rejectUnexpectedTripWorkspaceCreation,
      async createTripSlice() {
        workspaceCalls.push("create");
        return undefined as never;
      },
      async getTripSlice() {
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
      async cancelTrip() {
        return undefined as never;
      },
      createRuntimeAcceptanceFixtureTrip: rejectUnexpectedFixtureTripCreation,
    };
    const makeOperations = (snapshot: StaffAuthorizationSnapshot | null) =>
      createStaffTripOperations({
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
      "00000000-0000-7000-8000-000000000002" as CreateTripSliceInput["agencyId"];
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
        agencyId,
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
        tripId: "00000000-0000-7000-8000-000000000020" as CreateTripSliceInput["agencyId"],
        itemId: "00000000-0000-7000-8000-000000000021" as CreateTripSliceInput["agencyId"],
        expectedLockVersion: 0n,
        title: "Updated hotel",
        description: "Updated description",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      readOnlyOperations.updateInternalSupplierNote("staff-session-cookie=opaque", {
        agencyId,
        tripId: "00000000-0000-7000-8000-000000000020" as CreateTripSliceInput["agencyId"],
        reservationId: "00000000-0000-7000-8000-000000000022" as CreateTripSliceInput["agencyId"],
        expectedLockVersion: 0n,
        internalNote: "Unauthorized change",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(workspaceCalls).toEqual([]);
  });

  it("creates_a_minimal_trip_workspace_using_only_the_authenticated_staff_scope", async () => {
    const nowEpochMs = 1_700_000_000_000;
    const request = {
      customer: { displayName: "Costa Norte Viagens" },
      primaryTraveller: { givenName: "Ana", familyName: "Matos" },
      trip: { title: "Lisboa a Porto", startDate: "2026-10-26", endDate: "2026-10-30" },
    };
    const requiredPermissions = [
      "customer.edit",
      "traveller.edit",
      "trip.edit",
      "trip.view",
    ] as const satisfies readonly StaffPermissionId[];
    const session: StaffSessionAuthorizationProof = {
      sessionId: "session-create-workspace",
      staffPrincipalId: "staff-principal-create-workspace",
      agencyId,
      authorizationEpoch: 3n,
      expiresAtEpochMs: nowEpochMs + 60_000,
      recentMfaVerifiedAtEpochMs: null,
    };
    const snapshot: StaffAuthorizationSnapshot = {
      staffPrincipalId: session.staffPrincipalId,
      agencyId,
      membershipState: "ACTIVE",
      authorizationEpoch: session.authorizationEpoch,
      assignments: requiredPermissions.map((permissionId) => ({
        agencyId,
        permissionId,
        scopeKind: "AGENCY",
        organizationUnitId: null,
        accessLevel: "ALL",
        active: true,
      })),
    };
    const createdTrip = {
      id: "00000000-0000-7000-8000-000000000101",
      agencyId,
      title: "Lisboa a Porto",
      startDate: "2026-10-26",
      endDate: "2026-10-30",
      state: "DRAFT",
      workspaceRevision: 1n,
      lockVersion: 0n,
    };
    const calls: string[] = [];
    const repository = {
      async createTripWorkspace(value: unknown, authorization: StaffAuthorizationOperationProof) {
        calls.push("repository:create");
        expect(value).toEqual(request);
        expect(authorization.session).toEqual(session);
        expect(authorization.requiredPermissionIds).toEqual(requiredPermissions);
        return createdTrip;
      },
    };
    const operations = createStaffTripOperations({
      repository: repository as unknown as OperationalSliceRepository,
      authorizationRepository: {
        async getStaffAuthorizationSnapshot() {
          calls.push("authorization:snapshot");
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
    const candidate = (operations as unknown as Record<string, unknown>).createTripWorkspace;

    expect(candidate).toBeTypeOf("function");
    if (typeof candidate !== "function") return;
    const result = await (
      candidate as (cookieHeader: unknown, value: unknown) => Promise<unknown>
    ).call(operations, "staff-session-cookie=opaque", request);

    expect(result).toEqual(createdTrip);
    expect(calls).toEqual([
      "session:staff-session-cookie=opaque",
      "authorization:snapshot",
      "repository:create",
    ]);
  });

  it("rejects_forged_agency_fields_and_missing_create_permissions_before_persistence", async () => {
    const request = {
      customer: { displayName: "Costa Norte Viagens" },
      primaryTraveller: { givenName: "Ana", familyName: "Matos" },
      trip: { title: "Lisboa a Porto", startDate: "2026-10-26", endDate: "2026-10-30" },
    };
    const nowEpochMs = 1_700_000_000_000;
    const session: StaffSessionAuthorizationProof = {
      sessionId: "session-create-denied",
      staffPrincipalId: "staff-principal-create-denied",
      agencyId,
      authorizationEpoch: 3n,
      expiresAtEpochMs: nowEpochMs + 60_000,
      recentMfaVerifiedAtEpochMs: null,
    };
    let repositoryCalls = 0;
    const repository = {
      async createTripWorkspace() {
        repositoryCalls += 1;
        return undefined;
      },
    };
    const operations = createStaffTripOperations({
      repository: repository as unknown as OperationalSliceRepository,
      authorizationRepository: {
        async getStaffAuthorizationSnapshot() {
          return {
            staffPrincipalId: session.staffPrincipalId,
            agencyId,
            membershipState: "ACTIVE",
            authorizationEpoch: session.authorizationEpoch,
            assignments: [],
          } satisfies StaffAuthorizationSnapshot;
        },
      },
      sessionResolver: {
        async resolveStaffSession() {
          return session;
        },
      },
      nowEpochMs: () => nowEpochMs,
    });
    const candidate = (operations as unknown as Record<string, unknown>).createTripWorkspace;

    expect(candidate).toBeTypeOf("function");
    if (typeof candidate !== "function") return;
    const create = candidate as (cookieHeader: unknown, value: unknown) => Promise<unknown>;
    await expect(
      create.call(operations, "staff-session-cookie=opaque", { ...request, agencyId }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      create.call(operations, "staff-session-cookie=opaque", request),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repositoryCalls).toBe(0);
  });
});
