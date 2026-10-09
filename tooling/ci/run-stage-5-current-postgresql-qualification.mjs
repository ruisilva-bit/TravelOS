import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import manifest from "./stage-5-current-candidate.json" with { type: "json" };
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
assertStage5CandidateManifest(manifest);
const evidenceDirectory = path.join(root, manifest.evidenceDirectory);
const runnerPath = path.join(root, "tooling/database/run-stage-5-disposable.mjs");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scratch = process.env.TMPDIR ?? path.join(os.homedir(), ".hermes/cache/scratch");
const temporaryDirectory = await mkdtemp(path.join(scratch, "travelos-stage5-current-pg-"));
const rawEvidenceDirectory = path.join(temporaryDirectory, "evidence");
const startedAt = new Date().toISOString();
const executionResult = spawnSync(process.execPath, [runnerPath], {
  cwd: root,
  env: { ...process.env, TRAVELOS_STAGE5_EVIDENCE_DIR: rawEvidenceDirectory },
  encoding: "utf8",
  maxBuffer: 48 * 1024 * 1024,
});
const endedAt = new Date().toISOString();
const runnerLog = `${executionResult.stdout ?? ""}${executionResult.stderr ?? ""}`;
const assertAbsentOrSame = async (file, bytes) => {
  try {
    const existing = await readFile(file);
    assert.deepEqual(existing, bytes, `Refusing divergent PostgreSQL evidence reuse: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};
try {
  assert.equal(executionResult.error, undefined, executionResult.error?.message);
  assert.equal(
    executionResult.status,
    0,
    `disposable PostgreSQL harness exited ${executionResult.status}`,
  );
  const readJson = async (name) =>
    JSON.parse(await readFile(path.join(rawEvidenceDirectory, name), "utf8"));
  const integrationExecution = await readJson("integration-test-execution.json");
  const cleanup = await readJson("disposable-cleanup.json");
  const packageBuild = await readJson("package-build.json");
  const packageProvenance = await readJson("postgresql-package-provenance.json");
  const runtime = await readJson("postgresql-runtime.json");
  const integrationLog = await readFile(path.join(rawEvidenceDirectory, "integration-tests.log"));
  assert.equal(integrationExecution.result, "PASS");
  assert.equal(integrationExecution.exitCode, 0);
  assert.equal(cleanup.result, "PASS");
  assert.equal(cleanup.clusterStopped, true);
  assert.equal(cleanup.disposableRootAbsent, true);
  assert.equal(cleanup.retainedPostgresqlDataDirectories, 0);
  assert.equal(cleanup.retainedPackageArchives, 0);
  assert.equal(cleanup.ct200Actions, 0);
  assert.equal(packageBuild.result, "PASS");
  assert.equal(packageBuild.nodeVersion, "v24.19.0");
  assert.equal(packageProvenance.result, "PASS");
  assert.equal(runtime.result, "PASS");
  const logText = integrationLog.toString("utf8");
  const requiredMarkers = [
    "29 passed (29)",
    "forged transaction-local revision marker",
    "bigint lock versions beyond JavaScript safe integer",
    "real repository PostgreSQL deadlock SQLSTATE 40P01 through the registered Admin HTTP route",
    "stale supplier-cost compare-and-swap through the registered Admin HTTP route",
  ];
  for (const marker of requiredMarkers)
    assert(logText.includes(marker), `missing PostgreSQL regression: ${marker}`);
  await mkdir(evidenceDirectory, { recursive: true });
  const copies = [
    ["disposable-cleanup.json", "postgresql-disposable-cleanup.json"],
    ["integration-test-execution.json", "postgresql-integration-test-execution.json"],
    ["integration-tests.log", "postgresql-integration-tests.log"],
    ["package-build.json", "postgresql-package-build.json"],
    ["postgresql-package-provenance.json", "postgresql-package-provenance.json"],
    ["postgresql-runtime.json", "postgresql-runtime.json"],
  ];
  for (const [sourceName, targetName] of copies) {
    await assertAbsentOrSame(
      path.join(evidenceDirectory, targetName),
      await readFile(path.join(rawEvidenceDirectory, sourceName)),
    );
  }
  const integrationSourcePath = "tests/integration/stage-5-postgresql.test.ts";
  const checksumsBytes = await readFile(path.join(root, "migrations/checksums.json"));
  const integrationSourceBytes = await readFile(path.join(root, integrationSourcePath));
  const execution = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    result: "PASS",
    command: `node ${path.relative(root, runnerPath)}`,
    startedAt,
    endedAt,
    exitCode: executionResult.status,
    runnerLogBytes: Buffer.byteLength(runnerLog),
    runnerLogSha256: hash(Buffer.from(runnerLog)),
    integrationLogBytes: integrationLog.length,
    integrationLogSha256: hash(integrationLog),
    integrationTestsPassed: 29,
    integrationTestPath: integrationSourcePath,
    integrationTestSha256: hash(integrationSourceBytes),
    packageJsonSha256: hash(await readFile(path.join(root, "package.json"))),
    migrationChecksumsSha256: hash(checksumsBytes),
    node: process.version,
    cwd: root,
    disposableEvidenceDirectory: "Hermes scratch; removed after capture",
    stage6Actions: manifest.stage6Actions,
  };
  const executionBytes = Buffer.from(`${JSON.stringify(execution, null, 2)}\n`);
  const runnerLogBytes = Buffer.from(runnerLog);
  await assertAbsentOrSame(
    path.join(evidenceDirectory, "postgresql-qualification-execution.json"),
    executionBytes,
  );
  await assertAbsentOrSame(
    path.join(evidenceDirectory, "postgresql-qualification-runner.log"),
    runnerLogBytes,
  );
  const qualification = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    result: "PASS",
    integrationExecution: {
      ...integrationExecution,
      sha256: hash(Buffer.from(`${JSON.stringify(integrationExecution, null, 2)}\n`)),
    },
    disposableCleanup: cleanup,
    packageBuild,
    packageProvenance,
    postgresqlRuntime: runtime,
    qualificationExecution: execution,
    integrationLog: { bytes: integrationLog.length, sha256: hash(integrationLog) },
    runnerLog: { bytes: runnerLogBytes.length, sha256: hash(runnerLogBytes) },
    sourceTestPath: integrationSourcePath,
    sourceTestSha256: hash(integrationSourceBytes),
    packageJsonSha256: execution.packageJsonSha256,
    migrationChecksumsSha256: execution.migrationChecksumsSha256,
    stage6Actions: manifest.stage6Actions,
  };
  const qualificationBytes = Buffer.from(`${JSON.stringify(qualification, null, 2)}\n`);
  await assertAbsentOrSame(
    path.join(evidenceDirectory, "postgresql-qualification.json"),
    qualificationBytes,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: manifest.candidate,
        result: "PASS",
        qualificationPath: `${manifest.evidenceDirectory}/postgresql-qualification.json`,
        qualificationSha256: hash(qualificationBytes),
        integrationTestsPassed: 29,
        cleanup: "PASS",
        stage6Actions: manifest.stage6Actions,
      },
      null,
      2,
    )}\n`,
  );
  await rm(temporaryDirectory, { recursive: true, force: true });
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(
      {
        candidate: manifest.candidate,
        phase: "POSTGRESQL_QUALIFICATION",
        result: "FAIL",
        exitCode: executionResult.status ?? 1,
        runnerLogBytes: Buffer.byteLength(runnerLog),
        runnerLogSha256: hash(Buffer.from(runnerLog)),
        failure: error instanceof Error ? error.message : String(error),
        temporaryEvidenceDirectory: rawEvidenceDirectory,
        stage6Actions: manifest.stage6Actions,
      },
      null,
      2,
    )}\n`,
  );
  throw error;
}
