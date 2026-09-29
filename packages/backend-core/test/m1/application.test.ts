import { describe, expect, it } from "vitest";

import {
  createM1TripSlice,
  M1InputValidationError,
  updateM1Accommodation,
  updateM1InternalSupplierNote,
  validateCreateM1TripSliceInput,
  type CreateM1TripSliceInput,
} from "../../src/index.js";

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
        expectedLockVersion: 1,
        title: "x".repeat(301),
        description: "valid description",
      }),
    ).rejects.toThrow(M1InputValidationError);
    await expect(
      updateM1InternalSupplierNote(repository, {
        agencyId,
        tripId: agencyId,
        reservationId: agencyId,
        expectedLockVersion: 1,
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
});
