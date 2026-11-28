// Customer-facing proposal snapshot. This is an explicit ALLOWLIST: every field below is written by
// name from the quote record. Supplier, net cost, recommended price, margins, internal notes and
// staff identities are never copied, so they cannot leak into a frozen version by accident.
import {
  CATEGORY_LABELS,
  generateDays,
  includedItems,
  nightsBetween,
  quoteTotals,
  type QuoteCalcHeader,
  type QuoteCalcLine,
  type QuoteTotals,
} from "./quote-calculations.js";
import type { QuoteLineRecord, QuoteRecord } from "./quote-model.js";

export interface CustomerMoneyV1 {
  readonly minorUnits: string;
  readonly currency: string;
  readonly scale: number;
}

export interface QuoteProposalV1 {
  readonly schemaVersion: 1;
  readonly agency: { readonly displayName: string };
  readonly quote: {
    readonly number: string;
    readonly title: string;
    readonly destination: string | null;
    readonly intro: string | null;
    readonly heroImageUrl: string | null;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly nights: number | null;
    readonly adults: number;
    readonly children: number;
    readonly currency: string;
    readonly validUntil: string;
  };
  readonly totals: {
    readonly pvpFinal: CustomerMoneyV1;
    readonly perPerson: CustomerMoneyV1;
    readonly deposit: CustomerMoneyV1;
    readonly balance: CustomerMoneyV1;
    readonly balanceDueDate: string | null;
  };
  readonly flights: readonly {
    readonly direction: "OUTBOUND" | "RETURN" | "OTHER";
    readonly date: string | null;
    readonly departTime: string | null;
    readonly arriveTime: string | null;
    readonly fromIata: string | null;
    readonly toIata: string | null;
    readonly carrier: string | null;
    readonly flightNumber: string | null;
    readonly baggage: string | null;
  }[];
  readonly accommodations: readonly {
    readonly service: string;
    readonly location: string | null;
    readonly roomType: string | null;
    readonly boardBasis: string | null;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly nights: number | null;
    readonly imageUrl: string | null;
    readonly description: string | null;
  }[];
  readonly otherServices: readonly {
    readonly category: string;
    readonly service: string;
    readonly description: string | null;
    readonly startDate: string | null;
    readonly imageUrl: string | null;
  }[];
  readonly days: readonly {
    readonly dayIndex: number;
    readonly date: string;
    readonly title: string;
    readonly description: string | null;
  }[];
  readonly options: readonly {
    readonly service: string;
    readonly description: string | null;
    readonly pvp: CustomerMoneyV1;
  }[];
  readonly included: readonly { readonly label: string; readonly items: readonly string[] }[];
  readonly excluded: readonly string[];
}

/** A day as shown to the customer: the generated suggestion merged with stored overrides. */
export interface EffectiveQuoteDay {
  readonly dayIndex: number;
  readonly date: string;
  readonly title: string;
  readonly description: string | null;
}

const moneyV1 = (amountMinor: bigint, currency: string): CustomerMoneyV1 => ({
  minorUnits: amountMinor.toString(),
  currency,
  scale: currency === "JPY" ? 0 : 2,
});

export const toCalcHeader = (quote: QuoteRecord): QuoteCalcHeader => ({
  startDate: quote.startDate,
  endDate: quote.endDate,
  adults: quote.adults,
  children: quote.children,
  validUntil: quote.validUntil,
  pvpOverrideMinor: quote.pvpOverrideMinor,
  targetMarginBp: quote.targetMarginBp,
  agencyNetShareBp: quote.agencyNetShareBp,
  depositBp: quote.depositBp,
  balanceDueDays: quote.balanceDueDays,
});

export const toCalcLine = (line: QuoteLineRecord): QuoteCalcLine => ({
  id: line.id,
  section: line.section,
  category: line.category,
  service: line.service,
  supplier: line.supplier,
  startDate: line.startDate,
  endDate: line.endDate,
  quantity: line.quantity,
  netSupplierMinor: line.netSupplierMinor,
  recommendedMinor: line.recommendedMinor,
  pvpMinor: line.pvpMinor,
  customerVisible: line.customerVisible,
  fromIata: line.fromIata,
  toIata: line.toIata,
});

/** Merges generated day suggestions with stored overrides; a stored title or description wins. */
export const effectiveDays = (
  quote: QuoteRecord,
  lines: readonly QuoteLineRecord[],
  stored: readonly {
    readonly dayIndex: number;
    readonly title: string;
    readonly description: string | null;
  }[],
): EffectiveQuoteDay[] => {
  const overrides = new Map(stored.map((day) => [day.dayIndex, day]));
  return generateDays(toCalcHeader(quote), lines.map(toCalcLine), {
    destination: quote.destination,
  }).map((generated) => {
    const override = overrides.get(generated.dayIndex);
    return {
      dayIndex: generated.dayIndex,
      date: generated.date,
      title: override?.title ?? generated.title,
      description: override?.description ?? null,
    };
  });
};

const visibleBase = (lines: readonly QuoteLineRecord[]): QuoteLineRecord[] =>
  lines
    .filter((line) => line.section === "BASE" && line.customerVisible)
    .sort((left, right) => left.position - right.position);

const flightDirections = (
  flights: readonly QuoteLineRecord[],
): Map<string, "OUTBOUND" | "RETURN" | "OTHER"> => {
  const ordered = [...flights].sort(
    (left, right) =>
      (left.startDate ?? "").localeCompare(right.startDate ?? "") || left.position - right.position,
  );
  return new Map(
    ordered.map((line, index) => [
      line.id,
      index === 0 ? "OUTBOUND" : index === ordered.length - 1 ? "RETURN" : "OTHER",
    ]),
  );
};

