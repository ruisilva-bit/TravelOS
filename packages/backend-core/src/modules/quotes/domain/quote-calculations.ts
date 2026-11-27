// Pure quote calculations. Money is bigint minor units; every commercial rounding is HALF_UP through
// shared-kernel/money (COMMERCIAL_HALF_UP_V1) or the exact integer helpers below. Dates are ISO
// calendar dates ("YYYY-MM-DD") compared as day numbers, so no time zone or float is involved.
import { createMoney, multiplyMoney } from "../../../shared-kernel/money/money.js";

export const QUOTE_CATEGORIES = [
  "FLIGHT",
  "ACCOMMODATION",
  "TRANSFER",
  "ACTIVITY",
  "INSURANCE",
  "CAR",
  "OTHER",
] as const;
export type QuoteLineCategory = (typeof QUOTE_CATEGORIES)[number];
export type QuoteLineSection = "BASE" | "OPTION";
export type QuoteRoundingUnit = "CENT" | "EURO" | "TEN_EUROS";

export interface QuoteCalcHeader {
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly adults: number;
  readonly children: number;
  readonly validUntil: string;
  readonly pvpOverrideMinor: bigint | null;
  readonly targetMarginBp: number;
  readonly agencyNetShareBp: number;
  readonly depositBp: number;
  readonly balanceDueDays: number;
}

export interface QuoteCalcLine {
  readonly id: string;
  readonly section: QuoteLineSection;
  readonly category: QuoteLineCategory;
  readonly service: string;
  readonly supplier: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly quantity: number;
  readonly netSupplierMinor: bigint;
  readonly recommendedMinor: bigint;
  readonly pvpMinor: bigint;
  readonly customerVisible: boolean;
  readonly fromIata: string | null;
  readonly toIata: string | null;
}

export interface QuoteLineTotals {
  readonly netSupplierMinor: bigint;
  readonly recommendedMinor: bigint;
  readonly agencyNetMinor: bigint;
  readonly pvpMinor: bigint;
}

export interface QuoteTotals {
  readonly baseNetSupplierMinor: bigint;
  readonly baseRecommendedMinor: bigint;
  readonly baseAgencyNetMinor: bigint;
  readonly baseLinesPvpMinor: bigint;
  readonly pvpFinalMinor: bigint;
  readonly profitMinor: bigint;
  readonly profitBp: number | null;
  readonly recommendedMarginMinor: bigint;
  readonly recommendedMarginBp: number | null;
  readonly perPersonMinor: bigint;
  readonly depositMinor: bigint;
  readonly balanceMinor: bigint;
  readonly balanceDueDate: string | null;
  readonly balanceDueNow: boolean;
  readonly optionsPvp: readonly { readonly lineId: string; readonly pvpMinor: bigint }[];
}

export type QuoteWarningCode =
  | "MARGIN_BELOW_TARGET"
  | "PVP_BELOW_RECOMMENDED"
  | "LINE_OUTSIDE_TRIP_DATES"
  | "LINE_WITHOUT_SUPPLIER"
  | "LINE_END_BEFORE_START"
  | "QUOTE_EXPIRED"
  | "NO_FLIGHT"
  | "NO_ACCOMMODATION"
  | "ZERO_PVP_LINE";

export interface QuoteWarning {
  readonly code: QuoteWarningCode;
  readonly lineId?: string;
}

export interface QuoteDay {
  readonly dayIndex: number;
  readonly date: string;
  readonly title: string;
  readonly lineIds: readonly string[];
}

export interface QuoteIncludedGroup {
  readonly category: QuoteLineCategory;
  readonly label: string;
  readonly lineIds: readonly string[];
}

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const BASIS_POINTS_DENOMINATOR = 10_000n;
const ROUNDING_POLICY = "COMMERCIAL_HALF_UP_V1";

/** Day number since 1970-01-01 for a valid calendar date, otherwise null. Never throws. */
const dayNumberOf = (value: string | null | undefined): number | null => {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return time / MS_PER_DAY;
};

const requireDayNumber = (value: string, label: string): number => {
  const day = dayNumberOf(value);
  if (day === null) throw new Error(`${label} must be a valid ISO calendar date`);
  return day;
};

