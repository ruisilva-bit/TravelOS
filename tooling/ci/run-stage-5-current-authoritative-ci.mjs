import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  assertStage5CandidateManifest,
  verifyStage5CandidateCoherence,
} from "./stage-5-candidate-coherence.mjs";
import {
  verifyStage5CurrentEvidenceIndex,
  writeStage5CurrentEvidenceIndex,
} from "./stage-5-current-evidence-index.mjs";
import { scanStage5CurrentSource } from "./scan-stage-5-current-source.mjs";
import { verifyStage5CurrentReadiness } from "./stage-5-current-readiness-preflight.mjs";
import { prepareStage5CurrentEvidence } from "./prepare-stage-5-current-evidence.mjs";
import { verifyStage5CurrentSourceScope } from "./run-stage-5-current-source-scope.mjs";
import { captureStage5WorkingTreeSnapshot } from "./stage-5-working-tree-snapshot.mjs";
import { STAGE5_SECURITY_EXTENSION_BASELINE_PATH } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const command = "corepack pnpm ci:verify";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const assertAbsent = async (file) => {
  try {
    await lstat(file);
    throw new Error(`One-shot CI output already exists; refusing a second invocation: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
const toolchain = async () => {
  const runVersion = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn("corepack", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `exit ${code}`)),
      );
    });
  const [corepackVersion, pnpmVersion] = await Promise.all([
    runVersion(["--version"]),
    runVersion(["pnpm", "--version"]),
  ]);
  const actual = { node: process.version, corepack: corepackVersion, pnpm: pnpmVersion };
  assert.deepEqual(actual, { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
  return { ...actual, nodeExecutable: process.execPath };
};
const parseJsonObjectAt = (text, start) => {
  assert(start >= 0, "Expected machine-readable JSON object is missing");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  throw new Error("Machine-readable JSON object is incomplete");
};
const expectedGateLabels = async () => {
  const source = await readFile(path.join(root, "tooling/ci/verify.mjs"), "utf8");
  const labels = [...source.matchAll(/^\s*\["([^"]+)",\s*"[^"]+"\],?$/gmu)].map(
    (match) => match[1],
  );
  assert(labels.length > 0, "Unable to derive authoritative ci:verify gate sequence");
  return labels;
};
const pinReportFromLog = (log) => {
  const marker = "=== TravelOS CI gate: verify:pins ===";
  const start = log.indexOf(marker);
  assert(start >= 0, "CI log does not contain the pinned-toolchain gate");
  const nextGate = log.indexOf("=== TravelOS CI gate:", start + marker.length);
  const segment = log.slice(start, nextGate < 0 ? undefined : nextGate);
  const objectStart = segment.lastIndexOf('{\n  "schemaVersion": 1,');
  const report = parseJsonObjectAt(segment, objectStart);
  assert.equal(report.result, "PASS");
  assert.deepEqual(report.toolchain, { node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
  return report;
};
const completionMarkerFromLog = (log) => {
  const marker = '{\n  "schemaVersion": 1,\n  "result": "PASS",\n  "completed": [';
  const start = log.lastIndexOf(marker);
  return start < 0 ? null : parseJsonObjectAt(log, start);
};
const writeExclusive = async (file, bytes) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: "wx" });
};
const persistGuard = async (guardPath, guard) => {
  await writeFile(guardPath, `${JSON.stringify(guard, null, 2)}\n`, { flag: "w" });
};
const currentCandidateState = async (manifest, pins, evidenceIndex, readiness, sourceScanBytes) => {
  const snapshot = await captureStage5WorkingTreeSnapshot({
    root,
    excludedPaths: [manifest.invocationGuard, `${manifest.invocationGuard}.claim`],
  });
  return {
    gitHead: snapshot.commit,
    workingTreeSnapshot: snapshot,
    packageJsonSha256: hash(await readRegular(path.join(root, "package.json"))),
    activeRunnerSha256: hash(await readRegular(path.join(root, manifest.paths.runner))),
    verifierSha256: hash(await readRegular(path.join(root, manifest.paths.baselineVerifier))),
    candidateManifestSha256: hash(await readRegular(path.join(root, manifest.paths.manifest))),
    baselineSha256: hash(
      await readRegular(path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH)),
    ),
    evidenceIndexSha256: evidenceIndex.indexSha256,
    evidenceIndexAggregateSha256: evidenceIndex.aggregateSha256,
    sourceScanSha256: hash(sourceScanBytes),
    migrationHead: readiness.report.migrationHead,
    toolchain: pins,
    command,
    ciConsumed: "NO",
    invocationCount: 0,
    stage6Actions: manifest.stage6Actions,
  };
};

export const runStage5CurrentAuthoritativeCi = async () => {
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(root, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const guardPath = path.join(root, manifest.invocationGuard);
  const claimPath = `${guardPath}.claim`;
  const evidenceDirectory = path.join(root, manifest.evidenceDirectory);
  const logPath = path.join(evidenceDirectory, "ci-verify.log");
  const receiptPath = path.join(evidenceDirectory, "ci-verify-execution.json");
  const finalLifecyclePath = path.join(evidenceDirectory, "lifecycle-state-final.json");
  const finalScanPath = path.join(evidenceDirectory, "source-security-scan-final.json");
  for (const output of [claimPath, logPath, receiptPath, finalLifecyclePath, finalScanPath])
    await assertAbsent(output);
  const guardBytes = await readRegular(guardPath);
  const guard = JSON.parse(guardBytes.toString("utf8"));
  assert.equal(guard.state, "ARMED");
  assert.equal(guard.candidate, manifest.candidate);
  assert.equal(guard.predecessor, manifest.predecessor);
  assert.equal(guard.ciConsumed, "NO");
  assert.equal(guard.invocationCount, 0);
  assert.equal(guard.command, command);
  assert.equal(guard.stage6Actions, manifest.stage6Actions);
  assert.equal(guard.coherenceRecheck.result, "PASS");
  const readiness = await verifyStage5CurrentReadiness();
  assert.equal(readiness.result, "PASS");
  assert.equal(readiness.readinessSha256, guard.readinessSha256);
  const pins = await toolchain();
  assert.deepEqual(pins, guard.toolchain);
  const preflightEvidence = await prepareStage5CurrentEvidence({ write: false });
  assert.equal(preflightEvidence.result, "PASS");
  const evidenceIndex = await verifyStage5CurrentEvidenceIndex();
  assert.equal(evidenceIndex.phase, "PRE_CI");
  const sourceScanPath = path.join(evidenceDirectory, "source-security-scan-pre-ci.json");
  const sourceScanBytes = await readRegular(sourceScanPath);
  const currentState = await currentCandidateState(
    manifest,
    pins,
    evidenceIndex,
    readiness,
    sourceScanBytes,
  );
  assert.deepEqual(
    currentState,
    {
      gitHead: guard.gitHead,
      workingTreeSnapshot: guard.workingTreeSnapshot,
      packageJsonSha256: guard.packageJsonSha256,
      activeRunnerSha256: guard.activeRunnerSha256,
      verifierSha256: guard.verifierSha256,
      candidateManifestSha256: guard.candidateManifestSha256,
      baselineSha256: guard.baselineSha256,
      evidenceIndexSha256: guard.evidenceIndexSha256,
      evidenceIndexAggregateSha256: guard.evidenceIndexAggregateSha256,
      sourceScanSha256: guard.sourceScanSha256,
      migrationHead: guard.migrationHead,
      toolchain: guard.toolchain,
      command: guard.command,
      ciConsumed: guard.ciConsumed,
      invocationCount: guard.invocationCount,
      stage6Actions: guard.stage6Actions,
    },
    "Candidate bytes/readiness/index differ from the armed one-shot guard",
  );
  const candidateStateSha256 = hash(Buffer.from(JSON.stringify(currentState)));
  assert.equal(guard.candidateStateSha256, candidateStateSha256);
  const coherence = await verifyStage5CandidateCoherence({ root });
  assert.equal(coherence.result, "PASS");
  const expectedLabels = await expectedGateLabels();
  await writeExclusive(
    claimPath,
    Buffer.from(
      `${JSON.stringify({ candidate: manifest.candidate, command, invocationCount: 1, started: false }, null, 2)}\n`,
    ),
  );

  const startedAt = new Date().toISOString();
  const child = spawn("corepack", ["pnpm", "ci:verify"], {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const closeResult = new Promise((resolve) =>
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal })),
  );
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } catch (error) {
    await rm(claimPath, { force: true });
    throw error;
  }
  guard.state = "CONSUMED";
  guard.ciConsumed = "YES";
  guard.invocationCount = 1;
  guard.ciResult = "RUNNING";
  guard.startedAtUtc = startedAt;
  guard.childPid = child.pid;
  await persistGuard(guardPath, guard);
  await writeFile(
    claimPath,
    `${JSON.stringify({ candidate: manifest.candidate, command, invocationCount: 1, started: true, startedAtUtc: startedAt }, null, 2)}\n`,
    { flag: "w" },
  );

  const { exitCode, signal } = await closeResult;
  const endedAt = new Date().toISOString();
  const logBytes = Buffer.concat(chunks);
  const logText = logBytes.toString("utf8");
  const gateLabels = [...logText.matchAll(/=== TravelOS CI gate: ([^=]+) ===/gu)].map((match) =>
    match[1].trim(),
  );
  const completion = completionMarkerFromLog(logText);
  let pinReport = null;
  let pinError = null;
  try {
    pinReport = pinReportFromLog(logText);
  } catch (error) {
    pinError = error instanceof Error ? error.message : String(error);
  }
  const markersPass =
    completion?.result === "PASS" &&
    JSON.stringify(completion.completed) === JSON.stringify(expectedLabels);
  const labelsPass = JSON.stringify(gateLabels) === JSON.stringify(expectedLabels);
  const result = exitCode === 0 && markersPass && labelsPass && pinReport ? "PASS" : "FAIL";
  const receipt = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    command,
    invocationCount: 1,
    ciConsumed: "YES",
    result,
    exitCode: exitCode ?? 1,
    signal: signal ?? null,
    startedAtUtc: startedAt,
    endedAtUtc: endedAt,
    gitHead: guard.gitHead,
    guardSha256: hash(guardBytes),
    packageJsonSha256: guard.packageJsonSha256,
    activeRunnerSha256: guard.activeRunnerSha256,
    verifierSha256: guard.verifierSha256,
    baselineSha256: guard.baselineSha256,
    evidenceIndexSha256: guard.evidenceIndexSha256,
    migrationHead: guard.migrationHead,
    toolchainParent: pins,
    childPinReport: pinReport,
    pinReportError: pinError,
    expectedGateLabels: expectedLabels,
    observedGateLabels: gateLabels,
    completionMarker: completion,
    logBytes: logBytes.length,
    logSha256: hash(logBytes),
    failureGate: result === "PASS" ? null : (gateLabels.at(-1) ?? "toolchain-or-launch"),
    stage6Actions: manifest.stage6Actions,
  };
  await writeExclusive(logPath, logBytes);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await writeExclusive(receiptPath, receiptBytes);
  guard.ciResult = result;
  guard.exitCode = exitCode ?? 1;
  guard.logSha256 = receipt.logSha256;
  guard.receiptSha256 = hash(receiptBytes);
  await persistGuard(guardPath, guard);
  const finalLifecycle = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    lifecycleState: result === "PASS" ? "CI_PASS" : "CI_FAILED",
    ciStatus: result,
    invocationCount: 1,
    ciReceiptSha256: guard.receiptSha256,
    ciLogSha256: receipt.logSha256,
    validationStatus: "PENDING_FINAL_EVIDENCE",
    freezeStatus: "NOT_CREATED",
    reviewStatus: "NOT_RUN",
    closureStatus: "NOT_CLOSED",
    stage6Actions: manifest.stage6Actions,
  };
  await writeExclusive(
    finalLifecyclePath,
    Buffer.from(`${JSON.stringify(finalLifecycle, null, 2)}\n`),
  );

  let finalScan = null;
  let finalEvidenceIndex = null;
  let sourceScope = null;
  let postCiEvidenceError = null;
  try {
    finalScan = await scanStage5CurrentSource({ phase: "FINAL", write: true });
    const phase = result === "PASS" ? "FINAL" : "CI_FAILED";
    finalEvidenceIndex = await writeStage5CurrentEvidenceIndex({ phase });
    sourceScope = await verifyStage5CurrentSourceScope();
    if (result === "PASS") {
      const finalEvidence = await prepareStage5CurrentEvidence({ write: false });
      assert.equal(finalEvidence.result, "PASS");
    }
  } catch (error) {
    postCiEvidenceError = error instanceof Error ? error.message : String(error);
  }
  const finalReport = {
    result: result === "PASS" && !postCiEvidenceError ? "PASS" : "FAIL",
    candidate: manifest.candidate,
    ciResult: result,
    exitCode: exitCode ?? 1,
    logPath: path.relative(root, logPath),
    logSha256: receipt.logSha256,
    receiptPath: path.relative(root, receiptPath),
    receiptSha256: guard.receiptSha256,
    finalScan,
    finalEvidenceIndex,
    sourceScope,
    postCiEvidenceError,
    stage6Actions: manifest.stage6Actions,
  };
  process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
  if (finalReport.result !== "PASS") process.exitCode = 1;
  return finalReport;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runStage5CurrentAuthoritativeCi();
}
