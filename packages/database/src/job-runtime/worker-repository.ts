import {
  WorkerExecutionError,
  type WorkerClaim,
  type WorkerErrorCode,
  type WorkerRepository,
  type WorkerStats,
} from "@travelos/backend-core";
import { sql, type Kysely, type Transaction } from "kysely";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";

type Shape = Record<string, never>;
type Database = Kysely<Shape> | Transaction<Shape>;
type ClaimRow = {
  messageId: string;
  agencyId: string;
  owner: string;
  version: string;
  attempt: number;
  correlationId: string;
  traceparent: string | null;
};
const mapClaim = (row: ClaimRow): WorkerClaim => ({
  messageId: row.messageId,
  agencyId: row.agencyId,
  owner: row.owner,
  version: row.version,
  attempt: row.attempt,
  correlationId: row.correlationId,
  traceparent: row.traceparent,
});
const activeClaim = (claim: WorkerClaim) => sql`
  "agencyId" = ${claim.agencyId}::uuid AND "messageId" = ${claim.messageId}::uuid
  AND "consumer" = 'ACTIVITY_V1' AND "state" = 'RUNNING'
  AND "owner" = ${claim.owner}::uuid AND "version" = ${claim.version}::bigint
  AND "leaseUntil" > clock_timestamp() AND "deadline" > clock_timestamp()`;

