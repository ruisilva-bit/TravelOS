import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL20_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL20_EVIDENCE_DIRECTORY,
  STAGE5_FINAL20_PRE_CI_FREEZE_GUARD,
  STAGE5_FINAL20_READINESS_PREFLIGHT_LOCAL_STATE,
} from "./stage-5-candidate-contract.mjs";
import { writeStage5Final20EvidenceIndex } from "./stage-5-final20-evidence-index.mjs";
import { verifyStage5Final20Readiness } from "./stage-5-final20-readiness-preflight.mjs";
import { captureStage5WorkingTreeSnapshot } from "./stage-5-working-tree-snapshot.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const guardPath = path.join(root, STAGE5_FINAL20_CI_VERIFY_INVOCATION_GUARD);
const claimPath = `${guardPath}.claim`;
const evidenceDirectory = path.join(root, STAGE5_FINAL20_EVIDENCE_DIRECTORY);
const logPath = path.join(evidenceDirectory, "ci-verify.log");
const executionPath = path.join(evidenceDirectory, "ci-verify-execution.json");
const command = "corepack pnpm ci:verify";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .trim();
const captureWorkingTree = () =>
  captureStage5WorkingTreeSnapshot({
    root,
    excludedPaths: [
      STAGE5_FINAL20_PRE_CI_FREEZE_GUARD,
      STAGE5_FINAL20_READINESS_PREFLIGHT_LOCAL_STATE,
    ],
  });
