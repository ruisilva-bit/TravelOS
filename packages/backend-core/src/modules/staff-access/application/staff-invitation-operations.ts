import {
  authorizeStaffRequest,
  type StaffAuthorizationOperationProof,
  type StaffAuthorizationSnapshot,
  type StaffSessionAuthorizationProof,
} from "../../../staff-access/authorization.js";
import {
  TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
  type StaffPermissionId,
} from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { TransactionContext } from "../../../application/transaction.js";
import {
  isValidStaffInvitationTokenDigest,
  STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS,
  STAFF_INVITATION_TTL_MS,
  StaffInvitationAcceptanceRejectedError,
  StaffInvitationInvariantError,
  toStaffInvitationMetadata,
  validateStaffInvitationAcceptInput,
  validateStaffInvitationId,
  validateStaffInvitationIssueInput,
  validateStaffInvitationListQuery,
  isValidStaffInvitationToken,
  type StaffInvitationMetadata,
  type StaffInvitationPage,
  type StaffInvitationRecord,
} from "../domain/staff-invitation.js";

export interface StaffInvitationSessionResolver {
  /** Resolves an untrusted cookie with the Staff auth realm; callers never provide identity claims. */
  resolveStaffSession(cookieHeader: string): Promise<unknown>;
}

export interface StaffInvitationAuthorizationRepository {
  getStaffAuthorizationSnapshot(
    staffPrincipalId: string,
    agencyId: OpaqueId,
  ): Promise<StaffAuthorizationSnapshot | null>;
}

export interface StaffIdentityEnrollmentPort {
  enroll(
    context: TransactionContext,
    input: { readonly email: string; readonly name: string; readonly password: string },
  ): Promise<{ readonly staffPrincipalId: string }>;
}

export interface StaffInvitationTokenFactory {
  create(): { readonly token: string; readonly digest: string };
  digest(token: string): string;
}

export interface StaffInvitationRepository {
  /** Atomically transitions due PENDING invitations to EXPIRED, audits each transition once, then lists. */
  listAndExpireDue(input: {
    readonly agencyId: OpaqueId;
    readonly actorStaffPrincipalId: string;
    readonly nowEpochMs: number;
    readonly limit: number;
    readonly cursor: OpaqueId | null;
    readonly authorization: StaffAuthorizationOperationProof;
  }): Promise<StaffInvitationPage>;
  issue(input: {
    readonly agencyId: OpaqueId;
    readonly actorStaffPrincipalId: string;
    readonly targetEmail: string;
    readonly tokenDigest: string;
    readonly roleTemplateKey: typeof TRIP_OPERATIONS_ROLE_TEMPLATE_KEY;
    readonly expiresAtEpochMs: number;
    readonly nowEpochMs: number;
    readonly authorization: StaffAuthorizationOperationProof;
  }): Promise<StaffInvitationRecord>;
  reissue(input: {
    readonly agencyId: OpaqueId;
    readonly invitationId: OpaqueId;
    readonly actorStaffPrincipalId: string;
    readonly tokenDigest: string;
    readonly expiresAtEpochMs: number;
    readonly nowEpochMs: number;
    readonly authorization: StaffAuthorizationOperationProof;
  }): Promise<StaffInvitationRecord>;
  revoke(input: {
    readonly agencyId: OpaqueId;
    readonly invitationId: OpaqueId;
    readonly actorStaffPrincipalId: string;
    readonly nowEpochMs: number;
    readonly authorization: StaffAuthorizationOperationProof;
  }): Promise<StaffInvitationRecord>;
  /** Locks and consumes by digest; identity, membership, role and audit commit with this transaction. */
  accept(
    input: {
      readonly tokenDigest: string;
      readonly name: string;
      readonly password: string;
      readonly nowEpochMs: number;
    },
    enrollment: StaffIdentityEnrollmentPort,
  ): Promise<void>;
}

