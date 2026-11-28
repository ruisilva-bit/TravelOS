// Quote (orcamento) aggregate records and the validation of staff-entered drafts. Persistence
// adapters map database rows to these records; nothing here knows about SQL.
import { createLocalDate } from "../../../shared-kernel/time.js";
import type { OpaqueId } from "../../../shared-kernel/opaque-id.js";
import { InputValidationError } from "../../trip-operations/application/trip-slice.js";
import {
  QUOTE_CATEGORIES,
  type QuoteLineCategory,
  type QuoteLineSection,
} from "./quote-calculations.js";

export const QUOTE_STATES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "ARCHIVED",
] as const;
export type QuoteState = (typeof QUOTE_STATES)[number];

export const QUOTE_VALIDITY_DAYS = 14;
export const QUOTE_TITLE_MAX_LENGTH = 200;
export const QUOTE_DESTINATION_MAX_LENGTH = 200;
export const QUOTE_INTRO_MAX_LENGTH = 2_000;
export const QUOTE_INTERNAL_NOTES_MAX_LENGTH = 8_000;
export const QUOTE_EXCLUDED_ITEMS_MAX_COUNT = 50;
export const QUOTE_LINE_SERVICE_MAX_LENGTH = 200;
export const QUOTE_LINE_SUPPLIER_MAX_LENGTH = 200;
export const QUOTE_LINE_DESCRIPTION_MAX_LENGTH = 2_000;
export const QUOTE_LINE_INTERNAL_NOTE_MAX_LENGTH = 2_000;
export const QUOTE_DAY_TITLE_MAX_LENGTH = 120;
export const QUOTE_DAY_DESCRIPTION_MAX_LENGTH = 2_000;
export const QUOTE_LIST_MAXIMUM_LIMIT = 100;
export const QUOTE_ACCEPTED_NAME_MIN_LENGTH = 2;
export const QUOTE_ACCEPTED_NAME_MAX_LENGTH = 120;
export const QUOTE_DEFAULT_EXCLUDED_ITEMS: readonly string[] = Object.freeze([
  "Despesas pessoais",
  "Gorjetas",
  "Taxas turísticas locais",
  "Seguro de cancelamento (salvo indicação)",
]);

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const IATA_PATTERN = /^[A-Z]{3}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export interface QuoteRecord {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly customerId: OpaqueId;
  readonly customerDisplayName: string;
  readonly leadId: OpaqueId;
  readonly number: string;
  readonly title: string;
  readonly destination: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly adults: number;
  readonly children: number;
  readonly state: QuoteState;
  readonly validUntil: string;
  readonly currencyCode: string;
  readonly pvpOverrideMinor: bigint | null;
  readonly targetMarginBp: number;
  readonly agencyNetShareBp: number;
  readonly depositBp: number;
  readonly balanceDueDays: number;
  readonly heroImageUrl: string | null;
  readonly intro: string | null;
  readonly internalNotes: string | null;
  readonly excludedItems: readonly string[];
  readonly convertedTripId: OpaqueId | null;
  readonly lockVersion: bigint;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QuoteLineRecord {
  readonly id: OpaqueId;
  readonly quoteId: OpaqueId;
  readonly section: QuoteLineSection;
  readonly position: number;
  readonly category: QuoteLineCategory;
  readonly service: string;
  readonly supplier: string | null;
  readonly description: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly quantity: number;
  readonly netSupplierMinor: bigint;
  readonly recommendedMinor: bigint;
  readonly pvpMinor: bigint;
  readonly customerVisible: boolean;
  readonly imageUrl: string | null;
  readonly internalNote: string | null;
  readonly fromIata: string | null;
  readonly toIata: string | null;
  readonly departTime: string | null;
  readonly arriveTime: string | null;
  readonly carrier: string | null;
  readonly flightNumber: string | null;
  readonly baggage: string | null;
  readonly roomType: string | null;
  readonly boardBasis: string | null;
  readonly location: string | null;
  readonly lockVersion: bigint;
}

/** Line fields a staff member may set; identity, order and lock version are managed separately. */
export interface QuoteLineDraft {
  readonly category: QuoteLineCategory;
  readonly service: string;
  readonly supplier: string | null;
  readonly description: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly quantity: number;
  readonly netSupplierMinor: bigint;
  readonly recommendedMinor: bigint;
  readonly pvpMinor: bigint;
  readonly customerVisible: boolean;
  readonly imageUrl: string | null;
  readonly internalNote: string | null;
  readonly fromIata: string | null;
  readonly toIata: string | null;
  readonly departTime: string | null;
  readonly arriveTime: string | null;
  readonly carrier: string | null;
  readonly flightNumber: string | null;
  readonly baggage: string | null;
  readonly roomType: string | null;
  readonly boardBasis: string | null;
  readonly location: string | null;
}

export interface QuoteDayRecord {
  readonly quoteId: OpaqueId;
  readonly dayIndex: number;
  readonly title: string;
  readonly description: string | null;
}

export interface QuoteShareLinkRecord {
  readonly shareLinkId: OpaqueId;
  readonly versionId: OpaqueId;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface QuoteAcceptanceRecord {
  readonly acceptedAt: string;
  readonly acceptedName: string;
}

export interface QuoteVersionRecord {
  readonly id: OpaqueId;
  readonly quoteId: OpaqueId;
  readonly versionNumber: number;
  readonly sentAt: string;
  readonly pvpFinalMinor: bigint;
  readonly currencyCode: string;
  readonly payloadSha256: string;
  readonly acceptance: QuoteAcceptanceRecord | null;
  readonly isLatest: boolean;
  readonly shareLinks: readonly QuoteShareLinkRecord[];
}

export interface QuoteAggregate {
  readonly quote: QuoteRecord;
  readonly lines: readonly QuoteLineRecord[];
  readonly days: readonly QuoteDayRecord[];
  readonly versions: readonly QuoteVersionRecord[];
}

export interface QuoteHeaderPatch {
  readonly title: string;
  readonly destination: string | null;
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
  readonly heroImageUrl: string | null;
  readonly intro: string | null;
  readonly internalNotes: string | null;
  readonly excludedItems: readonly string[];
}

export interface QuoteCreateDraft {
  readonly leadId: OpaqueId;
  readonly title: string | null;
  readonly destination: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly adults: number | null;
  readonly children: number | null;
}

export class QuoteNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor() {
    super("Quote resource not found");
    this.name = "QuoteNotFoundError";
  }
}

export class QuoteStaleError extends Error {
  readonly code = "OPTIMISTIC_CONFLICT" as const;

  constructor() {
    super("The quote changed since it was read; reload and retry");
    this.name = "QuoteStaleError";
  }
}

/** Carries the business outcome of a state or edit rule (for example NOT_DRAFT or UNAVAILABLE). */
export class QuoteRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "QuoteRuleError";
  }
}