const dateOfDayNumber = (day: number): string =>
  new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

/** Half-up quotient of two bigints (ties away from zero), exact. */
const ratioHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator === 0n) throw new Error("Division by zero in quote calculation");
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (absNumerator * 2n + absDenominator) / (absDenominator * 2n);
  return negative ? -quotient : quotient;
};

/** Multiplies minor units by a basis-point share with the shared HALF_UP commercial policy. */
const shareOfMinor = (amount: bigint, basisPoints: number): bigint => {
  assertBasisPoints(basisPoints);
  const whole = Math.floor(basisPoints / 10_000);
  const fraction = String(basisPoints % 10_000).padStart(4, "0");
  return multiplyMoney(createMoney(amount, "EUR"), `${whole}.${fraction}`, ROUNDING_POLICY)
    .minorUnits;
};

const assertBasisPoints = (value: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("Basis points must be an integer between 0 and 10000");
  }
};

const ceilDivide = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error("Ceiling division requires a positive denominator");
  const quotient = numerator / denominator;
  return numerator % denominator === 0n || numerator < 0n ? quotient : quotient + 1n;
};

const roundingUnitMinor = (rounding: QuoteRoundingUnit): bigint => {
  switch (rounding) {
    case "CENT":
      return 1n;
    case "EURO":
      return 100n;
    case "TEN_EUROS":
      return 1000n;
  }
};

/** Nights between two ISO dates; null when either is missing or invalid or end is before start. */
export const nightsBetween = (start: string | null, end: string | null): number | null => {
  const startDay = dayNumberOf(start);
  const endDay = dayNumberOf(end);
  if (startDay === null || endDay === null || endDay < startDay) return null;
  return endDay - startDay;
};

/** Agency net for one unit: NET + share of (Recommended - NET); never below NET. */
export const agencyNetMinor = (
  netSupplierMinor: bigint,
  recommendedMinor: bigint,
  agencyNetShareBp: number,
): bigint => {
  if (recommendedMinor <= netSupplierMinor) return netSupplierMinor;
  return netSupplierMinor + shareOfMinor(recommendedMinor - netSupplierMinor, agencyNetShareBp);
};

/** Line money multiplied by quantity. */
export const lineTotals = (line: QuoteCalcLine, agencyNetShareBp: number): QuoteLineTotals => {
  const quantity = BigInt(line.quantity);
  return {
    netSupplierMinor: line.netSupplierMinor * quantity,
    recommendedMinor: line.recommendedMinor * quantity,
    agencyNetMinor:
      agencyNetMinor(line.netSupplierMinor, line.recommendedMinor, agencyNetShareBp) * quantity,
    pvpMinor: line.pvpMinor * quantity,
  };
};

/** Suggested sale price for a total agency net at a target margin, rounded up to the chosen unit. */
export const suggestedPvpMinor = (
  agencyNet: bigint,
  targetMarginBp: number,
  rounding: QuoteRoundingUnit,
): bigint => {
  if (!Number.isInteger(targetMarginBp) || targetMarginBp < 0 || targetMarginBp >= 10_000) {
    throw new Error("Target margin must be an integer below 10000 basis points");
  }
  const raw = ceilDivide(
    agencyNet * BASIS_POINTS_DENOMINATOR,
    BASIS_POINTS_DENOMINATOR - BigInt(targetMarginBp),
  );
  const unit = roundingUnitMinor(rounding);
  return ceilDivide(raw, unit) * unit;
};

const sumLines = (lines: readonly QuoteCalcLine[], shareBp: number) =>
  lines.reduce(
    (sum, line) => {
      const totals = lineTotals(line, shareBp);
      return {
        net: sum.net + totals.netSupplierMinor,
        recommended: sum.recommended + totals.recommendedMinor,
        agencyNet: sum.agencyNet + totals.agencyNetMinor,
        pvp: sum.pvp + totals.pvpMinor,
      };
    },
    { net: 0n, recommended: 0n, agencyNet: 0n, pvp: 0n },
  );

