import { describe, expect, it } from "vitest";

import { QuoteProposalV1Schema } from "../src/share/index.js";

const money = (minorUnits: string) => ({ minorUnits, currency: "EUR", scale: 2 });

const proposal = () => ({
  schemaVersion: 1,
  agency: { displayName: "Agência Exemplo" },
  quote: {
    number: "ORC-2027-0001",
    title: "Lisboa e Funchal",
    destination: "Madeira",
    intro: "Uma semana entre a capital e a ilha.",
    heroImageUrl: "https://images.example.test/hero.jpg",
    startDate: "2027-03-10",
    endDate: "2027-03-17",
    nights: 7,
    adults: 2,
    children: 0,
    currency: "EUR",
    validUntil: "2026-12-11",
  },
  totals: {
    pvpFinal: money("248000"),
    perPerson: money("124000"),
    deposit: money("74400"),
    balance: money("173600"),
    balanceDueDate: "2027-01-24",
  },
  flights: [
    {
      direction: "OUTBOUND",
      date: "2027-03-10",
      departTime: "08:15",
      arriveTime: "09:30",
      fromIata: "LIS",
      toIata: "FNC",
      carrier: "TAP",
      flightNumber: "TP1234",
      baggage: "23 kg",
    },
  ],
  accommodations: [
    {
      service: "Hotel Estrela",
      location: "Funchal",
      roomType: "Duplo",
      boardBasis: "Meia pensão",
      startDate: "2027-03-10",
      endDate: "2027-03-17",
      nights: 7,
      imageUrl: null,
      description: null,
    },
  ],
  otherServices: [],
  days: [{ dayIndex: 0, date: "2027-03-10", title: "Chegada a Funchal", description: null }],
  options: [],
  included: [{ label: "Voos", items: ["Voo LIS–FNC"] }],
  excluded: ["Gorjetas"],
});

describe("QuoteProposalV1Schema", () => {
  it("accepts a customer-safe proposal", () => {
    expect(QuoteProposalV1Schema.parse(proposal())).toEqual(proposal());
  });

  it("rejects internal-only fields at the top level and inside sections", () => {
    const internal = [
      { supplier: "Fornecedor" },
      { netSupplierMinor: "70000" },
      { recommendedMinor: "95000" },
      { internalNotes: "nota" },
      { createdByStaffPrincipalId: "staff-1" },
    ];
    for (const extra of internal) {
      expect(QuoteProposalV1Schema.safeParse({ ...proposal(), ...extra }).success).toBe(false);
    }
    const nestedLeak = proposal();
    expect(
      QuoteProposalV1Schema.safeParse({
        ...nestedLeak,
        accommodations: [{ ...nestedLeak.accommodations[0], supplier: "Fornecedor" }],
      }).success,
    ).toBe(false);
    expect(
      QuoteProposalV1Schema.safeParse({
        ...nestedLeak,
        totals: { ...nestedLeak.totals, agencyNet: money("75000") },
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer money, non-https images and inverted dates", () => {
    const base = proposal();
    expect(
      QuoteProposalV1Schema.safeParse({
        ...base,
        totals: { ...base.totals, pvpFinal: money("2480.50") },
      }).success,
    ).toBe(false);
    expect(
      QuoteProposalV1Schema.safeParse({
        ...base,
        quote: { ...base.quote, heroImageUrl: "http://images.example.test/a.jpg" },
      }).success,
    ).toBe(false);
    expect(
      QuoteProposalV1Schema.safeParse({
        ...base,
        quote: { ...base.quote, startDate: "2027-03-17", endDate: "2027-03-10" },
      }).success,
    ).toBe(false);
  });
});
