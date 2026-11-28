import { z } from "zod";

import { AdminLockVersionSchema } from "../lock-version.js";
import { AdminOpaqueIdSchema } from "../money.js";

/** The customer snapshot contract, re-exported so admin-api parses public payloads through admin only. */
export { QuoteProposalV1Schema, type QuoteProposalV1 } from "../../share/quote-proposal-v1.js";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MINOR_UNITS_TEXT = /^(?:0|[1-9]\d*)(?![\s\S])/u;

/** Money crosses the admin API as a non-negative minor-unit string; never a float. */
export const AdminQuoteMinorUnitsSchema = z
  .string()
  .max(19)
  .regex(MINOR_UNITS_TEXT, "Money must be a non-negative integer string")
  .refine(
    (value) => !MINOR_UNITS_TEXT.test(value) || BigInt(value) <= POSTGRES_BIGINT_MAX,
    "Money exceeds PostgreSQL bigint range",
  );

const ISO_DATE = z.iso.date();
const IATA = z.string().regex(/^[A-Z]{3}$/u);
const TIME_TEXT = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const HTTPS_URL = z.string().max(1000).startsWith("https://");

export const AdminQuoteStateSchema = z.enum([
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "ARCHIVED",
]);
export const AdminQuoteCategorySchema = z.enum([
  "FLIGHT",
  "ACCOMMODATION",
  "TRANSFER",
  "ACTIVITY",
  "INSURANCE",
  "CAR",
  "OTHER",
]);
export const AdminQuoteSectionSchema = z.enum(["BASE", "OPTION"]);
export const AdminQuoteRoundingSchema = z.enum(["CENT", "EURO", "TEN_EUROS"]);

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable();

/** Quote header fields a staff member edits. Every field is sent on PATCH (full header replace). */
const quoteHeaderShape = {
  title: text(200),
  destination: nullableText(200),
  startDate: ISO_DATE.nullable(),
  endDate: ISO_DATE.nullable(),
  adults: z.number().int().min(1).max(50),
  children: z.number().int().min(0).max(50),
  validUntil: ISO_DATE,
  pvpOverrideMinor: AdminQuoteMinorUnitsSchema.nullable(),
  targetMarginBp: z.number().int().min(0).max(9000),
  agencyNetShareBp: z.number().int().min(0).max(10_000),
  depositBp: z.number().int().min(0).max(10_000),
  balanceDueDays: z.number().int().min(0).max(365),
  heroImageUrl: HTTPS_URL.nullable(),
  intro: nullableText(2000),
  internalNotes: nullableText(8000),
  excludedItems: z.array(text(200)).max(50),
} as const;

export const AdminQuoteCreateV1RequestSchema = z
  .object({
    leadId: AdminOpaqueIdSchema,
    title: text(200).optional(),
    destination: nullableText(200).optional(),
    startDate: ISO_DATE.nullable().optional(),
    endDate: ISO_DATE.nullable().optional(),
    adults: z.number().int().min(1).max(50).nullable().optional(),
    children: z.number().int().min(0).max(50).nullable().optional(),
  })
  .strict();

export const AdminQuoteHeaderPatchV1RequestSchema = z
  .object({ expectedLockVersion: AdminLockVersionSchema, ...quoteHeaderShape })
  .strict();

/** Line fields; money is optional (absent means zero) and quantity defaults to one. */
const quoteLineShape = {
  category: AdminQuoteCategorySchema,
  service: text(200),
  supplier: nullableText(200).optional(),
  description: nullableText(2000).optional(),
  startDate: ISO_DATE.nullable().optional(),
  endDate: ISO_DATE.nullable().optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  netSupplierMinor: AdminQuoteMinorUnitsSchema.optional(),
  recommendedMinor: AdminQuoteMinorUnitsSchema.optional(),
  pvpMinor: AdminQuoteMinorUnitsSchema.optional(),
  customerVisible: z.boolean().optional(),
  imageUrl: HTTPS_URL.nullable().optional(),
  internalNote: nullableText(2000).optional(),
  fromIata: IATA.nullable().optional(),
  toIata: IATA.nullable().optional(),
  departTime: TIME_TEXT.nullable().optional(),
  arriveTime: TIME_TEXT.nullable().optional(),
  carrier: nullableText(80).optional(),
  flightNumber: nullableText(12).optional(),
  baggage: nullableText(120).optional(),
  roomType: nullableText(120).optional(),
  boardBasis: nullableText(80).optional(),
  location: nullableText(200).optional(),
} as const;

