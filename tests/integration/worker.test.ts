import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  WorkerExecutionError,
  type WorkerClaim,
  type WorkerHandler,
  type WorkerRepository,
} from "@travelos/backend-core";
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

/** Test-only consumer: does nothing but the generic completion path. */
const noop: WorkerHandler = async () => undefined;

/**
 * Seeds a test-only delivery and its job as the owner role. The runtime role cannot insert either
 * row any more; only the generic claim, lease, retry and completion machinery is under test here.
 */
const seedJob = async (correlation?: { correlationId: string; traceparent?: string }) => {
  const messageId = randomUUID();
  await owner.query("BEGIN");
  try {
    await owner.query(
      "INSERT INTO integration.outbox_delivery (\"messageId\", \"agencyId\", consumer, state) VALUES ($1,$2,'ACTIVITY_V1','PENDING')",
      [messageId, agencyId],
    );
    await owner.query(
      "INSERT INTO job_runtime.job (\"messageId\", \"agencyId\", consumer, state) VALUES ($1,$2,'ACTIVITY_V1','PENDING')",
      [messageId, agencyId],
    );
    if (correlation !== undefined)
      await owner.query(
        'INSERT INTO integration.event_context ("messageId", "agencyId", "correlationId", traceparent) VALUES ($1,$2,$3,$4)',
        [messageId, agencyId, correlation.correlationId, correlation.traceparent ?? null],
      );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  }
  return messageId;
};
const claim = async (repository: WorkerRepository): Promise<WorkerClaim> => {
  const result = await repository.claim(randomUUID());
  expect(result).not.toBeNull();
  return result!;
};
const jobState = async (messageId: string) =>
  (
    await owner.query(
      'SELECT job.state, delivery.state AS delivery FROM job_runtime.job AS job JOIN integration.outbox_delivery AS delivery USING ("agencyId", "messageId", consumer) WHERE job."messageId"=$1',
      [messageId],
    )
  ).rows[0];
