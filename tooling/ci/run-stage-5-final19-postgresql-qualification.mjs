import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { STAGE5_FINAL19_EVIDENCE_DIRECTORY } from "./stage-5-candidate-contract.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
const runnerPath = path.join(root, "tooling/database/run-stage-5-disposable.mjs");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "travelos-stage5-final19-"));
const rawEvidenceDirectory = path.join(temporaryDirectory, "evidence");
const startedAt = new Date().toISOString();
const executionResult = spawnSync(process.execPath, [runnerPath], {
  cwd: root,
  env: { ...process.env, TRAVELOS_STAGE5_EVIDENCE_DIR: rawEvidenceDirectory },
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const endedAt = new Date().toISOString();
const runnerLog = `${executionResult.stdout ?? ""}${executionResult.stderr ?? ""}`;

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
  for (const marker of requiredMarkers) {
    assert(
      logText.includes(marker),
      `PostgreSQL qualification log is missing regression: ${marker}`,
    );
  }

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
    await writeFile(
      path.join(evidenceDirectory, targetName),
      await readFile(path.join(rawEvidenceDirectory, sourceName)),
      { flag: "wx" },
    );
  }

  const integrationSourcePath = "tests/integration/stage-5-postgresql.test.ts";
  const checksumsBytes = await readFile(path.join(root, "migrations/checksums.json"));
  const integrationSourceBytes = await readFile(path.join(root, integrationSourcePath));
  const execution = {
    schemaVersion: 1,
    candidate: "FINAL-19",
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
    disposableEvidenceDirectory: "temporary OS scratch; removed after capture",
    stage6Actions: 0,
  };
  await writeFile(
    path.join(evidenceDirectory, "postgresql-qualification-execution.json"),
    `${JSON.stringify(execution, null, 2)}\n`,
    { flag: "wx" },
  );
  await writeFile(path.join(evidenceDirectory, "postgresql-qualification-runner.log"), runnerLog, {
    flag: "wx",
  });
  const qualification = {
    schemaVersion: 1,
    candidate: "FINAL-19",
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
    runnerLog: { bytes: Buffer.byteLength(runnerLog), sha256: hash(Buffer.from(runnerLog)) },
    sourceTestPath: integrationSourcePath,
    sourceTestSha256: hash(integrationSourceBytes),
    packageJsonSha256: execution.packageJsonSha256,
    stage6Actions: 0,
  };
  await writeFile(
    path.join(evidenceDirectory, "postgresql-qualification.json"),
    `${JSON.stringify(qualification, null, 2)}\n`,
    { flag: "wx" },
  );
  const continuity = {
    schemaVersion: 1,
    candidate: "FINAL-19",
    result: "PASS",
    qualificationEvidence: {
      path: `${STAGE5_FINAL19_EVIDENCE_DIRECTORY}/postgresql-qualification.json`,
      sha256: hash(Buffer.from(`${JSON.stringify(qualification, null, 2)}\n`)),
    },
    integrationTest: {
      path: integrationSourcePath,
      sha256: hash(integrationSourceBytes),
      testsPassed: 29,
      requiredRegressionMarkers: requiredMarkers,
    },
    migrationChecksumsSha256: hash(checksumsBytes),
    disposableCleanup: "PASS",
    stage6Actions: 0,
  };
  await writeFile(
    path.join(evidenceDirectory, "postgresql-qualification-continuity.json"),
    `${JSON.stringify(continuity, null, 2)}\n`,
    { flag: "wx" },
  );
  process.stdout.write(`${JSON.stringify(continuity, null, 2)}\n`);
} catch (error) {
  const failure = {
    schemaVersion: 1,
    candidate: "FINAL-19",
    phase: "POSTGRESQL_QUALIFICATION",
    result: "FAIL",
    exitCode: executionResult.status ?? 1,
    command: `node ${path.relative(root, runnerPath)}`,
    runnerLogBytes: Buffer.byteLength(runnerLog),
    runnerLogSha256: hash(Buffer.from(runnerLog)),
    failure: error instanceof Error ? error.message : String(error),
    temporaryEvidenceDirectory: rawEvidenceDirectory,
    stage6Actions: 0,
  };
  const failurePath = path.join(
    root,
    ".hermes/state/stage5-final19-postgresql-qualification-failure.json",
  );
  await writeFile(failurePath, `${JSON.stringify(failure, null, 2)}\n`, { flag: "wx" });
  throw error;
} finally {
  if (executionResult.status === 0) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