export interface StaffInvitationOperationsDependencies {
  readonly repository: StaffInvitationRepository;
  readonly authorizationRepository: StaffInvitationAuthorizationRepository;
  readonly sessionResolver: StaffInvitationSessionResolver;
  readonly tokenFactory: StaffInvitationTokenFactory;
  readonly identityEnrollment: StaffIdentityEnrollmentPort;
  readonly nowEpochMs: () => number;
}

export interface StaffInvitationListResponse {
  readonly items: readonly StaffInvitationMetadata[];
  readonly nextCursor: OpaqueId | null;
}

export interface StaffInvitationOneTimeResponse {
  readonly invitation: StaffInvitationMetadata;
  readonly token: string;
}

export interface StaffInvitationOperations {
  list(
    cookieHeader: unknown,
    query: { readonly limit: number; readonly cursor: OpaqueId | null },
  ): Promise<StaffInvitationListResponse>;
  issue(
    cookieHeader: unknown,
    input: { readonly targetEmail: string },
  ): Promise<StaffInvitationOneTimeResponse>;
  reissue(cookieHeader: unknown, invitationId: OpaqueId): Promise<StaffInvitationOneTimeResponse>;
  revoke(cookieHeader: unknown, invitationId: OpaqueId): Promise<StaffInvitationMetadata>;
  accept(input: {
    readonly token: string;
    readonly name: string;
    readonly password: string;
  }): Promise<{ readonly accepted: true }>;
}

export class StaffInvitationAuthorizationError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN";

  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(
      code === "UNAUTHENTICATED"
        ? "Staff authentication is required"
        : "Staff authorization denied",
    );
    this.name = "StaffInvitationAuthorizationError";
    this.code = code;
  }
}

export const STAFF_INVITATION_PERMISSION_REQUIREMENTS = Object.freeze([
  "staff.invite",
] as const satisfies readonly StaffPermissionId[]);

const safeSessionProofFrom = (value: unknown): StaffSessionAuthorizationProof | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).toSorted().join("\u0000");
  const expectedKeys = [
    "agencyId",
    "authorizationEpoch",
    "expiresAtEpochMs",
    "recentMfaVerifiedAtEpochMs",
    "sessionId",
    "staffPrincipalId",
  ]
    .toSorted()
    .join("\u0000");
  if (actualKeys !== expectedKeys) return null;
  if (
    typeof record.sessionId !== "string" ||
    record.sessionId.length === 0 ||
    typeof record.staffPrincipalId !== "string" ||
    record.staffPrincipalId.length === 0 ||
    typeof record.agencyId !== "string" ||
    typeof record.authorizationEpoch !== "bigint" ||
    record.authorizationEpoch < 0n ||
    typeof record.expiresAtEpochMs !== "number" ||
    !Number.isSafeInteger(record.expiresAtEpochMs) ||
    record.expiresAtEpochMs < 0 ||
    (record.recentMfaVerifiedAtEpochMs !== null &&
      (typeof record.recentMfaVerifiedAtEpochMs !== "number" ||
        !Number.isSafeInteger(record.recentMfaVerifiedAtEpochMs) ||
        record.recentMfaVerifiedAtEpochMs < 0))
  ) {
    return null;
  }
  try {
    asOpaqueId(record.agencyId);
  } catch {
    return null;
  }
  return {
    sessionId: record.sessionId,
    staffPrincipalId: record.staffPrincipalId,
    agencyId: record.agencyId,
    authorizationEpoch: record.authorizationEpoch,
    expiresAtEpochMs: record.expiresAtEpochMs,
    recentMfaVerifiedAtEpochMs: record.recentMfaVerifiedAtEpochMs,
  };
};

const cookieFrom = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8_192 ||
    value.includes("\u0000") ||
    /[\r\n]/u.test(value)
  ) {
    throw new StaffInvitationAuthorizationError("UNAUTHENTICATED");
  }
  return value;
};