/**
 * Builds the frozen customer snapshot. Totals come from the pure calculations; the only text that
 * reaches the customer is the service, description, supplier-free labels and the agency display name.
 */
export const buildQuoteProposalV1 = (input: {
  readonly agencyDisplayName: string;
  readonly quote: QuoteRecord;
  readonly lines: readonly QuoteLineRecord[];
  readonly days: readonly EffectiveQuoteDay[];
  readonly totals?: QuoteTotals;
}): QuoteProposalV1 => {
  const { quote, lines } = input;
  const totals =
    input.totals ?? quoteTotals(toCalcHeader(quote), lines.map(toCalcLine), quote.validUntil);
  const currency = quote.currencyCode;
  const visible = visibleBase(lines);
  const flights = visible.filter((line) => line.category === "FLIGHT");
  const directions = flightDirections(flights);
  const included = includedItems(lines.map(toCalcLine));
  const linesById = new Map(lines.map((line) => [line.id, line]));

  return {
    schemaVersion: 1,
    agency: { displayName: input.agencyDisplayName },
    quote: {
      number: quote.number,
      title: quote.title,
      destination: quote.destination,
      intro: quote.intro,
      heroImageUrl: quote.heroImageUrl,
      startDate: quote.startDate,
      endDate: quote.endDate,
      nights: nightsBetween(quote.startDate, quote.endDate),
      adults: quote.adults,
      children: quote.children,
      currency,
      validUntil: quote.validUntil,
    },
    totals: {
      pvpFinal: moneyV1(totals.pvpFinalMinor, currency),
      perPerson: moneyV1(totals.perPersonMinor, currency),
      deposit: moneyV1(totals.depositMinor, currency),
      balance: moneyV1(totals.balanceMinor, currency),
      balanceDueDate: totals.balanceDueDate,
    },
    flights: flights.map((line) => ({
      direction: directions.get(line.id) ?? "OTHER",
      date: line.startDate,
      departTime: line.departTime,
      arriveTime: line.arriveTime,
      fromIata: line.fromIata,
      toIata: line.toIata,
      carrier: line.carrier,
      flightNumber: line.flightNumber,
      baggage: line.baggage,
    })),
    accommodations: visible
      .filter((line) => line.category === "ACCOMMODATION")
      .map((line) => ({
        service: line.service,
        location: line.location,
        roomType: line.roomType,
        boardBasis: line.boardBasis,
        startDate: line.startDate,
        endDate: line.endDate,
        nights: nightsBetween(line.startDate, line.endDate),
        imageUrl: line.imageUrl,
        description: line.description,
      })),
    otherServices: visible
      .filter((line) => line.category !== "FLIGHT" && line.category !== "ACCOMMODATION")
      .map((line) => ({
        category: CATEGORY_LABELS[line.category],
        service: line.service,
        description: line.description,
        startDate: line.startDate,
        imageUrl: line.imageUrl,
      })),
    days: input.days.map((day) => ({
      dayIndex: day.dayIndex,
      date: day.date,
      title: day.title,
      description: day.description,
    })),
    options: lines
      .filter((line) => line.section === "OPTION" && line.customerVisible)
      .sort((left, right) => left.position - right.position)
      .map((line) => ({
        service: line.service,
        description: line.description,
        pvp: moneyV1(line.pvpMinor * BigInt(line.quantity), currency),
      })),
    included: included.map((group) => ({
      label: group.label,
      items: group.lineIds.map((id) => linesById.get(id as never)?.service ?? ""),
    })),
    excluded: [...quote.excludedItems],
  };
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** dd/mm/aaaa for an ISO calendar date; unparseable values are returned unchanged. */
export const formatPtDate = (isoDate: string | null): string => {
  if (isoDate === null) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate);
  return match ? `${pad(Number(match[3]))}/${pad(Number(match[2]))}/${match[1]}` : isoDate;
};

export interface ProposalMessageInput {
  readonly givenName: string | null;
  readonly destination: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly validUntil: string;
  readonly url: string;
}

/** Ready-to-send pt-PT text for email or WhatsApp. */
export const buildProposalMessageText = (input: ProposalMessageInput): string => {
  const greeting =
    input.givenName === null || input.givenName.trim() === ""
      ? "Olá"
      : `Olá ${input.givenName.trim()}`;
  const destination = input.destination ?? "a sua viagem";
  const dates =
    input.startDate !== null && input.endDate !== null
      ? ` (${formatPtDate(input.startDate)} – ${formatPtDate(input.endDate)})`
      : "";
  return `${greeting}, segue a vossa proposta para ${destination}${dates}: ${input.url} — válida até ${formatPtDate(input.validUntil)}. Qualquer dúvida, estou disponível.`;
};

/** Phone digits only (international format without +); null when nothing usable is stored. */
export const whatsappDigits = (phone: string | null): string | null => {
  if (phone === null) return null;
  const digits = phone.replace(/\D/gu, "");
  return digits.length >= 6 ? digits : null;
};

export const buildMailtoUrl = (email: string | null, subject: string, body: string): string => {
  const address = email === null ? "" : encodeURIComponent(email.trim());
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

export const buildWhatsappUrl = (phone: string | null, text: string): string => {
  const digits = whatsappDigits(phone);
  return `https://wa.me/${digits ?? ""}?text=${encodeURIComponent(text)}`;
};
