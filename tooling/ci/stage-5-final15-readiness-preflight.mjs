import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL15_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL15_EVIDENCE_DIRECTORY,
  STAGE5_FINAL15_EVIDENCE_INDEX,
  STAGE5_FINAL15_READINESS_PREFLIGHT_EVIDENCE,
  STAGE5_FINAL15_READINESS_PREFLIGHT_LOCAL_STATE,
} from "./stage-5-candidate-contract.mjs";
import {
  writeStage5Final15EvidenceIndex,
  verifyStage5Final15EvidenceIndex,
} from "./stage-5-final15-evidence-index.mjs";
import { verifyStage5Final15FindingLineage } from "./stage-5-final15-finding-lineage.mjs";
import { verifyStage5Final15SecurityExtensionBaseline } from "./verify-stage-5-final15-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY);
const readinessPath = path.join(root, STAGE5_FINAL15_READINESS_PREFLIGHT_EVIDENCE);
const localStatePath = path.join(root, STAGE5_FINAL15_READINESS_PREFLIGHT_LOCAL_STATE);
const expectedToolchain = { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" };
const expectedCommand = "corepack pnpm ci:verify";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 127,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
};
const runPnpm = (args) => run("corepack", ["pnpm", ...args]);
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const toolchain = () => {
  const corepack = run("corepack", ["--version"]);
  const pnpm = run("corepack", ["pnpm", "--version"]);
  assert.equal(corepack.exitCode, 0);
  assert.equal(pnpm.exitCode, 0);
  const actual = {
    node: process.version,
    corepack: corepack.stdout.trim(),
    pnpm: pnpm.stdout.trim(),
  };
  assert.deepEqual(actual, expectedToolchain, "FINAL-15 requires the pinned toolchain");
  return { ...actual, nodeExecutable: process.execPath };
};
const migrationHead = async () => {
  const checksumsBytes = await readFile(path.join(root, "migrations/checksums.json"));
  const checksums = JSON.parse(checksumsBytes.toString("utf8"));
  const head = checksums.migrations.at(-1);
  assert(head);
  assert.equal(hash(await readFile(path.join(root, "migrations", head.file))), head.sha256);
  return { file: head.file, sha256: head.sha256, checksumsSha256: hash(checksumsBytes) };
};
const persistGate = async (name, args) => {
  const command = `corepack pnpm ${args.join(" ")}`;
  const startedAtUtc = new Date().toISOString();
  const result = runPnpm(args);
  const finishedAtUtc = new Date().toISOString();
  const log = Buffer.from(`${result.stdout}${result.stderr}`);
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-15",
    phase: "PRE_CI",
    command,
    result: result.exitCode === 0 ? "PASS" : "FAIL",
    exitCode: result.exitCode,
    startedAtUtc,
    finishedAtUtc,
    toolchain: { node: process.version },
    logBytes: log.length,
    logSha256: hash(log),
    stage6Actions: 0,
  };
  await writeFile(path.join(evidenceDirectory, `${name}.log`), log);
  await writeFile(
    path.join(evidenceDirectory, `${name}.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  assert.equal(result.exitCode, 0, `${command} failed\n${result.stdout}\n${result.stderr}`);
  return receipt;
};
const sourceScan = () => {
  const args = ["tooling/ci/scan-source-secrets.mjs", "--stage5-final15"];
  const result = run(process.execPath, args);
  assert.equal(
    result.exitCode,
    0,
    `FINAL-15 source scan failed\n${result.stdout}\n${result.stderr}`,
  );
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.result, "PASS");
  assert.deepEqual(parsed.findings, []);
  assert.equal(parsed.stage5FinalScanProvenance.candidate, "FINAL-15");
  assert.equal(parsed.stage5FinalScanProvenance.phase, "FINAL_EVIDENCE");
  assert.equal(parsed.stage5FinalScanProvenance.inputsMatchFailClosedCollector, true);
  assert.equal(parsed.stage5FinalScanProvenance.evidenceIndex.path, STAGE5_FINAL15_EVIDENCE_INDEX);
  assert.equal(parsed.stage5FinalScanProvenance.validationIncluded, false);
  assert.equal(parsed.stage5FinalScanProvenance.freezeIncluded, false);
  assert.equal(parsed.stage6Actions, 0);
  return parsed;
};
const assertNoCiGuard = async () => {
  try {
    await lstat(path.join(root, STAGE5_FINAL15_CI_VERIFY_INVOCATION_GUARD));
    throw new Error("FINAL-15 CI invocation guard already exists; preflight must not rewrite it");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

export const verifyStage5Final15Readiness = async ({ root: candidateRoot = root } = {}) => {
  assert.equal(path.resolve(candidateRoot), root);
  const pins = toolchain();
  const lineage = await verifyStage5Final15FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  const baseline = await verifyStage5Final15SecurityExtensionBaseline({ root });
  assert.equal(baseline.result, "PASS");
  const readiness = await readJson(readinessPath);
  assert.equal(readiness.candidate, "FINAL-15");
  assert.equal(readiness.phase, "PRE_CI");
  assert.equal(readiness.result, "PASS");
  assert.equal(readiness.ciVerifyInvoked, false);
  assert.equal(readiness.ciVerifyInvocations, 0);
  assert.equal(readiness.expectedCommand, expectedCommand);
  assert.deepEqual(readiness.toolchain, pins);
  assert.equal(
    readiness.candidateInputs.packageJsonSha256,
    hash(await readFile(path.join(root, "package.json"))),
  );
  assert.equal(readiness.candidateInputs.baselineSha256, baseline.baselineSha256);
  assert.equal(
    readiness.candidateInputs.runnerSha256,
    hash(await readFile(path.join(root, "tooling/ci/run-stage-5-final15-authoritative-ci.mjs"))),
  );
  assert.deepEqual(readiness.candidateInputs.migrationHead, await migrationHead());
  assert(readiness.checks.length >= 9);
  assert(readiness.checks.every((check) => check.result === "PASS"));
  const index = await verifyStage5Final15EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(index.result, "PASS");
  assert.equal(readiness.stage6Actions, 0);
  return {
    result: "PASS",
    candidate: "FINAL-15",
    phase: "PRE_CI",
    ciVerifyInvocations: 0,
    expectedCommand,
    toolchain: pins,
    baselineSha256: baseline.baselineSha256,
    packageJsonSha256: readiness.candidateInputs.packageJsonSha256,
    runnerSha256: readiness.candidateInputs.runnerSha256,
    migrationHead: readiness.candidateInputs.migrationHead,
    readinessSha256: hash(await readFile(readinessPath)),
    evidenceIndexSha256: index.indexSha256,
    evidenceAggregateSha256: index.aggregateSha256,
    stage6Actions: 0,
  };
};

export const writeStage5Final15ReadinessPreflight = async ({ root: candidateRoot = root } = {}) => {
  assert.equal(path.resolve(candidateRoot), root);
  await assertNoCiGuard();
  const pins = toolchain();
  const lineage = await verifyStage5Final15FindingLineage({ root });
  const baseline = await verifyStage5Final15SecurityExtensionBaseline({ root });
  assert.equal(baseline.result, "PASS");
  const format = await persistGate("format-check", ["run", "format:check"]);
  const lint = await persistGate("lint-check", ["run", "lint"]);
  const typecheck = runPnpm(["run", "typecheck"]);
  assert.equal(typecheck.exitCode, 0, `typecheck failed\n${typecheck.stdout}\n${typecheck.stderr}`);
  const migrations = runPnpm(["run", "db:migrations:verify"]);
  assert.equal(
    migrations.exitCode,
    0,
    `migration checksum verification failed\n${migrations.stdout}\n${migrations.stderr}`,
  );
  const focused = runPnpm(["run", "test:stage5:focused"]);
  assert.equal(
    focused.exitCode,
    0,
    `focused Stage 5 tests failed\n${focused.stdout}\n${focused.stderr}`,
  );
  const focusedReceipt = await readJson(
    path.join(evidenceDirectory, "focused-test-execution.json"),
  );
  assert.equal(focusedReceipt.candidate, "FINAL-15");
  assert.equal(focusedReceipt.result, "PASS");
  assert.equal(
    focusedReceipt.sourceHashes["package.json"],
    hash(await readFile(path.join(root, "package.json"))),
  );
  const candidateInputs = {
    packageJsonSha256: hash(await readFile(path.join(root, "package.json"))),
    baselineSha256: baseline.baselineSha256,
    runnerSha256: hash(
      await readFile(path.join(root, "tooling/ci/run-stage-5-final15-authoritative-ci.mjs")),
    ),
    migrationHead: await migrationHead(),
  };
  const checks = [
    {
      name: "FINAL-14 predecessor and Phase-0 lineage",
      result: "PASS",
      predecessorIndexSha256: lineage.predecessor.indexSha256,
    },
    {
      name: "FINAL-15 correction lineage and source-bound PostgreSQL qualification",
      result: "PASS",
      findingCount: lineage.totalFindingCount,
    },
    {
      name: "FINAL-15 exact protected-path baseline",
      result: baseline.result,
      baselineSha256: baseline.baselineSha256,
    },
    { name: "pinned Node/Corepack/pnpm toolchain", result: "PASS", versions: pins },
    { name: "full format:check", result: format.result, logSha256: format.logSha256 },
    { name: "full lint", result: lint.result, logSha256: lint.logSha256 },
    {
      name: "typecheck",
      result: "PASS",
      outputSha256: hash(Buffer.from(typecheck.stdout + typecheck.stderr)),
    },
    {
      name: "migration checksums",
      result: "PASS",
      outputSha256: hash(Buffer.from(migrations.stdout + migrations.stderr)),
    },
    {
      name: "FINAL-15 focused tests",
      result: "PASS",
      sourceHashes: focusedReceipt.sourceHashes,
      testFiles: focusedReceipt.files,
      testsPassed: focusedReceipt.tests,
    },
    { name: "single-invocation CI guard absent", result: "PASS" },
  ];
  const report = {
    schemaVersion: 1,
    candidate: "FINAL-15",
    phase: "PRE_CI",
    result: "PENDING_POST_INDEX_CHECKS",
    ciVerifyInvoked: false,
    ciVerifyInvocations: 0,
    expectedCommand,
    toolchain: pins,
    checks,
    candidateInputs,
    stage6Actions: 0,
  };
  await writeFile(readinessPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeStage5Final15EvidenceIndex({ root, phase: "PRE_CI" });
  const baselineTests = runPnpm(["run", "test:stage5-security-extension-baseline"]);
  assert.equal(
    baselineTests.exitCode,
    0,
    `FINAL-15 baseline regression suite failed\n${baselineTests.stdout}\n${baselineTests.stderr}`,
  );
  const sourceTests = runPnpm(["run", "test:stage5-source-scope"]);
  assert.equal(
    sourceTests.exitCode,
    0,
    `FINAL-15 source/index regression suite failed\n${sourceTests.stdout}\n${sourceTests.stderr}`,
  );
  const scan = sourceScan();
  checks.push(
    {
      name: "baseline regression suite",
      result: "PASS",
      outputSha256: hash(Buffer.from(baselineTests.stdout + baselineTests.stderr)),
    },
    {
      name: "source/evidence regression suite",
      result: "PASS",
      outputSha256: hash(Buffer.from(sourceTests.stdout + sourceTests.stderr)),
    },
    {
      name: "post-index FINAL-15 source scan",
      result: "PASS",
      filesScanned: scan.filesScanned,
      findings: 0,
      scopeAggregateSha256: scan.stage5FinalScanProvenance.scopeAggregateSha256,
    },
  );
  report.result = "PASS";
  await writeFile(readinessPath, `${JSON.stringify(report, null, 2)}\n`);
  const finalIndex = await writeStage5Final15EvidenceIndex({ root, phase: "PRE_CI" });
  const finalBaselineTests = runPnpm(["run", "test:stage5-security-extension-baseline"]);
  assert.equal(
    finalBaselineTests.exitCode,
    0,
    `post-index baseline regression suite failed\n${finalBaselineTests.stdout}\n${finalBaselineTests.stderr}`,
  );
  const finalSourceTests = runPnpm(["run", "test:stage5-source-scope"]);
  assert.equal(
    finalSourceTests.exitCode,
    0,
    `post-index source/evidence regression suite failed\n${finalSourceTests.stdout}\n${finalSourceTests.stderr}`,
  );
  sourceScan();
  const verified = await verifyStage5Final15EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(verified.indexSha256, finalIndex.indexSha256);
  assert.equal(verified.aggregateSha256, finalIndex.aggregateSha256);
  const localState = {
    ...report,
    evidenceIndexSha256: verified.indexSha256,
    evidenceAggregateSha256: verified.aggregateSha256,
    preflightCompletedAtUtc: new Date().toISOString(),
    stage6Actions: 0,
  };
  await mkdir(path.dirname(localStatePath), { recursive: true });
  await writeFile(localStatePath, `${JSON.stringify(localState, null, 2)}\n`);
  const result = await verifyStage5Final15Readiness({ root });
  return {
    ...result,
    checks: report.checks,
    postIndexRegressionReruns: {
      baseline: "PASS",
      sourceScopeAndIndex: "PASS",
      sourceScan: "PASS",
    },
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.includes("--write")
    ? await writeStage5Final15ReadinessPreflight()
    : await verifyStage5Final15Readiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
