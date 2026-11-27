export const CRM_CUSTOMER_ROLES = ["PRIMARY_CONTACT", "TRAVELLER", "PAYER", "GUARDIAN"] as const;
export type CrmCustomerRole = (typeof CRM_CUSTOMER_ROLES)[number];

export const CRM_CUSTOMER_DISPLAY_NAME_MAX_LENGTH = 300;
export const CRM_PERSON_NAME_MAX_LENGTH = 100;
export const CRM_EMAIL_MAX_LENGTH = 254;
export const CRM_PHONE_MAX_LENGTH = 40;
export const CRM_NOTES_MAX_LENGTH = 4_000;
export const CRM_PASSPORT_NUMBER_MAX_LENGTH = 40;

/** Allowed phone characters: digits, spaces, `+`, `(`, `)` and `-`; at least one digit. */
const PHONE_PATTERN = /^[+0-9 ()-]+$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_COUNTRY_PATTERN = /^[A-Z]{2}$/u;

export interface CustomerDetailsDraft {
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
}

export interface PersonDetailsDraft {
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly nationality: string | null;
  readonly notes: string | null;
}

/**
 * Sensitive traveller identity fields. On update an omitted field (`undefined`) keeps the stored
 * value; `null` clears it. Creation never accepts them: they are set through a later update.
 */
export interface PersonSensitiveDraft {
  readonly birthDate?: string | null;
  readonly passportNumber?: string | null;
  readonly passportExpiry?: string | null;
}

export type PersonUpdateDraft = PersonDetailsDraft & PersonSensitiveDraft;

export interface SensitivePersonFields {
  readonly birthDate: string | null;
  readonly passportNumber: string | null;
  readonly passportExpiry: string | null;
}

const requiredText = (value: unknown, label: string, maximumLength: number): string => {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} must not be blank`);
  if (trimmed.length > maximumLength) {
    throw new Error(`${label} must be at most ${maximumLength} characters`);
  }
  return trimmed;
};

const optionalText = (value: unknown, label: string, maximumLength: number): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${label} must be text or null`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maximumLength) {
    throw new Error(`${label} must be at most ${maximumLength} characters`);
  }
  return trimmed;
};

const normalizeEmail = (value: unknown): string | null => {
  const email = optionalText(value, "Email", CRM_EMAIL_MAX_LENGTH);
  if (email !== null && !EMAIL_PATTERN.test(email)) throw new Error("Email is invalid");
  return email;
};

const normalizePhone = (value: unknown): string | null => {
  const phone = optionalText(value, "Phone", CRM_PHONE_MAX_LENGTH);
  if (phone === null) return null;
  if (!PHONE_PATTERN.test(phone) || !/[0-9]/u.test(phone)) {
    throw new Error("Phone may contain only digits, spaces, '+', '(', ')' and '-'");
  }
  return phone;
};

const normalizeNotes = (value: unknown): string | null =>
  optionalText(value, "Notes", CRM_NOTES_MAX_LENGTH);

const normalizeNationality = (value: unknown): string | null => {
  const country = optionalText(value, "Nationality", 64);
  if (country === null) return null;
  const upper = country.toUpperCase();
  if (!ISO_COUNTRY_PATTERN.test(upper)) {
    throw new Error("Nationality must be an ISO 3166-1 alpha-2 country code");
  }
  return upper;
};

/** Returns a calendar date as YYYY-MM-DD, rejecting malformed or impossible dates. */
const normalizeCalendarDate = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${label} must be a date in YYYY-MM-DD form`);
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} is not a real calendar date`);
  }
  return value;
};

const normalizeBirthDate = (value: unknown, today: string): string | null => {
  if (value === null || value === undefined) return null;
  const date = normalizeCalendarDate(value, "Birth date");
  if (date > today) throw new Error("Birth date must not be in the future");
  return date;
};

const normalizePassportExpiry = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return normalizeCalendarDate(value, "Passport expiry");
};

const normalizePassportNumber = (value: unknown): string | null =>
  optionalText(value, "Passport number", CRM_PASSPORT_NUMBER_MAX_LENGTH);

/** Current UTC calendar date as YYYY-MM-DD; injectable for deterministic tests. */
export const utcToday = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export const validateCustomerDetails = (value: unknown): CustomerDetailsDraft => {
  const draft = (value ?? {}) as Record<string, unknown>;
  return {
    displayName: requiredText(
      draft.displayName,
      "Customer display name",
      CRM_CUSTOMER_DISPLAY_NAME_MAX_LENGTH,
    ),
    email: normalizeEmail(draft.email),
    phone: normalizePhone(draft.phone),
    notes: normalizeNotes(draft.notes),
  };
};

/** Validates the non-sensitive person fields; used for creation and by every update. */
export const validatePersonDetails = (value: unknown): PersonDetailsDraft => {
  const draft = (value ?? {}) as Record<string, unknown>;
  return {
    givenName: requiredText(draft.givenName, "Person given name", CRM_PERSON_NAME_MAX_LENGTH),
    familyName: requiredText(draft.familyName, "Person family name", CRM_PERSON_NAME_MAX_LENGTH),
    email: normalizeEmail(draft.email),
    phone: normalizePhone(draft.phone),
    nationality: normalizeNationality(draft.nationality),
    notes: normalizeNotes(draft.notes),
  };
};

/** Validates a full person update. Sensitive keys that are absent stay `undefined` (unchanged). */
export const validatePersonUpdate = (value: unknown, today: string): PersonUpdateDraft => {
  const draft = (value ?? {}) as Record<string, unknown>;
  const details = validatePersonDetails(draft);
  return {
    ...details,
    ...(draft.birthDate === undefined
      ? {}
      : { birthDate: normalizeBirthDate(draft.birthDate, today) }),
    ...(draft.passportNumber === undefined
      ? {}
      : { passportNumber: normalizePassportNumber(draft.passportNumber) }),
    ...(draft.passportExpiry === undefined
      ? {}
      : { passportExpiry: normalizePassportExpiry(draft.passportExpiry) }),
  };
};

export const hasSensitivePersonFields = (draft: PersonSensitiveDraft): boolean =>
  draft.birthDate !== undefined ||
  draft.passportNumber !== undefined ||
  draft.passportExpiry !== undefined;

export const validateCustomerRoles = (value: unknown): readonly CrmCustomerRole[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one customer role is required");
  }
  const seen = new Set<string>();
  for (const role of value) {
    if (!(CRM_CUSTOMER_ROLES as readonly unknown[]).includes(role)) {
      throw new Error("Customer role is invalid");
    }
    if (seen.has(role as string)) throw new Error("Customer roles must not repeat");
    seen.add(role as string);
  }
  return value as readonly CrmCustomerRole[];
};

/** Strips sensitive identity fields unless the caller holds traveller.view_sensitive. */
export const redactSensitivePerson = <Person extends SensitivePersonFields>(
  person: Person,
  canViewSensitive: boolean,
): Person =>
  canViewSensitive
    ? person
    : { ...person, birthDate: null, passportNumber: null, passportExpiry: null };

/** Search text is matched case-insensitively; LIKE wildcards are escaped by the caller. */
export const validateSearchQuery = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Search query must be text");
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 100) {
    throw new Error("Search query must be 2 to 100 characters");
  }
  return trimmed;
};
