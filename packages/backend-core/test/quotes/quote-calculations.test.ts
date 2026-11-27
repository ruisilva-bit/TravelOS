import { describe, expect, it } from "vitest";

import {
  agencyNetMinor,
  generateDays,
  includedItems,
  lineTotals,
  nightsBetween,
  quoteTotals,
  quoteWarnings,
  suggestedPvpMinor,
  type QuoteCalcHeader,
  type QuoteCalcLine,
} from "../../src/index.js";

const EUR = (units: number) => BigInt(units) * 100n;

const header = (overrides: Partial<QuoteCalcHeader> = {}): QuoteCalcHeader => ({
  startDate: "2027-03-10",
  endDate: "2027-03-17",
  adults: 2,
  children: 0,
  validUntil: "2027-03-01",
  pvpOverrideMinor: null,
  targetMarginBp: 1500,
  agencyNetShareBp: 2000,
  depositBp: 3000,
  balanceDueDays: 45,
  ...overrides,
});

const line = (overrides: Partial<QuoteCalcLine> & { id: string }): QuoteCalcLine => ({
  section: "BASE",
  category: "OTHER",
  service: "Servico",
  supplier: "Fornecedor",
  startDate: null,
  endDate: null,
  quantity: 1,
  netSupplierMinor: 0n,
  recommendedMinor: 0n,
  pvpMinor: 0n,
  customerVisible: true,
  fromIata: null,
  toIata: null,
  ...overrides,
});

// Mockup example: three BASE lines, NET / Recomendado in euros, agency share 20 %.
const mockupLines: QuoteCalcLine[] = [
  line({
    id: "flight",
    category: "FLIGHT",
    netSupplierMinor: EUR(700),
    recommendedMinor: EUR(950),
    pvpMinor: EUR(0),
  }),
  line({
    id: "hotel",
    category: "ACCOMMODATION",
    netSupplierMinor: EUR(720),
    recommendedMinor: EUR(920),
  }),
  line({
    id: "activity",
    category: "ACTIVITY",
    netSupplierMinor: EUR(410),
    recommendedMinor: EUR(500),
  }),
];

describe("quote calculations: nights", () => {
  it("counts nights between valid dates", () => {
    expect(nightsBetween("2027-03-10", "2027-03-17")).toBe(7);
    expect(nightsBetween("2027-03-10", "2027-03-10")).toBe(0);
  });

  it("returns null for missing, invalid or reversed dates without throwing", () => {
    expect(nightsBetween(null, "2027-03-17")).toBeNull();
    expect(nightsBetween("2027-03-10", null)).toBeNull();
    expect(nightsBetween("2027-02-30", "2027-03-17")).toBeNull();
    expect(nightsBetween("10/03/2027", "2027-03-17")).toBeNull();
    expect(nightsBetween("2027-03-17", "2027-03-10")).toBeNull();
  });
});

describe("quote calculations: agency net", () => {
  it("applies NET + share of (Recommended - NET) with HALF_UP and never goes below NET", () => {
    expect(agencyNetMinor(EUR(700), EUR(950), 2000)).toBe(EUR(750));
    expect(agencyNetMinor(EUR(720), EUR(920), 2000)).toBe(EUR(760));
    expect(agencyNetMinor(EUR(410), EUR(500), 2000)).toBe(EUR(428));
    // Formula check: NET + 20% * (Rec - NET) with an odd cent (1 cent * 0.2 = 0.2 rounds to 0).
    expect(agencyNetMinor(10_000n, 10_001n, 2000)).toBe(10_000n);
    expect(agencyNetMinor(10_000n, 10_003n, 2000)).toBe(10_001n);
    expect(agencyNetMinor(EUR(500), EUR(400), 2000)).toBe(EUR(500));
  });

  it("multiplies each money field by quantity", () => {
    const totals = lineTotals(
      line({
        id: "x",
        quantity: 3,
        netSupplierMinor: EUR(100),
        recommendedMinor: EUR(150),
        pvpMinor: EUR(200),
      }),
      2000,
    );
    expect(totals).toEqual({
      netSupplierMinor: EUR(300),
      recommendedMinor: EUR(450),
      agencyNetMinor: EUR(330),
      pvpMinor: EUR(600),
    });
  });
});

