import { describe, expect, it } from "vitest";

import {
  AdminCreateM1TripSliceRequestSchema,
  AdminM1TripSliceResponseSchema,
  AdminMoneySchema,
  AdminOpaqueIdSchema,
  AdminScheduledLocalDateTimeSchema,
} from "../src/admin/index.js";
import {
  TRAVELOS_CANONICAL_TIMEZONE_NAMES as CONTRACT_CANONICAL_TIMEZONE_NAMES,
  TRAVELOS_POSTGRESQL_TIMEZONE_EXCLUSIONS as CONTRACT_TIMEZONE_EXCLUSIONS,
  TRAVELOS_TIMEZONE_CONTRACT_VERSION as CONTRACT_TIMEZONE_CONTRACT_VERSION,
} from "../src/admin/itinerary/m1.js";
import {
  TRAVELOS_CANONICAL_TIMEZONE_NAMES as BACKEND_CANONICAL_TIMEZONE_NAMES,
  TRAVELOS_POSTGRESQL_TIMEZONE_EXCLUSIONS as BACKEND_TIMEZONE_EXCLUSIONS,
  TRAVELOS_TIMEZONE_CONTRACT_VERSION as BACKEND_TIMEZONE_CONTRACT_VERSION,
} from "../../backend-core/src/shared-kernel/time.js";

const syntheticEmail = ["rui", "example.test"].join(String.fromCharCode(64));

const baseRequest = {
  agencyId: "00000000-0000-4000-8000-000000000001",
  person: { givenName: "Rui", familyName: "Silva", email: syntheticEmail },
  customer: { displayName: "Silva Travel" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: { title: "Trip", startDate: "2026-09-25", endDate: "2026-09-28", state: "DRAFT" },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Flight",
    description: "Description",
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
    cabin: null,
    baggage: null,
    seat: null,
    customerBookingReference: null,
  },
  accommodation: {
    title: "Hotel",
    description: "Description",
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
    roomDescription: null,
    boardType: null,
    customerBookingReference: null,
  },
  reservation: {
    supplierName: "Supplier",
    supplierReference: "REF",
    customerBookingReference: null,
    state: "CONFIRMED",
  },
  supplierCost: { amount: { minorUnits: "12345", currency: "EUR", scale: 2 }, internalNote: "Net" },
} as const;

