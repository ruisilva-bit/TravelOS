import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultEvidenceDirectory =
  "/home/hermes/.hermes/cache/scratch/travelos-stage5-final14-qualification";
const evidenceDirectory = path.resolve(
  process.env.TRAVELOS_STAGE5_FINAL14_QUALIFICATION_DIR ?? defaultEvidenceDirectory,
);
const runnerPath = path.join(root, "tooling/database/run-stage-5-disposable.mjs");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, [runnerPath], {
  cwd: root,
  env: { ...process.env, TRAVELOS_STAGE5_EVIDENCE_DIR: evidenceDirectory },
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const endedAt = new Date().toISOString();
const runnerLog = `${result.stdout ?? ""}${result.stderr ?? ""}`;
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(path.join(evidenceDirectory, "qualification-runner.log"), runnerLog);
assert.equal(result.error, undefined, result.error?.message);
assert.equal(result.status, 0, `disposable PostgreSQL harness exited ${result.status}`);
const readJson = async (name) =>
  JSON.parse(await readFile(path.join(evidenceDirectory, name), "utf8"));
const integrationExecution = await readJson("integration-test-execution.json");
const disposableCleanup = await readJson("disposable-cleanup.json");
const packageBuild = await readJson("package-build.json");
const packageProvenance = await readJson("postgresql-package-provenance.json");
const postgresqlRuntime = await readJson("postgresql-runtime.json");
const integrationLog = await readFile(path.join(evidenceDirectory, "integration-tests.log"));
assert.equal(integrationExecution.result, "PASS");
assert.equal(integrationExecution.exitCode, 0);
assert.equal(disposableCleanup.result, "PASS");
assert.equal(disposableCleanup.clusterStopped, true);
assert.equal(disposableCleanup.disposableRootAbsent, true);
assert.equal(disposableCleanup.retainedPostgresqlDataDirectories, 0);
assert.equal(disposableCleanup.retainedPackageArchives, 0);
assert.equal(disposableCleanup.ct200Actions, 0);
assert.equal(packageBuild.result, "PASS");
assert.equal(packageBuild.nodeVersion, "v24.19.0");
assert.equal(packageProvenance.result, "PASS");
assert.equal(postgresqlRuntime.result, "PASS");
const logText = integrationLog.toString("utf8");
for (const marker of [
  "27 passed (27)",
  "forged transaction-local revision marker",
  "bigint lock versions beyond JavaScript safe integer",
  "real PostgreSQL deadlock SQLSTATE 40P01 through repository and HTTP",
  "stale supplier-cost compare-and-swap through the registered Admin HTTP route",
]) {
  assert(
    logText.includes(marker),
    `PostgreSQL qualification log is missing required regression: ${marker}`,
  );
}
const execution = {
  schemaVersion: 1,
  candidate: "FINAL-14",
  result: "PASS",
  command: `node ${path.relative(root, runnerPath)}`,
  startedAt,
  endedAt,
  exitCode: result.status,
  runnerLogBytes: Buffer.byteLength(runnerLog),
  runnerLogSha256: digest(Buffer.from(runnerLog)),
  integrationLogBytes: integrationLog.length,
  integrationLogSha256: digest(integrationLog),
  integrationTestsPassed: 27,
  node: process.version,
  cwd: root,
  evidenceDirectory,
  stage6Actions: 0,
};
await writeFile(
  path.join(evidenceDirectory, "qualification-execution.json"),
  `${JSON.stringify(execution, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(execution, null, 2)}\n`);