const fail = (message: string): never => {
  throw new InputValidationError(message);
};

const containsControlCharacter = (text: string): boolean => {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
};

const asText = (value: unknown, label: string, maximum: number, minimum = 0): string => {
  if (typeof value !== "string") fail(`${label} must be text`);
  const text = (value as string).trim();
  if (text.length < minimum || text.length > maximum) {
    fail(`${label} must have between ${minimum} and ${maximum} characters`);
  }
  if (containsControlCharacter(text)) fail(`${label} must not contain control characters`);
  return text;
};

const asOptionalText = (value: unknown, label: string, maximum: number): string | null => {
  if (value === null || value === undefined) return null;
  const text = asText(value, label, maximum);
  return text.length === 0 ? null : text;
};

const asOptionalDate = (value: unknown, label: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail(`${label} must be a calendar date`);
  try {
    return createLocalDate(value as string);
  } catch {
    return fail(`${label} must be a valid calendar date`);
  }
};

const asInteger = (value: unknown, label: string, minimum: number, maximum: number): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
};

const asMoney = (value: unknown, label: string): bigint => {
  if (typeof value !== "bigint" || value < 0n || value > POSTGRES_BIGINT_MAX) {
    fail(`${label} must be a non-negative amount in minor units`);
  }
  return value as bigint;
};

const asOptionalMoney = (value: unknown, label: string): bigint | null =>
  value === null || value === undefined ? null : asMoney(value, label);

