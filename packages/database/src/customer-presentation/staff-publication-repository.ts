import { createHash } from "node:crypto";
import {
  asOpaqueId,
  authorizeStaffRequest,
  buildTripPublicationCandidateFromSources,
  canonicalPortalTripSnapshotV1Json,
  IdempotencyConflictError,
  StaffAuthorizationError,
  StaffPublicationInputError,
  TransactionConflictError,
  isStaffPermissionId,
  StalePublicationCandidateError,
  TripPublicationNotFoundError,
  type StaffTripPublicationRepository,
  type PortalTripSnapshotHashPort,
  type PortalTripSnapshotValidatorPort,
  type PublicationHistoryEntry,
  type PublishTripRequest,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
  type TripPublicationCandidate,
  type TripPublicationResult,
  type WithdrawActivePublicationRequest,
} from "@travelos/backend-core";
import { sql, type Kysely, type Transaction as KyselyTransaction } from "kysely";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { readStaffAuthorizationSnapshot } from "../staff-access/staff-access-repository.js";
import { assertStaffAuthorizationInTransaction } from "../trip-operations/operational-slice-repository.js";
import { createUuidV7 } from "../uuidv7.js";
import { bindEventCorrelation } from "../job-runtime/event-context.js";
import { publicationReaders } from "./publication-source-repository.js";

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

type DatabaseShape = Record<string, never>;
type Database = Kysely<DatabaseShape>;
type Transaction = KyselyTransaction<DatabaseShape>;

const PREVIEW_PERMISSIONS = [
  "trip.view",
  "trip.preview",
] as const satisfies readonly StaffPermissionId[];
const PUBLISH_PERMISSIONS = [
  "trip.view",
  "trip.publish",
] as const satisfies readonly StaffPermissionId[];
const WITHDRAW_PERMISSIONS = [
  "trip.view",
  "trip.withdraw_publication",
] as const satisfies readonly StaffPermissionId[];
const RECENT_MFA_MAXIMUM_AGE_MS = 5 * 60 * 1_000;
const MAX_SERIALIZATION_ATTEMPTS = 3;

const postgresCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

