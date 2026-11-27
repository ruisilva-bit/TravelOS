import {
  asOpaqueId,
  buildTripPublicationCandidateFromSources,
  IdempotencyConflictError,
  ShareLinkInputError,
  ShareLinkNotFoundError,
  StaffAuthorizationError,
  TransactionConflictError,
  TripPublicationNotFoundError,
  type StaffPermissionId,
  type StaffShareLinkRepository,
  type TripSnapshotHashPort,
  type TripSnapshotValidatorPort,
} from "@travelos/backend-core";
import { sql, type Kysely, type Transaction as KyselyTransaction } from "kysely";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { assertStaffAuthorizationInTransaction } from "../trip-operations/operational-slice-repository.js";
import { publicationReaders } from "../customer-presentation/publication-source-repository.js";
import {
  assertStaffAuthorizationReadOnly,
  PREVIEW_PERMISSIONS,
} from "../customer-presentation/staff-publication-repository.js";
import { createUuidV7 } from "../uuidv7.js";

type DatabaseShape = Record<string, never>;
type Transaction = KyselyTransaction<DatabaseShape>;

const PUBLISH_PERMISSIONS = [
  "trip.view",
  "trip.publish",
] as const satisfies readonly StaffPermissionId[];
const RECENT_MFA_MAXIMUM_AGE_MS = 5 * 60 * 1_000;
const MAX_SERIALIZATION_ATTEMPTS = 3;
const LIST_LIMIT = 200;

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

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

export const createPostgresStaffShareLinkRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
  hasher: TripSnapshotHashPort,
  validator: TripSnapshotValidatorPort,
): StaffShareLinkRepository => {
  const serializable = async <Result>(
    work: (database: Transaction) => Promise<Result>,
  ): Promise<Result> => {
    for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        return await persistence.withConnection((database: Kysely<DatabaseShape>) =>
          database.transaction().setIsolationLevel("serializable").execute(work),
        );
      } catch (error) {
        const code = postgresCode(error);
        if (code === "23505" && postgresConstraint(error) === "share_link_idempotency_unique") {
          throw new IdempotencyConflictError();
        }
        const retryable = code === "40001" || code === "40P01";
        if (!retryable) throw error;
        if (attempt === MAX_SERIALIZATION_ATTEMPTS) throw new TransactionConflictError();
      }
    }
    throw new TransactionConflictError();
  };

  const idempotencyKeyExists = async (
    database: Transaction,
    agencyId: string,
    staffPrincipalId: string,
    idempotencyKey: string,
  ): Promise<boolean> =>
    (
      await sql<{ readonly shareLinkId: string }>`
        SELECT "shareLinkId"::text AS "shareLinkId"
          FROM "trip_ops"."share_link"
         WHERE "agencyId" = ${agencyId}::uuid
           AND "createdByStaffPrincipalId" = ${staffPrincipalId}
           AND "idempotencyKey" = ${idempotencyKey}
      `.execute(database)
    ).rows.length > 0;

  const repository: StaffShareLinkRepository = {
    async createShareLink(agencyId, tripId, request, tokenHash, authorization) {
      if (
        request.idempotencyKey.length < 1 ||
        request.idempotencyKey.length > 128 ||
        containsControlCharacter(request.idempotencyKey) ||
        !Number.isInteger(request.expiresInDays) ||
        request.expiresInDays < 1 ||
        request.expiresInDays > 365 ||
        tokenHash.length !== 32
      ) {
        throw new ShareLinkInputError();
      }
      return serializable(async (database) => {
        const assuranceVerifiedAtEpochMs = await assertStaffAuthorizationInTransaction(
          database,
          authorization,
          agencyId,
          PUBLISH_PERMISSIONS,
          RECENT_MFA_MAXIMUM_AGE_MS,
        );
        if (assuranceVerifiedAtEpochMs === null) throw new StaffAuthorizationError("FORBIDDEN");
        const staffPrincipalId = authorization.session.staffPrincipalId;
        if (
          await idempotencyKeyExists(database, agencyId, staffPrincipalId, request.idempotencyKey)
        ) {
          throw new IdempotencyConflictError();
        }
        const trip = (
          await sql<{ readonly workspaceRevision: string }>`
            SELECT locked."workspaceRevision"::text AS "workspaceRevision"
              FROM "trip_ops"."lock_trip_for_publication"(${agencyId}::uuid, ${tripId}::uuid) AS locked
          `.execute(database)
        ).rows[0];
        if (trip === undefined) throw new TripPublicationNotFoundError();
        if (
          await idempotencyKeyExists(database, agencyId, staffPrincipalId, request.idempotencyKey)
        ) {
          throw new IdempotencyConflictError();
        }

        const candidate = await buildTripPublicationCandidateFromSources(
          publicationReaders(database),
          hasher,
          validator,
          agencyId,
          tripId,
        );
        const latest = (
          await sql<{ readonly version: number | null }>`
            SELECT max("version") AS "version"
              FROM "trip_ops"."publication_version"
             WHERE "agencyId" = ${agencyId}::uuid AND "tripId" = ${tripId}::uuid
          `.execute(database)
        ).rows[0]?.version;
        const version = (latest ?? 0) + 1;
        const publicationId = createUuidV7();
        const shareLinkId = createUuidV7();
        await sql`
          INSERT INTO "trip_ops"."publication_version"
            ("publicationId", "agencyId", "tripId", "version", "workspaceRevision",
             "schemaVersion", "projectionHash", "publisherStaffPrincipalId", "assuranceVerifiedAt", "publishedAt")
          VALUES (${publicationId}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${version},
                  ${candidate.workspaceRevision.toString()}::bigint, 1, ${candidate.projectionHash},
                  ${staffPrincipalId},
                  to_timestamp(${assuranceVerifiedAtEpochMs}::double precision / 1000),
                  clock_timestamp())
        `.execute(database);
        await sql`
          INSERT INTO "trip_ops"."publication_snapshot"
            ("publicationId", "agencyId", "tripId", "canonicalPayload")
          VALUES (${publicationId}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${candidate.canonicalJson})
        `.execute(database);
        const created = (
          await sql<{
            readonly shareLinkId: string;
            readonly createdAt: Date;
            readonly expiresAt: Date;
          }>`
            INSERT INTO "trip_ops"."share_link"
              ("shareLinkId", "agencyId", "tripId", "publicationId", "tokenHash",
               "createdByStaffPrincipalId", "idempotencyKey", "expiresAt")
            VALUES (${shareLinkId}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${publicationId}::uuid,
                    ${Buffer.from(tokenHash)}, ${staffPrincipalId}, ${request.idempotencyKey},
                    now() + make_interval(days => ${request.expiresInDays}))
            RETURNING "shareLinkId"::text AS "shareLinkId", "createdAt", "expiresAt"
          `.execute(database)
        ).rows[0];
        if (created === undefined) throw new Error("Share link insert returned no row");
        return {
          shareLinkId: asOpaqueId(created.shareLinkId),
          createdAt: created.createdAt.toISOString(),
          expiresAt: created.expiresAt.toISOString(),
        };
      });
    },

    listShareLinks(agencyId, tripId, authorization) {
      return persistence.withConnection((database: Kysely<DatabaseShape>) =>
        database
          .transaction()
          .setIsolationLevel("repeatable read")
          .setAccessMode("read only")
          .execute(async (transaction) => {
            await assertStaffAuthorizationReadOnly(
              transaction,
              authorization,
              agencyId,
              PREVIEW_PERMISSIONS,
            );
            const trip = (
              await sql`
                SELECT 1 FROM "trip_ops"."trip"
                 WHERE "agencyId" = ${agencyId}::uuid AND "id" = ${tripId}::uuid
              `.execute(transaction)
            ).rows[0];
            if (trip === undefined) throw new TripPublicationNotFoundError();
            // Explicit column list: the token hash is never selected.
            const rows = (
              await sql<{
                readonly shareLinkId: string;
                readonly createdAt: Date;
                readonly expiresAt: Date;
                readonly revokedAt: Date | null;
                readonly createdBy: string;
              }>`
                SELECT "shareLinkId"::text AS "shareLinkId", "createdAt", "expiresAt", "revokedAt",
                       "createdByStaffPrincipalId" AS "createdBy"
                  FROM "trip_ops"."share_link"
                 WHERE "agencyId" = ${agencyId}::uuid AND "tripId" = ${tripId}::uuid
                 ORDER BY "createdAt" DESC, "shareLinkId" DESC
                 LIMIT ${LIST_LIMIT}
              `.execute(transaction)
            ).rows;
            return rows.map((row) => ({
              shareLinkId: asOpaqueId(row.shareLinkId),
              createdAt: row.createdAt.toISOString(),
              expiresAt: row.expiresAt.toISOString(),
              revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
              createdBy: row.createdBy,
            }));
          }),
      );
    },

    revokeShareLink(agencyId, shareLinkId, authorization) {
      return serializable(async (database) => {
        await assertStaffAuthorizationInTransaction(
          database,
          authorization,
          agencyId,
          PUBLISH_PERMISSIONS,
          null,
        );
        const link = (
          await sql<{ readonly revokedAt: Date | null }>`
            SELECT "revokedAt" FROM "trip_ops"."share_link"
             WHERE "agencyId" = ${agencyId}::uuid AND "shareLinkId" = ${shareLinkId}::uuid
             FOR UPDATE
          `.execute(database)
        ).rows[0];
        if (link === undefined) throw new ShareLinkNotFoundError();
        if (link.revokedAt !== null) return;
        await sql`
          UPDATE "trip_ops"."share_link" SET "revokedAt" = now()
           WHERE "agencyId" = ${agencyId}::uuid AND "shareLinkId" = ${shareLinkId}::uuid
             AND "revokedAt" IS NULL
        `.execute(database);
      });
    },
  };
  return Object.freeze(repository);
};
