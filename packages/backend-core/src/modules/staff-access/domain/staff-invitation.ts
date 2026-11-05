import { TRIP_OPERATIONS_ROLE_TEMPLATE_KEY } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";

export const STAFF_INVITATION_TTL_MS = 60 * 60 * 1_000;
export const STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS = 5 * 60 * 1_000;
export const STAFF_INVITATION_STATUSES = Object.freeze([
  "PENDING",
  "CONSUMED",
  "REVOKED",
  "EXPIRED",
] as const);

export type StaffInvitationStatus = (typeof STAFF_INVITATION_STATUSES)[number];

export interface StaffInvitationRecord {
  readonly invitationId: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly targetEmail: string;
  readonly roleTemplateKey: typeof TRIP_OPERATIONS_ROLE_TEMPLATE_KEY;
  readonly status: StaffInvitationStatus;
  readonly tokenDigest: string;
  readonly createdAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly consumedAtEpochMs: number | null;
  readonly revokedAtEpochMs: number | null;
}

/** Explicit application output allowlist; it deliberately has no Agency, role, or token field. */
export interface StaffInvitationMetadata {
  readonly invitationId: OpaqueId;
  readonly targetEmail: string;
  readonly status: StaffInvitationStatus;
  readonly createdAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly consumedAtEpochMs: number | null;
  readonly revokedAtEpochMs: number | null;
}

export interface StaffInvitationPage {
  readonly items: readonly StaffInvitationRecord[];
  readonly nextCursor: OpaqueId | null;
}

export interface StaffInvitationIssueInput {
  readonly targetEmail: string;
}

export interface StaffInvitationAcceptInput {
  readonly token: string;
  readonly name: string;
  readonly password: string;
}

export interface StaffInvitationListQuery {
  readonly limit: number;
  readonly cursor: OpaqueId | null;
}

export class StaffInvitationInputError extends Error {
  readonly code = "INVALID_INPUT" as const;

  constructor() {
    super("Staff invitation input is invalid");
    this.name = "StaffInvitationInputError";
  }
}

export class StaffInvitationAcceptanceRejectedError extends Error {
  readonly code = "INVALID_OR_EXPIRED" as const;

  constructor() {
    super("Invitation is invalid or expired");
    this.name = "StaffInvitationAcceptanceRejectedError";
  }
}

export class StaffInvitationInvariantError extends Error {
  readonly code = "STAFF_INVITATION_INVARIANT_VIOLATION" as const;

  constructor() {
    super("Staff invitation state is invalid");
    this.name = "StaffInvitationInvariantError";
  }
}

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  Object.keys(value).toSorted().join("\u0000") === expected.toSorted().join("\u0000");

const normalizeEmail = (value: unknown): string => {
  if (typeof value !== "string") throw new StaffInvitationInputError();
  const email = value.trim();
  if (
    email.length === 0 ||
    email.length > 320 ||
    hasControlCharacter(email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    throw new StaffInvitationInputError();
  }
  return email;
};

export const validateStaffInvitationIssueInput = (value: unknown): StaffInvitationIssueInput => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["targetEmail"])) {
    throw new StaffInvitationInputError();
  }
  return { targetEmail: normalizeEmail(value.targetEmail) };
};

export const validateStaffInvitationListQuery = (value: unknown): StaffInvitationListQuery => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["cursor", "limit"])) {
    throw new StaffInvitationInputError();
  }
  if (
    typeof value.limit !== "number" ||
    !Number.isInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > 50
  ) {
    throw new StaffInvitationInputError();
  }
  let cursor: OpaqueId | null;
  if (value.cursor === null) {
    cursor = null;
  } else if (typeof value.cursor === "string") {
    try {
      cursor = asOpaqueId(value.cursor);
    } catch {
      throw new StaffInvitationInputError();
    }
  } else {
    throw new StaffInvitationInputError();
  }
  return { limit: value.limit, cursor };
};

export const validateStaffInvitationId = (value: unknown): OpaqueId => {
  if (typeof value !== "string") throw new StaffInvitationInputError();
  try {
    return asOpaqueId(value);
  } catch {
    throw new StaffInvitationInputError();
  }
};

export const isValidStaffInvitationToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);

export const isValidStaffInvitationTokenDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

export const validateStaffInvitationAcceptInput = (value: unknown): StaffInvitationAcceptInput => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["name", "password", "token"])) {
    throw new StaffInvitationAcceptanceRejectedError();
  }
  if (
    !isValidStaffInvitationToken(value.token) ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.trim().length > 255 ||
    hasControlCharacter(value.name.trim()) ||
    typeof value.password !== "string" ||
    value.password.length === 0 ||
    value.password.length > 1_024
  ) {
    throw new StaffInvitationAcceptanceRejectedError();
  }
  return { token: value.token, name: value.name.trim(), password: value.password };
};

const isSafeEpochMillis = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isValidStatus = (value: unknown): value is StaffInvitationStatus =>
  typeof value === "string" && STAFF_INVITATION_STATUSES.some((status) => status === value);

export const toStaffInvitationMetadata = (
  record: StaffInvitationRecord,
): StaffInvitationMetadata => {
  const validLifecycleTimestamps =
    (record.status === "CONSUMED" &&
      record.consumedAtEpochMs !== null &&
      record.revokedAtEpochMs === null) ||
    (record.status === "REVOKED" &&
      record.revokedAtEpochMs !== null &&
      record.consumedAtEpochMs === null) ||
    ((record.status === "PENDING" || record.status === "EXPIRED") &&
      record.consumedAtEpochMs === null &&
      record.revokedAtEpochMs === null);
  if (
    record.roleTemplateKey !== TRIP_OPERATIONS_ROLE_TEMPLATE_KEY ||
    !isValidStatus(record.status) ||
    !isValidStaffInvitationTokenDigest(record.tokenDigest) ||
    !isSafeEpochMillis(record.createdAtEpochMs) ||
    !isSafeEpochMillis(record.expiresAtEpochMs) ||
    record.expiresAtEpochMs < record.createdAtEpochMs ||
    (record.consumedAtEpochMs !== null && !isSafeEpochMillis(record.consumedAtEpochMs)) ||
    (record.revokedAtEpochMs !== null && !isSafeEpochMillis(record.revokedAtEpochMs)) ||
    !validLifecycleTimestamps
  ) {
    throw new StaffInvitationInvariantError();
  }
  let targetEmail: string;
  try {
    targetEmail = normalizeEmail(record.targetEmail);
  } catch {
    throw new StaffInvitationInvariantError();
  }
  let invitationId: OpaqueId;
  try {
    invitationId = asOpaqueId(record.invitationId);
  } catch {
    throw new StaffInvitationInvariantError();
  }
  return Object.freeze({
    invitationId,
    targetEmail,
    status: record.status,
    createdAtEpochMs: record.createdAtEpochMs,
    expiresAtEpochMs: record.expiresAtEpochMs,
    consumedAtEpochMs: record.consumedAtEpochMs,
    revokedAtEpochMs: record.revokedAtEpochMs,
  });
};
