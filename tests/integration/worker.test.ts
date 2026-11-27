import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkerClaim, WorkerRepository } from "@travelos/backend-core";
import * as databaseExports from "../../packages/database/src/index.js";
import type { PostgresPersistence } from "../../packages/database/src/index.js";
import {
  createDatabase,
  createOwnerClient,
  host,
  migrateToHead,
  port,
  productionChain,
  productionMigrationNames,
  requireHarness,
  runMigrationChain,
  targetFor,
} from "./helpers/postgres.js";

const database = "travelos_worker";
const agencyId = "019a0000-0000-7000-8000-000000000008";
let owner: Client;
let workerPersistence: PostgresPersistence<Record<string, never>>;

const worker = (): WorkerRepository => {
  const factory = (
    databaseExports as unknown as {
      createWorkerRepository?: (
        persistence: PostgresPersistence<Record<string, never>>,
      ) => WorkerRepository;
    }
  ).createWorkerRepository;
  expect(factory).toBeTypeOf("function");
  return factory!(workerPersistence);
};
const staffId = "worker-synthetic-staff";
const personId = randomUUID();
const tripId = randomUUID();
let publicationVersion = 0;
const sourceMessage = async (correlationId?: string): Promise<string> => {
  const publicationId = randomUUID();
  const eventId = randomUUID();
  const messageId = randomUUID();
  publicationVersion += 1;
  await owner.query("BEGIN");
  try {
    if (correlationId !== undefined)
      await owner.query("SELECT set_config('travelos.correlation_id', $1, true)", [correlationId]);
    await owner.query(
      'INSERT INTO trip_ops.publication_version ("publicationId", "agencyId", "tripId", "version", "workspaceRevision", "schemaVersion", "projectionHash", "publisherStaffPrincipalId", "assuranceVerifiedAt") VALUES ($1,$2,$3,$4,0,1,$5,$6,clock_timestamp())',
      [publicationId, agencyId, tripId, publicationVersion, "a".repeat(64), staffId],
    );
    await owner.query(
      'INSERT INTO trip_ops.publication_event ("eventId", "agencyId", "tripId", "publicationId", "version", "eventType", "actorStaffPrincipalId") VALUES ($1,$2,$3,$4,$5,\'TRIP_PUBLICATION_PUBLISHED\',$6)',
      [eventId, agencyId, tripId, publicationId, publicationVersion, staffId],
    );
    await owner.query(
      'INSERT INTO integration.trip_publication_outbox ("messageId", "eventId", "agencyId", "tripId", "publicationId", "version", "eventType") VALUES ($1,$2,$3,$4,$5,$6,\'TRIP_PUBLICATION_PUBLISHED\')',
      [messageId, eventId, agencyId, tripId, publicationId, publicationVersion],
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  }
  return messageId;
};
const claim = async (repository: WorkerRepository): Promise<WorkerClaim> => {
  await repository.dispatch();
  const result = await repository.claim(randomUUID());
  expect(result).not.toBeNull();
  return result!;
};
const activityCount = async (messageId: string): Promise<number> =>
  (
    await owner.query(
      'SELECT count(*)::integer AS count FROM activity.entry WHERE "messageId"=$1',
      [messageId],
    )
  ).rows[0].count as number;

const workerRequiredPrivileges = [
  {
    capability: "SELECT integration.event_context",
    revoke: "REVOKE SELECT ON integration.event_context FROM travelos_worker_runtime",
    grant: "GRANT SELECT ON integration.event_context TO travelos_worker_runtime",
  },
  {
    capability: "USAGE job_runtime",
    revoke: "REVOKE USAGE ON SCHEMA job_runtime FROM travelos_worker_runtime",
    grant: "GRANT USAGE ON SCHEMA job_runtime TO travelos_worker_runtime",
  },
  {
    capability: "USAGE integration",
    revoke: "REVOKE USAGE ON SCHEMA integration FROM travelos_worker_runtime",
    grant: "GRANT USAGE ON SCHEMA integration TO travelos_worker_runtime",
  },
  {
    capability: "USAGE activity",
    revoke: "REVOKE USAGE ON SCHEMA activity FROM travelos_worker_runtime",
    grant: "GRANT USAGE ON SCHEMA activity TO travelos_worker_runtime",
  },
  {
    capability: "SELECT job_runtime.job",
    revoke: "REVOKE SELECT ON job_runtime.job FROM travelos_worker_runtime",
    grant: "GRANT SELECT ON job_runtime.job TO travelos_worker_runtime",
  },
  {
    capability: "INSERT job_runtime.job",
    revoke: "REVOKE INSERT ON job_runtime.job FROM travelos_worker_runtime",
    grant: "GRANT INSERT ON job_runtime.job TO travelos_worker_runtime",
  },
  ...[
    "state",
    "attempt",
    "version",
    '"runAt"',
    '"owner"',
    '"leaseUntil"',
    '"deadline"',
    '"errorCode"',
  ].map((column) => ({
    capability: `UPDATE job_runtime.job.${column}`,
    revoke: `REVOKE UPDATE (${column}) ON job_runtime.job FROM travelos_worker_runtime`,
    grant: `GRANT UPDATE (${column}) ON job_runtime.job TO travelos_worker_runtime`,
  })),
  {
    capability: "SELECT job_runtime.attempt",
    revoke: "REVOKE SELECT ON job_runtime.attempt FROM travelos_worker_runtime",
    grant: "GRANT SELECT ON job_runtime.attempt TO travelos_worker_runtime",
  },
  {
    capability: "INSERT job_runtime.attempt",
    revoke: "REVOKE INSERT ON job_runtime.attempt FROM travelos_worker_runtime",
    grant: "GRANT INSERT ON job_runtime.attempt TO travelos_worker_runtime",
  },
  {
    capability: "SELECT integration.outbox_delivery",
    revoke: "REVOKE SELECT ON integration.outbox_delivery FROM travelos_worker_runtime",
    grant: "GRANT SELECT ON integration.outbox_delivery TO travelos_worker_runtime",
  },
  {
    capability: "INSERT integration.outbox_delivery",
    revoke: "REVOKE INSERT ON integration.outbox_delivery FROM travelos_worker_runtime",
    grant: "GRANT INSERT ON integration.outbox_delivery TO travelos_worker_runtime",
  },
  {
    capability: "UPDATE integration.outbox_delivery.state",
    revoke: "REVOKE UPDATE (state) ON integration.outbox_delivery FROM travelos_worker_runtime",
    grant: "GRANT UPDATE (state) ON integration.outbox_delivery TO travelos_worker_runtime",
  },
  {
    capability: "UPDATE integration.outbox_delivery.completedAt",
    revoke:
      'REVOKE UPDATE ("completedAt") ON integration.outbox_delivery FROM travelos_worker_runtime',
    grant: 'GRANT UPDATE ("completedAt") ON integration.outbox_delivery TO travelos_worker_runtime',
  },
  {
    capability: "SELECT integration.activity_source",
    revoke: "REVOKE SELECT ON integration.activity_source FROM travelos_worker_runtime",
    grant: "GRANT SELECT ON integration.activity_source TO travelos_worker_runtime",
  },
  {
    capability: "SELECT activity.entry",
    revoke: "REVOKE SELECT ON activity.entry FROM travelos_worker_runtime",
    grant: "GRANT SELECT ON activity.entry TO travelos_worker_runtime",
  },
  {
    capability: "INSERT activity.entry",
    revoke: "REVOKE INSERT ON activity.entry FROM travelos_worker_runtime",
    grant: "GRANT INSERT ON activity.entry TO travelos_worker_runtime",
  },
] as const;

beforeAll(async () => {
  requireHarness();
  createDatabase(database);
  await migrateToHead(database, {
    agencyId,
    bootstrapReference: "worker-synthetic-bootstrap",
    slug: "worker-synthetic",
  });
  owner = await createOwnerClient(database);
  workerPersistence = databaseExports.createPostgresPersistence({
    host,
    port,
    database,
    user: "travelos_worker",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "worker-test",
    maxConnections: 5,
  });
  await owner.query(
    'INSERT INTO staff_access.staff_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,\'Synthetic Worker Test\',\'worker@example.test\',true,now(),now())',
    [staffId],
  );
  await owner.query(
    'INSERT INTO staff_access.staff_membership (id, "agencyId", "staffPrincipalId", state) VALUES ($1,$2,$3,\'ACTIVE\')',
    [randomUUID(), agencyId, staffId],
  );
  await owner.query("BEGIN");
  await owner.query(
    'INSERT INTO crm.person (id, "agencyId", "givenName", "familyName") VALUES ($1,$2,\'Synthetic\',\'Worker\')',
    [personId, agencyId],
  );
  const customerId = randomUUID();
  await owner.query(
    'INSERT INTO crm.customer (id, "agencyId", "displayName") VALUES ($1,$2,\'Synthetic Worker\')',
    [customerId, agencyId],
  );
  await owner.query(
    'INSERT INTO crm.customer_person ("agencyId", "customerId", "personId", role, "isPrimary") VALUES ($1,$2,$3,\'PRIMARY_CONTACT\',true)',
    [agencyId, customerId, personId],
  );
  await owner.query(
    "INSERT INTO trip_ops.trip (id, \"agencyId\", title, \"startDate\", \"endDate\", state) VALUES ($1,$2,'Synthetic Worker','2026-11-01','2026-11-02','DRAFT')",
    [tripId, agencyId],
  );
  await owner.query(
    'INSERT INTO trip_ops.trip_traveller (id, "agencyId", "tripId", "personId", role) VALUES ($1,$2,$3,$4,\'PRIMARY_TRAVELLER\')',
    [randomUUID(), agencyId, tripId, personId],
  );
  await owner.query("COMMIT");
});

afterAll(async () => {
  await workerPersistence?.destroy();
  await owner?.end();
});

describe("Durable worker on PostgreSQL", () => {
  it("has the durable job tables and a canonical rerun is a no-op", async () => {
    const result = await runMigrationChain(targetFor(database), productionChain);
    expect(result.appliedMigrations).toEqual([]);
    expect(result.currentVersion).toBe((await productionMigrationNames()).at(-1));
    expect(
      (await owner.query("SELECT to_regclass('job_runtime.job')::text AS name")).rows[0].name,
    ).toBe("job_runtime.job");
  });

  it.each(workerRequiredPrivileges)(
    "reports not-ready when $capability is missing",
    async ({ revoke, grant }) => {
      await owner.query(revoke);
      try {
        expect(await worker().ready()).toBe(false);
      } finally {
        await owner.query(grant);
      }
      expect(await worker().ready()).toBe(true);
    },
  );

  it("requires a real same-Agency source for every delivery", async () => {
    await expect(
      owner.query(
        'INSERT INTO integration.outbox_delivery ("messageId", "agencyId", "publicationMessageId") VALUES ($1, $2, $1)',
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("dispatches concurrently without duplicate jobs and commits Activity with completion", async () => {
    const repository = worker();
    expect(await repository.ready()).toBe(true);
    const messageId = await sourceMessage();
    const dispatched = await Promise.all([
      repository.dispatch(),
      repository.dispatch(),
      repository.dispatch(),
    ]);
    expect(dispatched.reduce((sum, count) => sum + count, 0)).toBe(1);
    const lease = await claim(repository);
    expect(lease.messageId).toBe(messageId);
    expect(await repository.projectAndComplete(lease)).toBe(true);
    expect(await repository.projectAndComplete(lease)).toBe(false);
    expect(await repository.dispatch()).toBe(0);
    expect(await activityCount(messageId)).toBe(1);
    const state = (
      await owner.query(
        'SELECT job.state, delivery.state AS delivery FROM job_runtime.job AS job JOIN integration.outbox_delivery AS delivery USING ("agencyId", "messageId", consumer) WHERE job."messageId"=$1',
        [messageId],
      )
    ).rows[0];
    expect(state).toEqual({ state: "SUCCEEDED", delivery: "SUCCEEDED" });
  });

  it("captures request correlation atomically and uses stable context for legacy producers", async () => {
    const correlationId = randomUUID();
    const messageId = await sourceMessage(correlationId);
    const repository = worker();
    const lease = await claim(repository);
    expect(lease.messageId).toBe(messageId);
    expect(lease.correlationId).toBe(correlationId);
    expect(await repository.projectAndComplete(lease)).toBe(true);
    const legacyId = await sourceMessage();
    const legacy = await claim(repository);
    expect(legacy.messageId).toBe(legacyId);
    expect(legacy.correlationId).toBe(legacyId);
    expect(await repository.projectAndComplete(legacy)).toBe(true);
  });

  it("bounds task concurrency and does not hand the same job to two owners", async () => {
    const repository = worker();
    const ids = [await sourceMessage(), await sourceMessage(), await sourceMessage()];
    await repository.dispatch();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => repository.claim(randomUUID())),
    );
    const active = claims.filter((value): value is WorkerClaim => value !== null);
    expect(active).toHaveLength(2);
    expect(new Set(active.map((value) => value.messageId)).size).toBe(2);
    await Promise.all(active.map((value) => repository.projectAndComplete(value)));
    await repository.projectAndComplete(await claim(repository));
    for (const id of ids) expect(await activityCount(id)).toBe(1);
  });

  it("heartbeats with CAS and fences expired owners after restart recovery", async () => {
    const repository = worker();
    const messageId = await sourceMessage();
    const first = await claim(repository);
    const renewed = await repository.heartbeat(first);
    expect(renewed).not.toBeNull();
    expect(renewed!.version).not.toBe(first.version);
    expect(await repository.heartbeat(first)).toBeNull();
    expect(await repository.projectAndComplete(first)).toBe(false);
    await owner.query(
      'UPDATE job_runtime.job SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "messageId"=$1',
      [messageId],
    );
    expect(await repository.projectAndComplete(renewed!)).toBe(false);
    expect(await repository.heartbeat(renewed!)).toBeNull();
    expect(await repository.recover()).toBe(1);
    await owner.query('UPDATE job_runtime.job SET "runAt"=clock_timestamp() WHERE "messageId"=$1', [
      messageId,
    ]);
    const restarted = await claim(worker());
    expect(restarted.attempt).toBe(2);
    expect(await repository.fail(renewed!, "PERMANENT", 0)).toBe(false);
    expect(await repository.projectAndComplete(restarted)).toBe(true);
    expect(await activityCount(messageId)).toBe(1);
  });

  it("retries only safe temporary outcomes then dead-letters after five attempts", async () => {
    const repository = worker();
    const messageId = await sourceMessage();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const lease = await claim(repository);
      expect(lease.messageId).toBe(messageId);
      expect(lease.attempt).toBe(attempt);
      expect(await repository.fail(lease, "TEMPORARY", 1000)).toBe(true);
      expect(await repository.claim(randomUUID())).toBeNull();
      await owner.query(
        'UPDATE job_runtime.job SET "runAt"=clock_timestamp() WHERE "messageId"=$1',
        [messageId],
      );
    }
    expect(await repository.claim(randomUUID())).toBeNull();
    expect(await activityCount(messageId)).toBe(0);
    expect((await repository.inspect()).deadLetter).toBe(1);
    expect(
      (
        await owner.query(
          'SELECT count(*)::int AS count FROM job_runtime.attempt WHERE "messageId"=$1',
          [messageId],
        )
      ).rows[0].count,
    ).toBe(5);
  });

  it("quarantines ambiguous outcomes without replay and rejects invalid failure inputs", async () => {
    const repository = worker();
    const messageId = await sourceMessage();
    const lease = await claim(repository);
    await expect(repository.fail(lease, "TEMPORARY", -1)).rejects.toThrow();
    expect(await repository.fail(lease, "UNKNOWN_OUTCOME", 0)).toBe(true);
    expect(await repository.recover()).toBe(0);
    expect(await repository.claim(randomUUID())).toBeNull();
    expect(await activityCount(messageId)).toBe(0);
    expect((await repository.inspect()).unknownOutcome).toBe(1);
  });

  it("rolls back projection and completion on database failure while Audit persists", async () => {
    const repository = worker();
    const messageId = await sourceMessage();
    const lease = await claim(repository);
    await owner.query(
      `CREATE FUNCTION activity.synthetic_failure() RETURNS trigger LANGUAGE plpgsql AS $test$ BEGIN RAISE EXCEPTION 'Controlled synthetic rollback' USING ERRCODE='40001'; END $test$; CREATE TRIGGER synthetic_failure BEFORE INSERT ON activity.entry FOR EACH ROW EXECUTE FUNCTION activity.synthetic_failure()`,
    );
    try {
      await expect(repository.projectAndComplete(lease)).rejects.toMatchObject({
        code: "TEMPORARY",
      });
    } finally {
      await owner.query(
        "DROP TRIGGER synthetic_failure ON activity.entry; DROP FUNCTION activity.synthetic_failure()",
      );
    }
    expect(await activityCount(messageId)).toBe(0);
    expect(
      (await owner.query('SELECT state FROM job_runtime.job WHERE "messageId"=$1', [messageId]))
        .rows[0].state,
    ).toBe("RUNNING");
    expect(
      (
        await owner.query(
          'SELECT count(*)::int AS count FROM trip_ops.publication_event event JOIN integration.trip_publication_outbox outbox USING ("eventId", "publicationId", "agencyId", "tripId") WHERE outbox."messageId"=$1',
          [messageId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(await repository.fail(lease, "TEMPORARY", 0)).toBe(true);
    expect(await repository.projectAndComplete(await claim(repository))).toBe(true);
    expect(await activityCount(messageId)).toBe(1);
  });

  it("denies the Worker workspace, credentials and Audit access", async () => {
    for (const [user, queries] of [
      [
        "travelos_worker",
        [
          "SELECT * FROM trip_ops.trip",
          "SELECT * FROM trip_ops.publication_snapshot",
          "SELECT * FROM staff_access.staff_user",
          "SELECT * FROM audit.lead_event",
          "DELETE FROM activity.entry",
          'UPDATE activity.entry SET "schemaVersion"=1',
          "DELETE FROM job_runtime.job",
          "UPDATE job_runtime.attempt SET outcome='SUCCEEDED'",
        ],
      ],
    ] as const) {
      const connection = new Client({ host, port, database, user, ssl: false });
      await connection.connect();
      try {
        for (const query of queries)
          await expect(connection.query(query)).rejects.toMatchObject({ code: "42501" });
      } finally {
        await connection.end();
      }
    }
  });
});
