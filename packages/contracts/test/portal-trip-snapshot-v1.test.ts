import { describe, expect, it } from "vitest";

import { PortalTripSnapshotV1Schema } from "../src/portal/index.js";

const scheduled = {
  localDate: "2026-10-12",
  localTime: "09:00:00",
  timeZone: "Europe/Lisbon",
  instant: "2026-10-12T08:00:00Z",
};

const snapshot = {
  schemaVersion: 1,
  trip: { title: "Lisbon city break", startDate: "2026-10-12", endDate: "2026-10-15" },
  items: [
    {
      kind: "ACCOMMODATION",
      title: "Hotel stay",
      description: "Three nights in the city centre.",
      propertyName: "Example Hotel",
      checkIn: scheduled,
      checkOut: {
        ...scheduled,
        localDate: "2026-10-15",
        localTime: "11:00:00",
        instant: "2026-10-15T10:00:00Z",
      },
      roomDescription: null,
      boardType: null,
      customerBookingReference: null,
    },
  ],
} as const;

describe("PortalTripSnapshotV1", () => {
  it("accepts the golden customer-safe fixture and rejects unknown keys recursively", () => {
    expect(PortalTripSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
    expect(
      PortalTripSnapshotV1Schema.safeParse({ ...snapshot, supplierCostSentinel: "never publish" })
        .success,
    ).toBe(false);
    expect(
      PortalTripSnapshotV1Schema.safeParse({
        ...snapshot,
        items: [{ ...snapshot.items[0], internalNote: "never publish" }],
      }).success,
    ).toBe(false);
    expect(
      PortalTripSnapshotV1Schema.safeParse({
        ...snapshot,
        items: [
          { ...snapshot.items[0], rawProviderPayload: { providerField: "synthetic sentinel" } },
        ],
      }).success,
    ).toBe(false);
  });

  it("declares only customer presentation members and keeps the schema version explicit", () => {
    expect(Object.keys(snapshot).toSorted()).toEqual(["items", "schemaVersion", "trip"]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /INTERNAL_ONLY|supplierCost|margin|internalNote|session|credential|rawProviderPayload/u,
    );
    expect(PortalTripSnapshotV1Schema.safeParse({ ...snapshot, schemaVersion: 2 }).success).toBe(
      false,
    );
  });

  it("rejects invalid temporal intervals and same-airport flights", () => {
    expect(
      PortalTripSnapshotV1Schema.safeParse({
        ...snapshot,
        items: [
          {
            kind: "FLIGHT",
            title: "Flight",
            description: "Flight description",
            carrier: "Example Air",
            flightNumber: "EA100",
            departureAirport: "LIS",
            arrivalAirport: "LIS",
            departure: scheduled,
            arrival: scheduled,
            terminal: null,
            cabin: null,
            baggage: null,
            seat: null,
            customerBookingReference: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("compares itinerary instants after normalizing their ISO offsets", () => {
    const result = PortalTripSnapshotV1Schema.safeParse({
      ...snapshot,
      items: [
        {
          ...snapshot.items[0],
          checkIn: { ...scheduled, instant: "2026-10-12T12:00:00+02:00" },
          checkOut: { ...scheduled, instant: "2026-10-12T10:30:00Z" },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
