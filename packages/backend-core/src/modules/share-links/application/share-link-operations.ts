import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "../../trip-operations/application/staff-trip-operations.js";
import {
  computeShareLinkState,
  resolveShareLinkExpiryDays,
  type ShareLinkState,
} from "../domain/share-expiry.js";
import {
  generateShareToken,
  hashPresentedShareToken,
  type ShareTokenCryptoPort,
} from "../domain/share-token.js";
import type { TripSnapshotV1 } from "../../customer-presentation/domain/snapshot-v1.js";

export class ShareLinkInputError extends Error {
  readonly code = "INVALID_SHARE_LINK_REQUEST" as const;

  constructor() {
    super("The share link request is invalid");
    this.name = "ShareLinkInputError";
  }
}

export class ShareLinkNotFoundError extends Error {
  readonly code = "SHARE_LINK_NOT_FOUND" as const;

  constructor() {
    super("Share link was not found");
    this.name = "ShareLinkNotFoundError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT" as const;

  constructor() {
    super("The idempotency key was already used; a share link token is shown only once");
    this.name = "IdempotencyConflictError";
  }
}

export interface CreateShareLinkRequest {
  readonly expiresInDays: number;
  readonly idempotencyKey: string;
}

export interface CreatedShareLinkRecord {
  readonly shareLinkId: OpaqueId;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ShareLinkRow {
  readonly shareLinkId: OpaqueId;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdBy: string;
}

export interface StaffShareLinkRepository {
  /** Builds the snapshot, inserts version + snapshot + share link in one transaction. */
  createShareLink(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    request: CreateShareLinkRequest,
    tokenHash: Uint8Array,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CreatedShareLinkRecord>;
  listShareLinks(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<readonly ShareLinkRow[]>;
  /** Idempotent. Throws ShareLinkNotFoundError for an unknown link or another agency's link. */
  revokeShareLink(
    agencyId: OpaqueId,
    shareLinkId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<void>;
}

export interface ShareLinkSummary {
  readonly shareLinkId: OpaqueId;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly state: ShareLinkState;
  readonly createdBy: string;
}

export interface CreatedShareLink {
  readonly shareLinkId: OpaqueId;
  /** Returned only here; never stored and never listed again. */
  readonly token: string;
  readonly url: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface StaffShareLinkOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: StaffShareLinkRepository;
  readonly crypto: ShareTokenCryptoPort;
  /** Canonical origin without trailing slash, for example https://admin.example.test */
  readonly publicOrigin: string;
}

export interface StaffShareLinkOperations {
  createShareLink(
    cookieHeader: unknown,
    tripId: unknown,
    request: unknown,
  ): Promise<CreatedShareLink>;
  listShareLinks(cookieHeader: unknown, tripId: unknown): Promise<readonly ShareLinkSummary[]>;
  revokeShareLink(cookieHeader: unknown, shareLinkId: unknown): Promise<void>;
}

const CREATE_PERMISSIONS = Object.freeze([
  "trip.view",
  "trip.publish",
] as const satisfies readonly StaffPermissionId[]);
const LIST_PERMISSIONS = Object.freeze([
  "trip.view",
  "trip.preview",
] as const satisfies readonly StaffPermissionId[]);
const REVOKE_PERMISSIONS = Object.freeze([
  "trip.view",
  "trip.publish",
] as const satisfies readonly StaffPermissionId[]);
const RECENT_MFA_MAXIMUM_AGE_MS = 5 * 60 * 1_000;

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

const parseId = (value: unknown): OpaqueId => {
  if (typeof value !== "string") throw new ShareLinkInputError();
  try {
    return asOpaqueId(value);
  } catch {
    throw new ShareLinkInputError();
  }
};

const parseCreateRequest = (value: unknown): CreateShareLinkRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ShareLinkInputError();
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => key !== "expiresInDays" && key !== "idempotencyKey")) {
    throw new ShareLinkInputError();
  }
  const expiresInDays = resolveShareLinkExpiryDays(request.expiresInDays);
  const idempotencyKey = request.idempotencyKey;
  if (
    expiresInDays === null ||
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 128 ||
    containsControlCharacter(idempotencyKey)
  ) {
    throw new ShareLinkInputError();
  }
  return { expiresInDays, idempotencyKey };
};

export const createStaffShareLinkOperations = (
  dependencies: StaffShareLinkOperationsDependencies,
): StaffShareLinkOperations => {
  const origin = dependencies.publicOrigin.replace(/\/+$/u, "");
  const operations: StaffShareLinkOperations = {
    async createShareLink(cookieHeader, tripIdValue, requestValue) {
      const tripId = parseId(tripIdValue);
      const request = parseCreateRequest(requestValue);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        CREATE_PERMISSIONS,
        RECENT_MFA_MAXIMUM_AGE_MS,
      );
      const generated = generateShareToken(dependencies.crypto);
      const created = await dependencies.repository.createShareLink(
        asOpaqueId(authorization.session.agencyId),
        tripId,
        request,
        generated.tokenHash,
        authorization,
      );
      return {
        shareLinkId: created.shareLinkId,
        token: generated.token,
        url: `${origin}/v/${generated.token}`,
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
      };
    },

    async listShareLinks(cookieHeader, tripIdValue) {
      const tripId = parseId(tripIdValue);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        LIST_PERMISSIONS,
      );
      const rows = await dependencies.repository.listShareLinks(
        asOpaqueId(authorization.session.agencyId),
        tripId,
        authorization,
      );
      const nowEpochMs = (dependencies.nowEpochMs ?? Date.now)();
      // Explicit field copy: nothing but the allowlisted summary can leave this function.
      return rows.map((row) => ({
        shareLinkId: row.shareLinkId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        state: computeShareLinkState({
          nowEpochMs,
          expiresAtEpochMs: Date.parse(row.expiresAt),
          revokedAtEpochMs: row.revokedAt === null ? null : Date.parse(row.revokedAt),
        }),
        createdBy: row.createdBy,
      }));
    },

