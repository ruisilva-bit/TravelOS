import { createHash } from "node:crypto";

import {
  asOpaqueId,
  IdempotencyConflictError,
  M1InputValidationError,
  M1_STAFF_TRIP_ACCESS_PERMISSION_REQUIREMENTS,
  M1TransactionConflictError,
  TRIP_ACCESS_CAPABILITY_IDS,
  type IssueTripAccessGrantCommand,
  type M1StaffTripAccessRepository,
  type RevokeTripAccessGrantCommand,
  type StaffAuthorizationOperationProof,
  type TripAccessGrant,
} from "@travelos/backend-core";
import { sql, type Kysely, type Transaction as KyselyTransaction } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { assertStaffAuthorizationInTransaction } from "../trip-operations/m1-operational-slice-repository.js";
import { createUuidV7 } from "../uuidv7.js";

type DatabaseShape = Record<string, never>;
type Database = Kysely<DatabaseShape>;
type Transaction = KyselyTransaction<DatabaseShape>;
type GrantState = "ACTIVE" | "REVOKED" | "EXPIRED";
type GrantEventType =
  "TRIP_ACCESS_GRANT_ISSUED" | "TRIP_ACCESS_GRANT_REVOKED" | "TRIP_ACCESS_GRANT_EXPIRED";

interface GrantRow {
  readonly grantId: string;
  readonly agencyId: string;
  readonly portalPrincipalId: string;
  readonly tripId: string;
  readonly capabilities: string[];
  readonly issuedByStaffPrincipalId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date | null;
  readonly relationshipLabel: string | null;
  readonly grantState: GrantState;
  readonly revokedByStaffPrincipalId: string | null;
  readonly revokedAt: Date | null;
  readonly expiredAt: Date | null;
}

interface IdempotencyRow {
  readonly grantId: string;
  readonly requestHash: string;
}

const MAX_SERIALIZATION_ATTEMPTS = 3;
const ISSUE_COMMAND = "trip.access.issue" as const;
const REVOKE_COMMAND = "trip.access.revoke" as const;
const EXPECTED_CAPABILITY = TRIP_ACCESS_CAPABILITY_IDS[0];
const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

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

const invalidInput = (): never => {
  throw new M1InputValidationError("Invalid Trip access persistence command");
};

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

const exactRecord = (value: unknown, expectedKeys: readonly string[]): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidInput();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidInput();
  const record = value as Record<string, unknown>;
  const actualKeys = Reflect.ownKeys(record);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    return invalidInput();
  }
  for (const key of actualKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      return invalidInput();
    }
  }
  return record;
};

const opaqueIdField = (record: Record<string, unknown>, field: string) => {
  const value = record[field];
  if (typeof value !== "string") return invalidInput();
  try {
    return asOpaqueId(value);
  } catch {
    return invalidInput();
  }
};

const idempotencyKeyField = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    hasControlCharacter(value)
  ) {
    return invalidInput();
  }
  return value;
};

const portalPrincipalIdField = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    value !== value.trim() ||
    hasControlCharacter(value)
  ) {
    return invalidInput();
  }
  return value;
};

