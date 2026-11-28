import { describe, expect, it } from "vitest";

import {
  AIRPORT_TIMEZONES,
  QuoteRuleError,
  asOpaqueId,
  isCanonicalTravelTimezone,
  localToInstant,
  planQuoteTrip,
  type OpaqueId,
  type QuoteLineRecord,
  type QuoteRecord,
} from "../../src/index.js";

const id = (n: number): OpaqueId =>
  asOpaqueId(`abcdef12-3456-7abc-8def-${n.toString().padStart(12, "0")}`);

const quote = (overrides: Partial<QuoteRecord> = {}): QuoteRecord =>
  ({
    id: id(1),
    number: "ORC-2027-0001",
    title: "Funchal",
    startDate: "2027-03-10",
    endDate: "2027-03-17",
    currencyCode: "EUR",
    ...overrides,
  }) as QuoteRecord;

const line = (overrides: Partial<QuoteLineRecord>): QuoteLineRecord =>
  ({
    id: id(100),
    section: "BASE",
    position: 1,
    category: "OTHER",
    service: "Serviço",
    supplier: null,
    description: null,
    startDate: null,
    endDate: null,
    netSupplierMinor: 0n,
    fromIata: null,
    toIata: null,
    departTime: null,
    arriveTime: null,
    carrier: null,
    flightNumber: null,
    baggage: null,
    roomType: null,
    boardBasis: null,
    location: null,
    ...overrides,
  }) as QuoteLineRecord;

const outbound = (overrides: Partial<QuoteLineRecord> = {}): QuoteLineRecord =>
  line({
    id: id(101),
    position: 1,
    category: "FLIGHT",
    service: "LIS-FNC",
    supplier: "TAP",
    fromIata: "LIS",
    toIata: "FNC",
    departTime: "08:15",
    arriveTime: "09:30",
    carrier: "TAP",
    flightNumber: "TP1234",
    startDate: "2027-03-10",
    endDate: "2027-03-10",
    netSupplierMinor: 70000n,
    ...overrides,
  });

const hotel = (overrides: Partial<QuoteLineRecord> = {}): QuoteLineRecord =>
  line({
    id: id(102),
    position: 2,
    category: "ACCOMMODATION",
    service: "Hotel Estrela",
    supplier: "Hotel Estrela, Lda",
    location: "Funchal",
    roomType: "Duplo",
    boardBasis: "Meia pensão",
    netSupplierMinor: 72000n,
    ...overrides,
  });

describe("airport timezone table", () => {
  it("uses only canonical IANA zones that the database also accepts", () => {
    for (const [iata, zone] of Object.entries(AIRPORT_TIMEZONES)) {
      expect(iata).toMatch(/^[A-Z]{3}$/u);
      expect(isCanonicalTravelTimezone(zone), `${iata} -> ${zone}`).toBe(true);
    }
  });

  it("covers the common Portuguese routes", () => {
    for (const iata of ["LIS", "OPO", "FNC", "PDL", "MAD", "LHR", "CDG", "JFK", "GRU", "DXB"]) {
      expect(AIRPORT_TIMEZONES[iata]).toBeDefined();
    }
  });
});

describe("localToInstant", () => {
  it("applies the winter offset in Lisbon and summer offset in summer", () => {
    expect(localToInstant("2027-03-10", "08:15", "Europe/Lisbon")).toBe("2027-03-10T08:15:00.000Z");
    expect(localToInstant("2027-07-01", "08:00", "Europe/Lisbon")).toBe("2027-07-01T07:00:00.000Z");
  });

  it("applies a negative offset for New York in summer", () => {
    expect(localToInstant("2027-07-01", "15:00", "America/New_York")).toBe(
      "2027-07-01T19:00:00.000Z",
    );
  });
});