export const AdminQuoteAddLineV1RequestSchema = z
  .object({ section: AdminQuoteSectionSchema, ...quoteLineShape })
  .strict();

export const AdminQuoteUpdateLineV1RequestSchema = z
  .object({ expectedLockVersion: AdminLockVersionSchema, ...quoteLineShape })
  .strict();

export const AdminQuoteDeleteLineQuerySchema = z
  .object({ expectedLockVersion: AdminLockVersionSchema })
  .strict();

export const AdminQuoteReorderV1RequestSchema = z
  .object({
    expectedLockVersion: AdminLockVersionSchema,
    order: z
      .array(z.object({ lineId: AdminOpaqueIdSchema, section: AdminQuoteSectionSchema }).strict())
      .min(1)
      .max(500),
  })
  .strict();

export const AdminQuoteApplyMarginV1RequestSchema = z
  .object({
    lineIds: z.array(AdminOpaqueIdSchema).max(500).nullable().default(null),
    rounding: AdminQuoteRoundingSchema,
  })
  .strict();

export const AdminQuoteDayV1RequestSchema = z
  .object({
    expectedLockVersion: AdminLockVersionSchema,
    title: text(120),
    description: nullableText(2000),
  })
  .strict();

export const AdminQuoteExpectedVersionV1RequestSchema = z
  .object({ expectedLockVersion: AdminLockVersionSchema })
  .strict();

export const AdminQuoteSendV1RequestSchema = z
  .object({
    expectedLockVersion: AdminLockVersionSchema,
    expiresAt: ISO_DATE.nullable().default(null),
  })
  .strict();

