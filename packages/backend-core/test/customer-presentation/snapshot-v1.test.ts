import { describe, expect, it } from "vitest";

import {
  assemblePortalTripSnapshotV1,
  canonicalPortalTripSnapshotV1Json,
  resolvePublicationFieldVisibility,
  type PublicationSafeAccommodationSource,
  type PublicationSafeFlightSource,
  type PublicationSafeTripInput,
} from "../../src/index.js";

const flight: PublicationSafeFlightSource = {
  sourceId: "flight-2",
  sortOrder: 2,
  title: "Lisbon to Porto",
  description: "A customer-facing flight description",
  carrier: "Example Air",
  flightNumber: "EA100",
  departureAirport: "LIS",
  arrivalAirport: "OPO",
  departure: {
    localDate: "2026-10-12",
    localTime: "09:00",
    timeZone: "Europe/Lisbon",
    instant: "2026-10-12T08:00:00.000Z",
  },
  arrival: {
    localDate: "2026-10-12",
    localTime: "10:00",
    timeZone: "Europe/Lisbon",
    instant: "2026-10-12T09:00:00.000Z",
  },
  terminal: null,
  cabin: "Economy",
  baggage: "One cabin bag",
  seat: null,
  customerBookingReference: null,
};

const accommodation: PublicationSafeAccommodationSource = {
  sourceId: "accommodation-1",
  sortOrder: 1,
  title: "Porto stay",
  description: "A customer-facing stay description",
  propertyName: "Example Hotel",
  checkIn: {
    localDate: "2026-10-12",
    localTime: "15:00",
    timeZone: "Europe/Lisbon",
    instant: "2026-10-12T14:00:00.000Z",
  },
  checkOut: {
    localDate: "2026-10-15",
    localTime: "11:00",
    timeZone: "Europe/Lisbon",
    instant: "2026-10-15T10:00:00.000Z",
  },
  roomDescription: "Double room",
  boardType: "Breakfast included",
  customerBookingReference: null,
};

const input: PublicationSafeTripInput = {
  trip: { title: "Portugal break", startDate: "2026-10-12", endDate: "2026-10-15" },
  flights: [flight],
  accommodations: [accommodation],
  visibility: {
    fieldsByItemSourceId: {
      "flight-2": {
        "flight.description": {
          classification: "CONFIGURABLE",
          platformDefault: true,
          agencyDefault: "INHERIT",
          itemOverride: "INHERIT",
        },
        "flight.cabin": {
          classification: "CONFIGURABLE",
          platformDefault: true,
          agencyDefault: "INHERIT",
          itemOverride: "INHERIT",
        },
      },
      "accommodation-1": {
        "accommodation.description": {
          classification: "CONFIGURABLE",
          platformDefault: true,
          agencyDefault: "INHERIT",
          itemOverride: "INHERIT",
        },
        "accommodation.roomDescription": {
          classification: "CONFIGURABLE",
          platformDefault: true,
          agencyDefault: "INHERIT",
          itemOverride: "INHERIT",
        },
        "accommodation.boardType": {
          classification: "CONFIGURABLE",
          platformDefault: true,
          agencyDefault: "INHERIT",
          itemOverride: "INHERIT",
        },
      },
    },
  },
};

describe("Stage 6 snapshot projection", () => {
  it("resolves platform → agency → item visibility and never exposes INTERNAL_ONLY", () => {
    const resolve = (
      classification: "CONFIGURABLE" | "INTERNAL_ONLY" | "ALWAYS_CUSTOMER",
      platformDefault: boolean,
      agencyDefault: "INHERIT" | "SHOW" | "HIDE",
      itemOverride: "INHERIT" | "SHOW" | "HIDE",
    ) =>
      resolvePublicationFieldVisibility({
        classification,
        platformDefault,
        agencyDefault,
        itemOverride,
      });

    expect(resolve("CONFIGURABLE", true, "INHERIT", "INHERIT")).toBe(true);
    expect(resolve("CONFIGURABLE", false, "INHERIT", "INHERIT")).toBe(false);
    expect(resolve("CONFIGURABLE", true, "HIDE", "INHERIT")).toBe(false);
    expect(resolve("CONFIGURABLE", false, "SHOW", "INHERIT")).toBe(true);
    expect(resolve("CONFIGURABLE", false, "HIDE", "SHOW")).toBe(true);
    expect(resolve("CONFIGURABLE", true, "SHOW", "HIDE")).toBe(false);
    expect(resolve("ALWAYS_CUSTOMER", false, "HIDE", "HIDE")).toBe(true);
    expect(resolve("INTERNAL_ONLY", true, "SHOW", "SHOW")).toBe(false);
  });

  it("uses one explicit allowlist and sorts families/items independently of source row order", () => {
    const projection = assemblePortalTripSnapshotV1(input);
    const reversedProjection = assemblePortalTripSnapshotV1({
      ...input,
      flights: [...input.flights].reverse(),
      accommodations: [...input.accommodations].reverse(),
    });
    expect(projection).toEqual(reversedProjection);
    expect(projection.items.map((item) => item.kind)).toEqual(["ACCOMMODATION", "FLIGHT"]);
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toMatch(
      /sourceId|sortOrder|supplier|cost|margin|internalNote|INTERNAL_ONLY|session|credential|providerPayload/u,
    );
    expect(Object.keys(projection).toSorted()).toEqual(["items", "schemaVersion", "trip"]);
  });

  it("canonicalizes property insertion order and produces a repeatable SHA-256", () => {
    const projection = assemblePortalTripSnapshotV1(input);
    const canonical = canonicalPortalTripSnapshotV1Json(projection);
    const reordered = {
      trip: {
        endDate: projection.trip.endDate,
        startDate: projection.trip.startDate,
        title: projection.trip.title,
      },
      items: projection.items,
      schemaVersion: projection.schemaVersion,
    };
    expect(canonicalPortalTripSnapshotV1Json(reordered)).toBe(canonical);
    expect(canonicalPortalTripSnapshotV1Json(projection)).toBe(canonical);
    expect(() => canonicalPortalTripSnapshotV1Json({ unsupported: undefined })).toThrow();
  });

  it("pins canonical V1 golden bytes and their SHA-256", () => {
    const golden = {
      schemaVersion: 1 as const,
      trip: { title: "T", startDate: "2026-01-01", endDate: "2026-01-02" },
      items: [],
    };
    const canonical =
      '{"items":[],"schemaVersion":1,"trip":{"endDate":"2026-01-02","startDate":"2026-01-01","title":"T"}}';
    expect(canonicalPortalTripSnapshotV1Json(golden)).toBe(canonical);
  });
});