    async revokeShareLink(cookieHeader, shareLinkIdValue) {
      const shareLinkId = parseId(shareLinkIdValue);
      // Revocation is a safety action: it needs the publish permission but not recent MFA.
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        REVOKE_PERMISSIONS,
      );
      await dependencies.repository.revokeShareLink(
        asOpaqueId(authorization.session.agencyId),
        shareLinkId,
        authorization,
      );
    },
  };
  return Object.freeze(operations);
};

/** Reads the frozen payload for a token hash; unknown, revoked and expired links return null. */
export interface PublicShareReaderPort {
  readByTokenHash(tokenHash: Uint8Array): Promise<{ readonly canonicalPayload: string } | null>;
}

export type PublicShareFailure = "READER_ERROR" | "INVALID_PAYLOAD";

export interface PublicShareOperationsDependencies {
  readonly reader: PublicShareReaderPort;
  readonly crypto: Pick<ShareTokenCryptoPort, "sha256">;
  /** Strict customer-allowlist parser; must throw on any unknown or missing field. */
  readonly parseSnapshot: (value: unknown) => TripSnapshotV1;
  /** Internal diagnostics hook. Receives a failure kind only, never the token or payload. */
  readonly onFailure?: (failure: PublicShareFailure) => void;
}

export interface PublicShareOperations {
  /** Throws ShareLinkNotFoundError for every failure; callers must not distinguish causes. */
  readPublicShare(token: unknown): Promise<TripSnapshotV1>;
}

export const createPublicShareOperations = (
  dependencies: PublicShareOperationsDependencies,
): PublicShareOperations =>
  Object.freeze({
    async readPublicShare(token: unknown): Promise<TripSnapshotV1> {
      const tokenHash = hashPresentedShareToken(dependencies.crypto, token);
      if (tokenHash === null) throw new ShareLinkNotFoundError();
      let record: { readonly canonicalPayload: string } | null;
      try {
        record = await dependencies.reader.readByTokenHash(tokenHash);
      } catch {
        dependencies.onFailure?.("READER_ERROR");
        throw new ShareLinkNotFoundError();
      }
      if (record === null) throw new ShareLinkNotFoundError();
      try {
        return dependencies.parseSnapshot(JSON.parse(record.canonicalPayload) as unknown);
      } catch {
        dependencies.onFailure?.("INVALID_PAYLOAD");
        throw new ShareLinkNotFoundError();
      }
    },
  });
