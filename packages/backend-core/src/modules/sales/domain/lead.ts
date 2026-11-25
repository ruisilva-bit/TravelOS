import type { OpaqueId } from "../../../shared-kernel/opaque-id.js";
import {
  validateCustomerDraft,
  validatePersonDraft,
  type CustomerDraft,
  type PersonDraft,
} from "../../crm/domain/continuity.js";

export const LEAD_SOURCES = ["WEBSITE", "PHONE", "EMAIL", "REFERRAL", "WALK_IN", "OTHER"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATES = ["OPEN", "QUALIFIED", "DISQUALIFIED"] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export const LEAD_DISQUALIFICATION_REASONS = [
  "NO_RESPONSE",
  "NOT_INTERESTED",
  "NOT_SERVICEABLE",
  "DUPLICATE",
  "OTHER",
] as const;
export type LeadDisqualificationReason = (typeof LEAD_DISQUALIFICATION_REASONS)[number];

export const LEAD_CONTACT_NAME_MAX_LENGTH = 200;
export const LEAD_CONTACT_EMAIL_MAX_LENGTH = 320;
export const LEAD_CONTACT_PHONE_MAX_LENGTH = 40;
export const LEAD_INTERNAL_NOTE_MAX_LENGTH = 4_000;
export const CUSTOMER_DISPLAY_NAME_MAX_LENGTH = 300;

/** Contact snapshot and classification captured when the Lead was recorded. */
export interface LeadDraft {
  readonly source: LeadSource;
  readonly contactGivenName: string;
  readonly contactFamilyName: string;
  /** CONFIDENTIAL_PERSONAL. Never used to find or link a Person or Customer. */
  readonly contactEmail: string | null;
  /** CONFIDENTIAL_PERSONAL. */
  readonly contactPhone: string | null;
  /** INTERNAL_ONLY. No Portal contract or source field exists for it. */
  readonly internalNote: string | null;
}

export interface Lead extends LeadDraft {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly state: LeadState;
  readonly qualifiedCustomerId: OpaqueId | null;
  readonly disqualificationReason: LeadDisqualificationReason | null;
  readonly lockVersion: bigint;
  /** RFC 3339 UTC instants with millisecond precision. */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
}

export type LeadQualificationMode =
  | { readonly kind: "CREATE_CUSTOMER"; readonly customerDisplayName: string | null }
  | { readonly kind: "LINK_CUSTOMER"; readonly customerId: OpaqueId };

/** Typed domain failure for any command issued against a Lead that already left `OPEN`. */
export class LeadNotOpenError extends Error {
  readonly code = "LEAD_NOT_OPEN" as const;

  constructor() {
    super("The Lead is no longer open");
    this.name = "LeadNotOpenError";
  }
}

const PHONE_PATTERN = /^[0-9 +()-]+(?![\s\S])/u;

const requireText = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} must not be blank`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds its maximum length`);
  return normalized;
};

const nullableText = (value: unknown, label: string, maxLength: number): string | null => {
  if (value === null) return null;
  return requireText(value, label, maxLength);
};

/** Validates and normalizes a Lead draft. Throws a plain `Error` describing the first violation. */
export const validateLeadDraft = (draft: LeadDraft): LeadDraft => {
  if (!(LEAD_SOURCES as readonly unknown[]).includes(draft.source)) {
    throw new Error("Lead source is invalid");
  }
  const contactGivenName = requireText(
    draft.contactGivenName,
    "Lead contact given name",
    LEAD_CONTACT_NAME_MAX_LENGTH,
  );
  const contactFamilyName = requireText(
    draft.contactFamilyName,
    "Lead contact family name",
    LEAD_CONTACT_NAME_MAX_LENGTH,
  );
  const contactEmail = nullableText(
    draft.contactEmail,
    "Lead contact email",
    LEAD_CONTACT_EMAIL_MAX_LENGTH,
  );
  validatePersonDraft({
    givenName: contactGivenName,
    familyName: contactFamilyName,
    email: contactEmail,
  });
  const contactPhone = nullableText(
    draft.contactPhone,
    "Lead contact phone",
    LEAD_CONTACT_PHONE_MAX_LENGTH,
  );
  if (contactPhone !== null && !PHONE_PATTERN.test(contactPhone)) {
    throw new Error("Lead contact phone is invalid");
  }
  const internalNote = nullableText(
    draft.internalNote,
    "Lead internal note",
    LEAD_INTERNAL_NOTE_MAX_LENGTH,
  );
  return {
    source: draft.source,
    contactGivenName,
    contactFamilyName,
    contactEmail,
    contactPhone,
    internalNote,
  };
};