const nowFrom = (dependencies: StaffInvitationOperationsDependencies): number => {
  const nowEpochMs = dependencies.nowEpochMs();
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    throw new StaffInvitationInvariantError();
  }
  return nowEpochMs;
};

const expiresAtFrom = (nowEpochMs: number): number => {
  const expiresAtEpochMs = nowEpochMs + STAFF_INVITATION_TTL_MS;
  if (!Number.isSafeInteger(expiresAtEpochMs)) throw new StaffInvitationInvariantError();
  return expiresAtEpochMs;
};

const tokenFromFactory = (
  tokenFactory: StaffInvitationTokenFactory,
): { readonly token: string; readonly digest: string } => {
  const generated = tokenFactory.create();
  if (
    !isValidStaffInvitationToken(generated.token) ||
    !isValidStaffInvitationTokenDigest(generated.digest) ||
    tokenFactory.digest(generated.token) !== generated.digest
  ) {
    throw new StaffInvitationInvariantError();
  }
  return generated;
};

const safeMetadataForAgency = (
  record: StaffInvitationRecord,
  expectedAgencyId: OpaqueId,
): StaffInvitationMetadata => {
  let recordAgencyId: OpaqueId;
  try {
    recordAgencyId = asOpaqueId(record.agencyId);
  } catch {
    throw new StaffInvitationInvariantError();
  }
  if (recordAgencyId !== expectedAgencyId) throw new StaffInvitationInvariantError();
  return toStaffInvitationMetadata(record);
};

const safePageCursor = (value: unknown): OpaqueId | null => {
  if (value === null) return null;
  if (typeof value !== "string") throw new StaffInvitationInvariantError();
  try {
    return asOpaqueId(value);
  } catch {
    throw new StaffInvitationInvariantError();
  }
};

const authorizeInvitationManagement = async (
  dependencies: StaffInvitationOperationsDependencies,
  cookieHeader: unknown,
): Promise<StaffAuthorizationOperationProof> => {
  const cookie = cookieFrom(cookieHeader);
  const session = safeSessionProofFrom(
    await dependencies.sessionResolver.resolveStaffSession(cookie),
  );
  if (session === null) throw new StaffInvitationAuthorizationError("UNAUTHENTICATED");
  const agencyId = asOpaqueId(session.agencyId);
  const snapshot = await dependencies.authorizationRepository.getStaffAuthorizationSnapshot(
    session.staffPrincipalId,
    agencyId,
  );
  const nowEpochMs = nowFrom(dependencies);
  const decision = authorizeStaffRequest({
    session,
    snapshot,
    permissionId: "staff.invite",
    target: {
      agencyId,
      organizationUnitAncestorIds: [],
      requiredAccessLevel: "ALL",
    },
    nowEpochMs,
    recentMfaMaximumAgeMs: STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS,
  });
  if (decision.result === "DENY") {
    throw new StaffInvitationAuthorizationError(
      decision.reason === "UNAUTHENTICATED" || decision.reason === "SESSION_EXPIRED"
        ? "UNAUTHENTICATED"
        : "FORBIDDEN",
    );
  }
  return {
    session,
    requiredPermissionIds: STAFF_INVITATION_PERMISSION_REQUIREMENTS,
    nowEpochMs,
  };
};

