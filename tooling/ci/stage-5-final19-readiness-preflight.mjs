import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL19_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
  STAGE5_FINAL19_EVIDENCE_INDEX,
  STAGE5_FINAL19_PRE_CI_FREEZE_GUARD,
  STAGE5_FINAL19_READINESS_PREFLIGHT_EVIDENCE,
  STAGE5_FINAL19_READINESS_PREFLIGHT_LOCAL_STATE,
} from "./stage-5-candidate-contract.mjs";
import {
  writeStage5Final19EvidenceIndex,
  verifyStage5Final19EvidenceIndex,
} from "./stage-5-final19-evidence-index.mjs";
import { verifyStage5Final19FindingLineage } from "./stage-5-final19-finding-lineage.mjs";
import { verifyStage5Final19SecurityExtensionBaseline } from "./verify-stage-5-final19-security-extension-baseline.mjs";
import { captureStage5WorkingTreeSnapshot } from "./stage-5-working-tree-snapshot.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
const readinessPath = path.join(root, STAGE5_FINAL19_READINESS_PREFLIGHT_EVIDENCE);
const guardPath = path.join(root, STAGE5_FINAL19_PRE_CI_FREEZE_GUARD);
const localStatePath = path.join(root, STAGE5_FINAL19_READINESS_PREFLIGHT_LOCAL_STATE);
const pins = { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" };
const command = "corepack pnpm ci:verify";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 127,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
};
const runPnpm = (args) => run("corepack", ["pnpm", ...args]);
const git = (args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const captureWorkingTree = () =>
  captureStage5WorkingTreeSnapshot({
    root,
    excludedPaths: [
      STAGE5_FINAL19_PRE_CI_FREEZE_GUARD,
      STAGE5_FINAL19_READINESS_PREFLIGHT_LOCAL_STATE,
    ],
  });
const gate = async (name, args) => {
  const startedAtUtc = new Date().toISOString();
  const result = runPnpm(args);
  const log = Buffer.from(`${result.stdout}${result.stderr}`);
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-19",
    phase: "PRE_CI",
    command: `corepack pnpm ${args.join(" ")}`,
    result: result.exitCode === 0 ? "PASS" : "FAIL",
    exitCode: result.exitCode,
    startedAtUtc,
    finishedAtUtc: new Date().toISOString(),
    logBytes: log.length,
    logSha256: hash(log),
    stage6Actions: 0,
  };
  await writeFile(path.join(evidenceDirectory, `${name}.log`), log, { flag: "wx" });
  await writeFile(
    path.join(evidenceDirectory, `${name}-execution.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx" },
  );
  assert.equal(result.exitCode, 0, `${receipt.command} failed\n${result.stdout}\n${result.stderr}`);
  return receipt;
};
const assertAbsent = async (file) => {
  try {
    await readFile(file);
    throw new Error(`refusing to reuse existing FINAL-19 guard: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
const migrationHead = async () => {
  const bytes = await readFile(path.join(root, "migrations/checksums.json"));
  const head = JSON.parse(bytes.toString("utf8")).migrations?.at(-1);
  assert(head);
  assert.equal(hash(await readFile(path.join(root, "migrations", head.file))), head.sha256);
  return { file: head.file, sha256: head.sha256, checksumsSha256: hash(bytes) };
};
const runSourceScan = () => {
  const result = run(process.execPath, ["tooling/ci/scan-source-secrets.mjs", "--stage5-final19"]);
  assert.equal(
    result.exitCode,
    0,
    `FINAL-19 source scan failed\n${result.stdout}\n${result.stderr}`,
  );
  const scan = JSON.parse(result.stdout);
  assert.equal(scan.result, "PASS");
  assert.deepEqual(scan.findings, []);
  assert.equal(scan.stage5FinalScanProvenance.candidate, "FINAL-19");
  assert.equal(scan.stage5FinalScanProvenance.phase, "FINAL_EVIDENCE");
  assert.equal(scan.stage5FinalScanProvenance.inputsMatchFailClosedCollector, true);
  assert.equal(scan.stage5FinalScanProvenance.evidenceIndex.path, STAGE5_FINAL19_EVIDENCE_INDEX);
  assert.equal(scan.stage6Actions, 0);
  return scan;
};

export const verifyStage5Final19Readiness = async ({ root: candidateRoot = root } = {}) => {
  assert.equal(path.resolve(candidateRoot), root);
  assert.equal(process.version, pins.node);
  assert.equal(run("corepack", ["--version"]).stdout.trim(), pins.corepack);
  assert.equal(run("corepack", ["pnpm", "--version"]).stdout.trim(), pins.pnpm);
  const report = await readJson(readinessPath);
  const baseline = await verifyStage5Final19SecurityExtensionBaseline({ root });
  const index = await verifyStage5Final19EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(report.result, "PASS");
  assert.equal(report.candidate, "FINAL-19");
  assert.equal(report.phase, "PRE_CI");
  assert.equal(report.ciVerifyInvocations, 0);
  assert.equal(report.ciVerifyInvoked, false);
  assert.equal(report.candidateInputs.baselineSha256, baseline.baselineSha256);
  assert.equal(
    report.candidateInputs.packageJsonSha256,
    hash(await readFile(path.join(root, "package.json"))),
  );
  assert.equal(
    report.candidateInputs.runnerSha256,
    hash(await readFile(path.join(root, "tooling/ci/run-stage-5-final19-authoritative-ci.mjs"))),
  );
  assert.deepEqual(report.candidateInputs.migrationHead, await migrationHead());
  assert(report.checks.length >= 10 && report.checks.every((item) => item.result === "PASS"));
  assert.equal(index.result, "PASS");
  const guard = await readJson(guardPath);
  assert.equal(guard.candidate, "FINAL-19");
  assert.equal(guard.state, "PRE_CI_FROZEN_NOT_STARTED");
  assert.equal(guard.ciVerifyInvocations, 0);
  assert.equal(guard.gitCommit, git(["rev-parse", "HEAD"]).toString("utf8").trim());
  assert.deepEqual(guard.workingTreeState, await captureWorkingTree());
  assert.deepEqual(guard.toolchain, { ...pins, nodeExecutable: process.execPath });
  assert.equal(guard.packageJsonSha256, report.candidateInputs.packageJsonSha256);
  assert.equal(guard.baselineManifestSha256, baseline.baselineSha256);
  assert.equal(guard.runnerSha256, report.candidateInputs.runnerSha256);
  assert.deepEqual(guard.migrationHead, report.candidateInputs.migrationHead);
  assert.equal(guard.readinessSha256, hash(await readFile(readinessPath)));
  assert.equal(guard.evidenceIndexSha256, index.indexSha256);
  assert.equal(guard.evidenceAggregateSha256, index.aggregateSha256);
  assert.equal(guard.stage6Actions, 0);
  return {
    result: "PASS",
    candidate: "FINAL-19",
    phase: "PRE_CI",
    ciVerifyInvocations: 0,
    expectedCommand: command,
    toolchain: { ...pins, nodeExecutable: process.execPath },
    baselineSha256: baseline.baselineSha256,
    packageJsonSha256: report.candidateInputs.packageJsonSha256,
    runnerSha256: report.candidateInputs.runnerSha256,
    migrationHead: report.candidateInputs.migrationHead,
    readinessSha256: hash(await readFile(readinessPath)),
    evidenceIndexSha256: index.indexSha256,
    evidenceAggregateSha256: index.aggregateSha256,
    workingTreeState: guard.workingTreeState,
    preCiFreezeGuardSha256: hash(await readFile(guardPath)),
    stage6Actions: 0,
  };
};

export const writeStage5Final19ReadinessPreflight = async () => {
  assert.equal(process.version, pins.node);
  assert.equal(run("corepack", ["--version"]).stdout.trim(), pins.corepack);
  assert.equal(run("corepack", ["pnpm", "--version"]).stdout.trim(), pins.pnpm);
  await assertAbsent(guardPath);
  await assertAbsent(localStatePath);
  await assertAbsent(path.join(root, STAGE5_FINAL19_CI_VERIFY_INVOCATION_GUARD));
  await assertAbsent(STAGE5_FINAL19_EVIDENCE_INDEX);
  assert.deepEqual(await readJson(readinessPath), {
    schemaVersion: 1,
    candidate: "FINAL-19",
    phase: "PRE_CI",
    result: "PENDING",
    ciVerifyInvoked: false,
    invocationCount: 0,
    stage6Actions: 0,
  });
  for (const name of [
    "format-check.log",
    "format-check-execution.json",
    "lint-check.log",
    "lint-check-execution.json",
    "typecheck.log",
    "typecheck-execution.json",
    "migration-check.log",
    "migration-check-execution.json",
    "source-scope-tests.log",
    "source-scope-test.json",
  ]) {
    await assertAbsent(path.join(evidenceDirectory, name));
  }
  const lineage = await verifyStage5Final19FindingLineage({ root });
  const baseline = await verifyStage5Final19SecurityExtensionBaseline({ root });
  assert.equal(lineage.result, "PASS");
  assert.equal(baseline.result, "PASS");
  const focused = await readJson(path.join(evidenceDirectory, "focused-test-execution.json"));
  assert.equal(focused.candidate, "FINAL-19");
  assert.equal(focused.result, "PASS");
  assert.deepEqual(focused.toolchain, { ...pins, processExecPath: process.execPath });
  assert(focused.tests > 0);
  assert.equal(
    hash(await readFile(path.join(evidenceDirectory, "focused-tests.log"))),
    focused.combinedLogSha256,
  );
  for (const [source, expected] of Object.entries(focused.sourceHashes))
    assert.equal(hash(await readFile(path.join(root, source))), expected);
  const postgres = await readJson(path.join(evidenceDirectory, "postgresql-qualification.json"));
  assert.equal(postgres.candidate, "FINAL-19");
  assert.equal(postgres.result, "PASS");
  assert.equal(postgres.qualificationExecution.integrationTestsPassed, 29);
  assert.equal(postgres.disposableCleanup.result, "PASS");
  assert.equal(postgres.disposableCleanup.disposableRootAbsent, true);
  const sourceScopeTest = run(process.execPath, ["tooling/ci/test-stage-5-source-scope.mjs"]);
  assert.equal(
    sourceScopeTest.exitCode,
    0,
    `source-scope regression test failed\n${sourceScopeTest.stdout}\n${sourceScopeTest.stderr}`,
  );
  const sourceLog = Buffer.from(`${sourceScopeTest.stdout}${sourceScopeTest.stderr}`);
  const sourceResult = JSON.parse(sourceScopeTest.stdout);
  assert.equal(sourceResult.result, "PASS");
  assert.equal(sourceResult.stage6Actions, 0);
  await writeFile(path.join(evidenceDirectory, "source-scope-tests.log"), sourceLog, {
    flag: "wx",
  });
  await writeFile(
    path.join(evidenceDirectory, "source-scope-test.json"),
    `${JSON.stringify({ schemaVersion: 1, candidate: "FINAL-19", phase: "PRE_CI", result: "PASS", command: "node tooling/ci/test-stage-5-source-scope.mjs", exitCode: 0, logBytes: sourceLog.length, logSha256: hash(sourceLog), stage6Actions: 0 }, null, 2)}\n`,
    { flag: "wx" },
  );
  const checks = [
    { name: "pinned Node/Corepack/pnpm", result: "PASS" },
    { name: "predecessor finding lineage", result: "PASS", findingCount: lineage.findings.total },
    {
      name: "successor security baseline",
      result: "PASS",
      baselineSha256: baseline.baselineSha256,
    },
    { name: "focused tests", result: "PASS", files: focused.files, tests: focused.tests },
    { name: "disposable PostgreSQL", result: "PASS", tests: 29 },
    {
      name: "source-scope regression",
      result: "PASS",
      outputSha256: hash(sourceLog),
      sourceFiles: sourceResult.sourceFiles,
      expectedEvidenceIndexes: sourceResult.expectedEvidenceIndexes,
    },
    await gate("format-check", ["run", "format:check"]),
    await gate("lint-check", ["run", "lint"]),
    await gate("typecheck", ["run", "typecheck"]),
    await gate("migration-check", ["run", "db:migrations:verify"]),
  ];
  const migration = await migrationHead();
  const candidateInputs = {
    packageJsonSha256: hash(await readFile(path.join(root, "package.json"))),
    baselineSha256: baseline.baselineSha256,
    runnerSha256: hash(
      await readFile(path.join(root, "tooling/ci/run-stage-5-final19-authoritative-ci.mjs")),
    ),
    migrationHead: migration,
  };
  const report = {
    schemaVersion: 1,
    candidate: "FINAL-19",
    phase: "PRE_CI",
    result: "PENDING_POST_INDEX_CHECKS",
    ciVerifyInvoked: false,
    ciVerifyInvocations: 0,
    expectedCommand: command,
    toolchain: { ...pins, nodeExecutable: process.execPath },
    checks,
    candidateInputs,
    stage6Actions: 0,
  };
  await writeFile(readinessPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeStage5Final19EvidenceIndex({ root, phase: "PRE_CI" });
  const baselineTests = run("corepack", ["pnpm", "run", "test:stage5-security-extension-baseline"]);
  assert.equal(
    baselineTests.exitCode,
    0,
    `baseline regression suite failed\n${baselineTests.stdout}\n${baselineTests.stderr}`,
  );
  const sourceTests = run("corepack", ["pnpm", "run", "test:stage5-source-scope"]);
  assert.equal(
    sourceTests.exitCode,
    0,
    `source/evidence suite failed\n${sourceTests.stdout}\n${sourceTests.stderr}`,
  );
  await writeStage5Final19EvidenceIndex({ root, phase: "PRE_CI" });
  const scan = runSourceScan();
  checks.push(
    {
      name: "baseline regression suite",
      result: "PASS",
      outputSha256: hash(Buffer.from(baselineTests.stdout + baselineTests.stderr)),
    },
    {
      name: "source/evidence suite",
      result: "PASS",
      outputSha256: hash(Buffer.from(sourceTests.stdout + sourceTests.stderr)),
    },
    {
      name: "indexed evidence source scan",
      result: "PASS",
      filesScanned: scan.filesScanned,
      findings: 0,
    },
  );
  report.result = "PASS";
  await writeFile(readinessPath, `${JSON.stringify(report, null, 2)}\n`);
  const finalIndex = await writeStage5Final19EvidenceIndex({ root, phase: "PRE_CI" });
  const finalBaselineTests = run("corepack", [
    "pnpm",
    "run",
    "test:stage5-security-extension-baseline",
  ]);
  assert.equal(
    finalBaselineTests.exitCode,
    0,
    `post-index baseline regression suite failed\n${finalBaselineTests.stdout}\n${finalBaselineTests.stderr}`,
  );
  const finalSourceTests = run("corepack", ["pnpm", "run", "test:stage5-source-scope"]);
  assert.equal(
    finalSourceTests.exitCode,
    0,
    `post-index source/evidence suite failed\n${finalSourceTests.stdout}\n${finalSourceTests.stderr}`,
  );
  runSourceScan();
  const index = await verifyStage5Final19EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(index.indexSha256, finalIndex.indexSha256);
  await mkdir(path.dirname(localStatePath), { recursive: true });
  await writeFile(
    localStatePath,
    `${JSON.stringify({ ...report, evidenceIndexSha256: index.indexSha256, evidenceAggregateSha256: index.aggregateSha256, completedAtUtc: new Date().toISOString(), stage6Actions: 0 }, null, 2)}\n`,
    { flag: "wx" },
  );
  const guard = {
    schemaVersion: 1,
    candidate: "FINAL-19",
    state: "PRE_CI_FROZEN_NOT_STARTED",
    expectedCommand: command,
    gitCommit: git(["rev-parse", "HEAD"]).toString("utf8").trim(),
    workingTreeState: await captureWorkingTree(),
    toolchain: { ...pins, nodeExecutable: process.execPath },
    packageJsonSha256: candidateInputs.packageJsonSha256,
    baselineManifestSha256: baseline.baselineSha256,
    runnerSha256: candidateInputs.runnerSha256,
    migrationHead: migration,
    readinessSha256: hash(await readFile(readinessPath)),
    evidenceIndexSha256: index.indexSha256,
    evidenceAggregateSha256: index.aggregateSha256,
    readinessResult: "PASS",
    ciVerifyInvoked: false,
    ciVerifyInvocations: 0,
    guardedAtUtc: new Date().toISOString(),
    stage6Actions: 0,
  };
  await writeFile(guardPath, `${JSON.stringify(guard, null, 2)}\n`, { flag: "wx" });
  return verifyStage5Final19Readiness({ root });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.includes("--write")
    ? await writeStage5Final19ReadinessPreflight()
    : await verifyStage5Final19Readiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