const postgresConstraint = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("constraint" in error)) return null;
  const constraint = (error as { readonly constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : null;
};

const requestHash = (tripId: string, request: PublishTripRequest): string =>
  createHash("sha256")
    .update(
      `${tripId}\u0000${request.expectedWorkspaceRevision.toString()}\u0000${request.expectedProjectionHash}`,
      "utf8",
    )
    .digest("hex");

const withdrawalRequestHash = (tripId: string, request: WithdrawActivePublicationRequest): string =>
  createHash("sha256")
    .update(JSON.stringify(["trip.withdraw_publication", tripId, request.reason]), "utf8")
    .digest("hex");

const asHistoryEntry = (row: {
  readonly version: number;
  readonly publishedAt: Date;
  readonly actorReference: string;
  readonly schemaVersion: number;
  readonly projectionHash: string;
  readonly isActive: boolean;
}): PublicationHistoryEntry => ({
  version: row.version,
  publishedAt: row.publishedAt.toISOString(),
  actorReference: row.actorReference,
  schemaVersion: 1,
  projectionHash: row.projectionHash.trim(),
  isActive: row.isActive,
});

const readPublication = async (
  database: Database,
  hasher: PortalTripSnapshotHashPort,
  validator: PortalTripSnapshotValidatorPort,
  agencyId: string,
  tripId: string,
  publicationId: string,
): Promise<TripPublicationResult> => {
  const row = (
    await sql<{
      readonly publicationId: string;
      readonly tripId: string;
      readonly version: number;
      readonly publishedAt: Date;
      readonly schemaVersion: number;
      readonly projectionHash: string;
      readonly canonicalPayload: string;
      readonly isActive: boolean;
    }>`
      SELECT version."publicationId"::text AS "publicationId",
             version."tripId"::text AS "tripId",
             version."version" AS "version",
             version."publishedAt" AS "publishedAt",
             version."schemaVersion" AS "schemaVersion",
             version."projectionHash" AS "projectionHash",
             snapshot."canonicalPayload" AS "canonicalPayload",
             COALESCE(pointer."activePublicationId" = version."publicationId", false) AS "isActive"
        FROM "trip_ops"."publication_version" AS version
        JOIN "trip_ops"."publication_snapshot" AS snapshot
          ON snapshot."publicationId" = version."publicationId"
         AND snapshot."agencyId" = version."agencyId"
         AND snapshot."tripId" = version."tripId"
        LEFT JOIN "trip_ops"."publication_pointer" AS pointer
          ON pointer."agencyId" = version."agencyId" AND pointer."tripId" = version."tripId"
       WHERE version."agencyId" = ${agencyId}::uuid
         AND version."tripId" = ${tripId}::uuid
         AND version."publicationId" = ${publicationId}::uuid
    `.execute(database)
  ).rows[0];
  if (row === undefined) throw new TripPublicationNotFoundError();
  const canonicalPayload = row.canonicalPayload;
  const actualHash = await hasher.sha256(canonicalPayload);
  if (actualHash !== row.projectionHash.trim()) {
    throw new Error("Stored publication snapshot hash does not match its immutable metadata");
  }
  let projection: unknown;
  try {
    projection = JSON.parse(canonicalPayload) as unknown;
  } catch {
    throw new Error("Stored publication snapshot is not valid JSON");
  }
  validator.validate(projection);
  if (canonicalPortalTripSnapshotV1Json(projection) !== canonicalPayload) {
    throw new Error("Stored publication snapshot is not canonical JSON");
  }
  if (row.schemaVersion !== 1) throw new Error("Unsupported stored publication schema version");
  return {
    publicationId: asOpaqueId(row.publicationId),
    tripId: asOpaqueId(row.tripId),
    version: row.version,
    publishedAt: row.publishedAt.toISOString(),
    schemaVersion: 1,
    projectionHash: actualHash,
    isActive: row.isActive,
    projection: projection as TripPublicationCandidate["projection"],
  };
};

const throwIfConflictingIdempotencyRequest = (
  existing: { readonly requestHash: string },
  expectedHash: string,
): void => {
  if (existing.requestHash.trim() !== expectedHash) throw new IdempotencyConflictError();
};

const assertStaffAuthorizationReadOnly = async (
  database: Database,
  authorization: StaffAuthorizationOperationProof,
  targetAgencyId: string,
  requiredPermissionIds: readonly StaffPermissionId[],
): Promise<void> => {
  const session = authorization?.session;
  if (
    typeof session !== "object" ||
    session === null ||
    typeof session.sessionId !== "string" ||
    typeof session.staffPrincipalId !== "string" ||
    typeof session.agencyId !== "string" ||
    typeof session.authorizationEpoch !== "bigint" ||
    !Number.isSafeInteger(authorization.nowEpochMs) ||
    authorization.nowEpochMs < 0 ||
    !Array.isArray(authorization.requiredPermissionIds) ||
    !authorization.requiredPermissionIds.every(isStaffPermissionId)
  ) {
    throw new StaffAuthorizationError("UNAUTHENTICATED");
  }
  const suppliedPermissions = new Set(authorization.requiredPermissionIds);
  if (
    suppliedPermissions.size !== requiredPermissionIds.length ||
    requiredPermissionIds.some((permissionId) => !suppliedPermissions.has(permissionId))
  ) {
    throw new StaffAuthorizationError("FORBIDDEN");
  }
  if (session.agencyId !== targetAgencyId) throw new StaffAuthorizationError("FORBIDDEN");
  const liveSession = (
    await sql<{
      readonly agencyId: string;
      readonly staffPrincipalId: string;
      readonly authorizationEpoch: string;
      readonly expiresAtEpochMs: number;
      readonly recentMfaVerifiedAtEpochMs: number | null;
      readonly databaseNowEpochMs: number;
    }>`
      WITH request_time AS (SELECT statement_timestamp() AS "now")
      SELECT context."agencyId"::text AS "agencyId",
             active_session."userId" AS "staffPrincipalId",
             context."authorizationEpoch"::text AS "authorizationEpoch",
             (EXTRACT(EPOCH FROM active_session."expiresAt") * 1000)::double precision AS "expiresAtEpochMs",
             (EXTRACT(EPOCH FROM context."recentMfaVerifiedAt") * 1000)::double precision AS "recentMfaVerifiedAtEpochMs",
             (EXTRACT(EPOCH FROM request_time."now") * 1000)::double precision AS "databaseNowEpochMs"
        FROM "staff_access"."staff_session" AS active_session
        CROSS JOIN request_time
        JOIN "staff_access"."staff_session_context" AS context
          ON context."sessionId" = active_session."id"
         AND context."staffPrincipalId" = active_session."userId"
       WHERE active_session."id" = ${session.sessionId}
         AND active_session."userId" = ${session.staffPrincipalId}
         AND active_session."expiresAt" > request_time."now"
         AND context."agencyId" = ${targetAgencyId}::uuid
         AND context."authorizationEpoch" = ${session.authorizationEpoch}
    `.execute(database)
  ).rows[0];
  if (liveSession === undefined) throw new StaffAuthorizationError("UNAUTHENTICATED");
  const currentSession = {
    sessionId: session.sessionId,
    staffPrincipalId: liveSession.staffPrincipalId,
    agencyId: liveSession.agencyId,
    authorizationEpoch: BigInt(liveSession.authorizationEpoch),
    expiresAtEpochMs: liveSession.expiresAtEpochMs,
    recentMfaVerifiedAtEpochMs: liveSession.recentMfaVerifiedAtEpochMs,
  };
  const snapshot = await readStaffAuthorizationSnapshot(
    database,
    currentSession.staffPrincipalId,
    currentSession.agencyId,
  );
  if (snapshot === null) throw new StaffAuthorizationError("FORBIDDEN");
  for (const permissionId of requiredPermissionIds) {
    const decision = authorizeStaffRequest({
      session: currentSession,
      snapshot,
      permissionId,
      target: {
        agencyId: targetAgencyId,
        organizationUnitAncestorIds: [],
        requiredAccessLevel: "ALL",
      },
      nowEpochMs: liveSession.databaseNowEpochMs,
      recentMfaMaximumAgeMs: null,
    });
    if (decision.result === "DENY") throw new StaffAuthorizationError("FORBIDDEN");
  }
};

const loadExistingIdempotentResult = async (
  database: Database,
  hasher: PortalTripSnapshotHashPort,
  validator: PortalTripSnapshotValidatorPort,
  agencyId: string,
  staffPrincipalId: string,
  tripId: string,
  request: PublishTripRequest,
): Promise<TripPublicationResult | null> => {
  const existing = (
    await sql<{
      readonly tripId: string;
      readonly publicationId: string;
      readonly requestHash: string;
    }>`
      SELECT "tripId"::text AS "tripId", "publicationId"::text AS "publicationId",
             "requestHash" AS "requestHash"
        FROM "trip_ops"."publication_idempotency"
       WHERE "agencyId" = ${agencyId}::uuid
         AND "staffPrincipalId" = ${staffPrincipalId}
         AND "command" = 'trip.publish'
         AND "idempotencyKey" = ${request.idempotencyKey}
    `.execute(database)
  ).rows[0];
  if (existing === undefined) return null;
  throwIfConflictingIdempotencyRequest(existing, requestHash(tripId, request));
  if (existing.tripId !== tripId) throw new IdempotencyConflictError();
  return readPublication(database, hasher, validator, agencyId, tripId, existing.publicationId);
};

export const createPostgresStaffTripPublicationRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
  hasher: PortalTripSnapshotHashPort,
  validator: PortalTripSnapshotValidatorPort,
): StaffTripPublicationRepository => {
  const readOnly = <Result>(work: (database: Transaction) => Promise<Result>): Promise<Result> =>
    persistence.withConnection((database) =>
      database
        .transaction()
        .setIsolationLevel("repeatable read")
        .setAccessMode("read only")
        .execute(work),
    );

  const serializable = async <Result>(
    work: (database: Transaction) => Promise<Result>,
  ): Promise<Result> => {
    for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        return await persistence.withConnection((database) =>
          database.transaction().setIsolationLevel("serializable").execute(work),
        );
      } catch (error) {
        const code = postgresCode(error);
        const retryable = code === "40001" || code === "40P01";
        const idempotencyRace =
          code === "23505" &&
          ["publication_idempotency_pkey", "publication_withdrawal_idempotency_pkey"].includes(
            postgresConstraint(error) ?? "",
          );
        if ((!retryable && !idempotencyRace) || attempt === MAX_SERIALIZATION_ATTEMPTS) {
          if (retryable || idempotencyRace) throw new TransactionConflictError();
          throw error;
        }
      }
    }
    throw new TransactionConflictError();
  };

  const repository: StaffTripPublicationRepository = {
    previewTrip(agencyId, tripId, authorization) {
      return readOnly(async (database) => {
        await assertStaffAuthorizationReadOnly(
          database,
          authorization,
          agencyId,
          PREVIEW_PERMISSIONS,
        );
        return buildTripPublicationCandidateFromSources(
          publicationReaders(database),
          hasher,
          validator,
          agencyId,
          tripId,
        );
      });
    },

    async publishTrip(agencyId, tripId, request, authorization) {
      const requiredIdempotencyKey = request.idempotencyKey;
      if (
        requiredIdempotencyKey.length < 1 ||
        requiredIdempotencyKey.length > 128 ||
        containsControlCharacter(requiredIdempotencyKey)
      ) {
        throw new StaffPublicationInputError();
      }
      return serializable(async (database) => {
        const assuranceVerifiedAtEpochMs = await assertStaffAuthorizationInTransaction(
          database,
          authorization,
          agencyId,
          PUBLISH_PERMISSIONS,
          RECENT_MFA_MAXIMUM_AGE_MS,
        );
        if (assuranceVerifiedAtEpochMs === null) {
          throw new StaffAuthorizationError("FORBIDDEN");
        }
        const staffPrincipalId = authorization.session.staffPrincipalId;
        const repeatedBeforeLock = await loadExistingIdempotentResult(
          database,
          hasher,
          validator,
          agencyId,
          staffPrincipalId,
          tripId,
          request,
        );
        if (repeatedBeforeLock !== null) return repeatedBeforeLock;

        const trip = (
          await sql<{ readonly workspaceRevision: string }>`
            SELECT locked."workspaceRevision"::text AS "workspaceRevision"
              FROM "trip_ops"."lock_trip_for_publication"(${agencyId}::uuid, ${tripId}::uuid) AS locked
          `.execute(database)
        ).rows[0];
        if (trip === undefined) throw new TripPublicationNotFoundError();

        const repeatedAfterLock = await loadExistingIdempotentResult(
          database,
          hasher,
          validator,
          agencyId,
          staffPrincipalId,
          tripId,
          request,
        );
        if (repeatedAfterLock !== null) return repeatedAfterLock;

        const candidate = await buildTripPublicationCandidateFromSources(
          publicationReaders(database),
          hasher,
          validator,
          agencyId,
          tripId,
        );
        if (
          BigInt(trip.workspaceRevision) !== request.expectedWorkspaceRevision ||
          candidate.workspaceRevision !== request.expectedWorkspaceRevision ||
          candidate.projectionHash !== request.expectedProjectionHash
        ) {
          throw new StalePublicationCandidateError();
        }

        const pointer = (
          await sql<{
            readonly activePublicationId: string;
            readonly activeVersion: number;
          }>`
            SELECT "activePublicationId"::text AS "activePublicationId", "activeVersion" AS "activeVersion"
              FROM "trip_ops"."publication_pointer"
             WHERE "agencyId" = ${agencyId}::uuid AND "tripId" = ${tripId}::uuid
             FOR UPDATE
          `.execute(database)
        ).rows[0];

        if (pointer !== undefined) {
          const active = (
            await sql<{
              readonly workspaceRevision: string;
              readonly projectionHash: string;
            }>`
              SELECT "workspaceRevision"::text AS "workspaceRevision", "projectionHash" AS "projectionHash"
                FROM "trip_ops"."publication_version"
               WHERE "publicationId" = ${pointer.activePublicationId}::uuid
                 AND "agencyId" = ${agencyId}::uuid AND "tripId" = ${tripId}::uuid
            `.execute(database)
          ).rows[0];
          if (
            active !== undefined &&
            BigInt(active.workspaceRevision) === candidate.workspaceRevision &&
            active.projectionHash.trim() === candidate.projectionHash
          ) {
            await sql`
              INSERT INTO "trip_ops"."publication_idempotency"
                ("agencyId", "staffPrincipalId", "command", "idempotencyKey", "tripId",
                 "workspaceRevision", "projectionHash", "requestHash", "publicationId")
              VALUES (${agencyId}::uuid, ${staffPrincipalId}, 'trip.publish', ${requiredIdempotencyKey},
                      ${tripId}::uuid, ${request.expectedWorkspaceRevision.toString()}::bigint,
                      ${candidate.projectionHash}, ${requestHash(tripId, request)},
                      ${pointer.activePublicationId}::uuid)
            `.execute(database);
            return readPublication(
              database,
              hasher,
              validator,
              agencyId,
              tripId,
              pointer.activePublicationId,
            );
          }
        }

        const version = (pointer?.activeVersion ?? 0) + 1;
        const publicationId = createUuidV7();
        const eventId = createUuidV7();
        const auditId = createUuidV7();
        const outboxId = createUuidV7();
        await bindEventCorrelation(database);
        const publishedAt = (
          await sql<{ readonly publishedAt: Date }>`
            SELECT clock_timestamp() AS "publishedAt"
          `.execute(database)
        ).rows[0]?.publishedAt;
        if (publishedAt === undefined) throw new Error("Could not allocate publication timestamp");

        await sql`
          INSERT INTO "trip_ops"."publication_version"
            ("publicationId", "agencyId", "tripId", "version", "workspaceRevision",
             "schemaVersion", "projectionHash", "publisherStaffPrincipalId", "assuranceVerifiedAt", "publishedAt")
          VALUES (${publicationId}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${version},
                  ${candidate.workspaceRevision.toString()}::bigint, 1, ${candidate.projectionHash},
                  ${staffPrincipalId},
                  to_timestamp(${assuranceVerifiedAtEpochMs}::double precision / 1000),
                  ${publishedAt})
        `.execute(database);
        await sql`
          INSERT INTO "trip_ops"."publication_snapshot"
            ("publicationId", "agencyId", "tripId", "canonicalPayload")
          VALUES (${publicationId}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${candidate.canonicalJson})
        `.execute(database);
        if (pointer === undefined) {
          await sql`
            INSERT INTO "trip_ops"."publication_pointer"
              ("agencyId", "tripId", "activePublicationId", "activeVersion")
            VALUES (${agencyId}::uuid, ${tripId}::uuid, ${publicationId}::uuid, ${version})
          `.execute(database);
        } else {
          await sql`
            UPDATE "trip_ops"."publication_pointer"
               SET "activePublicationId" = ${publicationId}::uuid, "activeVersion" = ${version}
             WHERE "agencyId" = ${agencyId}::uuid AND "tripId" = ${tripId}::uuid
          `.execute(database);
        }
        await sql`
          INSERT INTO "trip_ops"."publication_event"
            ("eventId", "agencyId", "tripId", "publicationId", "version", "eventType", "actorStaffPrincipalId")
          VALUES (${eventId}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${publicationId}::uuid,
                  ${version}, 'TRIP_PUBLICATION_PUBLISHED', ${staffPrincipalId})
        `.execute(database);
        await sql`
          INSERT INTO "audit"."trip_publication_event"
            ("auditId", "agencyId", "tripId", "publicationId", "actorStaffPrincipalId",
             "action", "schemaVersion", "projectionHash")
          VALUES (${auditId}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${publicationId}::uuid,
                  ${staffPrincipalId}, 'TRIP_PUBLISHED', 1, ${candidate.projectionHash})
        `.execute(database);
        await sql`
          INSERT INTO "integration"."trip_publication_outbox"
            ("messageId", "eventId", "agencyId", "tripId", "publicationId", "version", "eventType")
          VALUES (${outboxId}::uuid, ${eventId}::uuid, ${agencyId}::uuid, ${tripId}::uuid,
                  ${publicationId}::uuid, ${version}, 'TRIP_PUBLICATION_PUBLISHED')
        `.execute(database);
        await sql`
          INSERT INTO "trip_ops"."publication_idempotency"
            ("agencyId", "staffPrincipalId", "command", "idempotencyKey", "tripId",
             "workspaceRevision", "projectionHash", "requestHash", "publicationId")
          VALUES (${agencyId}::uuid, ${staffPrincipalId}, 'trip.publish', ${requiredIdempotencyKey},
                  ${tripId}::uuid, ${request.expectedWorkspaceRevision.toString()}::bigint,
                  ${candidate.projectionHash}, ${requestHash(tripId, request)}, ${publicationId}::uuid)
        `.execute(database);
        return readPublication(database, hasher, validator, agencyId, tripId, publicationId);
      });
    },

    listPublicationHistory(agencyId, tripId, authorization, beforeVersion) {
      return readOnly(async (database) => {
        await assertStaffAuthorizationReadOnly(
          database,
          authorization,
          agencyId,
          PREVIEW_PERMISSIONS,
        );
        const rows = (
          await sql<{
            readonly version: number;
            readonly publishedAt: Date;
            readonly actorReference: string;
            readonly schemaVersion: number;
            readonly projectionHash: string;
            readonly isActive: boolean;
          }>`
            SELECT version."version" AS "version", version."publishedAt" AS "publishedAt",
                   version."publisherStaffPrincipalId" AS "actorReference",
                   version."schemaVersion" AS "schemaVersion", version."projectionHash" AS "projectionHash",
                   COALESCE(pointer."activePublicationId" = version."publicationId", false) AS "isActive"
              FROM "trip_ops"."publication_version" AS version
              LEFT JOIN "trip_ops"."publication_pointer" AS pointer
                ON pointer."agencyId" = version."agencyId" AND pointer."tripId" = version."tripId"
             WHERE version."agencyId" = ${agencyId}::uuid AND version."tripId" = ${tripId}::uuid
               AND (${beforeVersion}::integer IS NULL OR version."version" < ${beforeVersion}::integer)
             ORDER BY version."version" DESC
             LIMIT 51
          `.execute(database)
        ).rows;
        const hasMore = rows.length > 50;
        const entries = rows.slice(0, 50).map(asHistoryEntry);
        const lastEntry = entries.at(-1);
        if (hasMore && lastEntry === undefined) {
          throw new Error("Publication history pagination lost its cursor row");
        }
        return {
          entries,
          nextCursor: hasMore ? String(lastEntry?.version) : null,
        };
      });
    },

    async withdrawActivePublication(agencyId, tripId, request, authorization) {
      if (
        request.reason.trim().length < 1 ||
        request.reason.trim().length > 500 ||
        containsControlCharacter(request.reason) ||
        request.idempotencyKey.length < 1 ||
        request.idempotencyKey.length > 128 ||
        containsControlCharacter(request.idempotencyKey)
      ) {
        throw new StaffPublicationInputError();
      }
      const actorId = authorization.session.staffPrincipalId;
      const expectedRequestHash = withdrawalRequestHash(tripId, request);

      return serializable(async (database) => {
        const assuranceVerifiedAtEpochMs = await assertStaffAuthorizationInTransaction(
          database,
          authorization,
          agencyId,
          WITHDRAW_PERMISSIONS,
          RECENT_MFA_MAXIMUM_AGE_MS,
        );
        if (assuranceVerifiedAtEpochMs === null) {
          throw new StaffAuthorizationError("FORBIDDEN");
        }

        const existing = (
          await sql<{
            readonly tripId: string;
            readonly requestHash: string;
            readonly outcome: "WITHDRAWN" | "ALREADY_WITHDRAWN";
            readonly publicationId: string | null;
            readonly version: number | null;
            readonly withdrawnAt: Date | null;
          }>`
            SELECT "tripId"::text AS "tripId", "requestHash", "outcome",
                   "publicationId"::text AS "publicationId", "version", "withdrawnAt"
              FROM "trip_ops"."publication_withdrawal_idempotency"
             WHERE "agencyId" = ${agencyId}::uuid
               AND "staffPrincipalId" = ${actorId}
               AND "command" = 'trip.withdraw_publication'
               AND "idempotencyKey" = ${request.idempotencyKey}
          `.execute(database)
        ).rows[0];
        if (existing !== undefined) {
          if (existing.requestHash.trim() !== expectedRequestHash || existing.tripId !== tripId) {
            throw new IdempotencyConflictError();
          }
          return {
            status: existing.outcome,
            tripId: asOpaqueId(tripId),
            publicationId:
              existing.publicationId === null ? null : asOpaqueId(existing.publicationId),
            version: existing.version,
            withdrawnAt: existing.withdrawnAt?.toISOString() ?? null,
          };
        }

        const trip = (
          await sql<{ readonly workspaceRevision: string }>`
            SELECT locked."workspaceRevision"::text AS "workspaceRevision"
              FROM "trip_ops"."lock_trip_for_publication"(${agencyId}::uuid, ${tripId}::uuid) AS locked
          `.execute(database)
        ).rows[0];
        if (trip === undefined) throw new TripPublicationNotFoundError();

        const pointer = (
          await sql<{
            readonly activePublicationId: string;
            readonly activeVersion: number;
          }>`
            SELECT "activePublicationId"::text AS "activePublicationId", "activeVersion"
              FROM "trip_ops"."publication_pointer"
             WHERE "agencyId" = ${agencyId}::uuid AND "tripId" = ${tripId}::uuid
             FOR UPDATE
          `.execute(database)
        ).rows[0];

        if (pointer === undefined) {
          await sql`
            INSERT INTO "trip_ops"."publication_withdrawal_idempotency"
              ("agencyId", "staffPrincipalId", "command", "idempotencyKey", "tripId",
               "requestHash", "outcome", "publicationId", "version", "withdrawnAt")
            VALUES (${agencyId}::uuid, ${actorId}, 'trip.withdraw_publication',
                    ${request.idempotencyKey}, ${tripId}::uuid, ${expectedRequestHash},
                    'ALREADY_WITHDRAWN', NULL, NULL, NULL)
          `.execute(database);
          return {
            status: "ALREADY_WITHDRAWN",
            tripId: asOpaqueId(tripId),
            publicationId: null,
            version: null,
            withdrawnAt: null,
          };
        }

        const withdrawnAt = (
          await sql<{ readonly withdrawnAt: Date }>`
            SELECT date_trunc('milliseconds', clock_timestamp()) AS "withdrawnAt"
          `.execute(database)
        ).rows[0]?.withdrawnAt;
        if (withdrawnAt === undefined) throw new Error("PostgreSQL clock query returned no row");
        const deletedPointer = (
          await sql<{ readonly tripId: string }>`
            DELETE FROM "trip_ops"."publication_pointer"
             WHERE "agencyId" = ${agencyId}::uuid
               AND "tripId" = ${tripId}::uuid
               AND "activePublicationId" = ${pointer.activePublicationId}::uuid
            RETURNING "tripId"::text AS "tripId"
          `.execute(database)
        ).rows[0];
        if (deletedPointer === undefined) throw new TransactionConflictError();

        const eventId = createUuidV7();
        await sql`
          INSERT INTO "trip_ops"."publication_withdrawal_event"
            ("eventId", "agencyId", "tripId", "publicationId", "version", "actorStaffPrincipalId", "eventType")
          VALUES (${eventId}::uuid, ${agencyId}::uuid, ${tripId}::uuid,
                  ${pointer.activePublicationId}::uuid, ${pointer.activeVersion}, ${actorId},
                  'TRIP_PUBLICATION_WITHDRAWN')
        `.execute(database);
        await sql`
          INSERT INTO "audit"."trip_publication_withdrawal_event"
            ("auditId", "agencyId", "tripId", "publicationId", "actorStaffPrincipalId", "action", "reason")
          VALUES (${createUuidV7()}::uuid, ${agencyId}::uuid, ${tripId}::uuid,
                  ${pointer.activePublicationId}::uuid, ${actorId},
                  'TRIP_PUBLICATION_WITHDRAWN', ${request.reason.trim()})
        `.execute(database);
        await sql`
          INSERT INTO "integration"."publication_withdrawal_outbox"
            ("messageId", "eventId", "agencyId", "tripId", "publicationId", "version", "eventType")
          VALUES (${createUuidV7()}::uuid, ${eventId}::uuid, ${agencyId}::uuid, ${tripId}::uuid,
                  ${pointer.activePublicationId}::uuid, ${pointer.activeVersion},
                  'TRIP_PUBLICATION_WITHDRAWN')
        `.execute(database);
        await sql`
          INSERT INTO "trip_ops"."publication_withdrawal_idempotency"
            ("agencyId", "staffPrincipalId", "command", "idempotencyKey", "tripId",
             "requestHash", "outcome", "publicationId", "version", "withdrawnAt")
          VALUES (${agencyId}::uuid, ${actorId}, 'trip.withdraw_publication',
                  ${request.idempotencyKey}, ${tripId}::uuid, ${expectedRequestHash},
                  'WITHDRAWN', ${pointer.activePublicationId}::uuid, ${pointer.activeVersion}, ${withdrawnAt})
        `.execute(database);
        return {
          status: "WITHDRAWN",
          tripId: asOpaqueId(tripId),
          publicationId: asOpaqueId(pointer.activePublicationId),
          version: pointer.activeVersion,
          withdrawnAt: withdrawnAt.toISOString(),
        };
      });
    },
  };
  return Object.freeze(repository);
};