export const createStaffInvitationOperations = (
  dependencies: StaffInvitationOperationsDependencies,
): StaffInvitationOperations => {
  const operations: StaffInvitationOperations = {
    async list(cookieHeader, queryValue) {
      const query = validateStaffInvitationListQuery(queryValue);
      const authorization = await authorizeInvitationManagement(dependencies, cookieHeader);
      const agencyId = asOpaqueId(authorization.session.agencyId);
      const page = await dependencies.repository.listAndExpireDue({
        agencyId,
        actorStaffPrincipalId: authorization.session.staffPrincipalId,
        nowEpochMs: authorization.nowEpochMs,
        limit: query.limit,
        cursor: query.cursor,
        authorization,
      });
      if (!Array.isArray(page.items) || page.items.length > query.limit) {
        throw new StaffInvitationInvariantError();
      }
      return Object.freeze({
        items: Object.freeze(page.items.map((record) => safeMetadataForAgency(record, agencyId))),
        nextCursor: safePageCursor(page.nextCursor),
      });
    },

    async issue(cookieHeader, inputValue) {
      const input = validateStaffInvitationIssueInput(inputValue);
      const authorization = await authorizeInvitationManagement(dependencies, cookieHeader);
      const nowEpochMs = authorization.nowEpochMs;
      const agencyId = asOpaqueId(authorization.session.agencyId);
      const generated = tokenFromFactory(dependencies.tokenFactory);
      const record = await dependencies.repository.issue({
        agencyId,
        actorStaffPrincipalId: authorization.session.staffPrincipalId,
        targetEmail: input.targetEmail,
        tokenDigest: generated.digest,
        roleTemplateKey: TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
        expiresAtEpochMs: expiresAtFrom(nowEpochMs),
        nowEpochMs,
        authorization,
      });
      if (record.status !== "PENDING" || record.tokenDigest !== generated.digest) {
        throw new StaffInvitationInvariantError();
      }
      return Object.freeze({
        invitation: safeMetadataForAgency(record, agencyId),
        token: generated.token,
      });
    },

    async reissue(cookieHeader, invitationIdValue) {
      const invitationId = validateStaffInvitationId(invitationIdValue);
      const authorization = await authorizeInvitationManagement(dependencies, cookieHeader);
      const nowEpochMs = authorization.nowEpochMs;
      const agencyId = asOpaqueId(authorization.session.agencyId);
      const generated = tokenFromFactory(dependencies.tokenFactory);
      const record = await dependencies.repository.reissue({
        agencyId,
        invitationId,
        actorStaffPrincipalId: authorization.session.staffPrincipalId,
        tokenDigest: generated.digest,
        expiresAtEpochMs: expiresAtFrom(nowEpochMs),
        nowEpochMs,
        authorization,
      });
      if (record.status !== "PENDING" || record.tokenDigest !== generated.digest) {
        throw new StaffInvitationInvariantError();
      }
      return Object.freeze({
        invitation: safeMetadataForAgency(record, agencyId),
        token: generated.token,
      });
    },

    async revoke(cookieHeader, invitationIdValue) {
      const invitationId = validateStaffInvitationId(invitationIdValue);
      const authorization = await authorizeInvitationManagement(dependencies, cookieHeader);
      const agencyId = asOpaqueId(authorization.session.agencyId);
      const record = await dependencies.repository.revoke({
        agencyId,
        invitationId,
        actorStaffPrincipalId: authorization.session.staffPrincipalId,
        nowEpochMs: authorization.nowEpochMs,
        authorization,
      });
      if (record.status !== "REVOKED") throw new StaffInvitationInvariantError();
      return safeMetadataForAgency(record, agencyId);
    },

    async accept(inputValue) {
      const input = validateStaffInvitationAcceptInput(inputValue);
      if (!isValidStaffInvitationToken(input.token)) {
        throw new StaffInvitationAcceptanceRejectedError();
      }
      let tokenDigest: string;
      try {
        tokenDigest = dependencies.tokenFactory.digest(input.token);
      } catch {
        throw new StaffInvitationAcceptanceRejectedError();
      }
      if (!isValidStaffInvitationTokenDigest(tokenDigest)) {
        throw new StaffInvitationAcceptanceRejectedError();
      }
      await dependencies.repository.accept(
        {
          tokenDigest,
          name: input.name,
          password: input.password,
          nowEpochMs: nowFrom(dependencies),
        },
        dependencies.identityEnrollment,
      );
      return { accepted: true };
    },
  };
  return Object.freeze(operations);
};
