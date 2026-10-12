import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asOpaqueId,
  bootstrapRootAgency,
  createM1StaffTripOperations,
  createMoney,
  createScheduledLocalDateTime,
  OWNER_ROLE_PERMISSION_IDS,
  type M1StaffSessionResolver,
  type M1StaffTripOperations,
  type M1StaffTripPublicationOperations,
  type PublicationHistoryEntry,
  type StaffSessionAuthorizationProof,
} from "@travelos/backend-core";
import type { CreateM1TripSliceInput } from "@travelos/backend-core";
import { canonicalPortalTripSnapshotV1Json } from "@travelos/backend-core";
import { createM1OperationalSliceRepository } from "../../packages/database/src/trip-operations/m1-operational-slice-repository.js";
import {
  createPostgresM1StaffTripPublicationOperations,
  createPostgresPersistence,
  createStaffAccessRepository,
  createUuidV7,
} from "@travelos/database";
import { PortalTripSnapshotV1Schema } from "../../packages/contracts/src/portal/index.js";
import {
  runMigrationChain,
  type MigrationChain,
  type MigrationTarget,
} from "../../tooling/database/migration-runner.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const host = process.env["PGHOST"] ?? "";
const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
const postgresBin = process.env["TRAVELOS_STAGE6_PG_BIN"] ?? "";
const workRoot = process.env["TRAVELOS_STAGE6_WORK_ROOT"] ?? "";
const databaseName = "travelos_stage6_qualification";
const agencyId = asOpaqueId("00000000-0000-7000-8000-000000000001");
const staffPrincipalId = `stage6-${createUuidV7()}`;
const sessionId = `stage6-session-${createUuidV7()}`;
const staffEmail = `stage6-${createUuidV7()}@example.test`;
const cookie = "stage6_session=synthetic";

const productionChain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
};
const migrationTarget: MigrationTarget = {
  host,
  port,
  database: databaseName,
  migratorRole: "travelos_migrator",
  ownerRole: "travelos_owner",
  tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  allowTrustAuthenticationForTests: true,
};

let persistence: ReturnType<typeof createPostgresPersistence<Record<string, never>>> | null = null;
let staffOperations: M1StaffTripOperations;
let publicationOperations: M1StaffTripPublicationOperations;
let slice: Awaited<ReturnType<M1StaffTripOperations["createTripSlice"]>>;
let predecessorMigrationDirectory: string | null = null;
let sessionProof: StaffSessionAuthorizationProof;
let roleId = "";

const clientFor = async (user: string, database = databaseName): Promise<Client> => {
  const client = new Client({
    host,
    port,
    database,
    user,
    ssl: false,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  return client;
};

const queryAs = async <Row extends QueryResultRow>(
  user: string,
  statement: string,
): Promise<readonly Row[]> => {
  const client = await clientFor(user);
  try {
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.end();
  }
};

const queryAsOwner = async <Row extends QueryResultRow>(
  _loginRole: string,
  statement: string,
): Promise<readonly Row[]> => {
  const client = await clientFor("travelos_migrator");
  try {
    await client.query('SET ROLE "travelos_owner"');
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
};

const queryErrorCode = async (work: () => Promise<unknown>): Promise<string | null> => {
  try {
    await work();
    return null;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code?: unknown }).code ?? "")
      : null;
  }
};

const withOwnerTransaction = async <Result>(
  work: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = await clientFor("travelos_migrator");
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

const bootstrapDatabase = (): void => {
  const result = spawnSync(
    path.join(postgresBin, "psql"),
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--set",
      `database_name=${databaseName}`,
      "--dbname",
      "postgres",
      "--file",
      path.join(repositoryRoot, "deploy/database/bootstrap-database-and-roles.sql"),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: host,
        PGPORT: String(port),
        PGDATABASE: "postgres",
        PGUSER: "postgres",
        PGSSLMODE: "disable",
      },
    },
  );
  if (result.status !== 0) throw new Error(`Stage 6 database bootstrap failed: ${result.stderr}`);
};