const asOptionalHttps = (value: unknown, label: string): string | null => {
  const url = asOptionalText(value, label, 1_000);
  if (url !== null && !url.startsWith("https://")) fail(`${label} must be an https URL`);
  return url;
};

const asOptionalIata = (value: unknown, label: string): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !IATA_PATTERN.test(value)) fail(`${label} must be an IATA code`);
  return value as string;
};

const asOptionalTime = (value: unknown, label: string): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) fail(`${label} must be HH:MM`);
  return value as string;
};

/** Validates an optional set of commercial dates: an end date may not precede its start date. */
const assertDateOrder = (startDate: string | null, endDate: string | null, label: string): void => {
  if (startDate !== null && endDate !== null && endDate < startDate) {
    fail(`${label}: a data de fim não pode ser anterior ao início`);
  }
};

export const validateQuoteHeaderPatch = (input: unknown): QuoteHeaderPatch => {
  const record = (input ?? {}) as Record<string, unknown>;
  const startDate = asOptionalDate(record["startDate"], "startDate");
  const endDate = asOptionalDate(record["endDate"], "endDate");
  assertDateOrder(startDate, endDate, "Quote dates");
  const excluded: unknown[] = Array.isArray(record["excludedItems"])
    ? (record["excludedItems"] as unknown[])
    : fail("excludedItems must be a list");
  if (excluded.length > QUOTE_EXCLUDED_ITEMS_MAX_COUNT)
    fail("excludedItems must be a list of at most 50 entries");
  return {
    title: asText(record["title"], "title", QUOTE_TITLE_MAX_LENGTH, 1),
    destination: asOptionalText(record["destination"], "destination", QUOTE_DESTINATION_MAX_LENGTH),
    startDate,
    endDate,
    adults: asInteger(record["adults"], "adults", 1, 50),
    children: asInteger(record["children"], "children", 0, 50),
    validUntil:
      asOptionalDate(record["validUntil"], "validUntil") ?? fail("validUntil is required"),
    pvpOverrideMinor: asOptionalMoney(record["pvpOverrideMinor"], "pvpOverrideMinor"),
    targetMarginBp: asInteger(record["targetMarginBp"], "targetMarginBp", 0, 9000),
    agencyNetShareBp: asInteger(record["agencyNetShareBp"], "agencyNetShareBp", 0, 10_000),
    depositBp: asInteger(record["depositBp"], "depositBp", 0, 10_000),
    balanceDueDays: asInteger(record["balanceDueDays"], "balanceDueDays", 0, 365),
    heroImageUrl: asOptionalHttps(record["heroImageUrl"], "heroImageUrl"),
    intro: asOptionalText(record["intro"], "intro", QUOTE_INTRO_MAX_LENGTH),
    internalNotes: asOptionalText(
      record["internalNotes"],
      "internalNotes",
      QUOTE_INTERNAL_NOTES_MAX_LENGTH,
    ),
    excludedItems: excluded.map((item, index) => asText(item, `excludedItems[${index}]`, 200, 1)),
  };
};

export const validateQuoteCreateDraft = (input: unknown, leadId: unknown): QuoteCreateDraft => {
  if (typeof leadId !== "string") fail("leadId is required");
  const record = (input ?? {}) as Record<string, unknown>;
  const startDate = asOptionalDate(record["startDate"], "startDate");
  const endDate = asOptionalDate(record["endDate"], "endDate");
  assertDateOrder(startDate, endDate, "Quote dates");
  return {
    leadId: leadId as OpaqueId,
    title: asOptionalText(record["title"], "title", QUOTE_TITLE_MAX_LENGTH),
    destination: asOptionalText(record["destination"], "destination", QUOTE_DESTINATION_MAX_LENGTH),
    startDate,
    endDate,
    adults:
      record["adults"] === undefined || record["adults"] === null
        ? null
        : asInteger(record["adults"], "adults", 1, 50),
    children:
      record["children"] === undefined || record["children"] === null
        ? null
        : asInteger(record["children"], "children", 0, 50),
  };
};

