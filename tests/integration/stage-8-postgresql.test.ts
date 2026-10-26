import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrationChain } from "../../tooling/database/migration-runner.js";
import { bootstrapRootAgency } from "@travelos/backend-core";
import {
  createPostgresPersistence,
  createStaffAccessRepository,
} from "../../packages/database/src/index.js";
import * as databaseExports from "../../packages/database/src/index.js";
import type { WorkerClaim, WorkerRepository } from "@travelos/backend-core";
import type { PostgresPersistence } from "../../packages/database/src/index.js";

const host = process.env["PGHOST"]!;
const port = Number(process.env["PGPORT"]);
const database = "travelos_stage8_qualification";
const chain = {
  directory: path.resolve("migrations"),
  checksumManifestPath: path.resolve("migrations/checksums.json"),
};
const target = {
  host,
  port,
  database,
  migratorRole: "travelos_migrator",
  ownerRole: "travelos_owner",
  tls: { mode: "DISABLED_LOOPBACK_ONLY" as const },
  allowTrustAuthenticationForTests: true,
};
let owner: Client;
const agencyId = "019a0000-0000-7000-8000-000000000008";
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
const staffId = "stage8-synthetic-staff";
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
      'INSERT INTO audit.trip_publication_event ("auditId", "agencyId", "tripId", "publicationId", "actorStaffPrincipalId", "action", "schemaVersion", "projectionHash") VALUES ($1,$2,$3,$4,$5,\'TRIP_PUBLISHED\',1,$6)',
      [randomUUID(), agencyId, tripId, publicationId, staffId, "a".repeat(64)],
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