describe("quote calculations: mockup worked example", () => {
  it("sums agency nets to 1938 EUR and derives profit and margin from a 2480 EUR override", () => {
    const base = quoteTotals(header(), mockupLines, "2027-02-01");
    expect(base.baseNetSupplierMinor).toBe(EUR(1830));
    expect(base.baseRecommendedMinor).toBe(EUR(2370));
    expect(base.baseAgencyNetMinor).toBe(EUR(1938));
    expect(base.baseLinesPvpMinor).toBe(0n);
    expect(base.recommendedMarginMinor).toBe(EUR(432));

    const priced = quoteTotals(header({ pvpOverrideMinor: EUR(2480) }), mockupLines, "2027-02-01");
    expect(priced.pvpFinalMinor).toBe(EUR(2480));
    expect(priced.profitMinor).toBe(EUR(542));
    expect(priced.profitBp).toBe(2185); // 542 / 2480 = 21.85 %, HALF_UP to basis points
    expect(priced.recommendedMarginBp).toBe(1823); // 432 / 2370 = 18.23 %
  });

  it("splits per person, deposit and balance, and derives the balance due date", () => {
    const totals = quoteTotals(header({ pvpOverrideMinor: EUR(2480) }), mockupLines, "2027-01-01");
    expect(totals.perPersonMinor).toBe(EUR(1240)); // 2 adults
    expect(totals.depositMinor).toBe(EUR(744)); // 30 %
    expect(totals.balanceMinor).toBe(EUR(1736));
    expect(totals.balanceDueDate).toBe("2027-01-24"); // 2027-03-10 minus 45 days
    expect(totals.balanceDueNow).toBe(false);
    expect(
      quoteTotals(header({ pvpOverrideMinor: EUR(2480) }), mockupLines, "2027-01-23").balanceDueNow,
    ).toBe(false);
    expect(
      quoteTotals(header({ pvpOverrideMinor: EUR(2480) }), mockupLines, "2027-01-24").balanceDueNow,
    ).toBe(true);
  });

  it("rounds the per-person price HALF_UP to the cent with three travellers", () => {
    const totals = quoteTotals(
      header({ pvpOverrideMinor: EUR(2480), adults: 2, children: 1 }),
      mockupLines,
      "2027-02-01",
    );
    expect(totals.perPersonMinor).toBe(82_667n); // 2480 / 3 = 826.666... EUR
  });

  it("returns no balance date when there is no start date and reports option prices separately", () => {
    const totals = quoteTotals(
      header({ startDate: null, endDate: null }),
      [...mockupLines, line({ id: "opt", section: "OPTION", pvpMinor: EUR(120) })],
      "2027-02-01",
    );
    expect(totals.balanceDueDate).toBeNull();
    expect(totals.balanceDueNow).toBe(false);
    expect(totals.optionsPvp).toEqual([{ lineId: "opt", pvpMinor: EUR(120) }]);
    expect(totals.pvpFinalMinor).toBe(0n);
    expect(totals.profitBp).toBeNull();
  });
});

describe("quote calculations: suggested price", () => {
  it("rounds 750 EUR agency net at 15 % margin up to the chosen unit", () => {
    expect(suggestedPvpMinor(EUR(750), 1500, "CENT")).toBe(88_236n);
    expect(suggestedPvpMinor(EUR(750), 1500, "EURO")).toBe(88_300n);
    expect(suggestedPvpMinor(EUR(750), 1500, "TEN_EUROS")).toBe(89_000n);
  });

  it("returns the exact price when it is already a whole unit", () => {
    expect(suggestedPvpMinor(EUR(1938), 1500, "CENT")).toBe(EUR(2280));
    expect(suggestedPvpMinor(EUR(1938), 1500, "TEN_EUROS")).toBe(EUR(2280));
    expect(suggestedPvpMinor(0n, 1500, "EURO")).toBe(0n);
  });
});

describe("quote calculations: warnings", () => {
  const codesFor = (quote: QuoteCalcHeader, lines: QuoteCalcLine[], today = "2027-02-01") => {
    const totals = quoteTotals(quote, lines, today);
    return quoteWarnings(quote, lines, totals, today);
  };

  it("warns when the margin is below target", () => {
    const codes = codesFor(header({ pvpOverrideMinor: EUR(1950) }), mockupLines);
    expect(codes).toContainEqual({ code: "MARGIN_BELOW_TARGET" });
  });

  it("warns when the final price is below the recommended total", () => {
    const codes = codesFor(header({ pvpOverrideMinor: EUR(2000) }), mockupLines);
    expect(codes).toContainEqual({ code: "PVP_BELOW_RECOMMENDED" });
    expect(codesFor(header({ pvpOverrideMinor: EUR(2370) }), mockupLines)).not.toContainEqual({
      code: "PVP_BELOW_RECOMMENDED",
    });
  });

  it("warns for lines outside the trip dates, without a supplier, reversed dates and zero price", () => {
    const lines = [
      line({ id: "late", startDate: "2027-03-18", endDate: "2027-03-19", pvpMinor: EUR(10) }),
      line({ id: "nosupplier", supplier: "   ", pvpMinor: EUR(10) }),
      line({ id: "reversed", startDate: "2027-03-12", endDate: "2027-03-11", pvpMinor: EUR(10) }),
      line({ id: "free", pvpMinor: 0n }),
    ];
    const codes = codesFor(header({ pvpOverrideMinor: null }), lines);
    expect(codes).toContainEqual({ code: "LINE_OUTSIDE_TRIP_DATES", lineId: "late" });
    expect(codes).toContainEqual({ code: "LINE_WITHOUT_SUPPLIER", lineId: "nosupplier" });
    expect(codes).toContainEqual({ code: "LINE_END_BEFORE_START", lineId: "reversed" });
    expect(codes).toContainEqual({ code: "ZERO_PVP_LINE", lineId: "free" });
  });

  it("warns about expiry and about a missing flight or accommodation", () => {
    const codes = codesFor(
      header(),
      [line({ id: "only", category: "ACTIVITY", pvpMinor: EUR(10) })],
      "2027-03-02",
    );
    expect(codes).toContainEqual({ code: "QUOTE_EXPIRED" });
    expect(codes).toContainEqual({ code: "NO_FLIGHT" });
    expect(codes).toContainEqual({ code: "NO_ACCOMMODATION" });
  });
});