/** Category-scoped fields are rejected on other categories instead of being silently dropped. */
export const validateQuoteLineDraft = (input: unknown): QuoteLineDraft => {
  const record = (input ?? {}) as Record<string, unknown>;
  const category = record["category"];
  if (typeof category !== "string" || !(QUOTE_CATEGORIES as readonly string[]).includes(category)) {
    fail("Line category is invalid");
  }
  const lineCategory = category as QuoteLineCategory;
  const startDate = asOptionalDate(record["startDate"], "startDate");
  const endDate = asOptionalDate(record["endDate"], "endDate");
  assertDateOrder(startDate, endDate, "Line dates");
  const flightFields = [
    "fromIata",
    "toIata",
    "departTime",
    "arriveTime",
    "carrier",
    "flightNumber",
    "baggage",
  ];
  const accommodationFields = ["roomType", "boardBasis", "location"];
  if (
    lineCategory !== "FLIGHT" &&
    flightFields.some(
      (field) => record[field] !== undefined && record[field] !== null && record[field] !== "",
    )
  ) {
    fail("Flight details are only allowed on FLIGHT lines");
  }
  if (
    lineCategory !== "ACCOMMODATION" &&
    accommodationFields.some(
      (field) => record[field] !== undefined && record[field] !== null && record[field] !== "",
    )
  ) {
    fail("Accommodation details are only allowed on ACCOMMODATION lines");
  }
  const fromIata = asOptionalIata(record["fromIata"], "fromIata");
  const toIata = asOptionalIata(record["toIata"], "toIata");
  if (fromIata !== null && toIata !== null && fromIata === toIata)
    fail("Flight airports must differ");
  return {
    category: lineCategory,
    service: asText(record["service"], "service", QUOTE_LINE_SERVICE_MAX_LENGTH, 1),
    supplier: asOptionalText(record["supplier"], "supplier", QUOTE_LINE_SUPPLIER_MAX_LENGTH),
    description: asOptionalText(
      record["description"],
      "description",
      QUOTE_LINE_DESCRIPTION_MAX_LENGTH,
    ),
    startDate,
    endDate,
    quantity: asInteger(record["quantity"] ?? 1, "quantity", 1, 1000),
    netSupplierMinor: asMoney(record["netSupplierMinor"] ?? 0n, "netSupplierMinor"),
    recommendedMinor: asMoney(record["recommendedMinor"] ?? 0n, "recommendedMinor"),
    pvpMinor: asMoney(record["pvpMinor"] ?? 0n, "pvpMinor"),
    customerVisible:
      record["customerVisible"] === undefined ? true : record["customerVisible"] === true,
    imageUrl: asOptionalHttps(record["imageUrl"], "imageUrl"),
    internalNote: asOptionalText(
      record["internalNote"],
      "internalNote",
      QUOTE_LINE_INTERNAL_NOTE_MAX_LENGTH,
    ),
    fromIata,
    toIata,
    departTime: asOptionalTime(record["departTime"], "departTime"),
    arriveTime: asOptionalTime(record["arriveTime"], "arriveTime"),
    carrier: asOptionalText(record["carrier"], "carrier", 80),
    flightNumber: asOptionalText(record["flightNumber"], "flightNumber", 12),
    baggage: asOptionalText(record["baggage"], "baggage", 120),
    roomType: asOptionalText(record["roomType"], "roomType", 120),
    boardBasis: asOptionalText(record["boardBasis"], "boardBasis", 80),
    location: asOptionalText(record["location"], "location", 200),
  };
};

export const validateQuoteDay = (input: unknown): { title: string; description: string | null } => {
  const record = (input ?? {}) as Record<string, unknown>;
  return {
    title: asText(record["title"], "day title", QUOTE_DAY_TITLE_MAX_LENGTH, 1),
    description: asOptionalText(
      record["description"],
      "day description",
      QUOTE_DAY_DESCRIPTION_MAX_LENGTH,
    ),
  };
};

export const validateAcceptedName = (value: unknown): string => {
  if (typeof value !== "string") fail("Nome de aceitação inválido");
  const name = (value as string).trim();
  if (
    name.length < QUOTE_ACCEPTED_NAME_MIN_LENGTH ||
    name.length > QUOTE_ACCEPTED_NAME_MAX_LENGTH
  ) {
    fail("Nome de aceitação inválido");
  }
  return name;
};

export const isQuoteState = (value: unknown): value is QuoteState =>
  typeof value === "string" && (QUOTE_STATES as readonly string[]).includes(value);