const stage5MigrationChain = async (): Promise<MigrationChain> => {
  const manifest = JSON.parse(await readFile(productionChain.checksumManifestPath, "utf8")) as {
    readonly schemaVersion: number;
    readonly algorithm: string;
    readonly migrations: readonly { readonly file: string; readonly sha256: string }[];
  };
  const stage5Migrations = manifest.migrations.filter(
    ({ file }) => file !== "0011_stage6_trip_publication.cjs",
  );
  if (stage5Migrations.at(-1)?.file !== "0010_stage5_temporal_persistence_parity.cjs") {
    throw new Error("The Stage 5 predecessor migration chain must end at 0010");
  }
  const directory = await mkdtemp(path.join(workRoot, "stage5-migrations-"));
  predecessorMigrationDirectory = directory;
  for (const migration of stage5Migrations) {
    await copyFile(
      path.join(productionChain.directory, migration.file),
      path.join(directory, migration.file),
    );
  }
  const checksumManifestPath = path.join(directory, "checksums.json");
  await writeFile(
    checksumManifestPath,
    `${JSON.stringify({ ...manifest, migrations: stage5Migrations }, null, 2)}\n`,
  );
  return { directory, checksumManifestPath };
};

const tripInput = (): CreateM1TripSliceInput => ({
  agencyId,
  person: {
    givenName: "Synthetic",
    familyName: "Traveller",
    email: `traveller-${createUuidV7()}@example.test`,
  },
  customer: { displayName: "Synthetic Stage 6 Customer" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: {
    title: "Stage 6 Synthetic Trip",
    startDate: "2026-10-12",
    endDate: "2026-10-15",
    state: "DRAFT",
  },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Outbound flight",
    description: "Synthetic flight description",
    carrier: "Example Air",
    flightNumber: "EA100",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: createScheduledLocalDateTime({
      localDate: "2026-10-12",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-10-12T08:00:00Z",
    }),
    arrival: createScheduledLocalDateTime({
      localDate: "2026-10-12",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-10-12T09:00:00Z",
    }),
    terminal: null,
    cabin: "ECONOMY",
    baggage: "One cabin bag",
    seat: null,
    customerBookingReference: "SYNTH-FLIGHT-1",
  },
  accommodation: {
    title: "Synthetic hotel",
    description: "Synthetic accommodation description",
    propertyName: "Example Hotel",
    checkIn: createScheduledLocalDateTime({
      localDate: "2026-10-12",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-10-12T14:00:00Z",
    }),
    checkOut: createScheduledLocalDateTime({
      localDate: "2026-10-15",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-10-15T10:00:00Z",
    }),
    roomDescription: "Double room",
    boardType: "BREAKFAST",
    customerBookingReference: "SYNTH-HOTEL-1",
  },
  reservation: {
    supplierName: "Synthetic Supplier",
    supplierReference: `SUP-${createUuidV7()}`,
    customerBookingReference: "SYNTH-RES-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: createMoney("12345", "EUR", 2),
    internalNote: "INTERNAL_ONLY SENTINEL - never publish",
  },
});

const authorizationSessionResolver: M1StaffSessionResolver = {
  resolveStaffSession: async (cookieHeader) => (cookieHeader === cookie ? sessionProof : null),
};