describe("quote calculations: generated days and included items", () => {
  const lisbonFunchal = header();
  const trip: QuoteCalcLine[] = [
    line({
      id: "out",
      category: "FLIGHT",
      startDate: "2027-03-10",
      fromIata: "LIS",
      toIata: "FNC",
    }),
    line({
      id: "back",
      category: "FLIGHT",
      startDate: "2027-03-17",
      fromIata: "FNC",
      toIata: "LIS",
    }),
    line({
      id: "hotel",
      category: "ACCOMMODATION",
      service: "Hotel Quinta",
      startDate: "2027-03-10",
      endDate: "2027-03-17",
    }),
    line({
      id: "levada",
      category: "ACTIVITY",
      service: "Levada do Caldeirao Verde",
      startDate: "2027-03-12",
    }),
    line({
      id: "boat",
      category: "ACTIVITY",
      service: "Passeio de barco",
      startDate: "2027-03-14",
    }),
    line({
      id: "hidden",
      category: "INSURANCE",
      service: "Seguro interno",
      customerVisible: false,
    }),
    line({
      id: "option",
      section: "OPTION",
      category: "ACTIVITY",
      service: "Jantar",
      startDate: "2027-03-13",
    }),
  ];

  it("produces one day per date with pt-PT titles from the flights, stays and activities", () => {
    const days = generateDays(lisbonFunchal, trip, { destination: "Funchal" });
    expect(days.map(({ date, title }) => [date, title])).toEqual([
      ["2027-03-10", "Partida para Funchal"],
      ["2027-03-11", "Dia livre"],
      ["2027-03-12", "Levada do Caldeirao Verde"],
      ["2027-03-13", "Dia livre"],
      ["2027-03-14", "Passeio de barco"],
      ["2027-03-15", "Dia livre"],
      ["2027-03-16", "Dia livre"],
      ["2027-03-17", "Regresso"],
    ]);
    expect(days.map(({ dayIndex }) => dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(days[0]!.lineIds).toEqual(expect.arrayContaining(["out", "hotel"]));
    expect(days[1]!.lineIds).toEqual(["hotel"]);
    expect(days[2]!.lineIds).toEqual(["hotel", "levada"]);
    expect(days[7]!.lineIds).toEqual(["back"]); // hotel end is exclusive: no stay on check-out day
    expect(days.flatMap((day) => day.lineIds)).not.toContain("option");
  });

  it("uses an arrival title for a mid-trip flight and returns no days without a start date", () => {
    const days = generateDays(header({ endDate: "2027-03-12" }), [
      line({ id: "a", category: "FLIGHT", startDate: "2027-03-10", toIata: "FNC" }),
      line({ id: "b", category: "FLIGHT", startDate: "2027-03-11", toIata: "PDL" }),
      line({ id: "c", category: "FLIGHT", startDate: "2027-03-12", toIata: "LIS" }),
    ]);
    expect(days.map(({ title }) => title)).toEqual([
      "Partida para FNC",
      "Chegada a PDL",
      "Regresso",
    ]);
    expect(generateDays(header({ startDate: null, endDate: null }), trip)).toEqual([]);
  });

  it("groups only customer-visible BASE lines in pt-PT category order", () => {
    expect(includedItems(trip)).toEqual([
      { category: "FLIGHT", label: "Voos", lineIds: ["out", "back"] },
      { category: "ACCOMMODATION", label: "Alojamento", lineIds: ["hotel"] },
      { category: "ACTIVITY", label: "Atividades", lineIds: ["levada", "boat"] },
    ]);
  });
});