const parseExpiry = (value: unknown): { readonly iso: string } | null => {
  if (value === null) return null;
  if (typeof value !== "string") return invalidInput();
  const match = RFC3339_INSTANT.exec(value);
  if (match === null) return invalidInput();
  const localTimestamp = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${(match[7] ?? "").padEnd(3, "0")}Z`;
  const localEpochMs = Date.parse(localTimestamp);
  if (!Number.isFinite(localEpochMs) || new Date(localEpochMs).toISOString() !== localTimestamp) {
    return invalidInput();
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) return invalidInput();
  return { iso: new Date(epochMs).toISOString() };
};

const parseIssueCommand = (value: unknown): IssueTripAccessGrantCommand => {
  const record = exactRecord(value, [
    "agencyId",
    "portalPrincipalId",
    "tripId",
    "capabilities",
    "idempotencyKey",
    "expiresAt",
    "relationshipLabel",
  ]);
  const capabilities = record.capabilities;
  if (
    !Array.isArray(capabilities) ||
    capabilities.length !== 1 ||
    capabilities[0] !== EXPECTED_CAPABILITY
  ) {
    return invalidInput();
  }
  const relationshipLabel = record.relationshipLabel;
  let normalizedRelationshipLabel: string | null = null;
  if (relationshipLabel !== null) {
    if (typeof relationshipLabel !== "string" || hasControlCharacter(relationshipLabel)) {
      return invalidInput();
    }
    normalizedRelationshipLabel = relationshipLabel.trim();
    if (normalizedRelationshipLabel.length < 1 || normalizedRelationshipLabel.length > 200) {
      return invalidInput();
    }
  }
  return {
    agencyId: opaqueIdField(record, "agencyId"),
    portalPrincipalId: portalPrincipalIdField(record.portalPrincipalId),
    tripId: opaqueIdField(record, "tripId"),
    capabilities: TRIP_ACCESS_CAPABILITY_IDS,
    idempotencyKey: idempotencyKeyField(record.idempotencyKey),
    expiresAt: parseExpiry(record.expiresAt)?.iso ?? null,
    relationshipLabel: normalizedRelationshipLabel,
  };
};

const parseRevokeCommand = (value: unknown): RevokeTripAccessGrantCommand => {
  const record = exactRecord(value, ["agencyId", "grantId", "idempotencyKey"]);
  return {
    agencyId: opaqueIdField(record, "agencyId"),
    grantId: opaqueIdField(record, "grantId"),
    idempotencyKey: idempotencyKeyField(record.idempotencyKey),
  };
};

const hashRequest = (parts: readonly (string | null)[]): string =>
  createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");

const mapGrant = (row: GrantRow): TripAccessGrant => {
  if (row.capabilities.length !== 1 || row.capabilities[0] !== EXPECTED_CAPABILITY) {
    throw new Error("Stored Trip access grant has an unsupported capability set");
  }
  return {
    grantId: asOpaqueId(row.grantId),
    agencyId: asOpaqueId(row.agencyId),
    portalPrincipalId: row.portalPrincipalId,
    tripId: asOpaqueId(row.tripId),
    capabilities: TRIP_ACCESS_CAPABILITY_IDS,
    issuedByStaffPrincipalId: row.issuedByStaffPrincipalId,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    relationshipLabel: row.relationshipLabel,
    revokedByStaffPrincipalId: row.revokedByStaffPrincipalId,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
};

const getGrant = async (
  database: Database,
  agencyId: string,
  grantId: string,
  lock = false,
): Promise<GrantRow | null> => {
  const result = await sql<GrantRow>`
    SELECT "grantId"::text AS "grantId",
           "agencyId"::text AS "agencyId",
           "portalPrincipalId",
           "tripId"::text AS "tripId",
           "capabilities",
           "issuedByStaffPrincipalId",
           "issuedAt",
           "expiresAt",
           "relationshipLabel",
           "grantState",
           "revokedByStaffPrincipalId",
           "revokedAt",
           "expiredAt"
      FROM "portal_access"."trip_access_grant"
     WHERE "agencyId" = ${agencyId}::uuid AND "grantId" = ${grantId}::uuid
     ${lock ? sql`FOR UPDATE` : sql``}
  `.execute(database);
  return result.rows[0] ?? null;
};

const getIdempotency = async (
  database: Database,
  agencyId: string,
  staffPrincipalId: string,
  command: typeof ISSUE_COMMAND | typeof REVOKE_COMMAND,
  idempotencyKey: string,
): Promise<IdempotencyRow | null> => {
  const row = (
    await sql<IdempotencyRow>`
      SELECT "grantId"::text AS "grantId", "requestHash"
        FROM "portal_access"."trip_access_idempotency"
       WHERE "agencyId" = ${agencyId}::uuid
         AND "staffPrincipalId" = ${staffPrincipalId}
         AND "command" = ${command}
         AND "idempotencyKey" = ${idempotencyKey}
    `.execute(database)
  ).rows[0];
  return row ?? null;
};

const assertIdempotencyRequest = (row: IdempotencyRow, expectedHash: string): void => {
  if (row.requestHash.trim() !== expectedHash) throw new IdempotencyConflictError();
};

const insertIdempotency = async (
  database: Database,
  agencyId: string,
  staffPrincipalId: string,
  command: typeof ISSUE_COMMAND | typeof REVOKE_COMMAND,
  idempotencyKey: string,
  requestHash: string,
  grantId: string,
): Promise<void> => {
  await sql`
    INSERT INTO "portal_access"."trip_access_idempotency"
      ("agencyId", "staffPrincipalId", "command", "idempotencyKey", "requestHash", "grantId")
    VALUES (${agencyId}::uuid, ${staffPrincipalId}, ${command}, ${idempotencyKey}, ${requestHash}, ${grantId}::uuid)
  `.execute(database);
};

const appendEvent = async (
  database: Database,
  grant: Pick<GrantRow, "grantId" | "agencyId" | "portalPrincipalId" | "tripId">,
  eventType: GrantEventType,
  actorStaffPrincipalId: string | null,
): Promise<void> => {
  const eventId = createUuidV7();
  await sql`
    INSERT INTO "audit"."trip_access_grant_event"
      ("eventId", "grantId", "agencyId", "portalPrincipalId", "tripId", "eventType", "actorStaffPrincipalId")
    VALUES (
      ${eventId}::uuid, ${grant.grantId}::uuid, ${grant.agencyId}::uuid,
      ${grant.portalPrincipalId}, ${grant.tripId}::uuid, ${eventType}, ${actorStaffPrincipalId}
    )
  `.execute(database);
  await sql`
    INSERT INTO "integration"."trip_access_grant_outbox"
      ("messageId", "eventId", "agencyId", "grantId", "eventType")
    VALUES (${createUuidV7()}::uuid, ${eventId}::uuid, ${grant.agencyId}::uuid, ${grant.grantId}::uuid, ${eventType})
  `.execute(database);
};

const expireGrant = async (database: Database, grant: GrantRow): Promise<GrantRow> => {
  const expired = (
    await sql<GrantRow>`
      UPDATE "portal_access"."trip_access_grant"
         SET "grantState" = 'EXPIRED', "expiredAt" = date_trunc('milliseconds', clock_timestamp())
       WHERE "agencyId" = ${grant.agencyId}::uuid
         AND "grantId" = ${grant.grantId}::uuid
         AND "grantState" = 'ACTIVE'
      RETURNING "grantId"::text AS "grantId",
                "agencyId"::text AS "agencyId",
                "portalPrincipalId",
                "tripId"::text AS "tripId",
                "capabilities",
                "issuedByStaffPrincipalId",
                "issuedAt",
                "expiresAt",
                "relationshipLabel",
                "grantState",
                "revokedByStaffPrincipalId",
                "revokedAt",
                "expiredAt"
    `.execute(database)
  ).rows[0];
  if (expired === undefined) throw new M1TransactionConflictError();
  await appendEvent(database, expired, "TRIP_ACCESS_GRANT_EXPIRED", null);
  return expired;
};

const serializable = async <Result>(
  persistence: PostgresPersistence<DatabaseShape>,
  work: (database: Transaction) => Promise<Result>,
): Promise<Result> => {
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
    try {
      return await persistence.withConnection((database) =>
        database.transaction().setIsolationLevel("serializable").execute(work),
      );
    } catch (error) {
      const code = postgresCode(error);
      const constraint = postgresConstraint(error);
      const retryable = code === "40001" || code === "40P01";
      const idempotencyRace = code === "23505" && constraint === "trip_access_idempotency_pkey";
      if (code === "23505" && constraint === "trip_access_grant_one_active_scope_idx") {
        throw new M1TransactionConflictError();
      }
      if (!retryable && !idempotencyRace) throw error;
      if (attempt === MAX_SERIALIZATION_ATTEMPTS) throw new M1TransactionConflictError();
    }
  }
  throw new M1TransactionConflictError();
};

const createGrant = async (
  database: Database,
  command: IssueTripAccessGrantCommand,
  issuedByStaffPrincipalId: string,
): Promise<GrantRow> => {
  const grantId = createUuidV7();
  const row = (
    await sql<GrantRow>`
      WITH issued_time AS MATERIALIZED (
        SELECT date_trunc('milliseconds', statement_timestamp()) AS "issuedAt"
      )
      INSERT INTO "portal_access"."trip_access_grant"
        ("grantId", "agencyId", "portalPrincipalId", "tripId", "capabilities",
         "issuedByStaffPrincipalId", "expiresAt", "relationshipLabel")
      SELECT ${grantId}::uuid, ${command.agencyId}::uuid, ${command.portalPrincipalId},
             ${command.tripId}::uuid, ${[...command.capabilities]}::text[],
             ${issuedByStaffPrincipalId}, ${command.expiresAt}::timestamptz,
             ${command.relationshipLabel}
        FROM issued_time
       WHERE ${command.expiresAt}::timestamptz IS NULL
          OR ${command.expiresAt}::timestamptz > issued_time."issuedAt"
      RETURNING "grantId"::text AS "grantId",
                "agencyId"::text AS "agencyId",
                "portalPrincipalId",
                "tripId"::text AS "tripId",
                "capabilities",
                "issuedByStaffPrincipalId",
                "issuedAt",
                "expiresAt",
                "relationshipLabel",
                "grantState",
                "revokedByStaffPrincipalId",
                "revokedAt",
                "expiredAt"
    `.execute(database)
  ).rows[0];
  if (row === undefined)
    throw new M1InputValidationError("Trip access expiry must be in the future");
  return row;
};

export const createPostgresM1StaffTripAccessRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): M1StaffTripAccessRepository => {
  const repository: M1StaffTripAccessRepository = {
    async issueTripAccessGrant(untrustedCommand, authorization) {
      const command = parseIssueCommand(untrustedCommand);
      const actorId = authorization?.session?.staffPrincipalId;
      if (typeof actorId !== "string") {
        throw new M1InputValidationError("Invalid Staff authorization proof");
      }
      const requestHash = hashRequest([
        ISSUE_COMMAND,
        command.agencyId,
        actorId,
        command.portalPrincipalId,
        command.tripId,
        command.capabilities.join(","),
        command.expiresAt,
        command.relationshipLabel,
      ]);

      return serializable(persistence, async (database) => {
        await assertStaffAuthorizationInTransaction(
          database,
          authorization,
          command.agencyId,
          M1_STAFF_TRIP_ACCESS_PERMISSION_REQUIREMENTS,
        );
        const existing = await getIdempotency(
          database,
          command.agencyId,
          actorId,
          ISSUE_COMMAND,
          command.idempotencyKey,
        );
        if (existing !== null) {
          assertIdempotencyRequest(existing, requestHash);
          const existingGrant = await getGrant(database, command.agencyId, existing.grantId);
          if (existingGrant === null) throw new Error("Trip access idempotency row has no grant");
          return mapGrant(existingGrant);
        }

        const target = (
          await sql<{ readonly found: boolean }>`
            SELECT true AS "found"
              FROM "trip_ops"."trip" AS trip
              JOIN "portal_access"."portal_principal_context" AS principal
                ON principal."agencyId" = trip."agencyId"
             WHERE trip."agencyId" = ${command.agencyId}::uuid
               AND trip."id" = ${command.tripId}::uuid
               AND principal."portalPrincipalId" = ${command.portalPrincipalId}
          `.execute(database)
        ).rows[0];
        if (target === undefined) return null;

        const priorActiveGrant = (
          await sql<GrantRow>`
            SELECT "grantId"::text AS "grantId",
                   "agencyId"::text AS "agencyId",
                   "portalPrincipalId",
                   "tripId"::text AS "tripId",
                   "capabilities",
                   "issuedByStaffPrincipalId",
                   "issuedAt",
                   "expiresAt",
                   "relationshipLabel",
                   "grantState",
                   "revokedByStaffPrincipalId",
                   "revokedAt",
                   "expiredAt"
              FROM "portal_access"."trip_access_grant"
             WHERE "agencyId" = ${command.agencyId}::uuid
               AND "portalPrincipalId" = ${command.portalPrincipalId}
               AND "tripId" = ${command.tripId}::uuid
               AND "grantState" = 'ACTIVE'
             FOR UPDATE
          `.execute(database)
        ).rows[0];
        if (priorActiveGrant !== undefined) {
          const databaseNow = (
            await sql<{ readonly now: Date }>`SELECT clock_timestamp() AS "now"`.execute(database)
          ).rows[0];
          if (
            priorActiveGrant.expiresAt === null ||
            databaseNow === undefined ||
            priorActiveGrant.expiresAt.getTime() > databaseNow.now.getTime()
          ) {
            throw new M1TransactionConflictError();
          }
          await expireGrant(database, priorActiveGrant);
        }

        const grant = await createGrant(database, command, actorId);
        await appendEvent(database, grant, "TRIP_ACCESS_GRANT_ISSUED", actorId);
        await insertIdempotency(
          database,
          command.agencyId,
          actorId,
          ISSUE_COMMAND,
          command.idempotencyKey,
          requestHash,
          grant.grantId,
        );
        return mapGrant(grant);
      });
    },

    async revokeTripAccessGrant(untrustedCommand, authorization: StaffAuthorizationOperationProof) {
      const command = parseRevokeCommand(untrustedCommand);
      const actorId = authorization?.session?.staffPrincipalId;
      if (typeof actorId !== "string") {
        throw new M1InputValidationError("Invalid Staff authorization proof");
      }
      const requestHash = hashRequest([REVOKE_COMMAND, command.agencyId, actorId, command.grantId]);

      return serializable(persistence, async (database) => {
        await assertStaffAuthorizationInTransaction(
          database,
          authorization,
          command.agencyId,
          M1_STAFF_TRIP_ACCESS_PERMISSION_REQUIREMENTS,
        );
        const existing = await getIdempotency(
          database,
          command.agencyId,
          actorId,
          REVOKE_COMMAND,
          command.idempotencyKey,
        );
        if (existing !== null) {
          assertIdempotencyRequest(existing, requestHash);
          const existingGrant = await getGrant(database, command.agencyId, existing.grantId);
          if (existingGrant === null) throw new Error("Trip access idempotency row has no grant");
          return mapGrant(existingGrant);
        }

        const current = await getGrant(database, command.agencyId, command.grantId, true);
        if (current === null) return null;
        let result = current;
        if (current.grantState === "ACTIVE") {
          const databaseNow = (
            await sql<{ readonly now: Date }>`SELECT clock_timestamp() AS "now"`.execute(database)
          ).rows[0];
          if (databaseNow === undefined) throw new Error("PostgreSQL clock query returned no row");
          const expired =
            current.expiresAt !== null && current.expiresAt.getTime() <= databaseNow.now.getTime();
          if (expired) {
            result = await expireGrant(database, current);
          } else {
            const revoked = (
              await sql<GrantRow>`
                UPDATE "portal_access"."trip_access_grant"
                   SET "grantState" = 'REVOKED',
                       "revokedByStaffPrincipalId" = ${actorId},
                       "revokedAt" = date_trunc('milliseconds', clock_timestamp())
                 WHERE "agencyId" = ${command.agencyId}::uuid
                   AND "grantId" = ${command.grantId}::uuid
                   AND "grantState" = 'ACTIVE'
                RETURNING "grantId"::text AS "grantId",
                          "agencyId"::text AS "agencyId",
                          "portalPrincipalId",
                          "tripId"::text AS "tripId",
                          "capabilities",
                          "issuedByStaffPrincipalId",
                          "issuedAt",
                          "expiresAt",
                          "relationshipLabel",
                          "grantState",
                          "revokedByStaffPrincipalId",
                          "revokedAt",
                          "expiredAt"
              `.execute(database)
            ).rows[0];
            if (revoked === undefined) throw new M1TransactionConflictError();
            const principal = (
              await sql<{ readonly authorizationEpoch: string }>`
                UPDATE "portal_access"."portal_principal_context"
                   SET "authorizationEpoch" = "authorizationEpoch" + 1,
                       "updatedAt" = date_trunc('milliseconds', clock_timestamp())
                 WHERE "agencyId" = ${command.agencyId}::uuid
                   AND "portalPrincipalId" = ${current.portalPrincipalId}
                RETURNING "authorizationEpoch"::text AS "authorizationEpoch"
              `.execute(database)
            ).rows[0];
            if (principal === undefined) {
              throw new Error("Trip access grant has no Portal principal authorization context");
            }
            await appendEvent(database, revoked, "TRIP_ACCESS_GRANT_REVOKED", actorId);
            result = revoked;
          }
        }
        await insertIdempotency(
          database,
          command.agencyId,
          actorId,
          REVOKE_COMMAND,
          command.idempotencyKey,
          requestHash,
          result.grantId,
        );
        return mapGrant(result);
      });
    },
  };
  return Object.freeze(repository);
};
