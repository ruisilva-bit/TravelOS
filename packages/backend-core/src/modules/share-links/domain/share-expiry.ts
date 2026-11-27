export const SHARE_LINK_DEFAULT_EXPIRY_DAYS = 90;
export const SHARE_LINK_MIN_EXPIRY_DAYS = 1;
export const SHARE_LINK_MAX_EXPIRY_DAYS = 365;

export type ShareLinkState = "ACTIVE" | "EXPIRED" | "REVOKED";

/** Returns the validated validity in days, or null when the value is not acceptable. */
export const resolveShareLinkExpiryDays = (value: unknown): number | null => {
  if (value === undefined) return SHARE_LINK_DEFAULT_EXPIRY_DAYS;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < SHARE_LINK_MIN_EXPIRY_DAYS ||
    value > SHARE_LINK_MAX_EXPIRY_DAYS
  ) {
    return null;
  }
  return value;
};

/** Revocation wins over expiry; a link expires exactly at expiresAt. */
export const computeShareLinkState = (input: {
  readonly nowEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly revokedAtEpochMs: number | null;
}): ShareLinkState => {
  if (input.revokedAtEpochMs !== null) return "REVOKED";
  return input.expiresAtEpochMs > input.nowEpochMs ? "ACTIVE" : "EXPIRED";
};