const mapError = (error: unknown): WorkerExecutionError => {
  if (error instanceof WorkerExecutionError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (typeof code === "string" && ["40001", "40P01", "55P03", "57014"].includes(code))
    return new WorkerExecutionError("TEMPORARY");
  if (typeof code === "string" && code.startsWith("23"))
    return new WorkerExecutionError("PERMANENT");
  return new WorkerExecutionError("UNKNOWN_OUTCOME");
};

export const createWorkerRepository = (
  persistence: PostgresPersistence<Shape>,
): WorkerRepository => {
  const transaction = async <T>(work: (database: Transaction<Shape>) => Promise<T>): Promise<T> => {
    try {
      return await persistence.withConnection((connection) =>
        connection.transaction().execute(work),
      );
    } catch (error) {
      throw mapError(error);
    }
  };
  const recordAttempt = async (
    database: Database,
    claim: WorkerClaim,
    outcome: string,
    errorCode: string | null,
  ): Promise<void> => {
    await sql`INSERT INTO "job_runtime"."attempt" ("agencyId", "messageId", "consumer", "attempt", "owner", "outcome", "errorCode")
      VALUES (${claim.agencyId}::uuid, ${claim.messageId}::uuid, 'ACTIVITY_V1', ${claim.attempt}, ${claim.owner}::uuid, ${outcome}, ${errorCode})`.execute(
      database,
    );
  };
  const finish = async (
    database: Database,
    claim: WorkerClaim,
    outcome: string,
    errorCode: string | null,
    delay: number,
  ): Promise<boolean> => {
    const changed =
      await sql`UPDATE "job_runtime"."job" SET "state"=${outcome}, "errorCode"=${errorCode},
      "runAt"=clock_timestamp()+${delay}::integer*interval '1 millisecond', "version"="version"+1,
      "owner"=NULL, "leaseUntil"=NULL, "deadline"=NULL WHERE ${activeClaim(claim)} RETURNING "messageId"`.execute(
        database,
      );
    if (changed.rows.length === 0) return false;
    await recordAttempt(database, claim, outcome, errorCode);
    if (outcome !== "RETRY")
      await sql`UPDATE "integration"."outbox_delivery" SET "state"=${outcome}, "completedAt"=clock_timestamp()
      WHERE "agencyId"=${claim.agencyId}::uuid AND "messageId"=${claim.messageId}::uuid AND "consumer"='ACTIVITY_V1' AND "state"='PENDING'`.execute(
        database,
      );
    return true;
  };
  return {
    async ready() {
      const result = await persistence.withConnection((database) =>
        sql<{ ready: boolean }>`WITH required_schemas(schema_name) AS (
          VALUES ('job_runtime'), ('integration'), ('activity')
        ), required_table_privileges(schema_name, relation_name, privilege) AS (
          VALUES
            ('job_runtime', 'job', 'SELECT'),
            ('job_runtime', 'job', 'INSERT'),
            ('job_runtime', 'attempt', 'SELECT'),
            ('job_runtime', 'attempt', 'INSERT'),
            ('integration', 'outbox_delivery', 'SELECT'),
            ('integration', 'outbox_delivery', 'INSERT'),
            ('integration', 'activity_source', 'SELECT'),
            ('integration', 'event_context', 'SELECT'),
            ('activity', 'entry', 'SELECT'),
            ('activity', 'entry', 'INSERT')
        ), required_column_privileges(schema_name, relation_name, column_name, privilege) AS (
          VALUES
            ('job_runtime', 'job', 'state', 'UPDATE'),
            ('job_runtime', 'job', 'attempt', 'UPDATE'),
            ('job_runtime', 'job', 'version', 'UPDATE'),
            ('job_runtime', 'job', 'runAt', 'UPDATE'),
            ('job_runtime', 'job', 'owner', 'UPDATE'),
            ('job_runtime', 'job', 'leaseUntil', 'UPDATE'),
            ('job_runtime', 'job', 'deadline', 'UPDATE'),
            ('job_runtime', 'job', 'errorCode', 'UPDATE'),
            ('integration', 'outbox_delivery', 'state', 'UPDATE'),
            ('integration', 'outbox_delivery', 'completedAt', 'UPDATE')
        ), required_relations AS (
          SELECT
            required.schema_name,
            required.relation_name,
            required.privilege,
            relation.oid AS relation_oid
          FROM required_table_privileges AS required
          LEFT JOIN pg_namespace AS namespace ON namespace.nspname=required.schema_name
          LEFT JOIN pg_class AS relation
            ON relation.relnamespace=namespace.oid AND relation.relname=required.relation_name
        ), required_columns AS (
          SELECT
            required.schema_name,
            required.relation_name,
            required.column_name,
            required.privilege,
            relation.oid AS relation_oid,
            attribute.attnum AS attribute_number
          FROM required_column_privileges AS required
          LEFT JOIN pg_namespace AS namespace ON namespace.nspname=required.schema_name
          LEFT JOIN pg_class AS relation
            ON relation.relnamespace=namespace.oid AND relation.relname=required.relation_name
          LEFT JOIN pg_attribute AS attribute
            ON attribute.attrelid=relation.oid AND attribute.attname=required.column_name
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
        )
        SELECT current_user = 'travelos_worker' AND session_user = 'travelos_worker'
          AND NOT EXISTS (
            SELECT 1 FROM required_schemas AS required
            WHERE NOT has_schema_privilege(current_user, required.schema_name, 'USAGE')
          )
          AND NOT EXISTS (
            SELECT 1 FROM required_relations AS required
            WHERE required.relation_oid IS NULL
              OR NOT has_table_privilege(current_user, required.relation_oid, required.privilege)
          )
          AND NOT EXISTS (
            SELECT 1 FROM required_columns AS required
            WHERE required.relation_oid IS NULL OR required.attribute_number IS NULL
              OR NOT has_column_privilege(
                current_user, required.relation_oid, required.attribute_number, required.privilege
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_class AS relation
            JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
            WHERE ((namespace.nspname='trip_ops' AND relation.relname='trip')
              OR (namespace.nspname='staff_access' AND relation.relname='staff_user'))
              AND has_table_privilege(current_user, relation.oid, 'SELECT')
          ) AS ready`.execute(database),
      );
      return result.rows[0]?.ready === true;
    },
    dispatch: () =>
      transaction(async (database) => {
        const result = await sql`WITH candidates AS (
        SELECT source."agencyId", source."messageId", source."publicationMessageId", source."grantMessageId"
        FROM "integration"."activity_source" AS source
        WHERE NOT EXISTS (SELECT 1 FROM "integration"."outbox_delivery" AS delivery
          WHERE delivery."agencyId"=source."agencyId" AND delivery."messageId"=source."messageId" AND delivery."consumer"='ACTIVITY_V1')
        ORDER BY source."occurredAt", source."messageId" LIMIT 100
      ), inserted AS (
        INSERT INTO "integration"."outbox_delivery" ("agencyId", "messageId", "consumer", "publicationMessageId", "grantMessageId", "state")
        SELECT "agencyId", "messageId", 'ACTIVITY_V1', "publicationMessageId", "grantMessageId", 'PENDING' FROM candidates
        ON CONFLICT ("agencyId", "messageId", "consumer") DO NOTHING RETURNING "agencyId", "messageId", "consumer"
      ) INSERT INTO "job_runtime"."job" ("agencyId", "messageId", "consumer", "state")
        SELECT "agencyId", "messageId", "consumer", 'PENDING' FROM inserted RETURNING "messageId"`.execute(
          database,
        );
        return result.rows.length;
      }),
    claim: (owner) =>
      transaction(async (database) => {
        // Serialize only the task-cap check, not execution; claims still skip locked jobs.
        await sql`SELECT pg_advisory_xact_lock(80014, 1)`.execute(database);
        const result = await sql<ClaimRow>`WITH due AS (
        SELECT "agencyId", "messageId", "consumer" FROM "job_runtime"."job"
        WHERE "state" IN ('PENDING','RETRY') AND "runAt"<=clock_timestamp() AND "attempt"<5
          AND (SELECT count(*) FROM "job_runtime"."job" WHERE "state"='RUNNING' AND "leaseUntil">clock_timestamp())<2
        ORDER BY "runAt", "createdAt", "messageId" FOR UPDATE SKIP LOCKED LIMIT 1
      ), claimed AS (
        UPDATE "job_runtime"."job" AS job SET "state"='RUNNING', "attempt"=job."attempt"+1,
          "version"=job."version"+1, "owner"=${owner}::uuid,
          "leaseUntil"=clock_timestamp()+interval '15 seconds', "deadline"=clock_timestamp()+interval '60 seconds'
        FROM due WHERE job."agencyId"=due."agencyId" AND job."messageId"=due."messageId" AND job."consumer"=due."consumer"
        RETURNING job."agencyId", job."messageId", job."owner", job."version"::text, job."attempt"
      ) SELECT claimed."agencyId"::text, claimed."messageId"::text, claimed."owner"::text, claimed."version", claimed."attempt",
        coalesce(context."correlationId", claimed."messageId")::text AS "correlationId", context."traceparent"
        FROM claimed LEFT JOIN "integration"."event_context" AS context USING ("agencyId", "messageId")`.execute(
          database,
        );
        return result.rows[0] === undefined ? null : mapClaim(result.rows[0]);
      }),
    heartbeat: (claim) =>
      transaction(async (database) => {
        const result = await sql<{ version: string }>`UPDATE "job_runtime"."job" SET
        "leaseUntil"=least(clock_timestamp()+interval '15 seconds', "deadline"), "version"="version"+1
        WHERE ${activeClaim(claim)} RETURNING "version"::text`.execute(database);
        const row = result.rows[0];
        return row === undefined
          ? null
          : mapClaim({
              messageId: claim.messageId,
              agencyId: claim.agencyId,
              owner: claim.owner,
              version: row.version,
              attempt: claim.attempt,
              correlationId: claim.correlationId,
              traceparent: claim.traceparent,
            });
      }),
    projectAndComplete: (claim) =>
      transaction(async (database) => {
        const locked =
          await sql`SELECT "messageId" FROM "job_runtime"."job" WHERE ${activeClaim(claim)} FOR UPDATE`.execute(
            database,
          );
        if (locked.rows.length === 0) return false;
        const source = await sql`INSERT INTO "activity"."entry"
        ("agencyId", "messageId", "consumer", "tripId", "publicationId", "actorStaffPrincipalId", "eventType", "schemaVersion", "occurredAt")
        SELECT "agencyId", "messageId", 'ACTIVITY_V1', "tripId", "publicationId", "actorStaffPrincipalId", "eventType", 1, "occurredAt"
        FROM "integration"."activity_source" WHERE "agencyId"=${claim.agencyId}::uuid AND "messageId"=${claim.messageId}::uuid
        ON CONFLICT ("agencyId", "messageId", "consumer") DO NOTHING RETURNING "messageId"`.execute(
          database,
        );
        if (source.rows.length === 0) {
          const prior =
            await sql`SELECT "messageId" FROM "activity"."entry" WHERE "agencyId"=${claim.agencyId}::uuid AND "messageId"=${claim.messageId}::uuid AND "consumer"='ACTIVITY_V1'`.execute(
              database,
            );
          if (prior.rows.length === 0) throw new WorkerExecutionError("PERMANENT");
        }
        // Recheck DB time after projection; expiry rolls back the whole effect.
        if (!(await finish(database, claim, "SUCCEEDED", null, 0)))
          throw new WorkerExecutionError("TEMPORARY");
        return true;
      }),
    async fail(claim, code: WorkerErrorCode, retryDelayMs) {
      if (
        !["TEMPORARY", "PERMANENT", "UNKNOWN_OUTCOME"].includes(code) ||
        !Number.isInteger(retryDelayMs) ||
        retryDelayMs < 0 ||
        retryDelayMs > 60_000
      )
        throw new Error("Invalid worker failure policy");
      return transaction((database) =>
        finish(
          database,
          claim,
          code === "UNKNOWN_OUTCOME"
            ? "UNKNOWN_OUTCOME"
            : code === "PERMANENT" || claim.attempt >= 5
              ? "DEAD_LETTER"
              : "RETRY",
          code,
          retryDelayMs,
        ),
      );
    },
    recover: () =>
      transaction(async (database) => {
        const expired = await sql<{
          messageId: string;
          agencyId: string;
          owner: string;
          attempt: number;
          version: string;
        }>`SELECT "messageId"::text, "agencyId"::text, "owner"::text, "attempt", "version"::text
        FROM "job_runtime"."job" WHERE "state"='RUNNING' AND ("leaseUntil"<=clock_timestamp() OR "deadline"<=clock_timestamp())
        ORDER BY "leaseUntil" FOR UPDATE SKIP LOCKED LIMIT 100`.execute(database);
        for (const row of expired.rows) {
          const outcome = row.attempt >= 5 ? "DEAD_LETTER" : "RETRY";
          await sql`UPDATE "job_runtime"."job" SET "state"=${outcome}, "errorCode"='LEASE_EXPIRED', "version"="version"+1,
          "owner"=NULL, "leaseUntil"=NULL, "deadline"=NULL,
          "runAt"=clock_timestamp()+least(60000, 1000*power(2, "attempt"-1)*(1+random()/5))*interval '1 millisecond'
          WHERE "agencyId"=${row.agencyId}::uuid AND "messageId"=${row.messageId}::uuid AND "consumer"='ACTIVITY_V1'
            AND "version"=${row.version}::bigint AND "owner"=${row.owner}::uuid`.execute(database);
          await recordAttempt(
            database,
            mapClaim({
              messageId: row.messageId,
              agencyId: row.agencyId,
              owner: row.owner,
              version: row.version,
              attempt: row.attempt,
              correlationId: row.messageId,
              traceparent: null,
            }),
            outcome,
            "LEASE_EXPIRED",
          );
          if (outcome === "DEAD_LETTER")
            await sql`UPDATE "integration"."outbox_delivery" SET "state"='DEAD_LETTER', "completedAt"=clock_timestamp()
          WHERE "agencyId"=${row.agencyId}::uuid AND "messageId"=${row.messageId}::uuid AND "consumer"='ACTIVITY_V1' AND "state"='PENDING'`.execute(
              database,
            );
        }
        return expired.rows.length;
      }),
    async inspect(): Promise<WorkerStats> {
      const result = await persistence.withConnection((database) =>
        sql<WorkerStats>`SELECT
        count(*) FILTER (WHERE "state" IN ('PENDING','RETRY'))::integer AS "pending",
        count(*) FILTER (WHERE "state"='RUNNING')::integer AS "running",
        count(*) FILTER (WHERE "state"='SUCCEEDED')::integer AS "succeeded",
        (SELECT count(*)::integer FROM "job_runtime"."attempt" WHERE "outcome"='RETRY') AS "retries",
        count(*) FILTER (WHERE "state"='DEAD_LETTER')::integer AS "deadLetter",
        count(*) FILTER (WHERE "state"='UNKNOWN_OUTCOME')::integer AS "unknownOutcome",
        count(*) FILTER (WHERE "state"='RUNNING' AND "leaseUntil"<=clock_timestamp())::integer AS "expiredLeases",
        coalesce(greatest(0, floor(extract(epoch FROM clock_timestamp()-min("createdAt") FILTER (WHERE "state" IN ('PENDING','RETRY'))))),0)::integer AS "oldestPendingSeconds"
        FROM "job_runtime"."job"`.execute(database),
      );
      const row = result.rows[0]!;
      return {
        pending: row.pending,
        running: row.running,
        succeeded: row.succeeded,
        retries: row.retries,
        deadLetter: row.deadLetter,
        unknownOutcome: row.unknownOutcome,
        expiredLeases: row.expiredLeases,
        oldestPendingSeconds: row.oldestPendingSeconds,
      };
    },
  };
};
