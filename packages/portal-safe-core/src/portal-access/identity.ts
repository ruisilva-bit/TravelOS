export interface PortalPrincipalIdentity {
  readonly portalSessionId: string;
  readonly portalPrincipalId: string;
  readonly agencyId: string;
  readonly authorizationEpoch: bigint;
  readonly expiresAtEpochMs: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

const recordFromUnknown = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const portalPrincipalIdentityFromSession = (
  session: unknown,
): PortalPrincipalIdentity | null => {
  const record = recordFromUnknown(session);
  if (
    record === null ||
    record.realm !== "PORTAL" ||
    !nonEmptyString(record.sessionId) ||
    !nonEmptyString(record.principalId) ||
    typeof record.agencyId !== "string" ||
    !UUID_PATTERN.test(record.agencyId) ||
    typeof record.authorizationEpoch !== "bigint" ||
    record.authorizationEpoch < 1n ||
    typeof record.expiresAtEpochMs !== "number" ||
    !Number.isSafeInteger(record.expiresAtEpochMs) ||
    record.expiresAtEpochMs <= 0
  ) {
    return null;
  }

  return {
    portalSessionId: record.sessionId,
    portalPrincipalId: record.principalId,
    agencyId: record.agencyId,
    authorizationEpoch: record.authorizationEpoch,
    expiresAtEpochMs: record.expiresAtEpochMs,
  };
};