const assertAbsent = async (file) => {
  try {
    const metadata = await lstat(file);
    throw new Error(
      `FINAL-20 CI authorization unavailable; ${file} already exists (${metadata.isSymbolicLink() ? "symlink" : "record exists"})`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
const toolchain = () => {
  const corepack = execFileSync("corepack", ["--version"], { cwd: root, encoding: "utf8" }).trim();
  const pnpm = execFileSync("corepack", ["pnpm", "--version"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const actual = { node: process.version, corepack, pnpm };
  assert.deepEqual(actual, { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
  return { ...actual, nodeExecutable: process.execPath };
};
const verifyPinsInChildLog = (log, gateLabels, exitCode) => {
  const text = log.toString("utf8");
  const pinGateStart = text.indexOf("=== TravelOS CI gate: verify:pins ===");
  const nextGateStart =
    pinGateStart < 0 ? -1 : text.indexOf("=== TravelOS CI gate: ", pinGateStart + 1);
  const pinGateText =
    pinGateStart < 0
      ? ""
      : text.slice(pinGateStart, nextGateStart < 0 ? text.length : nextGateStart);
  const pinVerified =
    /"toolchain"\s*:\s*\{\s*"node"\s*:\s*"24\.19\.0"\s*,\s*"corepack"\s*:\s*"0\.35\.0"\s*,\s*"pnpm"\s*:\s*"11\.21\.0"\s*\}/u.test(
      pinGateText,
    );
  const markers = [
    ...text.matchAll(
      /\{\s*"schemaVersion"\s*:\s*1\s*,\s*"result"\s*:\s*"PASS"\s*,\s*"completed"\s*:\s*\[[\s\S]*?\]\s*\}/gu,
    ),
  ];
  const completed = (() => {
    try {
      return markers.length ? JSON.parse(markers.at(-1)[0]) : null;
    } catch {
      return null;
    }
  })();
  const gatesVerified =
    Array.isArray(completed?.completed) &&
    completed.completed.length === gateLabels.length &&
    completed.completed.every((label, i) => label === gateLabels[i]);
  return {
    result: exitCode === 0 && pinVerified && gatesVerified ? "PASS" : "FAIL",
    childPinReportVerified: pinVerified,
    completedGateMarkerVerified: gatesVerified,
    completedGateCount: completed?.completed?.length ?? 0,
  };
};

export const runStage5Final20AuthoritativeCi = async () => {
  const preflight = await verifyStage5Final20Readiness({ root });
  assert.equal(preflight.result, "PASS");
  await assertAbsent(guardPath);
  await assertAbsent(claimPath);
  const preCiGuard = JSON.parse(
    await readFile(path.join(root, STAGE5_FINAL20_PRE_CI_FREEZE_GUARD), "utf8"),
  );
  assert.equal(preCiGuard.candidate, "FINAL-20");
  assert.deepEqual(preCiGuard.workingTreeState, await captureWorkingTree());
  assert.equal(preCiGuard.evidenceIndexSha256, preflight.evidenceIndexSha256);
  const executionPlaceholder = await readFile(
    path.join(evidenceDirectory, "ci-verify-execution.json"),
    "utf8",
  );
  assert.match(executionPlaceholder, /"invocationCount": 0/u);
  assert.match(executionPlaceholder, /"result": "NOT_RUN"/u);
  const pins = toolchain();
  const claim = {
    schemaVersion: 1,
    candidate: "FINAL-20",
    state: "CLAIMED",
    invocationCount: 0,
    command,
    claimedAtUtc: new Date().toISOString(),
    stage6Actions: 0,
  };
  await writeFile(claimPath, `${JSON.stringify(claim, null, 2)}\n`, { flag: "wx" });
  const child = spawn("corepack", ["pnpm", "ci:verify"], {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [],
    stdoutChunks = [],
    stderrChunks = [];
  child.stdout.on("data", (chunk) => {
    logs.push(Buffer.from(chunk));
    stdoutChunks.push(Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk) => {
    logs.push(Buffer.from(chunk));
    stderrChunks.push(Buffer.from(chunk));
  });
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } catch (error) {
    await rm(claimPath, { force: true });
    throw new Error(
      `FINAL-20 ci:verify did not start; authorization not consumed: ${error.message}`,
      { cause: error },
    );
  }
  const startedAtUtc = new Date().toISOString();
  const guard = {
    ...claim,
    state: "CONSUMED",
    invocationCount: 1,
    result: "RUNNING",
    command,
    startedAtUtc,
    commandProcessPid: child.pid,
    toolchain: pins,
    gitCommit: git(["rev-parse", "HEAD"]),
    workingTreeState: preCiGuard.workingTreeState,
    packageJsonSha256: preflight.packageJsonSha256,
    securityExtensionBaselineSha256: preflight.baselineSha256,
    runnerSha256: preflight.runnerSha256,
    migrationHead: preflight.migrationHead,
    readinessSha256: preflight.readinessSha256,
    preCiEvidenceIndexSha256: preflight.evidenceIndexSha256,
    stage6Actions: 0,
  };
  await writeFile(guardPath, `${JSON.stringify(guard, null, 2)}\n`, { flag: "wx" });
  await rm(claimPath);
  const [exitCode, signal] = await new Promise((resolve) =>
    child.once("close", (code, closeSignal) =>
      resolve([code ?? (closeSignal ? 128 : 127), closeSignal]),
    ),
  );
  const finishedAtUtc = new Date().toISOString();
  const log = Buffer.concat(logs),
    stdout = Buffer.concat(stdoutChunks),
    stderr = Buffer.concat(stderrChunks);
  await writeFile(logPath, log);
  const gateLabels = [...log.toString("utf8").matchAll(/^=== TravelOS CI gate: (.+) ===$/gmu)].map(
    (match) => match[1],
  );
  const childVerification = verifyPinsInChildLog(log, gateLabels, exitCode);
  const result = childVerification.result;
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-20",
    phase: result === "PASS" ? "FINAL" : "CI_FAILED",
    invocationCount: 1,
    result,
    exitCode,
    childVerification,
    signal,
    command,
    cwd: root,
    nodeExecutable: pins.nodeExecutable,
    nodeVersion: pins.node,
    corepackVersion: pins.corepack,
    pnpmVersion: pins.pnpm,
    startedAtUtc,
    finishedAtUtc,
    gitCommit: guard.gitCommit,
    workingTreeState: guard.workingTreeState,
    packageSha256: guard.packageJsonSha256,
    securityExtensionBaselineSha256: guard.securityExtensionBaselineSha256,
    runnerSha256: guard.runnerSha256,
    migrationHead: guard.migrationHead,
    readinessSha256: guard.readinessSha256,
    preCiEvidenceIndexSha256: guard.preCiEvidenceIndexSha256,
    logBytes: log.length,
    logSha256: hash(log),
    stdoutBytes: stdout.length,
    stdoutSha256: hash(stdout),
    stderrBytes: stderr.length,
    stderrSha256: hash(stderr),
    gateCounts: {
      started: gateLabels.length,
      passed: result === "PASS" ? gateLabels.length : Math.max(0, gateLabels.length - 1),
      failed:
        result === "PASS" ? 0 : Math.max(1, gateLabels.length - Math.max(0, gateLabels.length - 1)),
      labels: gateLabels,
      failedGate: result === "PASS" ? null : (gateLabels.at(-1) ?? "runner-before-first-gate"),
    },
    stage6Actions: 0,
  };
  await writeFile(executionPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeStage5Final20EvidenceIndex({
    root,
    phase: result === "PASS" ? "FINAL" : "CI_FAILED",
    ciVerify: { invocationCount: 1, result, exitCode },
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.stdout.write(
    `${JSON.stringify({ candidate: "FINAL-20", result, exitCode, invocationCount: 1, command, ciLog: `${STAGE5_FINAL20_EVIDENCE_DIRECTORY}/ci-verify.log`, ciExecution: `${STAGE5_FINAL20_EVIDENCE_DIRECTORY}/ci-verify-execution.json`, gateCounts: receipt.gateCounts, stage6Actions: 0 }, null, 2)}\n`,
  );
  if (result !== "PASS") process.exitCode = exitCode || 1;
  return receipt;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runStage5Final20AuthoritativeCi();