describe("planQuoteTrip", () => {
  it("plans flight items with derived instants in each airport's zone", () => {
    const plan = planQuoteTrip(quote(), [outbound()]);
    expect(plan.items).toHaveLength(1);
    const flight = plan.items[0]?.flight;
    expect(flight?.departure).toEqual({
      localDate: "2027-03-10",
      localTime: "08:15",
      timezoneName: "Europe/Lisbon",
      instant: "2027-03-10T08:15:00.000Z",
    });
    expect(flight?.arrival.timezoneName).toBe("Atlantic/Madeira");
    expect(flight?.arrival.instant).toBe("2027-03-10T09:30:00.000Z");
    expect(flight).toMatchObject({
      carrier: "TAP",
      flightNumber: "TP1234",
      departureAirport: "LIS",
      arrivalAirport: "FNC",
    });
  });

  it("moves an overnight arrival to the next local day", () => {
    const plan = planQuoteTrip(quote(), [
      outbound({
        fromIata: "LIS",
        toIata: "JFK",
        departTime: "23:00",
        arriveTime: "01:00",
        startDate: "2027-03-10",
        endDate: "2027-03-10",
      }),
    ]);
    expect(plan.items[0]?.flight?.arrival.localDate).toBe("2027-03-11");
    expect(plan.items[0]?.flight?.arrival.timezoneName).toBe("America/New_York");
  });

  it("uses Europe/Lisbon for an unknown airport and records a review note on its reservation", () => {
    const plan = planQuoteTrip(quote(), [outbound({ toIata: "XYZ" })]);
    expect(plan.items[0]?.flight?.arrival.timezoneName).toBe("Europe/Lisbon");
    expect(plan.reservations[0]?.internalNote).toContain("fuso horário por confirmar (XYZ)");
  });

  it("sets check-in and check-out in the zone of the outbound flight's destination", () => {
    const plan = planQuoteTrip(quote({ endDate: "2027-03-14" }), [
      outbound({
        fromIata: "LIS",
        toIata: "JFK",
        departTime: "10:00",
        arriveTime: "15:00",
        startDate: "2027-07-01",
        endDate: "2027-07-01",
      }),
      hotel({ startDate: "2027-07-01", endDate: "2027-07-04" }),
    ]);
    const stay = plan.items.find((item) => item.family === "ACCOMMODATION")?.accommodation;
    expect(stay?.checkIn).toMatchObject({
      localDate: "2027-07-01",
      localTime: "15:00",
      timezoneName: "America/New_York",
      instant: "2027-07-01T19:00:00.000Z",
    });
    expect(stay?.checkOut).toMatchObject({
      localDate: "2027-07-04",
      localTime: "11:00",
      timezoneName: "America/New_York",
    });
    expect(stay).toMatchObject({
      propertyName: "Hotel Estrela",
      roomDescription: "Duplo",
      boardType: "Meia pensão",
    });
  });

  it("falls back to Europe/Lisbon for accommodation when there is no flight", () => {
    const plan = planQuoteTrip(quote(), [hotel({ startDate: null, endDate: null })]);
    const stay = plan.items[0]?.accommodation;
    expect(stay?.checkIn.timezoneName).toBe("Europe/Lisbon");
    expect(stay?.checkIn.localDate).toBe("2027-03-10");
    expect(stay?.checkOut.localDate).toBe("2027-03-17");
  });

  it("creates one reservation per supplier and category with the summed NET cost", () => {
    const plan = planQuoteTrip(quote(), [
      outbound({ id: id(101), position: 1, netSupplierMinor: 70000n }),
      outbound({
        id: id(103),
        position: 2,
        startDate: "2027-03-17",
        endDate: "2027-03-17",
        fromIata: "FNC",
        toIata: "LIS",
        departTime: "10:00",
        arriveTime: "12:00",
        netSupplierMinor: 50000n,
      }),
      hotel({ netSupplierMinor: 72000n }),
    ]);
    expect(plan.items).toHaveLength(3);
    expect(plan.reservations).toHaveLength(2);
    const flights = plan.reservations.find((reservation) => reservation.family === "FLIGHT");
    expect(flights).toMatchObject({
      supplierName: "TAP",
      supplierReference: "ORC-2027-0001",
      itemIndexes: [0, 1],
      netMinor: 120000n,
    });
    expect(
      plan.reservations.find((reservation) => reservation.family === "ACCOMMODATION"),
    ).toMatchObject({
      netMinor: 72000n,
      itemIndexes: [2],
    });
  });

  it("ignores option lines and other categories", () => {
    const plan = planQuoteTrip(quote(), [
      outbound({ section: "OPTION" }),
      line({ id: id(110), category: "OTHER", service: "Seguro" }),
    ]);
    expect(plan).toEqual({ items: [], reservations: [] });
  });

  it("refuses a flight without its airports or times instead of inventing them", () => {
    expect(() => planQuoteTrip(quote(), [outbound({ departTime: null })])).toThrow(QuoteRuleError);
    expect(() => planQuoteTrip(quote(), [outbound({ toIata: null })])).toThrow(QuoteRuleError);
    expect(() => planQuoteTrip(quote(), [outbound({ fromIata: "LIS", toIata: "LIS" })])).toThrow(
      QuoteRuleError,
    );
  });

  it("requires trip dates before planning anything", () => {
    expect(() => planQuoteTrip(quote({ startDate: null }), [hotel()])).toThrow(QuoteRuleError);
  });
});