const attemptCount = async (messageId: string): Promise<number> =>
  (
    await owner.query(
      'SELECT count(*)::integer AS count FROM job_runtime.attempt WHERE "messageId"=$1',
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
    capability: "SELECT job_runtime.job",
    revoke: "REVOKE SELECT ON job_runtime.job FROM travelos_worker_runtime",
    grant: "GRANT SELECT ON job_runtime.job TO travelos_worker_runtime",
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

  it("requires a delivery row for every job", async () => {
    await expect(
      owner.query(
        'INSERT INTO job_runtime.job ("messageId", "agencyId", consumer) VALUES ($1, $2, \'ACTIVITY_V1\')',
        [randomUUID(), agencyId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("completes a claimed job once and records the outcome with the delivery", async () => {
    const repository = worker();
    expect(await repository.ready()).toBe(true);
    const messageId = await seedJob();
    const lease = await claim(repository);
    expect(lease.messageId).toBe(messageId);
    expect(await repository.complete(lease, noop)).toBe(true);
    expect(await repository.complete(lease, noop)).toBe(false);
    expect(await repository.claim(randomUUID())).toBeNull();
    expect(await jobState(messageId)).toEqual({ state: "SUCCEEDED", delivery: "SUCCEEDED" });
    expect(await attemptCount(messageId)).toBe(1);
  });

  it("carries request correlation from the delivery context and defaults it for legacy rows", async () => {
    const correlationId = randomUUID();
    const messageId = await seedJob({ correlationId });
    const repository = worker();
    const lease = await claim(repository);
    expect(lease.messageId).toBe(messageId);
    expect(lease.correlationId).toBe(correlationId);
    expect(await repository.complete(lease, noop)).toBe(true);
    const legacyId = await seedJob();
    const legacy = await claim(repository);
    expect(legacy.messageId).toBe(legacyId);
    expect(legacy.correlationId).toBe(legacyId);
    expect(await repository.complete(legacy, noop)).toBe(true);
  });

  it("bounds task concurrency and does not hand the same job to two owners", async () => {
    const repository = worker();
    const ids = [await seedJob(), await seedJob(), await seedJob()];
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => repository.claim(randomUUID())),
    );
    const active = claims.filter((value): value is WorkerClaim => value !== null);
    expect(active).toHaveLength(2);
    expect(new Set(active.map((value) => value.messageId)).size).toBe(2);
    await Promise.all(active.map((value) => repository.complete(value, noop)));
    await repository.complete(await claim(repository), noop);
    for (const id of ids) expect((await jobState(id)).state).toBe("SUCCEEDED");
  });

  it("heartbeats with CAS and fences expired owners after restart recovery", async () => {
    const repository = worker();
    const messageId = await seedJob();
    const first = await claim(repository);
    const renewed = await repository.heartbeat(first);
    expect(renewed).not.toBeNull();
    expect(renewed!.version).not.toBe(first.version);
    expect(await repository.heartbeat(first)).toBeNull();
    expect(await repository.complete(first, noop)).toBe(false);
    await owner.query(
      'UPDATE job_runtime.job SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "messageId"=$1',
      [messageId],
    );
    expect(await repository.complete(renewed!, noop)).toBe(false);
    expect(await repository.heartbeat(renewed!)).toBeNull();
    expect(await repository.recover()).toBe(1);
    await owner.query('UPDATE job_runtime.job SET "runAt"=clock_timestamp() WHERE "messageId"=$1', [
      messageId,
    ]);
    const restarted = await claim(worker());
    expect(restarted.attempt).toBe(2);
    expect(await repository.fail(renewed!, "PERMANENT", 0)).toBe(false);
    expect(await repository.complete(restarted, noop)).toBe(true);
    expect((await jobState(messageId)).state).toBe("SUCCEEDED");
  });

  it("retries only safe temporary outcomes then dead-letters after five attempts", async () => {
    const repository = worker();
    const messageId = await seedJob();
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
    expect(await jobState(messageId)).toEqual({ state: "DEAD_LETTER", delivery: "DEAD_LETTER" });
    expect((await repository.inspect()).deadLetter).toBe(1);
    expect(await attemptCount(messageId)).toBe(5);
  });

  it("dead-letters a permanent handler failure without retry", async () => {
    const repository = worker();
    const messageId = await seedJob();
    const lease = await claim(repository);
    expect(await repository.fail(lease, "PERMANENT", 0)).toBe(true);
    expect(await repository.claim(randomUUID())).toBeNull();
    expect(await jobState(messageId)).toEqual({ state: "DEAD_LETTER", delivery: "DEAD_LETTER" });
    expect(await attemptCount(messageId)).toBe(1);
  });

  it("quarantines ambiguous outcomes without replay and rejects invalid failure inputs", async () => {
    const repository = worker();
    const messageId = await seedJob();
    const lease = await claim(repository);
    await expect(repository.fail(lease, "TEMPORARY", -1)).rejects.toThrow();
    expect(await repository.fail(lease, "UNKNOWN_OUTCOME", 0)).toBe(true);
    expect(await repository.recover()).toBe(0);
    expect(await repository.claim(randomUUID())).toBeNull();
    expect(await jobState(messageId)).toEqual({
      state: "UNKNOWN_OUTCOME",
      delivery: "UNKNOWN_OUTCOME",
    });
    expect((await repository.inspect()).unknownOutcome).toBe(1);
  });

  it("rolls back the handler effect and completion on database failure", async () => {
    const repository = worker();
    const messageId = await seedJob();
    const lease = await claim(repository);
    await owner.query(
      `CREATE FUNCTION job_runtime.synthetic_failure() RETURNS trigger LANGUAGE plpgsql AS $test$ BEGIN RAISE EXCEPTION 'Controlled synthetic rollback' USING ERRCODE='40001'; END $test$; CREATE TRIGGER synthetic_failure BEFORE UPDATE ON integration.outbox_delivery FOR EACH ROW EXECUTE FUNCTION job_runtime.synthetic_failure()`,
    );
    try {
      await expect(repository.complete(lease, noop)).rejects.toMatchObject({
        code: "TEMPORARY",
      });
    } finally {
      await owner.query(
        "DROP TRIGGER synthetic_failure ON integration.outbox_delivery; DROP FUNCTION job_runtime.synthetic_failure()",
      );
    }
    expect((await jobState(messageId)).state).toBe("RUNNING");
    expect(await attemptCount(messageId)).toBe(0);
    expect(await repository.fail(lease, "TEMPORARY", 0)).toBe(true);
    expect(await repository.complete(await claim(repository), noop)).toBe(true);
    expect((await jobState(messageId)).state).toBe("SUCCEEDED");
  });

  it("maps a typed handler failure to the generic failure path", async () => {
    const repository = worker();
    const messageId = await seedJob();
    const lease = await claim(repository);
    await expect(
      repository.complete(lease, async () => {
        throw new WorkerExecutionError("TEMPORARY");
      }),
    ).rejects.toMatchObject({ code: "TEMPORARY" });
    expect((await jobState(messageId)).state).toBe("RUNNING");
    expect(await repository.fail(lease, "TEMPORARY", 0)).toBe(true);
    expect((await jobState(messageId)).state).toBe("RETRY");
  });

  it("denies the Worker workspace, credentials and history rewrites", async () => {
    for (const [user, queries] of [
      [
        "travelos_worker",
        [
          "SELECT * FROM trip_ops.trip",
          "SELECT * FROM trip_ops.publication_snapshot",
          "SELECT * FROM staff_access.staff_user",
          "SELECT * FROM audit.lead_event",
          "SELECT * FROM activity.entry",
          'INSERT INTO job_runtime.job ("messageId", "agencyId", consumer) VALUES (gen_random_uuid(), gen_random_uuid(), \'ACTIVITY_V1\')',
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