/** Quote totals: base lines drive the price unless an explicit final price override is set. */
export const quoteTotals = (
  quote: QuoteCalcHeader,
  lines: readonly QuoteCalcLine[],
  today: string,
): QuoteTotals => {
  const todayDay = requireDayNumber(today, "today");
  const base = lines.filter((line) => line.section === "BASE");
  const baseSums = sumLines(base, quote.agencyNetShareBp);
  const pvpFinal = quote.pvpOverrideMinor ?? baseSums.pvp;
  const profit = pvpFinal - baseSums.agencyNet;
  const recommendedMargin = baseSums.recommended - baseSums.agencyNet;
  const travellers = BigInt(quote.adults + quote.children);
  const deposit = shareOfMinor(pvpFinal, quote.depositBp);
  const startDay = dayNumberOf(quote.startDate);
  const balanceDueDay = startDay === null ? null : startDay - quote.balanceDueDays;

  return {
    baseNetSupplierMinor: baseSums.net,
    baseRecommendedMinor: baseSums.recommended,
    baseAgencyNetMinor: baseSums.agencyNet,
    baseLinesPvpMinor: baseSums.pvp,
    pvpFinalMinor: pvpFinal,
    profitMinor: profit,
    profitBp:
      pvpFinal === 0n ? null : Number(ratioHalfUp(profit * BASIS_POINTS_DENOMINATOR, pvpFinal)),
    recommendedMarginMinor: recommendedMargin,
    recommendedMarginBp:
      baseSums.recommended === 0n
        ? null
        : Number(ratioHalfUp(recommendedMargin * BASIS_POINTS_DENOMINATOR, baseSums.recommended)),
    perPersonMinor: travellers === 0n ? 0n : ratioHalfUp(pvpFinal, travellers),
    depositMinor: deposit,
    balanceMinor: pvpFinal - deposit,
    balanceDueDate: balanceDueDay === null ? null : dateOfDayNumber(balanceDueDay),
    balanceDueNow: balanceDueDay !== null && balanceDueDay <= todayDay,
    optionsPvp: lines
      .filter((line) => line.section === "OPTION")
      .map((line) => ({
        lineId: line.id,
        pvpMinor: lineTotals(line, quote.agencyNetShareBp).pvpMinor,
      })),
  };
};

/** Automatic warnings for the quote editor. Codes are stable; a lineId is set for line-level ones. */
export const quoteWarnings = (
  quote: QuoteCalcHeader,
  lines: readonly QuoteCalcLine[],
  totals: QuoteTotals,
  today: string,
): QuoteWarning[] => {
  const todayDay = requireDayNumber(today, "today");
  const warnings: QuoteWarning[] = [];
  const quoteStart = dayNumberOf(quote.startDate);
  const quoteEnd = dayNumberOf(quote.endDate) ?? quoteStart;

  if (totals.profitMinor * BigInt(10_000) < BigInt(quote.targetMarginBp) * totals.pvpFinalMinor) {
    warnings.push({ code: "MARGIN_BELOW_TARGET" });
  }
  if (totals.pvpFinalMinor < totals.baseRecommendedMinor) {
    warnings.push({ code: "PVP_BELOW_RECOMMENDED" });
  }
  const validUntilDay = dayNumberOf(quote.validUntil);
  if (validUntilDay !== null && validUntilDay < todayDay) {
    warnings.push({ code: "QUOTE_EXPIRED" });
  }

  for (const line of lines) {
    const start = dayNumberOf(line.startDate);
    const end = dayNumberOf(line.endDate) ?? start;
    if (
      line.startDate !== null &&
      line.endDate !== null &&
      start !== null &&
      end !== null &&
      end < start
    ) {
      warnings.push({ code: "LINE_END_BEFORE_START", lineId: line.id });
    }
    if (start !== null && quoteStart !== null && quoteEnd !== null && end !== null) {
      if (start < quoteStart || end > quoteEnd) {
        warnings.push({ code: "LINE_OUTSIDE_TRIP_DATES", lineId: line.id });
      }
    }
    if (line.supplier === null || line.supplier.trim().length === 0) {
      warnings.push({ code: "LINE_WITHOUT_SUPPLIER", lineId: line.id });
    }
    if (line.section === "BASE" && line.pvpMinor === 0n) {
      warnings.push({ code: "ZERO_PVP_LINE", lineId: line.id });
    }
  }

  const base = lines.filter((line) => line.section === "BASE");
  if (!base.some((line) => line.category === "FLIGHT")) warnings.push({ code: "NO_FLIGHT" });
  if (!base.some((line) => line.category === "ACCOMMODATION")) {
    warnings.push({ code: "NO_ACCOMMODATION" });
  }
  return warnings;
};

