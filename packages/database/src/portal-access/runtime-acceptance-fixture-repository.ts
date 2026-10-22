import {
  asOpaqueId,
  M1_RUNTIME_ACCEPTANCE_FIXTURE_MANAGE_PERMISSION_REQUIREMENTS,
  M1InputValidationError,
  M1StaffAuthorizationError,
  type OpaqueId,
  type RuntimeAcceptanceCleanupCommand,
  type RuntimeAcceptanceCleanupCounts,
  type RuntimeAcceptanceCleanupHistoryCounts,
  type RuntimeAcceptanceCleanupReceipt,
  type RuntimeAcceptanceFixtureCleanupPlan,
  type RuntimeAcceptanceFixtureCleanupRepository,
  type RuntimeAcceptanceFixtureRunState,
  type StaffAuthorizationOperationProof,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import {
  assertStaffAuthorizationInTransaction,
  mapPostgresMutationError,
} from "../trip-operations/m1-operational-slice-repository.js";

const RECENT_MFA_MAXIMUM_AGE_MS = 5 * 60 * 1_000;
const MAX_COUNT = 10_000;
const COUNT_SENTINEL = MAX_COUNT + 1;
const RECOVERY_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

type DatabaseShape = Record<string, never>;

type FixtureRunRow = {
  readonly agencyId: string;
  readonly fixtureRunId: string;
  readonly createdByStaffPrincipalId: string;
  readonly portalPrincipalId: string | null;
  readonly state: RuntimeAcceptanceFixtureRunState;
};

type EvidenceRow = {
  readonly grantsRevoked: string;
  readonly publicationsWithdrawn: string;
  readonly tripsCancelled: string;
  readonly principalsRetired: string;
  readonly publicationSnapshots: string;
  readonly auditRecords: string;
};

type ActiveGrantRow = {
  readonly grantId: string;
  readonly tripId: string;
  readonly portalPrincipalId: string;
};

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

const parseCommand = (value: RuntimeAcceptanceCleanupCommand): RuntimeAcceptanceCleanupCommand => {
  if (typeof value !== "object" || value === null) {
    throw new M1InputValidationError("Invalid runtime acceptance cleanup command");
  }
  try {
    const agencyId = asOpaqueId(value.agencyId);
    const fixtureRunId = asOpaqueId(value.fixtureRunId);
    if (
      typeof value.staffPrincipalId !== "string" ||
      value.staffPrincipalId.length < 1 ||
      value.staffPrincipalId.length > 255 ||
      value.staffPrincipalId !== value.staffPrincipalId.trim() ||
      containsControlCharacter(value.staffPrincipalId) ||
      typeof value.idempotencyKey !== "string" ||
      value.idempotencyKey.length < 1 ||
      value.idempotencyKey.length > RECOVERY_IDEMPOTENCY_KEY_MAX_LENGTH ||
      containsControlCharacter(value.idempotencyKey)
    ) {
      throw new M1InputValidationError("Invalid runtime acceptance cleanup command");
    }
    return { ...value, agencyId, fixtureRunId };
  } catch (error) {
    if (error instanceof M1InputValidationError) throw error;
    throw new M1InputValidationError("Invalid runtime acceptance cleanup command");
  }
};

const assertCleanupAuthorization = async (
  database: Kysely<DatabaseShape>,
  command: RuntimeAcceptanceCleanupCommand,
  authorization: StaffAuthorizationOperationProof,
): Promise<void> => {
  if (authorization?.session?.staffPrincipalId !== command.staffPrincipalId) {
    throw new M1StaffAuthorizationError("UNAUTHENTICATED");
  }
  await assertStaffAuthorizationInTransaction(
    database,
    authorization,
    command.agencyId,
    M1_RUNTIME_ACCEPTANCE_FIXTURE_MANAGE_PERMISSION_REQUIREMENTS,
    RECENT_MFA_MAXIMUM_AGE_MS,
  );
};

const toBoundedCount = (value: string): number => {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0
    ? Math.min(count, COUNT_SENTINEL)
    : COUNT_SENTINEL;
};

const readRun = async (
  database: Kysely<DatabaseShape>,
  command: RuntimeAcceptanceCleanupCommand,
): Promise<FixtureRunRow | null> => {
  const row = (
    await sql<FixtureRunRow>`
      SELECT "agencyId"::text AS "agencyId",
             "fixtureRunId"::text AS "fixtureRunId",
             "createdByStaffPrincipalId",
             "portalPrincipalId",
             "state"
        FROM "portal_access"."runtime_acceptance_fixture_run"
       WHERE "agencyId" = ${command.agencyId}::uuid
         AND "fixtureRunId" = ${command.fixtureRunId}::uuid
         AND "createdByStaffPrincipalId" = ${command.staffPrincipalId}
       FOR UPDATE
    `.execute(database)
  ).rows[0];
  return row ?? null;
};

const readEvidence = async (
  database: Kysely<DatabaseShape>,
  command: RuntimeAcceptanceCleanupCommand,
): Promise<{
  readonly counts: RuntimeAcceptanceCleanupCounts;
  readonly retainedHistoryCounts: RuntimeAcceptanceCleanupHistoryCounts;
}> => {
  const row = (
    await sql<EvidenceRow>`
      WITH fixture_run AS (
        SELECT "agencyId", "fixtureRunId", "portalPrincipalId"
          FROM "portal_access"."runtime_acceptance_fixture_run"
         WHERE "agencyId" = ${command.agencyId}::uuid
           AND "fixtureRunId" = ${command.fixtureRunId}::uuid
      ),
      fixture_trips AS (
        SELECT "agencyId", "tripId"
          FROM "portal_access"."runtime_acceptance_fixture_trip"
         WHERE "agencyId" = ${command.agencyId}::uuid
           AND "fixtureRunId" = ${command.fixtureRunId}::uuid
      )
      SELECT
        (SELECT count(*)::text
           FROM "audit"."trip_access_grant_event" AS event
           JOIN fixture_run AS fixture
             ON fixture."agencyId" = event."agencyId"
            AND fixture."portalPrincipalId" = event."portalPrincipalId"
           JOIN fixture_trips AS trip
             ON trip."agencyId" = event."agencyId" AND trip."tripId" = event."tripId"
          WHERE event."eventType" = 'TRIP_ACCESS_GRANT_REVOKED') AS "grantsRevoked",
        (SELECT count(*)::text
           FROM "audit"."trip_publication_withdrawal_event" AS event
           JOIN fixture_trips AS trip
             ON trip."agencyId" = event."agencyId" AND trip."tripId" = event."tripId")
          AS "publicationsWithdrawn",
        (SELECT count(*)::text
           FROM "audit"."trip_cancellation_event" AS event
           JOIN fixture_trips AS trip
             ON trip."agencyId" = event."agencyId" AND trip."tripId" = event."tripId")
          AS "tripsCancelled",
        (SELECT count(*)::text
           FROM "audit"."runtime_acceptance_fixture_event" AS event
           JOIN fixture_run AS fixture
             ON fixture."agencyId" = event."agencyId"
            AND fixture."fixtureRunId" = event."fixtureRunId"
          WHERE event."eventType" = 'FIXTURE_PORTAL_PRINCIPAL_RETIRED')
          AS "principalsRetired",
        (SELECT count(*)::text
           FROM "trip_ops"."publication_snapshot" AS snapshot
           JOIN fixture_trips AS trip
             ON trip."agencyId" = snapshot."agencyId" AND trip."tripId" = snapshot."tripId")
          AS "publicationSnapshots",
        ((SELECT count(*)
            FROM "audit"."runtime_acceptance_fixture_event" AS event
           WHERE event."agencyId" = ${command.agencyId}::uuid
             AND event."fixtureRunId" = ${command.fixtureRunId}::uuid)
         + (SELECT count(*)
              FROM "audit"."trip_access_grant_event" AS event
              JOIN fixture_run AS fixture
                ON fixture."agencyId" = event."agencyId"
               AND fixture."portalPrincipalId" = event."portalPrincipalId"
              JOIN fixture_trips AS trip
                ON trip."agencyId" = event."agencyId" AND trip."tripId" = event."tripId")
         + (SELECT count(*)
              FROM "audit"."trip_publication_withdrawal_event" AS event
              JOIN fixture_trips AS trip
                ON trip."agencyId" = event."agencyId" AND trip."tripId" = event."tripId")
         + (SELECT count(*)
              FROM "audit"."trip_cancellation_event" AS event
              JOIN fixture_trips AS trip
                ON trip."agencyId" = event."agencyId" AND trip."tripId" = event."tripId"))::text
          AS "auditRecords"
    `.execute(database)
  ).rows[0];
  if (row === undefined) throw new Error("Fixture cleanup evidence query returned no row");
  return {
    counts: {
      grantsRevoked: toBoundedCount(row.grantsRevoked),
      publicationsWithdrawn: toBoundedCount(row.publicationsWithdrawn),
      tripsCancelled: toBoundedCount(row.tripsCancelled),
      principalsRetired: toBoundedCount(row.principalsRetired),
    },
    retainedHistoryCounts: {
      publicationSnapshots: toBoundedCount(row.publicationSnapshots),
      auditRecords: toBoundedCount(row.auditRecords),
    },
  };
};

const readPlan = async (
  database: Kysely<DatabaseShape>,
  run: FixtureRunRow,
  command: RuntimeAcceptanceCleanupCommand,
): Promise<RuntimeAcceptanceFixtureCleanupPlan> => {
  const tripRows = (
    await sql<{ readonly tripId: string }>`
      SELECT "tripId"::text AS "tripId"
        FROM "portal_access"."runtime_acceptance_fixture_trip"
       WHERE "agencyId" = ${run.agencyId}::uuid
         AND "fixtureRunId" = ${run.fixtureRunId}::uuid
       ORDER BY "slot"
    `.execute(database)
  ).rows;
  const tripIds = tripRows.map(({ tripId }) => asOpaqueId(tripId));
  let unexpectedResourceCount = Math.max(0, tripIds.length - 2);
  if (new Set(tripIds).size !== tripIds.length) unexpectedResourceCount += 1;

  const publicationRows =
    tripIds.length === 0
      ? []
      : (
          await sql<{ readonly tripId: string }>`
            SELECT pointer."tripId"::text AS "tripId"
              FROM "trip_ops"."publication_pointer" AS pointer
             WHERE pointer."agencyId" = ${run.agencyId}::uuid
               AND pointer."tripId" IN (${sql.join(tripIds.map((tripId) => sql`${tripId}::uuid`))})
             ORDER BY pointer."tripId"
          `.execute(database)
        ).rows;
  const activePublicationTripIds = publicationRows.map(({ tripId }) => asOpaqueId(tripId));

  const activeGrantRows =
    tripIds.length === 0
      ? []
      : (
          await sql<ActiveGrantRow>`
            SELECT access_grant."grantId"::text AS "grantId",
                   access_grant."tripId"::text AS "tripId",
                   access_grant."portalPrincipalId"
              FROM "portal_access"."trip_access_grant" AS access_grant
             WHERE access_grant."agencyId" = ${run.agencyId}::uuid
               AND access_grant."tripId" IN (${sql.join(tripIds.map((tripId) => sql`${tripId}::uuid`))})
               AND access_grant."grantState" = 'ACTIVE'
             ORDER BY access_grant."grantId"
             LIMIT 3
          `.execute(database)
        ).rows;
  const activeGrants: Array<{ readonly grantId: OpaqueId; readonly tripId: OpaqueId }> = [];
  for (const grant of activeGrantRows) {
    if (run.portalPrincipalId !== null && grant.portalPrincipalId === run.portalPrincipalId) {
      activeGrants.push({ grantId: asOpaqueId(grant.grantId), tripId: asOpaqueId(grant.tripId) });
    } else {
      unexpectedResourceCount += 1;
    }
  }
  if (activeGrantRows.length > 2) unexpectedResourceCount += 1;

  let portalPrincipalRetired = false;
  if (run.portalPrincipalId !== null) {
    const principal = (
      await sql<{ readonly retiredAt: Date | null }>`
        SELECT "retiredAt"
          FROM "portal_access"."portal_principal_context"
         WHERE "agencyId" = ${run.agencyId}::uuid
           AND "portalPrincipalId" = ${run.portalPrincipalId}
      `.execute(database)
    ).rows[0];
    if (principal === undefined) {
      unexpectedResourceCount += 1;
    } else {
      portalPrincipalRetired = principal.retiredAt !== null;
    }
  }

  const evidence = await readEvidence(database, command);
  return {
    agencyId: asOpaqueId(run.agencyId),
    fixtureRunId: asOpaqueId(run.fixtureRunId),
    state: run.state,
    tripIds,
    activePublicationTripIds,
    activeGrants,
    portalPrincipalId: run.portalPrincipalId,
    portalPrincipalRetired,
    counts: evidence.counts,
    retainedHistoryCounts: evidence.retainedHistoryCounts,
    unexpectedResourceCount: Math.min(unexpectedResourceCount, COUNT_SENTINEL),
  };
};

const receiptFromRun = async (
  database: Kysely<DatabaseShape>,
  run: FixtureRunRow,
  command: RuntimeAcceptanceCleanupCommand,
): Promise<RuntimeAcceptanceCleanupReceipt> => {
  const evidence = await readEvidence(database, command);
  return {
    fixtureRunId: asOpaqueId(run.fixtureRunId),
    state: run.state === "CLEANED" ? "CLEANED" : "CLEANUP_PENDING",
    counts: evidence.counts,
    retainedHistoryCounts: evidence.retainedHistoryCounts,
    errorCode: null,
  };
};

const assertFullyCleaned = async (
  database: Kysely<DatabaseShape>,
  plan: RuntimeAcceptanceFixtureCleanupPlan,
): Promise<boolean> => {
  if (
    plan.state !== "CLEANUP_PENDING" ||
    plan.unexpectedResourceCount !== 0 ||
    plan.activeGrants.length !== 0 ||
    plan.activePublicationTripIds.length !== 0 ||
    (plan.portalPrincipalId !== null && !plan.portalPrincipalRetired)
  ) {
    return false;
  }
  if (plan.tripIds.length === 0) return true;
  const row = (
    await sql<{ readonly tripCount: string; readonly uncancelledTripCount: string }>`
      SELECT count(*)::text AS "tripCount",
             count(*) FILTER (WHERE trip."state" <> 'CANCELLED')::text AS "uncancelledTripCount"
        FROM "trip_ops"."trip" AS trip
       WHERE trip."agencyId" = ${plan.agencyId}::uuid
         AND trip."id" IN (${sql.join(plan.tripIds.map((tripId) => sql`${tripId}::uuid`))})
    `.execute(database)
  ).rows[0];
  return (
    row !== undefined &&
    Number(row.tripCount) === plan.tripIds.length &&
    Number(row.uncancelledTripCount) === 0
  );
};

const withMappedErrors = async <Result>(work: () => Promise<Result>): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    throw mapPostgresMutationError(error);
  }
};

