import { describe, expect, it } from "vitest";

const contracts = (await import("../src/admin/index.js")) as unknown as Record<string, unknown>;
const schemaFrom = (
  name: string,
):
  | { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean } }
  | undefined => {
  const value = contracts[name];
  return typeof value === "object" && value !== null
    ? (value as {
        parse(value: unknown): unknown;
        safeParse(value: unknown): { success: boolean };
      })
    : undefined;
};

const agencyId = "00000000-0000-7000-8000-000000000101";
const flight = {
  title: "Voo Lisboa-Porto",
  description: "Partida de Lisboa",
  carrier: "Transportes Aéreos",
  flightNumber: "TA123",
  departureAirport: "LIS",
  arrivalAirport: "OPO",
  departure: {
    localDate: "2026-10-26",
    localTime: "10:30",
    timezoneName: "UTC",
    instant: "2026-10-26T10:30:00.000Z",
  },
  arrival: {
    localDate: "2026-10-26",
    localTime: "12:45",
    timezoneName: "UTC",
    instant: "2026-10-26T12:45:00.000Z",
  },
  terminal: null,
  cabin: null,
  baggage: null,
  seat: null,
  customerBookingReference: null,
};
const accommodation = {
  title: "Estadia no Porto",
  description: "Alojamento para a viagem",
  propertyName: "Casa do Norte",
  checkIn: {
    localDate: "2026-10-26",
    localTime: "15:00",
    timezoneName: "UTC",
    instant: "2026-10-26T15:00:00.000Z",
  },
  checkOut: {
    localDate: "2026-10-28",
    localTime: "11:00",
    timezoneName: "UTC",
    instant: "2026-10-28T11:00:00.000Z",
  },
  roomDescription: null,
  boardType: null,
  customerBookingReference: null,
};
const trip = {
  title: "Lisboa a Porto",
  startDate: "2026-10-26",
  endDate: "2026-10-30",
};
const requests = [
  {
    schema: "AdminTripWorkspaceFlightCreateV1RequestSchema",
    value: { expectedWorkspaceRevision: "7", flight },
  },
  {
    schema: "AdminTripWorkspaceFlightUpdateV1RequestSchema",
    value: { expectedLockVersion: "2", expectedWorkspaceRevision: "7", flight },
  },
  {
    schema: "AdminTripWorkspaceAccommodationCreateV1RequestSchema",
    value: { expectedWorkspaceRevision: "7", accommodation },
  },
  {
    schema: "AdminTripWorkspaceAccommodationUpdateV1RequestSchema",
    value: { expectedLockVersion: "2", expectedWorkspaceRevision: "7", accommodation },
  },
  {
    schema: "AdminTripWorkspaceTripUpdateV1RequestSchema",
    value: { expectedLockVersion: "2", expectedWorkspaceRevision: "7", trip },
  },
] as const;

describe("Admin Trip workspace write V1 contracts", () => {
  it("accepts_strict_trip_flight_and_accommodation_commands_with_expected_versions", () => {
    for (const request of requests) {
      const schema = schemaFrom(request.schema);
      expect(schema, request.schema).toBeDefined();
      expect(schema?.parse(request.value), request.schema).toEqual(request.value);
    }
  });

  it("rejects_client_scope_unknown_fields_and_missing_or_invalid_versions", () => {
    for (const request of requests) {
      const schema = schemaFrom(request.schema);
      expect(schema, request.schema).toBeDefined();
      expect(schema?.safeParse({ ...request.value, agencyId }).success, request.schema).toBe(false);
      expect(
        schema?.safeParse({ ...request.value, unexpected: "value" }).success,
        request.schema,
      ).toBe(false);
      expect(
        schema?.safeParse({ ...request.value, expectedWorkspaceRevision: "-1" }).success,
        request.schema,
      ).toBe(false);
    }
    expect(
      schemaFrom("AdminTripWorkspaceFlightUpdateV1RequestSchema")?.safeParse({
        expectedWorkspaceRevision: "7",
        flight,
      }).success,
    ).toBe(false);
    expect(
      schemaFrom("AdminTripWorkspaceTripUpdateV1RequestSchema")?.safeParse({
        expectedLockVersion: "2",
        expectedWorkspaceRevision: "7",
        trip: { ...trip, state: "CONFIRMED" },
      }).success,
    ).toBe(false);
  });

  it("rejects_invalid_trip_dates_and_schedule_order_or_local_time_tuples", () => {
    const tripSchema = schemaFrom("AdminTripWorkspaceTripUpdateV1RequestSchema");
    const flightSchema = schemaFrom("AdminTripWorkspaceFlightCreateV1RequestSchema");
    const accommodationSchema = schemaFrom("AdminTripWorkspaceAccommodationCreateV1RequestSchema");

    expect(
      tripSchema?.safeParse({
        expectedLockVersion: "2",
        expectedWorkspaceRevision: "7",
        trip: { ...trip, startDate: "2026-10-31" },
      }).success,
    ).toBe(false);
    expect(
      flightSchema?.safeParse({
        expectedWorkspaceRevision: "7",
        flight: {
          ...flight,
          arrival: { ...flight.arrival, instant: "2026-10-26T10:00:00.000Z", localTime: "10:00" },
        },
      }).success,
    ).toBe(false);
    expect(
      accommodationSchema?.safeParse({
        expectedWorkspaceRevision: "7",
        accommodation: {
          ...accommodation,
          checkOut: {
            ...accommodation.checkOut,
            instant: "2026-10-26T14:00:00.000Z",
            localDate: "2026-10-26",
            localTime: "14:00",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      flightSchema?.safeParse({
        expectedWorkspaceRevision: "7",
        flight: {
          ...flight,
          departure: { ...flight.departure, instant: "2026-10-26T11:30:00.000Z" },
        },
      }).success,
    ).toBe(false);
  });
});