const CATEGORY_LABELS: Readonly<Record<QuoteLineCategory, string>> = {
  FLIGHT: "Voos",
  ACCOMMODATION: "Alojamento",
  TRANSFER: "Transferes",
  ACTIVITY: "Atividades",
  INSURANCE: "Seguros",
  CAR: "Aluguer de carro",
  OTHER: "Outros",
};

/** Customer-visible BASE lines grouped by category, in the fixed pt-PT category order. */
export const includedItems = (lines: readonly QuoteCalcLine[]): QuoteIncludedGroup[] =>
  QUOTE_CATEGORIES.flatMap((category) => {
    const lineIds = lines
      .filter(
        (line) => line.section === "BASE" && line.customerVisible && line.category === category,
      )
      .map((line) => line.id);
    return lineIds.length === 0 ? [] : [{ category, label: CATEGORY_LABELS[category], lineIds }];
  });

/**
 * Suggested day programme from the BASE lines, one entry per date from the trip start to its end.
 * Title priority: first outbound flight, last return flight, other flight arrival, check-in,
 * then the first activity or transfer of the day, otherwise a free day. Titles are editable.
 */
export const generateDays = (
  quote: QuoteCalcHeader,
  lines: readonly QuoteCalcLine[],
  options: { readonly destination?: string | null } = {},
): QuoteDay[] => {
  const startDay = dayNumberOf(quote.startDate);
  if (startDay === null) return [];
  const endDay = Math.max(dayNumberOf(quote.endDate) ?? startDay, startDay);
  const base = lines.filter((line) => line.section === "BASE");
  const flights = base
    .filter((line) => line.category === "FLIGHT" && dayNumberOf(line.startDate) !== null)
    .sort((left, right) => dayNumberOf(left.startDate)! - dayNumberOf(right.startDate)!);
  const firstFlight = flights[0];
  const lastFlight = flights.length > 1 ? flights[flights.length - 1] : undefined;
  const destination = options.destination ?? null;

  const days: QuoteDay[] = [];
  for (let day = startDay; day <= endDay; day += 1) {
    const date = dateOfDayNumber(day);
    const onDay = (line: QuoteCalcLine) => dayNumberOf(line.startDate) === day;
    const dayLines = base.filter(onDay);
    const flightsToday = dayLines.filter((line) => line.category === "FLIGHT");
    const checkIns = dayLines.filter((line) => line.category === "ACCOMMODATION");
    const activities = dayLines.filter(
      (line) => line.category === "ACTIVITY" || line.category === "TRANSFER",
    );
    const referenced = base.filter((line) => {
      if (onDay(line)) return true;
      const start = dayNumberOf(line.startDate);
      const end = dayNumberOf(line.endDate);
      return (
        line.category === "ACCOMMODATION" &&
        start !== null &&
        end !== null &&
        start < day &&
        day < end
      );
    });

    let title = "Dia livre";
    const departure = flightsToday.find((line) => line.id === firstFlight?.id);
    const returnFlight = flightsToday.find((line) => line.id === lastFlight?.id);
    if (departure !== undefined) {
      title = `Partida para ${destination ?? departure.toIata ?? "destino"}`;
    } else if (returnFlight !== undefined) {
      title = "Regresso";
    } else if (flightsToday.length > 0) {
      title = `Chegada a ${flightsToday[0]!.toIata ?? destination ?? "destino"}`;
    } else if (checkIns.length > 0) {
      title = `Check-in em ${checkIns[0]!.service}`;
    } else if (activities.length > 0) {
      title = activities[0]!.service;
    }

    days.push({
      dayIndex: day - startDay,
      date,
      title,
      lineIds: referenced.map((line) => line.id),
    });
  }
  return days;
};
