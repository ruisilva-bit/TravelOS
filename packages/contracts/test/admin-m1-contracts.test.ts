import { describe, expect, it } from "vitest";

import {
  AdminCreateM1TripSliceRequestSchema,
  AdminLockVersionSchema,
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
const id = (sequence: number) =>
  `abcdef12-3456-7abc-8def-${sequence.toString(16).padStart(12, "0")}`;

const baseRequest = {
  agencyId: id(1),
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
    expect(
      AdminCreateM1TripSliceRequestSchema.safeParse({
        ...baseRequest,
        trip: { ...baseRequest.trip, startDate: "2026-09-29" },
      }).success,
    ).toBe(false);
    expect(
      AdminCreateM1TripSliceRequestSchema.safeParse({
        ...baseRequest,
        trip: { ...baseRequest.trip, startDate: "2026-09-25\n" },
      }).success,
    ).toBe(false);
    for (const departure of [
      { ...baseRequest.flight.departure, localDate: "2026-09-25\n" },
      { ...baseRequest.flight.departure, localTime: "09:00\n" },
      { ...baseRequest.flight.departure, instant: "2026-09-25T08:00:00Z\n" },
    ]) {
      expect(
        AdminCreateM1TripSliceRequestSchema.safeParse({
          ...baseRequest,
          flight: { ...baseRequest.flight, departure },
        }).success,
      ).toBe(false);
    }
    expect(
      AdminCreateM1TripSliceRequestSchema.safeParse({
        ...baseRequest,
        flight: {
          ...baseRequest.flight,
          arrival: {
            localDate: "2026-09-25",
            localTime: "08:00",
            timezoneName: "Europe/Lisbon",
            instant: "2026-09-25T07:00:00Z",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      AdminCreateM1TripSliceRequestSchema.safeParse({
        ...baseRequest,
        accommodation: {
          ...baseRequest.accommodation,
          checkOut: {
            localDate: "2026-09-25",
            localTime: "14:00",
            timezoneName: "Europe/Lisbon",
            instant: "2026-09-25T13:00:00Z",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps PostgreSQL bigint lock versions as canonical decimal strings", () => {
    expect(AdminLockVersionSchema.parse("0")).toBe("0");
    expect(AdminLockVersionSchema.parse("9007199254740993")).toBe("9007199254740993");
    expect(AdminLockVersionSchema.safeParse("9223372036854775807").success).toBe(true);
    expect(AdminLockVersionSchema.safeParse("9223372036854775808").success).toBe(false);
    expect(AdminLockVersionSchema.safeParse("01").success).toBe(false);
    expect(AdminLockVersionSchema.safeParse("0\n").success).toBe(false);
    expect(AdminLockVersionSchema.safeParse(1).success).toBe(false);
  });

  it("keeps Money JSON exact and string-valued in the response contract", () => {
    const parsed = AdminM1TripSliceResponseSchema.safeParse({
      person: {
        id: id(2),
        agencyId: baseRequest.agencyId,
        givenName: "Rui",
        familyName: "Silva",
        email: syntheticEmail,
        lockVersion: "0",
      },
      customer: {
        id: id(3),
        agencyId: baseRequest.agencyId,
        displayName: "Silva Travel",
        lockVersion: "0",
      },
      customerPerson: {
        agencyId: baseRequest.agencyId,
        customerId: id(3),
        personId: id(2),
        role: "PRIMARY_CONTACT",
        isPrimary: true,
      },
      traveller: {
        id: id(5),
        agencyId: baseRequest.agencyId,
        tripId: id(4),
        personId: id(2),
        role: "PRIMARY_TRAVELLER",
      },
      trip: {
        id: id(4),
        agencyId: baseRequest.agencyId,
        title: "Trip",
        startDate: baseRequest.trip.startDate,
        endDate: baseRequest.trip.endDate,
        state: "DRAFT",
        workspaceRevision: "1",
        lockVersion: "0",
      },
      flights: [
        {
          ...baseRequest.flight,
          id: id(6),
          agencyId: baseRequest.agencyId,
          tripId: id(4),
          family: "FLIGHT",
          state: "CONFIRMED",
          sortOrder: 1,
          lockVersion: "0",
        },
      ],
      accommodations: [
        {
          ...baseRequest.accommodation,
          id: id(7),
          agencyId: baseRequest.agencyId,
          tripId: id(4),
          family: "ACCOMMODATION",
          state: "CONFIRMED",
          sortOrder: 2,
          lockVersion: "0",
        },
      ],
      reservations: [
        {
          id: id(8),
          agencyId: baseRequest.agencyId,
          tripId: id(4),
          ...baseRequest.reservation,
          lockVersion: "0",
        },
      ],
      reservationItemLinks: [
        {
          agencyId: baseRequest.agencyId,
          tripId: id(4),
          reservationId: id(8),
          itineraryItemId: id(6),
          linkRole: "PRIMARY",
        },
        {
          agencyId: baseRequest.agencyId,
          tripId: id(4),
          reservationId: id(8),
          itineraryItemId: id(7),
          linkRole: "SECONDARY",
        },
      ],
      supplierCosts: [
        {
          id: id(9),
          agencyId: baseRequest.agencyId,
          tripId: id(4),
          reservationId: id(8),
          amount: baseRequest.supplierCost.amount,
          internalNote: "Net",
          classification: "INTERNAL_ONLY",
          lockVersion: "0",
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const pluralResponse = AdminM1TripSliceResponseSchema.safeParse({
        ...parsed.data,
        flights: [...parsed.data.flights, { ...parsed.data.flights[0]!, id: id(12), sortOrder: 3 }],
        accommodations: [
          ...parsed.data.accommodations,
          {
            ...parsed.data.accommodations[0]!,
            id: id(13),
            sortOrder: 4,
          },
        ],
        reservations: [
          ...parsed.data.reservations,
          { ...parsed.data.reservations[0]!, id: id(14) },
        ],
        supplierCosts: [
          ...parsed.data.supplierCosts,
          {
            ...parsed.data.supplierCosts[0]!,
            id: id(15),
            reservationId: id(14),
          },
        ],
      });
      expect(pluralResponse.success).toBe(true);
      expect(
        AdminM1TripSliceResponseSchema.safeParse({
          ...parsed.data,
          trip: { ...parsed.data.trip, startDate: "2026-02-30" },
        }).success,
      ).toBe(false);
      expect(
        AdminM1TripSliceResponseSchema.safeParse({
          ...parsed.data,
          trip: { ...parsed.data.trip, startDate: "2026-09-29" },
        }).success,
      ).toBe(false);
      expect(
        AdminM1TripSliceResponseSchema.safeParse({
          ...parsed.data,
          trip: { ...parsed.data.trip, workspaceRevision: "1\n" },
        }).success,
      ).toBe(false);
      expect(
        AdminM1TripSliceResponseSchema.safeParse({
          ...parsed.data,
          flights: [
            {
              ...parsed.data.flights[0]!,
              arrival: {
                localDate: "2026-09-25",
                localTime: "08:00",
                timezoneName: "Europe/Lisbon",
                instant: "2026-09-25T07:00:00Z",
              },
            },
          ],
        }).success,
      ).toBe(false);
      expect(
        AdminM1TripSliceResponseSchema.safeParse({
          ...parsed.data,
          accommodations: [
            {
              ...parsed.data.accommodations[0]!,
              checkOut: {
                localDate: "2026-09-25",
                localTime: "14:00",
                timezoneName: "Europe/Lisbon",
                instant: "2026-09-25T13:00:00Z",
              },
            },
          ],
        }).success,
      ).toBe(false);
      for (const inconsistentResponse of [
        {
          ...parsed.data,
          person: { ...parsed.data.person, agencyId: id(99) },
        },
        {
          ...parsed.data,
          customer: { ...parsed.data.customer, agencyId: id(99) },
        },
        {
          ...parsed.data,
          customerPerson: { ...parsed.data.customerPerson, agencyId: id(99) },
        },
        {
          ...parsed.data,
          customerPerson: { ...parsed.data.customerPerson, customerId: id(99) },
        },
        {
          ...parsed.data,
          customerPerson: { ...parsed.data.customerPerson, personId: id(99) },
        },
        {
          ...parsed.data,
          traveller: { ...parsed.data.traveller, agencyId: id(99) },
        },
        {
          ...parsed.data,
          traveller: { ...parsed.data.traveller, personId: id(99) },
        },
        {
          ...parsed.data,
          trip: { ...parsed.data.trip, agencyId: id(99) },
        },
        {
          ...parsed.data,
          flights: [{ ...parsed.data.flights[0]!, agencyId: id(99) }],
        },
        {
          ...parsed.data,
          flights: [{ ...parsed.data.flights[0]!, tripId: id(99) }],
        },
        {
          ...parsed.data,
          accommodations: [{ ...parsed.data.accommodations[0]!, agencyId: id(99) }],
        },
        {
          ...parsed.data,
          accommodations: [{ ...parsed.data.accommodations[0]!, tripId: id(99) }],
        },
        {
          ...parsed.data,
          reservations: [{ ...parsed.data.reservations[0]!, agencyId: id(99) }],
        },
        {
          ...parsed.data,
          reservations: [{ ...parsed.data.reservations[0]!, tripId: id(99) }],
        },
        {
          ...parsed.data,
          reservationItemLinks: [{ ...parsed.data.reservationItemLinks[0]!, agencyId: id(99) }],
        },
        {
          ...parsed.data,
          reservationItemLinks: [{ ...parsed.data.reservationItemLinks[0]!, tripId: id(99) }],
        },
        {
          ...parsed.data,
          reservationItemLinks: [
            { ...parsed.data.reservationItemLinks[0]!, reservationId: id(99) },
          ],
        },
        {
          ...parsed.data,
          reservationItemLinks: [
            { ...parsed.data.reservationItemLinks[0]!, itineraryItemId: id(99) },
          ],
        },
        {
          ...parsed.data,
          supplierCosts: [{ ...parsed.data.supplierCosts[0]!, agencyId: id(99) }],
        },
        {
          ...parsed.data,
          supplierCosts: [{ ...parsed.data.supplierCosts[0]!, tripId: id(99) }],
        },
        {
          ...parsed.data,
          supplierCosts: [{ ...parsed.data.supplierCosts[0]!, reservationId: id(99) }],
        },
      ]) {
        expect(AdminM1TripSliceResponseSchema.safeParse(inconsistentResponse).success).toBe(false);
      }
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
    expect(AdminOpaqueIdSchema.parse(baseRequest.agencyId)).toBe(baseRequest.agencyId);
    for (const invalidId of [
      baseRequest.agencyId.toUpperCase(),
      ` ${baseRequest.agencyId}`,
      "00000000-0000-0000-0000-000000000000",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-7000-7000-000000000001",
      "00000000-0000-7000-8000-00000000000g",
      "00000000-0000-7000-8000-00000000001",
      `${baseRequest.agencyId}\n`,
    ]) {
      expect(AdminOpaqueIdSchema.safeParse(invalidId).success).toBe(false);
    }
    for (const nonCanonicalMinorUnits of ["00", "0001", "-0", "1\n"]) {
      expect(
        AdminMoneySchema.safeParse({
          minorUnits: nonCanonicalMinorUnits,
          currency: "EUR",
          scale: 2,
        }).success,
      ).toBe(false);
    }
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
        localDate: "1000-01-01",
        localTime: "00:00:00",
        timezoneName: "UTC",
        instant: "1000-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "9999-12-31",
        localTime: "23:59:59",
        timezoneName: "UTC",
        instant: "9999-12-31T23:59:59.999Z",
      }).success,
    ).toBe(true);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "1000-01-01",
        localTime: "00:52:00",
        timezoneName: "Africa/Johannesburg",
        instant: "1000-01-01T00:52:00+01:52",
      }).success,
    ).toBe(false);
    expect(
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate: "9999-12-31",
        localTime: "16:00:00",
        timezoneName: "America/Los_Angeles",
        instant: "9999-12-31T16:00:00-08:00",
      }).success,
    ).toBe(false);
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