export const validateDisqualificationReason = (value: unknown): LeadDisqualificationReason => {
  if (!(LEAD_DISQUALIFICATION_REASONS as readonly unknown[]).includes(value)) {
    throw new Error("Lead disqualification reason is invalid");
  }
  return value as LeadDisqualificationReason;
};

export const assertLeadOpen = (lead: Pick<Lead, "state">): void => {
  if (lead.state !== "OPEN") throw new LeadNotOpenError();
};

export interface NewLeadInput {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly draft: LeadDraft;
  readonly nowInstant: string;
}

/** A new Lead always starts `OPEN` at lock version 1. */
export const openLead = (input: NewLeadInput): Lead => ({
  ...validateLeadDraft(input.draft),
  id: input.id,
  agencyId: input.agencyId,
  state: "OPEN",
  qualifiedCustomerId: null,
  disqualificationReason: null,
  lockVersion: 1n,
  createdAt: input.nowInstant,
  updatedAt: input.nowInstant,
  closedAt: null,
});

/** `OPEN --update--> OPEN`. */
export const updateOpenLead = (lead: Lead, draft: LeadDraft, nowInstant: string): Lead => {
  assertLeadOpen(lead);
  return {
    ...lead,
    ...validateLeadDraft(draft),
    lockVersion: lead.lockVersion + 1n,
    updatedAt: nowInstant,
  };
};

/** `OPEN --qualify--> QUALIFIED` (terminal). The Customer is created or chosen by the caller. */
export const qualifyOpenLead = (lead: Lead, customerId: OpaqueId, nowInstant: string): Lead => {
  assertLeadOpen(lead);
  return {
    ...lead,
    state: "QUALIFIED",
    qualifiedCustomerId: customerId,
    lockVersion: lead.lockVersion + 1n,
    updatedAt: nowInstant,
    closedAt: nowInstant,
  };
};

/** `OPEN --disqualify--> DISQUALIFIED` (terminal). */
export const disqualifyOpenLead = (
  lead: Lead,
  reason: LeadDisqualificationReason,
  nowInstant: string,
): Lead => {
  assertLeadOpen(lead);
  return {
    ...lead,
    state: "DISQUALIFIED",
    disqualificationReason: validateDisqualificationReason(reason),
    lockVersion: lead.lockVersion + 1n,
    updatedAt: nowInstant,
    closedAt: nowInstant,
  };
};

/** Person created from the contact snapshot; the email is copied, never matched against existing Persons. */
export const personDraftFromLead = (lead: Pick<Lead, keyof LeadDraft>): PersonDraft => {
  const draft: PersonDraft = {
    givenName: lead.contactGivenName,
    familyName: lead.contactFamilyName,
    email: lead.contactEmail,
  };
  validatePersonDraft(draft);
  return draft;
};

export const validateCustomerDisplayName = (value: unknown): string =>
  requireText(value, "Customer display name", CUSTOMER_DISPLAY_NAME_MAX_LENGTH);

/** Customer display name defaults to `"<given> <family>"` unless the caller provided one. */
export const customerDraftFromLead = (
  lead: Pick<Lead, "contactGivenName" | "contactFamilyName">,
  providedDisplayName: string | null,
): CustomerDraft => {
  const draft: CustomerDraft = {
    displayName: validateCustomerDisplayName(
      providedDisplayName === null
        ? `${lead.contactGivenName} ${lead.contactFamilyName}`
        : providedDisplayName,
    ),
  };
  validateCustomerDraft(draft);
  return draft;
};