beforeAll(async () => {
  const bootstrap = spawnSync(
    path.join(process.env["TRAVELOS_STAGE8_PG_BIN"]!, "psql"),
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--set",
      `database_name=${database}`,
      "--dbname",
      "postgres",
      "--file",
      path.resolve("deploy/database/bootstrap-database-and-roles.sql"),
    ],
    { encoding: "utf8" },
  );
  expect(bootstrap.status, bootstrap.stderr).toBe(0);
  const predecessor = path.join(process.env["TRAVELOS_STAGE8_WORK_ROOT"]!, "pre-stage7");
  await mkdir(predecessor);
  const manifest = JSON.parse(await readFile(chain.checksumManifestPath, "utf8")) as {
    migrations: { file: string; sha256: string }[];
  };
  const migrations = manifest.migrations.filter(({ file }) => file < "0012");
  for (const { file } of migrations)
    await copyFile(path.join(chain.directory, file), path.join(predecessor, file));
  await writeFile(
    path.join(predecessor, "checksums.json"),
    JSON.stringify({ schemaVersion: 1, algorithm: "sha256", migrations }),
  );
  await runMigrationChain(target, {
    directory: predecessor,
    checksumManifestPath: path.join(predecessor, "checksums.json"),
  });
  const admin = createPostgresPersistence<Record<string, never>>({
    host,
    port,
    database,
    user: "travelos_admin_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "stage8-bootstrap",
  });
  try {
    await bootstrapRootAgency(createStaffAccessRepository(admin), {
      agencyId,
      bootstrapReference: "stage8-synthetic-bootstrap",
      slug: "stage8-synthetic",
    });
  } finally {
    await admin.destroy();
  }
  await runMigrationChain(target, chain);
  owner = new Client({ host, port, database, user: "travelos_migrator", ssl: false });
  await owner.connect();
  await owner.query('SET ROLE "travelos_owner"');
  workerPersistence = createPostgresPersistence({
    host,
    port,
    database,
    user: "travelos_worker",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "stage8-worker-test",
    maxConnections: 5,
  });
  await owner.query(
    'INSERT INTO staff_access.staff_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,\'Synthetic Worker Test\',\'stage8@example.test\',true,now(),now())',
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

describe("Stage 8 pinned PostgreSQL durable worker", () => {
  it("applies the additive Stage 8 migration and makes canonical rerun a no-op", async () => {
    const result = await runMigrationChain(target, chain);
    expect(result.currentVersion).toBe("0014_stage8_worker_activity");
    expect(result.appliedMigrations).toEqual([]);
    expect(
      (await owner.query("SELECT to_regclass('job_runtime.job')::text AS name")).rows[0].name,
    ).toBe("job_runtime.job");
  });

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
          'SELECT count(*)::int AS count FROM audit.trip_publication_event audit JOIN integration.trip_publication_outbox outbox USING ("publicationId", "agencyId", "tripId") WHERE outbox."messageId"=$1',
          [messageId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(await repository.fail(lease, "TEMPORARY", 0)).toBe(true);
    expect(await repository.projectAndComplete(await claim(repository))).toBe(true);
    expect(await activityCount(messageId)).toBe(1);
  });

  it("denies Portal job/history access and Worker workspace, credentials and Audit access", async () => {
    for (const [user, queries] of [
      [
        "travelos_portal_api",
        [
          "SELECT * FROM job_runtime.job",
          "SELECT * FROM integration.activity_source",
          "SELECT * FROM activity.entry",
          "SELECT * FROM audit.trip_publication_event",
        ],
      ],
      [
        "travelos_worker",
        [
          "SELECT * FROM trip_ops.trip",
          "SELECT * FROM trip_ops.publication_snapshot",
          "SELECT * FROM staff_access.staff_user",
          "SELECT * FROM audit.trip_publication_event",
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

  it("executes built Worker from a release symlink, retries real SQL failures, recovers a killed claim and runs concurrently", async () => {
    const artifact = process.env["TRAVELOS_STAGE8_ARTIFACT_ROOT"] ?? path.resolve(".");
    const base = path.join(process.env["TRAVELOS_STAGE8_WORK_ROOT"]!, "release-rehearsal");
    await mkdir(base);
    await symlink(artifact, path.join(base, "current"));
    const current = path.join(base, "current");
    const manifest = JSON.parse(
      await readFile(path.resolve("deploy/manifests/development.example.json"), "utf8"),
    );
    manifest.database.port = port;
    manifest.database.name = database;
    const manifestFile = path.join(base, "development.json");
    await writeFile(manifestFile, JSON.stringify(manifest));
    const credentials = path.join(base, "credentials");
    await mkdir(credentials, { mode: 0o700 });
    await writeFile(path.join(credentials, "worker-db"), randomUUID(), { mode: 0o600 });
    const executable = process.env["TRAVELOS_STAGE8_ARTIFACT_ROOT"]
      ? path.join(current, "runtime/node/bin/node")
      : process.execPath;
    const children: ChildProcess[] = [];
    let logs = "";
    const waitFor = async (predicate: () => Promise<boolean>) => {
      const deadline = Date.now() + 45_000;
      do {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      throw new Error("Worker rehearsal condition timed out");
    };
    const start = async (name: string) => {
      const runtime = path.join(base, name);
      await mkdir(runtime, { mode: 0o700 });
      const environment = {
        ...process.env,
        CREDENTIALS_DIRECTORY: credentials,
        RUNTIME_DIRECTORY: runtime,
      };
      const child = spawn(
        executable,
        [path.join(current, "apps/worker/dist/main.js"), "--manifest", manifestFile],
        {
          cwd: path.join(current, "apps/worker"),
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.on("data", (bytes: Buffer) => {
        logs += bytes.toString();
      });
      child.stderr?.on("data", (bytes: Buffer) => {
        logs += bytes.toString();
      });
      children.push(child);
      await waitFor(async () => {
        try {
          return (
            JSON.parse(await readFile(path.join(runtime, "health.json"), "utf8")).ready === true
          );
        } catch {
          return false;
        }
      });
      return { child, runtime, environment };
    };
    const stop = async (child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill(signal);
      });
    };
    const state = async (id: string) =>
      (await owner.query('SELECT state FROM job_runtime.job WHERE "messageId"=$1', [id])).rows[0]
        ?.state;
    try {
      const first = await start("worker1");
      const id = await sourceMessage();
      await waitFor(async () => (await state(id)) === "SUCCEEDED");
      expect(await activityCount(id)).toBe(1);
      const health = spawnSync(
        executable,
        [path.join(current, "apps/worker/dist/main.js"), "--health"],
        { env: first.environment, encoding: "utf8" },
      );
      expect(health.status).toBe(0);
      expect(JSON.parse(health.stdout)).toEqual({ live: true, ready: true });
      await owner.query(
        `CREATE FUNCTION activity.rehearsal_failure() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE='40001'; END $body$; CREATE TRIGGER rehearsal_failure BEFORE INSERT ON activity.entry FOR EACH ROW EXECUTE FUNCTION activity.rehearsal_failure()`,
      );
      const retryId = await sourceMessage();
      await waitFor(async () => (await state(retryId)) === "RETRY");
      await owner.query(
        "DROP TRIGGER rehearsal_failure ON activity.entry; DROP FUNCTION activity.rehearsal_failure()",
      );
      await waitFor(async () => (await state(retryId)) === "SUCCEEDED");
      expect(await activityCount(retryId)).toBe(1);
      await owner.query(
        `CREATE FUNCTION activity.rehearsal_failure() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE='23514'; END $body$; CREATE TRIGGER rehearsal_failure BEFORE INSERT ON activity.entry FOR EACH ROW EXECUTE FUNCTION activity.rehearsal_failure()`,
      );
      const permanentId = await sourceMessage();
      await waitFor(async () => (await state(permanentId)) === "DEAD_LETTER");
      await owner.query(
        "DROP TRIGGER rehearsal_failure ON activity.entry; DROP FUNCTION activity.rehearsal_failure()",
      );
      expect(await activityCount(permanentId)).toBe(0);
      await stop(first.child);
      const crashId = await sourceMessage();
      await owner.query("BEGIN; LOCK TABLE activity.entry IN ACCESS EXCLUSIVE MODE");
      const interrupted = await start("worker2");
      await waitFor(async () => (await state(crashId)) === "RUNNING");
      await stop(interrupted.child, "SIGKILL");
      await owner.query("COMMIT");
      const restarted = await start("worker3");
      await waitFor(async () => (await state(crashId)) === "SUCCEEDED");
      expect(await activityCount(crashId)).toBe(1);
      const companion = await start("worker4");
      const concurrentIds = [await sourceMessage(), await sourceMessage(), await sourceMessage()];
      for (const message of concurrentIds) {
        await waitFor(async () => (await state(message)) === "SUCCEEDED");
        expect(await activityCount(message)).toBe(1);
      }
      await Promise.all([stop(restarted.child), stop(companion.child)]);
      const stopped = spawnSync(
        executable,
        [path.join(current, "apps/worker/dist/main.js"), "--health"],
        { env: restarted.environment, encoding: "utf8" },
      );
      expect(stopped.status).toBe(1);
      expect(JSON.parse(stopped.stdout)).toEqual({ live: false, ready: false });
      const missing = spawnSync(
        executable,
        [path.join(current, "apps/worker/dist/main.js"), "--manifest", manifestFile],
        {
          env: { ...first.environment, CREDENTIALS_DIRECTORY: path.join(base, "absent") },
          encoding: "utf8",
        },
      );
      expect(missing.status).toBe(1);
      expect(missing.stderr).not.toContain(credentials);
      const events = logs
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(
        expect.objectContaining({ action: "job_failed", outcome: "RETRY", errorCode: "TEMPORARY" }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ action: "job_completed", outcome: "SUCCEEDED" }),
      );
      expect(logs).not.toContain("stage8@example.test");
    } finally {
      await owner.query("ROLLBACK");
      await Promise.all(children.map((child) => stop(child)));
      await owner.query(
        "DROP TRIGGER IF EXISTS rehearsal_failure ON activity.entry; DROP FUNCTION IF EXISTS activity.rehearsal_failure()",
      );
    }
  });
});
