import {
  generateShareToken,
  hashPresentedShareToken,
  isShareTokenShape,
  type ShareTokenCryptoPort,
} from "../../share-links/domain/share-token.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { LeadState } from "../../sales/domain/lead.js";
import { LeadNotFoundError } from "../../sales/application/staff-lead-operations.js";
import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "../../trip-operations/application/staff-trip-operations.js";
import { InputValidationError } from "../../trip-operations/application/trip-slice.js";
import {
  agencyNetMinor,
  includedItems,
  quoteTotals,
  quoteWarnings,
  suggestedPvpMinor,
  type QuoteLineSection,
  type QuoteRoundingUnit,
  type QuoteTotals,
  type QuoteWarning,
} from "../domain/quote-calculations.js";
import {
  buildMailtoUrl,
  buildProposalMessageText,
  buildQuoteProposalV1,
  buildWhatsappUrl,
  effectiveDays,
  toCalcHeader,
  toCalcLine,
  type EffectiveQuoteDay,
  type QuoteProposalV1,
} from "../domain/quote-proposal.js";
import {
  QUOTE_LIST_MAXIMUM_LIMIT,
  QUOTE_VALIDITY_DAYS,
  QuoteNotFoundError,
  QuoteRuleError,
  QuoteStaleError,
  isQuoteState,
  validateAcceptedName,
  validateQuoteCreateDraft,
  validateQuoteDay,
  validateQuoteHeaderPatch,
  validateQuoteLineDraft,
  type QuoteAggregate,
  type QuoteHeaderPatch,
  type QuoteLineDraft,
  type QuoteLineRecord,
  type QuoteRecord,
  type QuoteShareLinkRecord,
  type QuoteState,
  type QuoteVersionRecord,
} from "../domain/quote-model.js";

/** Permission policy per use case; the persistence adapter re-checks it inside the transaction. */
export const QUOTE_PERMISSION_REQUIREMENTS = Object.freeze({
  VIEW: Object.freeze(["quote.view"] as const satisfies readonly StaffPermissionId[]),
  EDIT: Object.freeze(["quote.edit"] as const satisfies readonly StaffPermissionId[]),
  CREATE: Object.freeze([
    "quote.edit",
    "customer.view",
  ] as const satisfies readonly StaffPermissionId[]),
  SEND: Object.freeze(["quote.send"] as const satisfies readonly StaffPermissionId[]),
  CONVERT: Object.freeze([
    "quote.send",
    "trip.edit",
  ] as const satisfies readonly StaffPermissionId[]),
});

export interface QuoteListQuery {
  readonly limit: number;
  readonly cursor: OpaqueId | null;
  readonly state: QuoteState | null;
  readonly customerId: OpaqueId | null;
  readonly leadId: OpaqueId | null;
  readonly search: string | null;
}

export interface QuotePage {
  readonly items: readonly QuoteRecord[];
  readonly nextCursor: OpaqueId | null;
}

export interface QuoteCustomerContext {
  readonly customerId: OpaqueId;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly primaryGivenName: string | null;
}

export interface QuoteLeadContext {
  readonly leadId: OpaqueId;
  readonly state: LeadState;
  /** COALESCE(lead.customerId, lead.qualifiedCustomerId): the Customer a quote for this lead uses. */
  readonly customerId: OpaqueId | null;
  readonly customer: QuoteCustomerContext | null;
}

export interface NewQuoteRecord {
  readonly customerId: OpaqueId;
  readonly leadId: OpaqueId;
  readonly title: string;
  readonly destination: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly adults: number;
  readonly children: number;
  readonly validUntil: string;
  readonly year: number;
}

export interface PreparedQuoteVersion {
  readonly payload: QuoteProposalV1;
  readonly pvpFinalMinor: bigint;
  readonly currencyCode: string;
}

export interface QuotePublishPlan {
  readonly expiresAt: string;
  readonly tokenHash: Uint8Array;
  /** Runs inside the send transaction, after the quote is locked and its lines are stable. */
  readonly prepare: (aggregate: QuoteAggregate) => PreparedQuoteVersion;
}

