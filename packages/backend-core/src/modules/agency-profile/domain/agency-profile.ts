// Agency profile: the name and contact details customers see on quote proposals. Plain text is
// validated here; the database CHECK constraints repeat the same limits.

import { InputValidationError } from "../../trip-operations/application/trip-slice.js";

export const AGENCY_DISPLAY_NAME_MAXIMUM_LENGTH = 120;
export const AGENCY_CONTACT_MAXIMUM_LENGTH = 254;
export const AGENCY_PHONE_MAXIMUM_LENGTH = 40;
export const AGENCY_WEBSITE_MAXIMUM_LENGTH = 300;

export interface AgencyProfile {
  readonly agencyId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly lockVersion: bigint;
}

export interface AgencyProfileDraft {
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly website: string | null;
}

/** Customer-facing contact fields; absent values are omitted from a proposal rather than blank. */
export interface AgencyContactProfile {
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly website?: string;
}

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const PHONE = /^\+?[0-9 ()./-]+$/u;
const HTTPS_WEBSITE = /^https:\/\/[^\s/?#]+(?:[/?#]\S*)?$/u;

const requireObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputValidationError("Agency profile must be an object");
  }
  return value as Record<string, unknown>;
};

const optionalText = (
  value: unknown,
  label: string,
  maximum: number,
  pattern: RegExp | null,
): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new InputValidationError(`${label} is invalid`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maximum || hasControlCharacter(trimmed)) {
    throw new InputValidationError(`${label} is invalid`);
  }
  if (pattern !== null && !pattern.test(trimmed)) {
    throw new InputValidationError(`${label} is invalid`);
  }
  return trimmed;
};

const validWebsite = (value: string | null): string | null => {
  if (value === null) return null;
  if (!value.startsWith("https://")) {
    throw new InputValidationError("Agency website must use https");
  }
  if (!HTTPS_WEBSITE.test(value)) throw new InputValidationError("Agency website is invalid");
  return value;
};

/** Validates and normalises an incoming profile; blank optional fields become null. */
export const validateAgencyProfileDraft = (input: unknown): AgencyProfileDraft => {
  const body = requireObject(input);
  const displayName = optionalText(
    body["displayName"],
    "Agency display name",
    AGENCY_DISPLAY_NAME_MAXIMUM_LENGTH,
    null,
  );
  if (displayName === null) {
    throw new InputValidationError("Agency display name is required");
  }
  const email = optionalText(body["email"], "Agency email", AGENCY_CONTACT_MAXIMUM_LENGTH, EMAIL);
  return {
    displayName,
    email,
    phone: optionalText(body["phone"], "Agency phone", AGENCY_PHONE_MAXIMUM_LENGTH, PHONE),
    website: validWebsite(
      optionalText(body["website"], "Agency website", AGENCY_WEBSITE_MAXIMUM_LENGTH, null),
    ),
  };
};

/** Projects a stored profile onto the customer-facing contact fields. */
export const agencyContactProfile = (profile: AgencyProfile): AgencyContactProfile => ({
  displayName: profile.displayName,
  ...(profile.email === null ? {} : { email: profile.email }),
  ...(profile.phone === null ? {} : { phone: profile.phone }),
  ...(profile.website === null ? {} : { website: profile.website }),
});