export const createPostgresRuntimeAcceptanceFixtureCleanupRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): RuntimeAcceptanceFixtureCleanupRepository => {
  const runAuthorized = async <Result>(
    commandValue: RuntimeAcceptanceCleanupCommand,
    authorization: StaffAuthorizationOperationProof,
    work: (
      database: Kysely<DatabaseShape>,
      command: RuntimeAcceptanceCleanupCommand,
    ) => Promise<Result>,
  ): Promise<Result> => {
    const command = parseCommand(commandValue);
    return withMappedErrors(() =>
      persistence.transaction.runInTransaction(async (context) =>
        persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`.execute(database);
          await assertCleanupAuthorization(database, command, authorization);
          return work(database, command);
        }),
      ),
    );
  };

  const repository: RuntimeAcceptanceFixtureCleanupRepository = {
    beginCleanup(commandValue, authorization) {
      return runAuthorized(commandValue, authorization, async (database, command) => {
        const run = await readRun(database, command);
        if (run === null) return null;
        if (run.state === "CLEANED") {
          return { status: "CLEANED", receipt: await receiptFromRun(database, run, command) };
        }
        if (run.state === "OPEN") {
          const pending = (
            await sql<FixtureRunRow>`
              UPDATE "portal_access"."runtime_acceptance_fixture_run"
                 SET "state" = 'CLEANUP_PENDING'
               WHERE "agencyId" = ${command.agencyId}::uuid
                 AND "fixtureRunId" = ${command.fixtureRunId}::uuid
                 AND "state" = 'OPEN'
              RETURNING "agencyId"::text AS "agencyId",
                        "fixtureRunId"::text AS "fixtureRunId",
                        "createdByStaffPrincipalId",
                        "portalPrincipalId",
                        "state"
            `.execute(database)
          ).rows[0];
          if (pending === undefined) return null;
          return { status: "READY", plan: await readPlan(database, pending, command) };
        }
        if (run.state !== "CLEANUP_PENDING") return null;
        return { status: "READY", plan: await readPlan(database, run, command) };
      });
    },

    completeCleanup(commandValue, authorization) {
      return runAuthorized(commandValue, authorization, async (database, command) => {
        const run = await readRun(database, command);
        if (run === null) return null;
        if (run.state === "CLEANED") return receiptFromRun(database, run, command);
        if (run.state !== "CLEANUP_PENDING") return null;
        const plan = await readPlan(database, run, command);
        if (!(await assertFullyCleaned(database, plan))) return null;
        const cleaned = (
          await sql<FixtureRunRow>`
            UPDATE "portal_access"."runtime_acceptance_fixture_run"
               SET "state" = 'CLEANED'
             WHERE "agencyId" = ${command.agencyId}::uuid
               AND "fixtureRunId" = ${command.fixtureRunId}::uuid
               AND "state" = 'CLEANUP_PENDING'
            RETURNING "agencyId"::text AS "agencyId",
                      "fixtureRunId"::text AS "fixtureRunId",
                      "createdByStaffPrincipalId",
                      "portalPrincipalId",
                      "state"
          `.execute(database)
        ).rows[0];
        if (cleaned === undefined) return null;
        return receiptFromRun(database, cleaned, command);
      });
    },
  };
  return Object.freeze(repository);
};