export interface QuotePublishResult {
  readonly outcome: string;
  readonly version: QuoteVersionRecord | null;
  readonly shareLink: QuoteShareLinkRecord | null;
}

export interface QuoteLineInsertResult {
  readonly outcome: string;
  readonly lineId: OpaqueId | null;
}

export interface QuoteLineLockUpdate {
  readonly lineId: OpaqueId;
  readonly expectedLockVersion: bigint;
  readonly line: QuoteLineDraft;
}

/** Public, customer-safe read of a share link; the payload is re-validated by the API boundary. */
export interface QuoteSharedRecord {
  readonly versionId: OpaqueId;
  readonly versionNumber: number;
  readonly payload: unknown;
  readonly expiresAt: string;
  readonly quoteState: QuoteState;
  readonly validUntil: string;
  readonly isLatest: boolean;
  readonly acceptance: { readonly acceptedAt: string; readonly acceptedName: string } | null;
}

export interface QuoteRepository {
  listQuotes(
    agencyId: OpaqueId,
    query: QuoteListQuery,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<QuotePage>;
  readAggregate(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<QuoteAggregate | null>;
  readLeadContext(
    agencyId: OpaqueId,
    leadId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<QuoteLeadContext | null>;
  insertQuote(
    agencyId: OpaqueId,
    quote: NewQuoteRecord,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<QuoteAggregate>;
  updateHeader(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
    patch: QuoteHeaderPatch,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  insertLine(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    section: QuoteLineSection,
    line: QuoteLineDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<QuoteLineInsertResult>;
  updateLine(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    lineId: OpaqueId,
    expectedLockVersion: bigint,
    line: QuoteLineDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  /** All-or-nothing: throws the mapped error (STALE, NOT_DRAFT, ...) and writes nothing. */
  updateLines(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    updates: readonly QuoteLineLockUpdate[],
    authorization: StaffAuthorizationOperationProof,
  ): Promise<void>;
  deleteLine(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    lineId: OpaqueId,
    expectedLockVersion: bigint,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  duplicateLine(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    lineId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<QuoteLineInsertResult>;
  reorderLines(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    expectedQuoteLockVersion: bigint,
    order: readonly { readonly lineId: OpaqueId; readonly section: QuoteLineSection }[],
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  upsertDay(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
    day: { readonly dayIndex: number; readonly title: string; readonly description: string | null },
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  deleteDay(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
    dayIndex: number,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  resetDays(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  setState(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
    fromStates: readonly QuoteState[],
    toState: QuoteState,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  publish(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
    plan: QuotePublishPlan,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<QuotePublishResult>;
  revokeShareLink(
    agencyId: OpaqueId,
    shareLinkId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<string>;
  convertToTrip(
    agencyId: OpaqueId,
    quoteId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<{
    readonly outcome: string;
    readonly tripId: OpaqueId | null;
    readonly created: boolean;
  }>;
  readQuoteShare(tokenHash: Uint8Array): Promise<QuoteSharedRecord | null>;
  acceptQuoteShare(tokenHash: Uint8Array, acceptedName: string): Promise<string>;
}

export interface QuoteView {
  readonly quote: QuoteRecord;
  readonly lines: readonly QuoteLineRecord[];
  readonly days: readonly EffectiveQuoteDay[];
  readonly totals: QuoteTotals;
  readonly warnings: readonly QuoteWarning[];
  readonly included: ReturnType<typeof includedItems>;
  readonly excluded: readonly string[];
  readonly versions: readonly QuoteVersionRecord[];
  readonly today: string;
}

export interface SentQuote {
  readonly versionNumber: number;
  readonly url: string;
  /** Shown once; only its SHA-256 is stored. */
  readonly token: string;
  readonly messageText: string;
  readonly mailtoUrl: string;
  readonly whatsappUrl: string;
  readonly expiresAt: string;
}

export interface StaffQuoteOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: QuoteRepository;
  readonly shareTokens: ShareTokenCryptoPort;
  readonly agencyDisplayName: string;
  /** Origin that serves the customer proposal page, without a trailing slash. */
  readonly publicBaseUrl: string;
}

export interface StaffQuoteOperations {
  listQuotes(cookieHeader: unknown, query: QuoteListQuery): Promise<QuotePage>;
  createQuote(cookieHeader: unknown, leadId: OpaqueId, input: unknown): Promise<QuoteRecord>;
  getQuote(cookieHeader: unknown, quoteId: OpaqueId): Promise<QuoteView>;
  updateQuote(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    input: { readonly expectedLockVersion: bigint; readonly patch: unknown },
  ): Promise<QuoteView>;
  addLine(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    input: { readonly section: QuoteLineSection; readonly line: unknown },
  ): Promise<QuoteView>;
  updateLine(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    lineId: OpaqueId,
    input: { readonly expectedLockVersion: bigint; readonly line: unknown },
  ): Promise<QuoteView>;
  deleteLine(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    lineId: OpaqueId,
    expectedLockVersion: bigint,
  ): Promise<QuoteView>;
  duplicateLine(cookieHeader: unknown, quoteId: OpaqueId, lineId: OpaqueId): Promise<QuoteView>;
  reorderLines(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    input: {
      readonly expectedLockVersion: bigint;
      readonly order: readonly { readonly lineId: OpaqueId; readonly section: QuoteLineSection }[];
    },
  ): Promise<QuoteView>;
  applyTargetMargin(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    input: { readonly lineIds: readonly OpaqueId[] | null; readonly rounding: QuoteRoundingUnit },
  ): Promise<QuoteView>;
  upsertDay(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    input: {
      readonly expectedLockVersion: bigint;
      readonly dayIndex: number;
      readonly day: unknown;
    },
  ): Promise<QuoteView>;
  resetDays(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
  ): Promise<QuoteView>;
  sendQuote(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    input: { readonly expectedLockVersion: bigint; readonly expiresAt: string | null },
  ): Promise<SentQuote>;
  reviseQuote(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
  ): Promise<QuoteView>;
  declineQuote(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
  ): Promise<QuoteView>;
  archiveQuote(
    cookieHeader: unknown,
    quoteId: OpaqueId,
    expectedLockVersion: bigint,
  ): Promise<QuoteView>;
  revokeShareLink(cookieHeader: unknown, shareLinkId: OpaqueId): Promise<void>;
  convertToTrip(
    cookieHeader: unknown,
    quoteId: OpaqueId,
  ): Promise<{ readonly tripId: OpaqueId; readonly created: boolean }>;
}

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

const invalid = (message: string): never => {
  throw new InputValidationError(message);
};

const requireLockVersion = (value: unknown): bigint => {
  if (typeof value !== "bigint" || value < 0n || value > POSTGRES_BIGINT_MAX) {
    invalid("Quote expected lock version is invalid");
  }
  return value as bigint;
};

const requireId = (value: unknown, label: string): OpaqueId => {
  try {
    return asOpaqueId(value as string);
  } catch {
    return invalid(`${label} is invalid`);
  }
};

const LINE_SECTIONS: readonly QuoteLineSection[] = ["BASE", "OPTION"];

const requireSection = (value: unknown): QuoteLineSection => {
  if (typeof value !== "string" || !(LINE_SECTIONS as readonly string[]).includes(value)) {
    invalid("Line section is invalid");
  }
  return value as QuoteLineSection;
};

const ROUNDING_UNITS: readonly QuoteRoundingUnit[] = ["CENT", "EURO", "TEN_EUROS"];

const requireRounding = (value: unknown): QuoteRoundingUnit => {
  if (typeof value !== "string" || !(ROUNDING_UNITS as readonly string[]).includes(value)) {
    invalid("Rounding unit is invalid");
  }
  return value as QuoteRoundingUnit;
};

/** Maps the repository's CAS outcome to the public error vocabulary; UPDATED-like outcomes pass. */
export const assertQuoteWriteOutcome = (outcome: string): void => {
  switch (outcome) {
    case "UPDATED":
    case "DELETED":
    case "CREATED":
    case "REVOKED":
      return;
    case "NOT_FOUND":
      throw new QuoteNotFoundError();
    case "STALE":
      throw new QuoteStaleError();
    case "NOT_DRAFT":
      throw new QuoteRuleError("NOT_DRAFT", "Só é possível alterar um orçamento em rascunho");
    case "INVALID_STATE":
      throw new QuoteRuleError("INVALID_STATE", "Estado do orçamento não permite esta ação");
    case "ALREADY_REVOKED":
      throw new QuoteRuleError("ALREADY_REVOKED", "Este link já foi revogado");
    default:
      throw new Error(`Unexpected quote write outcome: ${outcome}`);
  }
};

const isoDay = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);

const addDays = (isoDate: string, days: number): string => {
  const epoch = Date.parse(`${isoDate}T00:00:00.000Z`) + days * 86_400_000;
  return isoDay(epoch);
};

/** Customer-visible proposal link expires at the end of its validity day (UTC). */
const endOfValidityIso = (validUntil: string): string => `${validUntil}T23:59:59.000Z`;

const loadAggregate = async (
  dependencies: StaffQuoteOperationsDependencies,
  cookieHeader: unknown,
  quoteId: OpaqueId,
  permissions: readonly StaffPermissionId[],
  mutate?: (
    agencyId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ) => Promise<unknown>,
): Promise<{
  agencyId: OpaqueId;
  authorization: StaffAuthorizationOperationProof;
  aggregate: QuoteAggregate;
}> => {
  const authorization = await authorizeOperation(dependencies, cookieHeader, null, permissions);
  const agencyId = asOpaqueId(authorization.session.agencyId);
  if (mutate !== undefined) await mutate(agencyId, authorization);
  const aggregate = await dependencies.repository.readAggregate(agencyId, quoteId, authorization);
  if (aggregate === null) throw new QuoteNotFoundError();
  return { agencyId, authorization, aggregate };
};

const nowMs = (dependencies: StaffQuoteOperationsDependencies): number =>
  (dependencies.nowEpochMs ?? Date.now)();

const viewOf = (aggregate: QuoteAggregate, today: string): QuoteView => {
  const header = toCalcHeader(aggregate.quote);
  const lines = aggregate.lines.map(toCalcLine);
  const totals = quoteTotals(header, lines, today);
  return {
    quote: aggregate.quote,
    lines: aggregate.lines,
    days: effectiveDays(aggregate.quote, aggregate.lines, aggregate.days),
    totals,
    warnings: quoteWarnings(header, lines, totals, today),
    included: includedItems(lines),
    excluded: aggregate.quote.excludedItems,
    versions: aggregate.versions,
    today,
  };
};

/** Defaults a new line inherits: dates from the previous line of the same category, else the quote. */
const withLineDefaults = (
  aggregate: QuoteAggregate,
  section: QuoteLineSection,
  raw: unknown,
): unknown => {
  const base: Record<string, unknown> =
    raw === null || typeof raw !== "object" ? {} : { ...(raw as Record<string, unknown>) };
  const record: Record<string, unknown> = { ...base, section };
  const category = typeof record["category"] === "string" ? record["category"] : null;
  const previous = [...aggregate.lines]
    .filter((line) => line.category === category)
    .sort((left, right) => right.position - left.position)[0];
  const hasDates =
    record["startDate"] !== undefined && record["startDate"] !== null && record["startDate"] !== "";
  if (!hasDates) {
    record["startDate"] = previous?.startDate ?? aggregate.quote.startDate;
    record["endDate"] = previous?.endDate ?? aggregate.quote.endDate;
  }
  if (category === "FLIGHT" && (record["service"] === undefined || record["service"] === "")) {
    const from = record["fromIata"];
    const to = record["toIata"];
    if (typeof from === "string" && typeof to === "string") record["service"] = `Voo ${from}–${to}`;
  }
  return record;
};

/** Customer-visible BASE lines must exist before a version can be frozen. */
const assertSendable = (aggregate: QuoteAggregate): void => {
  if (aggregate.quote.state !== "DRAFT") {
    throw new QuoteRuleError("NOT_DRAFT", "Só é possível enviar um orçamento em rascunho");
  }
  const visible = aggregate.lines.some((line) => line.section === "BASE" && line.customerVisible);
  if (!visible) {
    throw new QuoteRuleError("NO_VISIBLE_LINES", "Adicione pelo menos uma linha visível na base");
  }
};

export const createStaffQuoteOperations = (
  dependencies: StaffQuoteOperationsDependencies,
): StaffQuoteOperations => {
  const repository = dependencies.repository;

  const operations: StaffQuoteOperations = {
    async listQuotes(cookieHeader, query) {
      const limit = query.limit;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > QUOTE_LIST_MAXIMUM_LIMIT) {
        invalid("Quote list limit is invalid");
      }
      if (query.state !== null && !isQuoteState(query.state))
        invalid("Quote list state filter is invalid");
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        QUOTE_PERMISSION_REQUIREMENTS.VIEW,
      );
      return repository.listQuotes(
        asOpaqueId(authorization.session.agencyId),
        {
          limit,
          cursor: query.cursor === null ? null : requireId(query.cursor, "Quote cursor"),
          state: query.state,
          customerId: query.customerId === null ? null : requireId(query.customerId, "Customer"),
          leadId: query.leadId === null ? null : requireId(query.leadId, "Lead"),
          search: query.search === null ? null : query.search.trim().slice(0, 200) || null,
        },
        authorization,
      );
    },

    async createQuote(cookieHeader, leadId, input) {
      const leadKey = requireId(leadId, "Lead");
      const draft = validateQuoteCreateDraft(input, leadKey);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        QUOTE_PERMISSION_REQUIREMENTS.CREATE,
      );
      const agencyId = asOpaqueId(authorization.session.agencyId);
      const context = await repository.readLeadContext(agencyId, leadKey, authorization);
      if (context === null) throw new LeadNotFoundError();
      if (context.customerId === null || context.customer === null) {
        throw new QuoteRuleError("LEAD_NOT_QUALIFIED", "Qualifique a lead primeiro");
      }
      const customerName = context.customer.displayName;
      const today = isoDay(nowMs(dependencies));
      const aggregate = await repository.insertQuote(
        agencyId,
        {
          customerId: context.customerId,
          leadId: leadKey,
          title:
            draft.title ??
            (draft.destination !== null
              ? `${draft.destination} · ${customerName}`
              : `Orçamento ${customerName}`),
          destination: draft.destination,
          startDate: draft.startDate,
          endDate: draft.endDate,
          adults: draft.adults ?? 2,
          children: draft.children ?? 0,
          validUntil: addDays(today, QUOTE_VALIDITY_DAYS),
          year: Number(today.slice(0, 4)),
        },
        authorization,
      );
      return aggregate.quote;
    },

    async getQuote(cookieHeader, quoteId) {
      const key = requireId(quoteId, "Quote");
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        QUOTE_PERMISSION_REQUIREMENTS.VIEW,
      );
      const aggregate = await repository.readAggregate(
        asOpaqueId(authorization.session.agencyId),
        key,
        authorization,
      );
      if (aggregate === null) throw new QuoteNotFoundError();
      return viewOf(aggregate, isoDay(nowMs(dependencies)));
    },

    async updateQuote(cookieHeader, quoteId, input) {
      const key = requireId(quoteId, "Quote");
      const expected = requireLockVersion(input.expectedLockVersion);
      const patch = validateQuoteHeaderPatch(input.patch);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(
        await repository.updateHeader(agencyId, key, expected, patch, authorization),
      );
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async addLine(cookieHeader, quoteId, input) {
      const key = requireId(quoteId, "Quote");
      const section = requireSection(input.section);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      if (aggregate.quote.state !== "DRAFT")
        throw new QuoteRuleError("NOT_DRAFT", "Só é possível alterar um orçamento em rascunho");
      const draft = validateQuoteLineDraft(withLineDefaults(aggregate, section, input.line));
      const result = await repository.insertLine(agencyId, key, section, draft, authorization);
      assertQuoteWriteOutcome(result.outcome);
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async updateLine(cookieHeader, quoteId, lineId, input) {
      const key = requireId(quoteId, "Quote");
      const line = requireId(lineId, "Line");
      const expected = requireLockVersion(input.expectedLockVersion);
      const draft = validateQuoteLineDraft(input.line);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(
        await repository.updateLine(agencyId, key, line, expected, draft, authorization),
      );
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async deleteLine(cookieHeader, quoteId, lineId, expectedLockVersion) {
      const key = requireId(quoteId, "Quote");
      const line = requireId(lineId, "Line");
      const expected = requireLockVersion(expectedLockVersion);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(
        await repository.deleteLine(agencyId, key, line, expected, authorization),
      );
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async duplicateLine(cookieHeader, quoteId, lineId) {
      const key = requireId(quoteId, "Quote");
      const line = requireId(lineId, "Line");
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      if (aggregate.quote.state !== "DRAFT")
        throw new QuoteRuleError("NOT_DRAFT", "Só é possível alterar um orçamento em rascunho");
      const result = await repository.duplicateLine(agencyId, key, line, authorization);
      assertQuoteWriteOutcome(result.outcome);
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async reorderLines(cookieHeader, quoteId, input) {
      const key = requireId(quoteId, "Quote");
      const expected = requireLockVersion(input.expectedLockVersion);
      const order = input.order.map((entry) => ({
        lineId: requireId(entry.lineId, "Line"),
        section: requireSection(entry.section),
      }));
      if (new Set(order.map((entry) => entry.lineId)).size !== order.length) {
        invalid("Line order must name each line once");
      }
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(
        await repository.reorderLines(agencyId, key, expected, order, authorization),
      );
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async applyTargetMargin(cookieHeader, quoteId, input) {
      const key = requireId(quoteId, "Quote");
      const rounding = requireRounding(input.rounding);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      if (aggregate.quote.state !== "DRAFT")
        throw new QuoteRuleError("NOT_DRAFT", "Só é possível alterar um orçamento em rascunho");
      const selected =
        input.lineIds === null ? null : new Set(input.lineIds.map((id) => requireId(id, "Line")));
      const updates = aggregate.lines
        .filter((line) => line.section === "BASE" && (selected === null || selected.has(line.id)))
        .map((line) => {
          const agencyNet = agencyNetMinor(
            line.netSupplierMinor,
            line.recommendedMinor,
            aggregate.quote.agencyNetShareBp,
          );
          const pvpMinor = suggestedPvpMinor(agencyNet, aggregate.quote.targetMarginBp, rounding);
          return {
            lineId: line.id,
            expectedLockVersion: line.lockVersion,
            line: validateQuoteLineDraft({
              category: line.category,
              service: line.service,
              supplier: line.supplier,
              description: line.description,
              startDate: line.startDate,
              endDate: line.endDate,
              quantity: line.quantity,
              netSupplierMinor: line.netSupplierMinor,
              recommendedMinor: line.recommendedMinor,
              pvpMinor,
              customerVisible: line.customerVisible,
              imageUrl: line.imageUrl,
              internalNote: line.internalNote,
              fromIata: line.fromIata,
              toIata: line.toIata,
              departTime: line.departTime,
              arriveTime: line.arriveTime,
              carrier: line.carrier,
              flightNumber: line.flightNumber,
              baggage: line.baggage,
              roomType: line.roomType,
              boardBasis: line.boardBasis,
              location: line.location,
            }),
          };
        });
      await repository.updateLines(agencyId, key, updates, authorization);
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async upsertDay(cookieHeader, quoteId, input) {
      const key = requireId(quoteId, "Quote");
      const expected = requireLockVersion(input.expectedLockVersion);
      if (!Number.isSafeInteger(input.dayIndex) || input.dayIndex < 0)
        invalid("Day index is invalid");
      const day = validateQuoteDay(input.day);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(
        await repository.upsertDay(
          agencyId,
          key,
          expected,
          { dayIndex: input.dayIndex, title: day.title, description: day.description },
          authorization,
        ),
      );
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async resetDays(cookieHeader, quoteId, expectedLockVersion) {
      const key = requireId(quoteId, "Quote");
      const expected = requireLockVersion(expectedLockVersion);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(await repository.resetDays(agencyId, key, expected, authorization));
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async sendQuote(cookieHeader, quoteId, input) {
      const key = requireId(quoteId, "Quote");
      const expected = requireLockVersion(input.expectedLockVersion);
      const today = isoDay(nowMs(dependencies));
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        QUOTE_PERMISSION_REQUIREMENTS.SEND,
      );
      const agencyId = asOpaqueId(authorization.session.agencyId);
      const current = await repository.readAggregate(agencyId, key, authorization);
      if (current === null) throw new QuoteNotFoundError();
      assertSendable(current);
      if (current.quote.validUntil < today) {
        throw new QuoteRuleError(
          "QUOTE_EXPIRED",
          "A validade do orçamento já passou; atualize a data de validade",
        );
      }
      const expiresAt = input.expiresAt ?? endOfValidityIso(current.quote.validUntil);
      if (Date.parse(expiresAt) <= nowMs(dependencies)) {
        throw new QuoteRuleError(
          "LINK_EXPIRY_IN_PAST",
          "A data de expiração do link tem de ser futura",
        );
      }
      const generated = generateShareToken(dependencies.shareTokens);
      const plan: QuotePublishPlan = {
        expiresAt,
        tokenHash: generated.tokenHash,
        prepare: (aggregate) => {
          assertSendable(aggregate);
          const days = effectiveDays(aggregate.quote, aggregate.lines, aggregate.days);
          const payload = buildQuoteProposalV1({
            agencyDisplayName: dependencies.agencyDisplayName,
            quote: aggregate.quote,
            lines: aggregate.lines,
            days,
          });
          return {
            payload,
            pvpFinalMinor: BigInt(payload.totals.pvpFinal.minorUnits),
            currencyCode: aggregate.quote.currencyCode,
          };
        },
      };
      const published = await repository.publish(agencyId, key, expected, plan, authorization);
      assertQuoteWriteOutcome(published.outcome);
      if (published.version === null) throw new Error("Quote publish returned no version");
      const context = await repository.readLeadContext(
        agencyId,
        current.quote.leadId,
        authorization,
      );
      const url = `${dependencies.publicBaseUrl}/v/${generated.token}`;
      const messageText = buildProposalMessageText({
        givenName: context?.customer?.primaryGivenName ?? null,
        destination: current.quote.destination,
        startDate: current.quote.startDate,
        endDate: current.quote.endDate,
        validUntil: current.quote.validUntil,
        url,
      });
      const email = context?.customer?.email ?? null;
      const phone = context?.customer?.phone ?? null;
      return {
        versionNumber: published.version.versionNumber,
        url,
        token: generated.token,
        messageText,
        mailtoUrl: buildMailtoUrl(email, `Proposta ${current.quote.number}`, messageText),
        whatsappUrl: buildWhatsappUrl(phone, messageText),
        expiresAt,
      };
    },

    async reviseQuote(cookieHeader, quoteId, expectedLockVersion) {
      const key = requireId(quoteId, "Quote");
      const expected = requireLockVersion(expectedLockVersion);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(
        await repository.setState(agencyId, key, expected, ["SENT"], "DRAFT", authorization),
      );
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async declineQuote(cookieHeader, quoteId, expectedLockVersion) {
      const key = requireId(quoteId, "Quote");
      const expected = requireLockVersion(expectedLockVersion);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(
        await repository.setState(
          agencyId,
          key,
          expected,
          ["DRAFT", "SENT"],
          "DECLINED",
          authorization,
        ),
      );
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async archiveQuote(cookieHeader, quoteId, expectedLockVersion) {
      const key = requireId(quoteId, "Quote");
      const expected = requireLockVersion(expectedLockVersion);
      const { agencyId, authorization, aggregate } = await loadAggregate(
        dependencies,
        cookieHeader,
        key,
        QUOTE_PERMISSION_REQUIREMENTS.EDIT,
      );
      assertQuoteWriteOutcome(
        await repository.setState(
          agencyId,
          key,
          expected,
          ["DRAFT", "SENT", "DECLINED", "EXPIRED"],
          "ARCHIVED",
          authorization,
        ),
      );
      return viewOf(
        (await repository.readAggregate(agencyId, key, authorization)) ?? aggregate,
        isoDay(nowMs(dependencies)),
      );
    },

    async revokeShareLink(cookieHeader, shareLinkId) {
      const key = requireId(shareLinkId, "Share link");
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        QUOTE_PERMISSION_REQUIREMENTS.SEND,
      );
      assertQuoteWriteOutcome(
        await repository.revokeShareLink(
          asOpaqueId(authorization.session.agencyId),
          key,
          authorization,
        ),
      );
    },

    async convertToTrip(cookieHeader, quoteId) {
      const key = requireId(quoteId, "Quote");
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        QUOTE_PERMISSION_REQUIREMENTS.CONVERT,
      );
      const result = await repository.convertToTrip(
        asOpaqueId(authorization.session.agencyId),
        key,
        authorization,
      );
      if (result.outcome === "NOT_FOUND") throw new QuoteNotFoundError();
      if (result.outcome === "INVALID_STATE") {
        throw new QuoteRuleError("NOT_ACCEPTED", "Só é possível converter um orçamento aceite");
      }
      if (result.tripId === null) throw new Error("Quote conversion returned no trip");
      return { tripId: result.tripId, created: result.created };
    },
  };

  return Object.freeze(operations);
};

export interface PublicQuoteOperations {
  readPublicQuote(
    token: unknown,
    today: string,
  ): Promise<{
    readonly payload: unknown;
    readonly isLatest: boolean;
    readonly state: QuoteState;
    readonly validUntil: string;
    readonly expired: boolean;
    readonly accepted: { readonly name: string; readonly at: string } | null;
  }>;
  acceptPublicQuote(
    token: unknown,
    acceptedName: unknown,
  ): Promise<"ACCEPTED" | "ALREADY_ACCEPTED" | "SUPERSEDED" | "UNAVAILABLE">;
}

/** Token-only access. An unknown, malformed, expired or revoked token is always NOT_FOUND. */
export const createPublicQuoteOperations = (dependencies: {
  readonly repository: Pick<QuoteRepository, "readQuoteShare" | "acceptQuoteShare">;
  readonly shareTokens: ShareTokenCryptoPort;
}): PublicQuoteOperations => {
  const hashOf = (token: unknown): Uint8Array => {
    if (!isShareTokenShape(token)) throw new QuoteNotFoundError();
    const hash = hashPresentedShareToken(dependencies.shareTokens, token);
    if (hash === null) throw new QuoteNotFoundError();
    return hash;
  };
  const operations: PublicQuoteOperations = {
    async readPublicQuote(token: unknown, today: string) {
      const record = await dependencies.repository.readQuoteShare(hashOf(token));
      if (record === null) throw new QuoteNotFoundError();
      return {
        payload: record.payload,
        isLatest: record.isLatest,
        state: record.quoteState,
        validUntil: record.validUntil,
        expired: record.validUntil < today,
        accepted:
          record.acceptance === null
            ? null
            : { name: record.acceptance.acceptedName, at: record.acceptance.acceptedAt },
      };
    },
    async acceptPublicQuote(token: unknown, acceptedName: unknown) {
      const name = validateAcceptedName(acceptedName);
      const outcome = await dependencies.repository.acceptQuoteShare(hashOf(token), name);
      if (
        outcome === "ACCEPTED" ||
        outcome === "ALREADY_ACCEPTED" ||
        outcome === "SUPERSEDED" ||
        outcome === "UNAVAILABLE"
      ) {
        return outcome;
      }
      throw new Error(`Unexpected quote acceptance outcome: ${outcome}`);
    },
  };
  return Object.freeze(operations);
};
