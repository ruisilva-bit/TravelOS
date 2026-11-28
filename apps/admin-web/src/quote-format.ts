/** Pure helpers for the quote editor. Money is minor-unit strings on the wire, decimal strings in cells. */
import { currencyFractionDigits } from "@travelos/design-system";
import type { StatusTone } from "@travelos/design-system";
import type { AdminQuoteDetailV1Response, AdminQuoteV1Response } from "@travelos/contracts/admin";

export type QuoteDetail = AdminQuoteDetailV1Response;
export type QuoteLine = QuoteDetail["lines"][number];
export type QuoteCategory = QuoteLine["category"];
export type QuoteSection = QuoteLine["section"];
export type QuoteState = AdminQuoteV1Response["state"];
export type HeaderPatch = Partial<AdminQuoteV1Response>;

export const CATEGORY_ORDER: readonly QuoteCategory[] = [
  "FLIGHT",
  "ACCOMMODATION",
  "TRANSFER",
  "ACTIVITY",
  "INSURANCE",
  "CAR",
  "OTHER",
];

export const CATEGORY_LABELS: Record<QuoteCategory, string> = {
  FLIGHT: "Voos",
  ACCOMMODATION: "Alojamento",
  TRANSFER: "Transferes",
  ACTIVITY: "Atividades",
  INSURANCE: "Seguros",
  CAR: "Carro",
  OTHER: "Outros",
};

/** Default service text of a freshly added line; the person types over it. */
export const CATEGORY_NEW_SERVICE: Record<QuoteCategory, string> = {
  FLIGHT: "Voo",
  ACCOMMODATION: "Alojamento",
  TRANSFER: "Transfer",
  ACTIVITY: "Atividade",
  INSURANCE: "Seguro",
  CAR: "Aluguer de carro",
  OTHER: "Outro serviço",
};

export const categoryTone = (category: QuoteCategory) =>
  category.toLowerCase() as Lowercase<QuoteCategory>;

export const STATE_LABELS: Record<QuoteState, readonly [string, StatusTone]> = {
  DRAFT: ["Rascunho", "neutral"],
  SENT: ["Enviado", "info"],
  ACCEPTED: ["Aceite", "success"],
  DECLINED: ["Recusado", "danger"],
  EXPIRED: ["Expirado", "warning"],
  ARCHIVED: ["Arquivado", "neutral"],
};

export const WARNING_TEXT: Record<string, string> = {
  MARGIN_BELOW_TARGET: "A margem está abaixo da margem alvo.",
  PVP_BELOW_RECOMMENDED: "O PVP final está abaixo do total recomendado.",
  LINE_OUTSIDE_TRIP_DATES: "Esta linha tem datas fora da viagem.",
  LINE_WITHOUT_SUPPLIER: "Falta indicar o fornecedor desta linha.",
  LINE_END_BEFORE_START: "A data de fim é anterior à de início.",
  QUOTE_EXPIRED: "A validade do orçamento já passou.",
  NO_FLIGHT: "O orçamento ainda não tem voos.",
  NO_ACCOMMODATION: "O orçamento ainda não tem alojamento.",
  ZERO_PVP_LINE: "Esta linha não tem PVP.",
};

export const warningText = (code: string): string =>
  WARNING_TEXT[code] ?? "Verifique este orçamento.";

/** Minor units ("12345") to a decimal string ("123.45") for a currency; string maths only. */
export const minorToDecimal = (minor: string, currency: string): string => {
  const digits = currencyFractionDigits(currency);
  if (digits === 0) return minor;
  const padded = minor.padStart(digits + 1, "0");
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
};

/** Decimal string ("123.4") to minor units ("12340"); empty or invalid input is "0". */
export const decimalToMinor = (amount: string, currency: string): string => {
  const digits = currencyFractionDigits(currency);
  const [whole = "0", fraction = ""] = amount.split(".");
  const joined = `${whole === "" ? "0" : whole}${fraction.padEnd(digits, "0").slice(0, digits)}`;
  const trimmed = joined.replace(/^0+(?=\d)/u, "");
  return /^\d+$/u.test(trimmed) ? trimmed : "0";
};