describe("Stage 5 Admin contracts", () => {
  it("accepts the exact create allowlist and rejects unknown fields", () => {
    expect(AdminCreateM1TripSliceRequestSchema.parse(baseRequest)).toEqual(baseRequest);
    expect(() =>
      AdminCreateM1TripSliceRequestSchema.parse({ ...baseRequest, ignored: "nope" }),
    ).toThrow();
    expect(
      AdminCreateM1TripSliceRequestSchema.safeParse({ ...baseRequest, travellerRole: "TRAVELLER" })
        .success,
    ).toBe(false);
    expect(
      AdminCreateM1TripSliceRequestSchema.safeParse({ ...baseRequest, travellerRole: "PAYER" })
        .success,
    ).toBe(false);
  });

  it("keeps Money JSON exact and string-valued in the response contract", () => {
    const parsed = AdminM1TripSliceResponseSchema.safeParse({
      person: {
        id: baseRequest.agencyId,
        agencyId: baseRequest.agencyId,
        givenName: "Rui",
        familyName: "Silva",
        email: syntheticEmail,
        lockVersion: 1,
      },
      customer: {
        id: baseRequest.agencyId,
        agencyId: baseRequest.agencyId,
        displayName: "Silva Travel",
        lockVersion: 1,
      },
      customerPerson: {
        agencyId: baseRequest.agencyId,
        customerId: baseRequest.agencyId,
        personId: baseRequest.agencyId,
        role: "PRIMARY_CONTACT",
        isPrimary: true,
      },
      traveller: {
        id: baseRequest.agencyId,
        agencyId: baseRequest.agencyId,
        tripId: baseRequest.agencyId,
        personId: baseRequest.agencyId,
        role: "PRIMARY_TRAVELLER",
      },
      trip: {
        id: baseRequest.agencyId,
        agencyId: baseRequest.agencyId,
        title: "Trip",
        startDate: "2026-09-25",
        endDate: "2026-09-28",
        state: "DRAFT",
        workspaceRevision: "1",
        lockVersion: 1,
      },
      flights: [
        {
          ...baseRequest.flight,
          id: baseRequest.agencyId,
          agencyId: baseRequest.agencyId,
          tripId: baseRequest.agencyId,
          family: "FLIGHT",
          state: "CONFIRMED",
          sortOrder: 1,
          lockVersion: 1,
        },
      ],
      accommodations: [
        {
          ...baseRequest.accommodation,
          id: baseRequest.agencyId,
          agencyId: baseRequest.agencyId,
          tripId: baseRequest.agencyId,
          family: "ACCOMMODATION",
          state: "CONFIRMED",
          sortOrder: 2,
          lockVersion: 1,
        },
      ],
      reservations: [
        {
          id: baseRequest.agencyId,
          agencyId: baseRequest.agencyId,
          tripId: baseRequest.agencyId,
          ...baseRequest.reservation,
          lockVersion: 1,
        },
      ],
      reservationItemLinks: [],
      supplierCosts: [
        {
          id: baseRequest.agencyId,
          agencyId: baseRequest.agencyId,
          tripId: baseRequest.agencyId,
          reservationId: baseRequest.agencyId,
          amount: baseRequest.supplierCost.amount,
          internalNote: "Net",
          classification: "INTERNAL_ONLY",
          lockVersion: 1,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const pluralResponse = AdminM1TripSliceResponseSchema.safeParse({
        ...parsed.data,
        flights: [
          ...parsed.data.flights,
          { ...parsed.data.flights[0]!, id: "00000000-0000-4000-8000-000000000002", sortOrder: 3 },
        ],
        accommodations: [
          ...parsed.data.accommodations,
          {
            ...parsed.data.accommodations[0]!,
            id: "00000000-0000-4000-8000-000000000003",
            sortOrder: 4,
          },
        ],
        reservations: [
          ...parsed.data.reservations,
          { ...parsed.data.reservations[0]!, id: "00000000-0000-4000-8000-000000000004" },
        ],
        supplierCosts: [
          ...parsed.data.supplierCosts,
          {
            ...parsed.data.supplierCosts[0]!,
            id: "00000000-0000-4000-8000-000000000005",
            reservationId: "00000000-0000-4000-8000-000000000004",
          },
        ],
      });
      expect(pluralResponse.success).toBe(true);
    }
    expect(
      AdminM1TripSliceResponseSchema.safeParse({
        ...(parsed.success ? parsed.data : {}),
        traveller: {
          ...(parsed.success ? parsed.data.traveller : {}),
          role: "TRAVELLER",
        },
      }).success,
    ).toBe(false);
    expect(
      AdminM1TripSliceResponseSchema.safeParse({
        ...(parsed.success ? parsed.data : {}),
        supplierCosts: [
          {
            ...(parsed.success ? parsed.data.supplierCosts[0] : {}),
            amount: { minorUnits: 1, currency: "EUR", scale: 2 },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("enforces pinned Money scales, canonical IDs and coherent civil times", () => {
    expect(AdminMoneySchema.safeParse({ minorUnits: "1", currency: "EUR", scale: 4 }).success).toBe(
      false,
    );
    expect(
      AdminMoneySchema.safeParse({
        minorUnits: "9223372036854775808",
        currency: "EUR",
        scale: 2,
      }).success,
    ).toBe(false);
    expect(AdminOpaqueIdSchema.parse(baseRequest.agencyId.toUpperCase())).toBe(
      baseRequest.agencyId,
    );
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-02-30",
        localTime: "09:00",
        timezoneName: "Europe/Lisbon",
        instant: "2026-03-02T09:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-09-25",
        localTime: "09:00",
        timezoneName: "Europe/Lisbon",
        instant: "2026-09-25T10:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-03-02",
        localTime: "09:00",
        timezoneName: "Europe/Lisbon",
        instant: "2026-02-30T09:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-09-26",
        localTime: "00:00",
        timezoneName: "UTC",
        instant: "2026-09-25T24:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-09-24",
        localTime: "08:01",
        timezoneName: "UTC",
        instant: "2026-09-25T00:00:00+16:00",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-09-24",
        localTime: "08:01",
        timezoneName: "UTC",
        instant: "2026-09-25T00:00:00.1234Z",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-09-24",
        localTime: "08:01",
        timezoneName: "UTC",
        instant: "2026-09-25T00:00:00+15:59",
      }).success,
    ).toBe(true);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-09-25",
        localTime: "04:00",
        timezoneName: "US/Eastern",
        instant: "2026-09-25T08:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-10-25",
        localTime: "01:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-10-25T00:30:00Z",
      }).success,
    ).toBe(true);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-10-25",
        localTime: "01:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-10-25T01:30:00Z",
      }).success,
    ).toBe(true);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-03-29",
        localTime: "01:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-03-29T01:30:00Z",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "0999-12-31",
        localTime: "02:30",
        timezoneName: "UTC",
        instant: "0999-12-31T02:30:00Z",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "1000-01-01",
        localTime: "02:30",
        timezoneName: "UTC",
        instant: "1000-01-01T02:30:00Z",
      }).success,
    ).toBe(true);
  });

  it("keeps the Admin timezone registry byte-equivalent to backend and PostgreSQL policy", () => {
    expect(CONTRACT_TIMEZONE_CONTRACT_VERSION).toBe(BACKEND_TIMEZONE_CONTRACT_VERSION);
    expect(CONTRACT_TIMEZONE_EXCLUSIONS).toEqual(BACKEND_TIMEZONE_EXCLUSIONS);
    expect(CONTRACT_CANONICAL_TIMEZONE_NAMES).toEqual(BACKEND_CANONICAL_TIMEZONE_NAMES);
    for (const excludedTimezone of CONTRACT_TIMEZONE_EXCLUSIONS) {
      expect(CONTRACT_CANONICAL_TIMEZONE_NAMES).not.toContain(excludedTimezone);
    }
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "2026-09-25",
        localTime: "09:00",
        timezoneName: "Asia/Calcutta",
        instant: "2026-09-25T03:30:00Z",
      }).success,
    ).toBe(false);
  });
});