beforeAll(async () => {
  if (
    !/^127\.0\.0\.1$/u.test(host) ||
    !Number.isInteger(port) ||
    postgresBin.length === 0 ||
    !workRoot.startsWith(`${os.tmpdir()}${path.sep}`)
  ) {
    throw new Error(
      "Stage 6 disposable PostgreSQL environment is incomplete or not loopback-bound",
    );
  }
  bootstrapDatabase();
  await runMigrationChain(migrationTarget, await stage5MigrationChain());
  const migration = await runMigrationChain(migrationTarget, productionChain);
  expect(migration.result).toBe("PASS");

  persistence = createPostgresPersistence<Record<string, never>>({
    host,
    port,
    database: databaseName,
    user: "travelos_admin_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "travelos-stage6-qualification",
    maxConnections: 8,
  });
  const staffAccess = createStaffAccessRepository(persistence);
  await bootstrapRootAgency(staffAccess, {
    agencyId,
    bootstrapReference: "stage6-qualification",
    slug: "stage6-qualification",
  });

  roleId = createUuidV7();
  const membershipId = createUuidV7();
  const assignmentId = createUuidV7();
  await withOwnerTransaction(async (client) => {
    await client.query(
      `INSERT INTO "staff_access"."staff_user" ("id", "name", "email", "emailVerified", "twoFactorEnabled")
       VALUES ($1, 'Stage 6 Synthetic Staff', $2, true, true)`,
      [staffPrincipalId, staffEmail],
    );
    await client.query(
      `INSERT INTO "staff_access"."staff_membership" ("id", "agencyId", "staffPrincipalId", "state")
       VALUES ($1::uuid, $2::uuid, $3, 'ACTIVE')`,
      [membershipId, agencyId, staffPrincipalId],
    );
    await client.query(
      `INSERT INTO "staff_access"."staff_session" ("id", "expiresAt", "token", "updatedAt", "userId")
       VALUES ($1, now() + interval '1 hour', $2, now(), $3)`,
      [sessionId, `token-${createUuidV7()}`, staffPrincipalId],
    );
    await client.query(
      `INSERT INTO "staff_access"."role" ("id", "agencyId", "displayName")
       VALUES ($1::uuid, $2::uuid, 'Stage 6 Synthetic Staff')`,
      [roleId, agencyId],
    );
    await client.query(
      `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
       SELECT $1::uuid, permission_id, 'AGENCY', 'ALL' FROM unnest($2::text[]) AS permission_id`,
      [roleId, [...OWNER_ROLE_PERMISSION_IDS]],
    );
    await client.query(
      `INSERT INTO "staff_access"."role_assignment" ("id", "agencyId", "membershipId", "roleId", "scopeKind", "organizationUnitId", "active")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'AGENCY', NULL, true)`,
      [assignmentId, agencyId, membershipId, roleId],
    );
    await client.query(
      `INSERT INTO "staff_access"."staff_session_context" ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
       SELECT $1, membership."staffPrincipalId", membership."agencyId", membership."authorizationEpoch", now()
         FROM "staff_access"."staff_membership" AS membership WHERE membership."id"=$2::uuid`,
      [sessionId, membershipId],
    );
  });
  const authorizationSnapshot = await staffAccess.getStaffAuthorizationSnapshot(
    staffPrincipalId,
    agencyId,
  );
  if (authorizationSnapshot === null)
    throw new Error("Stage 6 Staff authorization fixture missing");
  sessionProof = {
    sessionId,
    staffPrincipalId,
    agencyId,
    authorizationEpoch: authorizationSnapshot.authorizationEpoch,
    expiresAtEpochMs: Date.now() + 60 * 60 * 1_000,
    recentMfaVerifiedAtEpochMs: Date.now(),
  };

  const operationalRepository = createM1OperationalSliceRepository(persistence);
  staffOperations = createM1StaffTripOperations({
    repository: operationalRepository,
    authorizationRepository: staffAccess,
    sessionResolver: authorizationSessionResolver,
  });
  slice = await staffOperations.createTripSlice(cookie, tripInput());
  publicationOperations = createPostgresM1StaffTripPublicationOperations(
    persistence,
    authorizationSessionResolver,
    {
      validate(value) {
        PortalTripSnapshotV1Schema.parse(value);
      },
    },
  );
});

afterAll(async () => {
  try {
    await persistence?.destroy();
  } finally {
    if (predecessorMigrationDirectory !== null)
      await rm(predecessorMigrationDirectory, { recursive: true, force: true });
  }
});