/** Basis points as a pt-PT percentage, e.g. 1550 -> "15,5 %". */
export const formatBp = (bp: number | null): string =>
  bp === null
    ? "—"
    : `${(Math.round(bp / 10) / 10).toLocaleString("pt-PT", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} %`;

/** "15", "15,5" or "15.5" to basis points (1500, 1550); null when not a percentage. */
export const percentToBp = (text: string): number | null => {
  const match = /^(\d{1,3})(?:[.,](\d{0,2}))?$/u.exec(text.trim());
  if (match === null) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
};

export const bpToPercentText = (bp: number): string => {
  const whole = Math.trunc(bp / 100);
  const rest = bp % 100;
  return rest === 0
    ? String(whole)
    : `${whole},${String(rest).padStart(2, "0").replace(/0$/u, "")}`;
};

const dayNumber = (isoDate: string | null): number | null => {
  if (isoDate === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (match === null) return null;
  return Math.round(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000,
  );
};

/** Nights between two ISO dates; null when either is missing or the range is inverted. */
export const nightsBetween = (start: string | null, end: string | null): number | null => {
  const a = dayNumber(start);
  const b = dayNumber(end);
  return a === null || b === null || b < a ? null : b - a;
};

/** Agency net of one unit: NET plus the agency's share of (Recommended - NET), half-up. */
export const agencyNetMinor = (net: string, recommended: string, shareBp: number): string => {
  const n = BigInt(net);
  const r = BigInt(recommended);
  if (r <= n) return net;
  return (n + ((r - n) * BigInt(shareBp) + 5000n) / 10_000n).toString();
};

/** Sum of minor-unit strings. */
export const sumMinor = (values: readonly string[]): string =>
  values.reduce((total, value) => total + BigInt(value), 0n).toString();

/** The full set of editable line fields, so a PATCH is always a complete, valid replacement. */
export const lineToRequest = (line: QuoteLine, patch: Partial<QuoteLine> = {}) => {
  const merged = { ...line, ...patch };
  return {
    expectedLockVersion: line.lockVersion,
    category: merged.category,
    service: merged.service,
    supplier: merged.supplier,
    description: merged.description,
    startDate: merged.startDate,
    endDate: merged.endDate,
    quantity: merged.quantity,
    netSupplierMinor: merged.netSupplierMinor,
    recommendedMinor: merged.recommendedMinor,
    pvpMinor: merged.pvpMinor,
    customerVisible: merged.customerVisible,
    imageUrl: merged.imageUrl,
    internalNote: merged.internalNote,
    fromIata: merged.fromIata,
    toIata: merged.toIata,
    departTime: merged.departTime,
    arriveTime: merged.arriveTime,
    carrier: merged.carrier,
    flightNumber: merged.flightNumber,
    baggage: merged.baggage,
    roomType: merged.roomType,
    boardBasis: merged.boardBasis,
    location: merged.location,
  };
};

export const headerToRequest = (detail: QuoteDetail, patch: Partial<AdminQuoteV1Response> = {}) => {
  const quote = { ...detail.quote, ...patch };
  return {
    expectedLockVersion: detail.quote.lockVersion,
    title: quote.title,
    destination: quote.destination,
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
    heroImageUrl: quote.heroImageUrl,
    intro: quote.intro,
    internalNotes: quote.internalNotes,
    excludedItems: quote.excludedItems,
  };
};

/** Replaces one query parameter of a mailto: or wa.me URL, so an edited message is what opens. */
export const withMessageText = (url: string, key: "body" | "text", text: string): string => {
  const [base = "", query = ""] = url.split("?", 2);
  const pairs = query.split("&").filter((pair) => pair !== "" && !pair.startsWith(`${key}=`));
  pairs.push(`${key}=${encodeURIComponent(text)}`);
  return `${base}?${pairs.join("&")}`;
};
