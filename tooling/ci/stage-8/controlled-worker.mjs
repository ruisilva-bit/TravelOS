import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setInterval } from "node:timers";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimePackageImport } from "./stage7-regression.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (predicate, limit = 45_000) => {
  const deadline = Date.now() + limit;
  do {
    if (await predicate()) return;
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error("CONTROLLED_WORKER_TIMEOUT");
};
const stop = async (child, signal = "SIGTERM") => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill(signal);
  });
};
export const createControlledWorker = async ({
  root,
  manifestPath,
  repository,
  persistence,
  load,
  probes,
}) => {
  const core = await load(path.join(root, "apps/worker"), "@travelos/backend-core");
  const telemetry = await load(path.join(root, "apps/worker"), "@travelos/observability");
  const outcomes = new Map();
  const children = [];
  const runtime = process.env.RUNTIME_DIRECTORY;
  assert.ok(runtime && path.isAbsolute(runtime));
  assert.equal(
    await repository.dispatch(),
    0,
    "Controlled acceptance requires a drained source backlog",
  );
  const initial = await repository.inspect();
  assert.equal(
    initial.pending + initial.running,
    0,
    "Controlled acceptance requires no outstanding jobs",
  );
  const job = (messageId) =>
    persistence.withConnection((db) =>
      db
        .selectFrom("job_runtime.job")
        .select(["state", "attempt"])
        .where("messageId", "=", messageId)
        .executeTakeFirst(),
    );
  const history = (messageId) =>
    persistence.withConnection((db) =>
      db
        .selectFrom("job_runtime.attempt")
        .select(["outcome", "errorCode"])
        .where("messageId", "=", messageId)
        .orderBy("attempt")
        .limit(6)
        .execute(),
    );
  const claimFor = async (source) => {
    let claim;
    await wait(async () => {
      claim = await repository.claim(randomUUID());
      return claim !== null;
    });
    assert.equal(claim.agencyId, source.agencyId);
    assert.equal(claim.messageId, source.messageId, "Refuse work outside this synthetic fixture");
    return claim;
  };
  return {
    expected(messageId) {
      return outcomes.get(messageId) ?? "SUCCEEDED";
    },
    async process(rows) {
      for (const source of rows) {
        if (outcomes.has(source.messageId)) continue;
        const ordinal = outcomes.size;
        outcomes.set(
          source.messageId,
          ordinal === 1 ? "DEAD_LETTER" : ordinal === 2 ? "UNKNOWN_OUTCOME" : "SUCCEEDED",
        );
        await repository.dispatch();
        if (ordinal < 3) {
          const maximum = ordinal === 1 ? 5 : ordinal === 0 ? 2 : 1;
          for (let attempt = 1; attempt <= maximum; attempt++) {
            const claim = await claimFor(source);
            const injected = {
              ...repository,
              projectAndComplete: async (current) => {
                if (ordinal === 0 && attempt === 2) return repository.projectAndComplete(current);
                throw new core.WorkerExecutionError(
                  ordinal === 2 ? "UNKNOWN_OUTCOME" : "TEMPORARY",
                );
              },
            };
            const result = await telemetry.runWithCorrelation(
              { correlationId: claim.correlationId, traceparent: claim.traceparent },
              () => core.processWorkerClaim(injected, claim, () => 0),
            );
            assert.equal(
              result.outcome,
              attempt === maximum ? outcomes.get(source.messageId) : "RETRY",
            );
            if (result.outcome === "RETRY")
              assert.equal(
                await repository.claim(randomUUID()),
                null,
                "Backoff must delay the next claim",
              );
          }
          const attempts = await history(source.messageId);
          assert.equal(attempts.length, maximum);
          probes.push(
            ordinal === 0
              ? "controlled-transient-failure-backoff-then-success"
              : ordinal === 1
                ? "controlled-persistent-failure-five-attempts-dead-letter"
                : "controlled-ambiguous-outcome-quarantined-no-replay",
          );
        } else if (ordinal === 3) {
          const crashed = spawn(
            path.join(root, "runtime/node/bin/node"),
            [
              path.join(root, "operator/controlled-worker.mjs"),
              "--claim-and-wait",
              manifestPath,
              source.messageId,
            ],
            { cwd: root, env: process.env, stdio: ["ignore", "ignore", "ignore", "ipc"] },
          );
          children.push(crashed);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("CLAIM_TIMEOUT")), 10_000);
            crashed.once("message", (message) => {
              clearTimeout(timer);
              if (message?.claimed === true) resolve();
              else reject(new Error("CLAIM_FAILED"));
            });
            crashed.once("exit", () => {
              clearTimeout(timer);
              reject(new Error("CLAIM_PROCESS_EXITED"));
            });
          });
          assert.equal((await job(source.messageId)).state, "RUNNING");
          await stop(crashed, "SIGKILL");
          for (const name of ["restart", "concurrent"]) {
            const directory = path.join(runtime, `${name}-${randomUUID()}`);
            await mkdir(directory, { mode: 0o700 });
            children.push(
              spawn(
                path.join(root, "runtime/node/bin/node"),
                [path.join(root, "apps/worker/dist/main.js"), "--manifest", manifestPath],
                {
                  cwd: path.join(root, "apps/worker"),
                  env: { ...process.env, RUNTIME_DIRECTORY: directory },
                  stdio: "ignore",
                },
              ),
            );
          }
          await wait(async () => (await job(source.messageId))?.state === "SUCCEEDED");
          assert.deepEqual(await history(source.messageId), [
            { outcome: "RETRY", errorCode: "LEASE_EXPIRED" },
            { outcome: "SUCCEEDED", errorCode: null },
          ]);
          probes.push("killed-claim-recovered-by-restarted-artifact-worker");
        } else {
          await wait(async () => (await job(source.messageId))?.state === "SUCCEEDED");
        }
      }
    },
    async finish() {
      assert.ok(outcomes.size >= 4, "Every controlled scenario must execute");
      for (const [id, state] of outcomes) assert.equal((await job(id))?.state, state);
      probes.push("quarantined-jobs-not-replayed-by-concurrent-artifact-workers");
    },
    async close() {
      await Promise.all(children.map((child) => stop(child)));
    },
  };
};
if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv[2], "--claim-and-wait");
    assert.equal(process.argv.length, 5);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const app = path.join(root, "apps/worker");
    const config = await import(
      await resolveRuntimePackageImport({ appRoot: app, packageName: "@travelos/config" })
    );
    const database = await import(
      await resolveRuntimePackageImport({ appRoot: app, packageName: "@travelos/database" })
    );
    const manifest = await config.loadDevelopmentInstanceManifest(process.argv[3]);
    assert.equal(manifest.environment, "DEVELOPMENT");
    const persistence = database.createPostgresPersistence({
      host: manifest.database.host,
      port: manifest.database.port,
      database: manifest.database.name,
      user: manifest.database.runtimeRoles.worker.roleName,
      password: await config.readSystemdCredentialText(
        manifest.database.runtimeRoles.worker.credentialReference,
      ),
      tls: { mode: manifest.database.tlsPolicy },
      applicationName: "travelos-stage8-crash-probe",
      maxConnections: 1,
    });
    const claim = await database.createWorkerRepository(persistence).claim(randomUUID());
    assert.equal(claim?.messageId, process.argv[4]);
    process.send({ claimed: true });
    setInterval(() => {}, 1000);
  } catch {
    process.send?.({ claimed: false });
    process.exitCode = 1;
  }
}
