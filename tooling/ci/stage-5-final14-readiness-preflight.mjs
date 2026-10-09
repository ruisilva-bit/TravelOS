import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL14_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
  STAGE5_FINAL14_EVIDENCE_INDEX,
  STAGE5_FINAL14_READINESS_PREFLIGHT_EVIDENCE,
  STAGE5_FINAL14_READINESS_PREFLIGHT_LOCAL_STATE,
} from "./stage-5-candidate-contract.mjs";
import {
  writeStage5Final14EvidenceIndex,
  verifyStage5Final14EvidenceIndex,
} from "./stage-5-final14-evidence-index.mjs";
import { verifyStage5Final14FindingLineage } from "./stage-5-final14-finding-lineage.mjs";
import { collectStage5SourceFiles } from "./stage-5-source-scope.mjs";
import { verifyStage5Final14SecurityExtensionBaseline } from "./verify-stage-5-final14-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY);
const readinessPath = path.join(root, STAGE5_FINAL14_READINESS_PREFLIGHT_EVIDENCE);
const localStatePath = path.join(root, STAGE5_FINAL14_READINESS_PREFLIGHT_LOCAL_STATE);
const expectedToolchain = { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" };
const expectedCommand = "corepack pnpm ci:verify";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serializeManifest = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...env },
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
  assert.deepEqual(
    actual,
    expectedToolchain,
    "FINAL-14 requires the pinned Node/Corepack/pnpm toolchain",
  );
  return { ...actual, nodeExecutable: process.execPath };
};
const gitOutput = (args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const trackedState = () => {
  const status = Buffer.from(gitOutput(["status", "--porcelain=v1", "--untracked-files=no"]));
  const diff = Buffer.from(gitOutput(["diff", "--binary", "HEAD"]));
  return {
    commit: gitOutput(["rev-parse", "HEAD"]).trim(),
    statusPorcelainBytes: status.length,
    statusPorcelainSha256: hash(status),
    trackedDiffBytes: diff.length,
    trackedDiffSha256: hash(diff),
  };
};
const migrationHead = async () => {
  const checksumsBytes = await readFile(path.join(root, "migrations/checksums.json"));
  const checksums = JSON.parse(checksumsBytes.toString("utf8"));
  const head = checksums.migrations.at(-1);
  assert(head);
  assert.equal(hash(await readFile(path.join(root, "migrations", head.file))), head.sha256);
  return { file: head.file, sha256: head.sha256, checksumsSha256: hash(checksumsBytes) };
};
const persistGate = async (name, command, args) => {
  const startedAtUtc = new Date().toISOString();
  const result = run(command, args);
  const finishedAtUtc = new Date().toISOString();
  const log = Buffer.from(`${result.stdout}${result.stderr}`);
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-14",
    phase: "PRE_CI",
    command: [command, ...args].join(" "),
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
  assert.equal(result.exitCode, 0, `${receipt.command} failed\n${result.stdout}\n${result.stderr}`);
  return receipt;
};
const sourceScan = () => {
  const args = ["tooling/ci/scan-source-secrets.mjs", "--stage5-final14"];
  const result = run(process.execPath, args);
  assert.equal(
    result.exitCode,
    0,
    `FINAL-14 source scan failed\n${result.stdout}\n${result.stderr}`,
  );
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.result, "PASS");
  assert.equal(parsed.findings.length, 0);
  const provenance = parsed.stage5FinalScanProvenance;
  assert.equal(provenance.candidate, "FINAL-14");
  assert.equal(provenance.phase, "FINAL_EVIDENCE");
  assert.equal(provenance.inputsMatchFailClosedCollector, true);
  assert.equal(provenance.evidenceIndex.path, STAGE5_FINAL14_EVIDENCE_INDEX);
  assert.equal(provenance.evidenceIndex.phase, "PRE_CI");
  assert.equal(provenance.validationIncluded, false);
  assert.equal(provenance.freezeIncluded, false);
  assert.equal(provenance.postFreezeScanReportExcludedFromScope, true);
  return { command: `node ${args.join(" ")}`, result, parsed };
};
const sourceSnapshot = async () => {
  const collected = await collectStage5SourceFiles({ root, phase: "FINAL_EVIDENCE" });
  const rows = await Promise.all(
    collected.files.map(async (relativePath) => {
      const bytes = await readFile(path.join(root, relativePath));
      return { path: relativePath, bytes: bytes.length, sha256: hash(bytes) };
    }),
  );
  return {
    result: collected.result,
    files: rows.length,
    aggregateSha256: hash(Buffer.from(serializeManifest(rows))),
  };
};
const existsGuard = async () => {
  try {
    await readFile(path.join(root, STAGE5_FINAL14_CI_VERIFY_INVOCATION_GUARD));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

export const verifyStage5Final14ReadinessPreflight = async ({
  root: candidateRoot = root,
} = {}) => {
  assert.equal(path.resolve(candidateRoot), root);
  const pins = toolchain();
  await verifyStage5Final14FindingLineage({ root });
  const baseline = await verifyStage5Final14SecurityExtensionBaseline({ root });
  assert.equal(baseline.result, "PASS");
  assert.equal(baseline.candidate, "FINAL-14");
  const formatReceipt = await persistGate("format-check", "corepack", [
    "pnpm",
    "run",
    "format:check",
  ]);
  const lintReceipt = await persistGate("lint-check", "corepack", ["pnpm", "run", "lint"]);
  await mkdir(evidenceDirectory, { recursive: true });
  const candidateInputs = {
    packageSha256: hash(await readFile(path.join(root, "package.json"))),
    baselineSha256: baseline.baselineSha256,
    runnerSha256: hash(
      await readFile(path.join(root, "tooling/ci/run-stage-5-final14-authoritative-ci.mjs")),
    ),
    migrationHead: await migrationHead(),
  };
  const report = {
    schemaVersion: 1,
    candidate: "FINAL-14",
    phase: "PRE_CI",
    result: "PENDING",
    ciVerifyInvoked: false,
    invocationCount: 0,
    expectedCommand,
    toolchain: pins,
    checks: [
      { name: "phase-0 and predecessor lineage", result: "PASS" },
      {
        name: "candidate-specific protected baseline",
        result: "PASS",
        sha256: baseline.baselineSha256,
      },
      {
        name: "full format:check",
        result: formatReceipt.result,
        logSha256: formatReceipt.logSha256,
      },
      { name: "full lint", result: lintReceipt.result, logSha256: lintReceipt.logSha256 },
      { name: "stage-5 regression suite", result: "PENDING" },
      { name: "post-index candidate source scan", result: "PENDING" },
    ],
    candidateInputs,
    stage6Actions: 0,
  };
  await writeFile(readinessPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeStage5Final14EvidenceIndex({ root, phase: "PRE_CI" });
  const baselineTests = runPnpm(["run", "test:stage5-security-extension-baseline"]);
  assert.equal(
    baselineTests.exitCode,
    0,
    `FINAL-14 baseline regression suite failed\n${baselineTests.stdout}\n${baselineTests.stderr}`,
  );
  const sourceTests = runPnpm(["run", "test:stage5-source-scope"]);
  assert.equal(
    sourceTests.exitCode,
    0,
    `FINAL-14 source-scope/evidence regression suite failed\n${sourceTests.stdout}\n${sourceTests.stderr}`,
  );
  sourceScan();
  report.result = "PASS";
  report.checks[4] = {
    name: "stage-5 regression suite",
    result: "PASS",
    baselineSuiteSha256: hash(Buffer.from(baselineTests.stdout + baselineTests.stderr)),
    sourceScopeSuiteSha256: hash(Buffer.from(sourceTests.stdout + sourceTests.stderr)),
  };
  report.checks[5] = { name: "post-index candidate source scan", result: "PASS" };
  await writeFile(readinessPath, `${JSON.stringify(report, null, 2)}\n`);
  const finalIndex = await writeStage5Final14EvidenceIndex({ root, phase: "PRE_CI" });
  const finalBaselineTests = runPnpm(["run", "test:stage5-security-extension-baseline"]);
  assert.equal(
    finalBaselineTests.exitCode,
    0,
    `FINAL-14 post-index baseline suite failed\n${finalBaselineTests.stdout}\n${finalBaselineTests.stderr}`,
  );
  const finalSourceTests = runPnpm(["run", "test:stage5-source-scope"]);
  assert.equal(
    finalSourceTests.exitCode,
    0,
    `FINAL-14 post-index source-scope suite failed\n${finalSourceTests.stdout}\n${finalSourceTests.stderr}`,
  );
  const finalScan = sourceScan();
  const verifiedIndex = await verifyStage5Final14EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(verifiedIndex.indexSha256, finalIndex.indexSha256);
  const snapshot = await sourceSnapshot();
  const localState = {
    schemaVersion: 1,
    candidate: "FINAL-14",
    phase: "PRE_CI",
    result: "PASS",
    ciVerifyInvoked: false,
    invocationCount: 0,
    readinessEvidence: {
      path: STAGE5_FINAL14_READINESS_PREFLIGHT_EVIDENCE,
      sha256: hash(await readFile(readinessPath)),
    },
    evidenceIndex: {
      path: STAGE5_FINAL14_EVIDENCE_INDEX,
      sha256: verifiedIndex.indexSha256,
      aggregateSha256: verifiedIndex.aggregateSha256,
    },
    toolchain: pins,
    candidateInputs,
    trackedGitState: trackedState(),
    sourceSnapshot: { files: snapshot.files, aggregateSha256: snapshot.aggregateSha256 },
    formatReceipt,
    lintReceipt,
    regressionSuites: {
      baselineSuiteSha256: hash(Buffer.from(finalBaselineTests.stdout + finalBaselineTests.stderr)),
      sourceScopeSuiteSha256: hash(Buffer.from(finalSourceTests.stdout + finalSourceTests.stderr)),
    },
    postIndexSourceScan: {
      result: finalScan.parsed.result,
      command: finalScan.command,
      stdoutSha256: hash(Buffer.from(finalScan.result.stdout)),
      stderrSha256: hash(Buffer.from(finalScan.result.stderr)),
      filesScanned: finalScan.parsed.filesScanned,
      findingCount: finalScan.parsed.findings.length,
      scopeAggregateSha256: finalScan.parsed.stage5FinalScanProvenance.scopeAggregateSha256,
      evidenceIndexSha256: verifiedIndex.indexSha256,
    },
    stage6Actions: 0,
  };
  await mkdir(path.dirname(localStatePath), { recursive: true });
  await writeFile(localStatePath, `${JSON.stringify(localState, null, 2)}\n`);
  const trackedLocalState = gitOutput([
    "ls-files",
    "--",
    STAGE5_FINAL14_READINESS_PREFLIGHT_LOCAL_STATE,
  ]).trim();
  assert.equal(trackedLocalState, "");
  assert.equal(await existsGuard(), false);
  return {
    result: "PASS",
    candidate: "FINAL-14",
    evidenceIndexSha256: verifiedIndex.indexSha256,
    evidenceAggregateSha256: verifiedIndex.aggregateSha256,
    baselineSha256: baseline.baselineSha256,
    sourceScanFiles: finalScan.parsed.filesScanned,
    sourceScanFindings: finalScan.parsed.findings.length,
    ciVerifyInvocations: 0,
    stage6Actions: 0,
  };
};

export const verifyStage5Final14Readiness = async ({ root: candidateRoot = root } = {}) => {
  assert.equal(path.resolve(candidateRoot), root);
  assert.equal(await existsGuard(), false, "FINAL-14 CI authorization is already consumed");
  const pins = toolchain();
  const readinessBytes = await readFile(readinessPath);
  const localStateBytes = await readFile(localStatePath);
  const readiness = JSON.parse(readinessBytes.toString("utf8"));
  const state = JSON.parse(localStateBytes.toString("utf8"));
  assert.equal(readiness.candidate, "FINAL-14");
  assert.equal(readiness.result, "PASS");
  assert.equal(readiness.ciVerifyInvoked, false);
  assert.equal(readiness.invocationCount, 0);
  assert.equal(readiness.expectedCommand, expectedCommand);
  assert.equal(state.candidate, "FINAL-14");
  assert.equal(state.result, "PASS");
  assert.equal(state.readinessEvidence.sha256, hash(readinessBytes));
  assert.deepEqual(state.toolchain, pins);
  assert.equal(state.stage6Actions, 0);
  const index = await verifyStage5Final14EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(state.evidenceIndex.sha256, index.indexSha256);
  assert.equal(state.evidenceIndex.aggregateSha256, index.aggregateSha256);
  const baseline = await verifyStage5Final14SecurityExtensionBaseline({ root });
  const currentInputs = {
    packageSha256: hash(await readFile(path.join(root, "package.json"))),
    baselineSha256: baseline.baselineSha256,
    runnerSha256: hash(
      await readFile(path.join(root, "tooling/ci/run-stage-5-final14-authoritative-ci.mjs")),
    ),
    migrationHead: await migrationHead(),
  };
  assert.deepEqual(currentInputs, state.candidateInputs);
  assert.deepEqual(trackedState(), state.trackedGitState);
  const snapshot = await sourceSnapshot();
  assert.equal(snapshot.files, state.sourceSnapshot.files);
  assert.equal(snapshot.aggregateSha256, state.sourceSnapshot.aggregateSha256);
  assert.equal(state.postIndexSourceScan.result, "PASS");
  assert.equal(state.postIndexSourceScan.findingCount, 0);
  assert.equal(state.postIndexSourceScan.evidenceIndexSha256, index.indexSha256);
  assert.equal(state.postIndexSourceScan.filesScanned > 0, true);
  const lineage = await verifyStage5Final14FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  return {
    result: "PASS",
    candidate: "FINAL-14",
    phase: "PRE_CI",
    evidenceIndexSha256: index.indexSha256,
    baselineSha256: baseline.baselineSha256,
    packageSha256: currentInputs.packageSha256,
    runnerSha256: currentInputs.runnerSha256,
    migrationHead: currentInputs.migrationHead,
    toolchain: pins,
    ciVerifyInvocations: 0,
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.includes("--write")
    ? await verifyStage5Final14ReadinessPreflight()
    : await verifyStage5Final14Readiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