describe.sequential("TravelOS Stage 6 disposable PostgreSQL publication qualification", () => {
  it("upgrades the Stage 5 schema and proves Preview is read-only", async () => {
    const before = await queryAsOwner<{
      versions: string;
      snapshots: string;
      pointers: string;
      idempotency: string;
      events: string;
      audits: string;
      outbox: string;
      lockGeneration: string;
    }>(
      "travelos_admin_api",
      `SELECT
        (SELECT count(*) FROM "trip_ops"."publication_version")::text AS versions,
        (SELECT count(*) FROM "trip_ops"."publication_snapshot")::text AS snapshots,
        (SELECT count(*) FROM "trip_ops"."publication_pointer")::text AS pointers,
        (SELECT count(*) FROM "trip_ops"."publication_idempotency")::text AS idempotency,
        (SELECT count(*) FROM "trip_ops"."publication_event")::text AS events,
        (SELECT count(*) FROM "audit"."trip_publication_event")::text AS audits,
        (SELECT count(*) FROM "integration"."trip_publication_outbox")::text AS outbox,
        (SELECT COALESCE(sum("generation"), 0) FROM "trip_ops"."publication_lock")::text AS "lockGeneration"`,
    );
    const first = await publicationOperations.previewTrip(cookie, slice.trip.id);
    const second = await publicationOperations.previewTrip(cookie, slice.trip.id);
    expect(first).toEqual(second);
    expect(first.projection.items.map((item) => item.kind)).toEqual(["FLIGHT", "ACCOMMODATION"]);
    expect(JSON.stringify(first.projection)).not.toContain("INTERNAL_ONLY SENTINEL");
    const after = await queryAsOwner<{
      versions: string;
      snapshots: string;
      pointers: string;
      idempotency: string;
      events: string;
      audits: string;
      outbox: string;
      lockGeneration: string;
    }>(
      "travelos_admin_api",
      `SELECT
        (SELECT count(*) FROM "trip_ops"."publication_version")::text AS versions,
        (SELECT count(*) FROM "trip_ops"."publication_snapshot")::text AS snapshots,
        (SELECT count(*) FROM "trip_ops"."publication_pointer")::text AS pointers,
        (SELECT count(*) FROM "trip_ops"."publication_idempotency")::text AS idempotency,
        (SELECT count(*) FROM "trip_ops"."publication_event")::text AS events,
        (SELECT count(*) FROM "audit"."trip_publication_event")::text AS audits,
        (SELECT count(*) FROM "integration"."trip_publication_outbox")::text AS outbox,
        (SELECT COALESCE(sum("generation"), 0) FROM "trip_ops"."publication_lock")::text AS "lockGeneration"`,
    );
    expect(after).toEqual(before);
    expect(after[0]).toEqual({
      versions: "0",
      snapshots: "0",
      pointers: "0",
      idempotency: "0",
      events: "0",
      audits: "0",
      outbox: "0",
      lockGeneration: "0",
    });
  });

  it("publishes immutable v1/v2, replays idempotency, rejects stale candidates and keeps records atomic", async () => {
    const preview1 = await publicationOperations.previewTrip(cookie, slice.trip.id);
    const request1 = {
      expectedWorkspaceRevision: preview1.workspaceRevision.toString(),
      expectedProjectionHash: preview1.projectionHash,
      idempotencyKey: "stage6-publish-v1",
    };
    const v1 = await publicationOperations.publishTrip(cookie, slice.trip.id, request1);
    expect(v1.version).toBe(1);
    expect(v1.projection).toEqual(preview1.projection);
    const replay = await publicationOperations.publishTrip(cookie, slice.trip.id, request1);
    expect(replay.publicationId).toBe(v1.publicationId);
    expect(replay.version).toBe(1);

    await expect(
      publicationOperations.publishTrip(cookie, slice.trip.id, {
        ...request1,
        expectedProjectionHash: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });

    const oldPayload = (
      await queryAs<{ canonicalPayload: string }>(
        "travelos_admin_api",
        `SELECT "canonicalPayload" FROM "trip_ops"."publication_snapshot" WHERE "publicationId"='${v1.publicationId}'::uuid`,
      )
    )[0]?.canonicalPayload;
    if (oldPayload === undefined) throw new Error("Published v1 payload missing");

    const accommodation = slice.accommodations[0];
    if (accommodation === undefined) throw new Error("Synthetic accommodation missing");
    const updatedSlice = await staffOperations.updateAccommodation(cookie, {
      agencyId,
      tripId: slice.trip.id,
      itemId: accommodation.id,
      expectedLockVersion: accommodation.lockVersion,
      title: "Synthetic hotel v2",
      description: "Updated synthetic presentation",
    });
    const staleCountsBefore = await queryAsOwner<{
      versions: string;
      events: string;
      audits: string;
      outbox: string;
    }>(
      "travelos_admin_api",
      `SELECT
        (SELECT count(*) FROM "trip_ops"."publication_version")::text AS versions,
        (SELECT count(*) FROM "trip_ops"."publication_event")::text AS events,
        (SELECT count(*) FROM "audit"."trip_publication_event")::text AS audits,
        (SELECT count(*) FROM "integration"."trip_publication_outbox")::text AS outbox`,
    );
    await expect(
      publicationOperations.publishTrip(cookie, slice.trip.id, {
        ...request1,
        idempotencyKey: "stage6-stale-revision",
      }),
    ).rejects.toMatchObject({ code: "STALE_PUBLICATION_CANDIDATE" });
    const staleCountsAfter = await queryAsOwner<{
      versions: string;
      events: string;
      audits: string;
      outbox: string;
    }>(
      "travelos_admin_api",
      `SELECT
        (SELECT count(*) FROM "trip_ops"."publication_version")::text AS versions,
        (SELECT count(*) FROM "trip_ops"."publication_event")::text AS events,
        (SELECT count(*) FROM "audit"."trip_publication_event")::text AS audits,
        (SELECT count(*) FROM "integration"."trip_publication_outbox")::text AS outbox`,
    );
    expect(staleCountsAfter).toEqual(staleCountsBefore);

    await expect(
      publicationOperations.publishTrip(cookie, slice.trip.id, {
        ...request1,
        expectedProjectionHash: "c".repeat(64),
        idempotencyKey: "stage6-stale-hash",
      }),
    ).rejects.toMatchObject({ code: "STALE_PUBLICATION_CANDIDATE" });
    const staleHashCountsAfter = await queryAsOwner<{
      versions: string;
      events: string;
      audits: string;
      outbox: string;
    }>(
      "travelos_admin_api",
      `SELECT
        (SELECT count(*) FROM "trip_ops"."publication_version")::text AS versions,
        (SELECT count(*) FROM "trip_ops"."publication_event")::text AS events,
        (SELECT count(*) FROM "audit"."trip_publication_event")::text AS audits,
        (SELECT count(*) FROM "integration"."trip_publication_outbox")::text AS outbox`,
    );
    expect(staleHashCountsAfter).toEqual(staleCountsBefore);

    const preview2 = await publicationOperations.previewTrip(cookie, slice.trip.id);
    expect(preview2.projectionHash).not.toBe(preview1.projectionHash);
    expect(preview2.projection.items[1]?.title).toBe("Synthetic hotel v2");
    const v2 = await publicationOperations.publishTrip(cookie, slice.trip.id, {
      expectedWorkspaceRevision: preview2.workspaceRevision.toString(),
      expectedProjectionHash: preview2.projectionHash,
      idempotencyKey: "stage6-publish-v2",
    });
    expect(v2.version).toBe(2);
    expect(v2.isActive).toBe(true);
    expect(
      (await publicationOperations.listPublicationHistory(cookie, slice.trip.id)).entries.map(
        (entry) => [entry.version, entry.isActive],
      ),
    ).toEqual([
      [2, true],
      [1, false],
    ]);

    const postV2Accommodation = updatedSlice.accommodations[0];
    if (postV2Accommodation === undefined) throw new Error("Updated accommodation missing");
    await staffOperations.updateAccommodation(cookie, {
      agencyId,
      tripId: slice.trip.id,
      itemId: postV2Accommodation.id,
      expectedLockVersion: postV2Accommodation.lockVersion,
      title: "Synthetic hotel v3",
      description: "Rollback/concurrency probe presentation",
    });
    const previewForFailedPublish = await publicationOperations.previewTrip(cookie, slice.trip.id);

    const failureCountsBefore = await queryAsOwner<{
      versions: string;
      events: string;
      audits: string;
      outbox: string;
    }>(
      "travelos_admin_api",
      `SELECT
        (SELECT count(*) FROM "trip_ops"."publication_version")::text AS versions,
        (SELECT count(*) FROM "trip_ops"."publication_event")::text AS events,
        (SELECT count(*) FROM "audit"."trip_publication_event")::text AS audits,
        (SELECT count(*) FROM "integration"."trip_publication_outbox")::text AS outbox`,
    );
    await queryAsOwner(
      "travelos_admin_api",
      `CREATE FUNCTION "trip_ops"."stage6_reject_publication_event"() RETURNS trigger
         LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Stage 6 rollback probe'; END $$;
       CREATE TRIGGER "stage6_reject_publication_event"
         BEFORE INSERT ON "trip_ops"."publication_event"
         FOR EACH ROW EXECUTE FUNCTION "trip_ops"."stage6_reject_publication_event"()`,
    );
    try {
      await expect(
        publicationOperations.publishTrip(cookie, slice.trip.id, {
          expectedWorkspaceRevision: previewForFailedPublish.workspaceRevision.toString(),
          expectedProjectionHash: previewForFailedPublish.projectionHash,
          idempotencyKey: "stage6-rollback-probe",
        }),
      ).rejects.toThrow();
    } finally {
      await queryAsOwner(
        "travelos_admin_api",
        `DROP TRIGGER "stage6_reject_publication_event" ON "trip_ops"."publication_event";
         DROP FUNCTION "trip_ops"."stage6_reject_publication_event"()`,
      );
    }
    const failureCountsAfter = await queryAsOwner<{
      versions: string;
      events: string;
      audits: string;
      outbox: string;
    }>(
      "travelos_admin_api",
      `SELECT
        (SELECT count(*) FROM "trip_ops"."publication_version")::text AS versions,
        (SELECT count(*) FROM "trip_ops"."publication_event")::text AS events,
        (SELECT count(*) FROM "audit"."trip_publication_event")::text AS audits,
        (SELECT count(*) FROM "integration"."trip_publication_outbox")::text AS outbox`,
    );
    expect(failureCountsAfter).toEqual(failureCountsBefore);
    expect(
      (await publicationOperations.listPublicationHistory(cookie, slice.trip.id)).entries.map(
        (entry: PublicationHistoryEntry) => [entry.version, entry.isActive],
      ),
    ).toEqual([
      [2, true],
      [1, false],
    ]);

    const concurrentRequest = {
      expectedWorkspaceRevision: previewForFailedPublish.workspaceRevision.toString(),
      expectedProjectionHash: previewForFailedPublish.projectionHash,
      idempotencyKey: "stage6-concurrent-publish-v3",
    };
    const blocker = await clientFor("travelos_admin_api");
    const monitor = await clientFor("postgres");
    let concurrentAttempts: Promise<
      [
        Awaited<ReturnType<typeof publicationOperations.publishTrip>>,
        Awaited<ReturnType<typeof publicationOperations.publishTrip>>,
      ]
    > | null = null;
    try {
      await blocker.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await blocker.query(
        `SELECT * FROM "trip_ops"."lock_trip_for_publication"($1::uuid, $2::uuid)`,
        [agencyId, slice.trip.id],
      );
      concurrentAttempts = Promise.all([
        publicationOperations.publishTrip(cookie, slice.trip.id, concurrentRequest),
        publicationOperations.publishTrip(cookie, slice.trip.id, concurrentRequest),
      ]);
      const blockedDeadline = Date.now() + 3_000;
      let blockedPublishers = 0;
      while (Date.now() < blockedDeadline) {
        const blocked = await monitor.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM pg_stat_activity
            WHERE usename = 'travelos_admin_api'
              AND wait_event_type = 'Lock'
              AND cardinality(pg_blocking_pids(pid)) > 0`,
        );
        blockedPublishers = Number(blocked.rows[0]?.count ?? "0");
        if (blockedPublishers >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blockedPublishers).toBeGreaterThanOrEqual(2);
      await blocker.query("COMMIT");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end();
      await monitor.end();
      await concurrentAttempts?.catch(() => []);
    }
    if (concurrentAttempts === null)
      throw new Error("Concurrent publication attempts did not start");
    const [concurrentA, concurrentB] = await concurrentAttempts;
    expect(concurrentA.publicationId).toBe(concurrentB.publicationId);
    expect(concurrentA.version).toBe(3);
    expect(
      (await publicationOperations.listPublicationHistory(cookie, slice.trip.id)).entries.map(
        (entry: PublicationHistoryEntry) => [entry.version, entry.isActive],
      ),
    ).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);

    const newOldPayload = (
      await queryAs<{ canonicalPayload: string }>(
        "travelos_admin_api",
        `SELECT "canonicalPayload" FROM "trip_ops"."publication_snapshot" WHERE "publicationId"='${v1.publicationId}'::uuid`,
      )
    )[0]?.canonicalPayload;
    expect(newOldPayload).toBe(oldPayload);
    expect(newOldPayload).toBe(canonicalPortalTripSnapshotV1Json(preview1.projection));

    expect(
      await queryErrorCode(() =>
        queryAs(
          "travelos_admin_api",
          `UPDATE "trip_ops"."publication_snapshot" SET "canonicalPayload"='{}' WHERE "publicationId"='${v1.publicationId}'::uuid`,
        ),
      ),
    ).toBe("42501");
    expect(
      await queryErrorCode(() =>
        queryAs(
          "travelos_admin_api",
          `DELETE FROM "trip_ops"."publication_version" WHERE "publicationId"='${v1.publicationId}'::uuid`,
        ),
      ),
    ).toBe("42501");
    expect(
      await queryErrorCode(() =>
        queryAs(
          "travelos_admin_api",
          `UPDATE "trip_ops"."publication_lock" SET "generation"="generation"+1
            WHERE "agencyId"='${agencyId}'::uuid AND "tripId"='${slice.trip.id}'::uuid`,
        ),
      ),
    ).toBe("42501");
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          "travelos_admin_api",
          `UPDATE "trip_ops"."publication_snapshot" SET "canonicalPayload"='{}'
            WHERE "publicationId"='${v1.publicationId}'::uuid`,
        ),
      ),
    ).toBe("55000");
    const totals = await queryAsOwner<{
      versions: string;
      events: string;
      audits: string;
      outbox: string;
    }>(
      "travelos_admin_api",
      `SELECT
        (SELECT count(*) FROM "trip_ops"."publication_version")::text AS versions,
        (SELECT count(*) FROM "trip_ops"."publication_event")::text AS events,
        (SELECT count(*) FROM "audit"."trip_publication_event")::text AS audits,
        (SELECT count(*) FROM "integration"."trip_publication_outbox")::text AS outbox`,
    );
    expect(totals[0]).toEqual({ versions: "3", events: "3", audits: "3", outbox: "3" });

    const currentPreview = await publicationOperations.previewTrip(cookie, slice.trip.id);
    await withOwnerTransaction(async (client) => {
      await client.query(
        `UPDATE "staff_access"."staff_session_context"
            SET "recentMfaVerifiedAt" = now() - interval '2 hours'
          WHERE "sessionId" = $1`,
        [sessionProof.sessionId],
      );
    });
    try {
      await expect(
        publicationOperations.publishTrip(cookie, slice.trip.id, {
          expectedWorkspaceRevision: currentPreview.workspaceRevision.toString(),
          expectedProjectionHash: currentPreview.projectionHash,
          idempotencyKey: "stage6-stale-mfa",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await withOwnerTransaction(async (client) => {
        await client.query(
          `UPDATE "staff_access"."staff_session_context"
              SET "recentMfaVerifiedAt" = now()
            WHERE "sessionId" = $1`,
          [sessionProof.sessionId],
        );
      });
    }
  });

  it("rejects unauthenticated and unauthorized direct use-case invocation", async () => {
    const denied = createPostgresM1StaffTripPublicationOperations(
      persistence!,
      { resolveStaffSession: async () => null },
      {
        validate(value) {
          PortalTripSnapshotV1Schema.parse(value);
        },
      },
    );
    await expect(denied.previewTrip(cookie, slice.trip.id)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    await withOwnerTransaction(async (client) => {
      await client.query(
        `DELETE FROM "staff_access"."role_permission"
          WHERE "roleId" = $1::uuid AND "permissionId" = 'trip.preview'`,
        [roleId],
      );
    });
    try {
      await expect(publicationOperations.previewTrip(cookie, slice.trip.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await withOwnerTransaction(async (client) => {
        await client.query(
          `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
           VALUES ($1::uuid, 'trip.preview', 'AGENCY', 'ALL') ON CONFLICT DO NOTHING`,
          [roleId],
        );
      });
    }
  });
});