export const AdminQuoteListQuerySchema = z
  .object({
    state: AdminQuoteStateSchema.optional(),
    customerId: AdminOpaqueIdSchema.optional(),
    leadId: AdminOpaqueIdSchema.optional(),
    q: z.string().trim().max(100).optional(),
    cursor: AdminOpaqueIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

const money = AdminQuoteMinorUnitsSchema;

/** Response shapes. Parsing responses through these strips anything not listed here. */
export const AdminQuoteV1ResponseSchema = z.object({
  id: AdminOpaqueIdSchema,
  number: z.string(),
  customerId: AdminOpaqueIdSchema,
  customerDisplayName: z.string(),
  leadId: AdminOpaqueIdSchema,
  title: z.string(),
  destination: z.string().nullable(),
  startDate: ISO_DATE.nullable(),
  endDate: ISO_DATE.nullable(),
  adults: z.number().int(),
  children: z.number().int(),
  state: AdminQuoteStateSchema,
  validUntil: ISO_DATE,
  currencyCode: z.string(),
  pvpOverrideMinor: money.nullable(),
  targetMarginBp: z.number().int(),
  agencyNetShareBp: z.number().int(),
  depositBp: z.number().int(),
  balanceDueDays: z.number().int(),
  heroImageUrl: z.string().nullable(),
  intro: z.string().nullable(),
  internalNotes: z.string().nullable(),
  excludedItems: z.array(z.string()),
  convertedTripId: AdminOpaqueIdSchema.nullable(),
  lockVersion: AdminLockVersionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const AdminQuoteLineV1ResponseSchema = z.object({
  id: AdminOpaqueIdSchema,
  quoteId: AdminOpaqueIdSchema,
  section: AdminQuoteSectionSchema,
  position: z.number().int(),
  category: AdminQuoteCategorySchema,
  service: z.string(),
  supplier: z.string().nullable(),
  description: z.string().nullable(),
  startDate: ISO_DATE.nullable(),
  endDate: ISO_DATE.nullable(),
  quantity: z.number().int(),
  netSupplierMinor: money,
  recommendedMinor: money,
  pvpMinor: money,
  customerVisible: z.boolean(),
  imageUrl: z.string().nullable(),
  internalNote: z.string().nullable(),
  fromIata: z.string().nullable(),
  toIata: z.string().nullable(),
  departTime: z.string().nullable(),
  arriveTime: z.string().nullable(),
  carrier: z.string().nullable(),
  flightNumber: z.string().nullable(),
  baggage: z.string().nullable(),
  roomType: z.string().nullable(),
  boardBasis: z.string().nullable(),
  location: z.string().nullable(),
  lockVersion: AdminLockVersionSchema,
});

const AdminQuoteShareLinkV1ResponseSchema = z.object({
  shareLinkId: AdminOpaqueIdSchema,
  versionId: AdminOpaqueIdSchema,
  versionNumber: z.number().int(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
});

const AdminQuoteVersionV1ResponseSchema = z.object({
  id: AdminOpaqueIdSchema,
  quoteId: AdminOpaqueIdSchema,
  versionNumber: z.number().int(),
  sentAt: z.string(),
  pvpFinalMinor: money,
  currencyCode: z.string(),
  payloadSha256: z.string(),
  acceptance: z.object({ acceptedAt: z.string(), acceptedName: z.string() }).nullable(),
  isLatest: z.boolean(),
  shareLinks: z.array(AdminQuoteShareLinkV1ResponseSchema),
});

const AdminQuoteTotalsV1ResponseSchema = z.object({
  baseNetSupplierMinor: money,
  baseRecommendedMinor: money,
  baseAgencyNetMinor: money,
  baseLinesPvpMinor: money,
  pvpFinalMinor: money,
  profitMinor: money,
  profitBp: z.number().int().nullable(),
  recommendedMarginMinor: money,
  recommendedMarginBp: z.number().int().nullable(),
  perPersonMinor: money,
  depositMinor: money,
  balanceMinor: money,
  balanceDueDate: ISO_DATE.nullable(),
  balanceDueNow: z.boolean(),
  optionsPvp: z.array(z.object({ lineId: z.string(), pvpMinor: money })),
});

const AdminQuoteWarningV1ResponseSchema = z.object({
  code: z.string(),
  lineId: z.string().optional(),
});

export const AdminQuoteDetailV1ResponseSchema = z.object({
  quote: AdminQuoteV1ResponseSchema,
  lines: z.array(AdminQuoteLineV1ResponseSchema),
  days: z.array(
    z.object({
      dayIndex: z.number().int(),
      date: ISO_DATE,
      title: z.string(),
      description: z.string().nullable(),
    }),
  ),
  totals: AdminQuoteTotalsV1ResponseSchema,
  warnings: z.array(AdminQuoteWarningV1ResponseSchema),
  included: z.array(
    z.object({
      category: AdminQuoteCategorySchema,
      label: z.string(),
      lineIds: z.array(z.string()),
    }),
  ),
  excluded: z.array(z.string()),
  versions: z.array(AdminQuoteVersionV1ResponseSchema),
  today: ISO_DATE,
});

export const AdminQuoteListV1ResponseSchema = z.object({
  items: z.array(AdminQuoteV1ResponseSchema),
  nextCursor: AdminOpaqueIdSchema.nullable(),
});

export const AdminQuoteSentV1ResponseSchema = z.object({
  versionNumber: z.number().int(),
  url: z.string().url(),
  token: z.string(),
  messageText: z.string(),
  mailtoUrl: z.string(),
  whatsappUrl: z.string(),
  expiresAt: z.string(),
});

export const AdminQuoteConvertedV1ResponseSchema = z.object({
  tripId: AdminOpaqueIdSchema,
});

export const AdminQuoteRevokedV1ResponseSchema = z.object({ revoked: z.literal(true) });

export const AdminLeadQuotesV1ResponseSchema = z.object({
  items: z.array(AdminQuoteV1ResponseSchema),
});

export type AdminQuoteListQuery = z.infer<typeof AdminQuoteListQuerySchema>;
export type AdminQuoteDetailV1Response = z.infer<typeof AdminQuoteDetailV1ResponseSchema>;
export type AdminQuoteSentV1Response = z.infer<typeof AdminQuoteSentV1ResponseSchema>;
export type AdminQuoteCreateV1Request = z.input<typeof AdminQuoteCreateV1RequestSchema>;
export type AdminQuoteHeaderPatchV1Request = z.input<typeof AdminQuoteHeaderPatchV1RequestSchema>;
export type AdminQuoteAddLineV1Request = z.input<typeof AdminQuoteAddLineV1RequestSchema>;
export type AdminQuoteUpdateLineV1Request = z.input<typeof AdminQuoteUpdateLineV1RequestSchema>;
export type AdminQuoteReorderV1Request = z.input<typeof AdminQuoteReorderV1RequestSchema>;
export type AdminQuoteApplyMarginV1Request = z.input<typeof AdminQuoteApplyMarginV1RequestSchema>;
export type AdminQuoteDayV1Request = z.input<typeof AdminQuoteDayV1RequestSchema>;
export type AdminQuoteSendV1Request = z.input<typeof AdminQuoteSendV1RequestSchema>;
export type AdminQuoteExpectedVersionV1Request = z.input<
  typeof AdminQuoteExpectedVersionV1RequestSchema
>;
export type AdminQuoteListV1Response = z.infer<typeof AdminQuoteListV1ResponseSchema>;
export type AdminQuoteV1Response = z.infer<typeof AdminQuoteV1ResponseSchema>;
