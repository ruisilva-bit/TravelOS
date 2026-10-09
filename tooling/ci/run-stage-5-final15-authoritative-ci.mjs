import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL15_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL15_EVIDENCE_DIRECTORY,
  STAGE5_FINAL15_EVIDENCE_INDEX,
  STAGE5_FINAL15_READINESS_PREFLIGHT_EVIDENCE,
} from "./stage-5-candidate-contract.mjs";
import { writeStage5Final15EvidenceIndex } from "./stage-5-final15-evidence-index.mjs";
import { verifyStage5Final15Readiness } from "./stage-5-final15-readiness-preflight.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const guardPath = path.join(root, STAGE5_FINAL15_CI_VERIFY_INVOCATION_GUARD);
const claimPath = `${guardPath}.claim`;
const evidenceDirectory = path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY);
const logPath = path.join(evidenceDirectory, "ci-verify.log");
const executionPath = path.join(evidenceDirectory, "ci-verify-execution.json");
const command = "corepack pnpm ci:verify";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
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
const assertAbsent = async (file) => {
  try {
    const metadata = await lstat(file);
    throw new Error(
      `FINAL-15 CI authorization unavailable; ${file} already exists (${metadata.isSymbolicLink() ? "symlink" : "record exists"})`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
const captureWorkingTree = async () => {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const diff = git(["diff", "HEAD", "--binary", "--"]);
  const untrackedPaths = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .toSorted();
  const untrackedFiles = [];
  for (const relativePath of untrackedPaths) {
    const bytes = await readFile(path.join(root, relativePath));
    untrackedFiles.push({ path: relativePath, bytes: bytes.length, sha256: hash(bytes) });
  }
  return {
    commit: git(["rev-parse", "HEAD"]).toString("utf8").trim(),
    statusPorcelainBytes: status.length,
    statusPorcelainSha256: hash(status),
    trackedDiffFromHeadBytes: diff.length,
    trackedDiffFromHeadSha256: hash(diff),
    untrackedFiles,
    untrackedFileCount: untrackedFiles.length,
  };
};
const migrationHead = async () => {
  const checksumsBytes = await readFile(path.join(root, "migrations/checksums.json"));
  const checksums = JSON.parse(checksumsBytes.toString("utf8"));
  const head = checksums.migrations?.at(-1);
  assert(head && typeof head.file === "string" && typeof head.sha256 === "string");
  assert.equal(hash(await readFile(path.join(root, "migrations", head.file))), head.sha256);
  return { file: head.file, sha256: head.sha256, checksumsSha256: hash(checksumsBytes) };
};
const spawnOnce = async (guard) => {
  const child = spawn("corepack", ["pnpm", "ci:verify"], {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logChunks = [];
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (chunk) => {
    logChunks.push(Buffer.from(chunk));
    stdoutChunks.push(Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk) => {
    logChunks.push(Buffer.from(chunk));
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
      `FINAL-15 ci:verify was not started; authorization remains unconsumed: ${error.message}`,
      { cause: error },
    );
  }
  const startedAtUtc = new Date().toISOString();
  const invocationRecord = {
    ...guard,
    state: "CONSUMED",
    invocationCount: 1,
    result: "RUNNING",
    command,
    startedAtUtc,
    commandProcessPid: child.pid,
  };
  await writeFile(guardPath, `${JSON.stringify(invocationRecord, null, 2)}\n`, { flag: "wx" });
  await rm(claimPath);
  const [exitCode, signal] = await new Promise((resolve) => {
    child.once("close", (code, closeSignal) =>
      resolve([code ?? (closeSignal ? 128 : 127), closeSignal]),
    );
  });
  const finishedAtUtc = new Date().toISOString();
  const log = Buffer.concat(logChunks);
  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks);
  await writeFile(logPath, log);
  const gateLabels = [...log.toString("utf8").matchAll(/^=== TravelOS CI gate: (.+) ===$/gmu)].map(
    (match) => match[1],
  );
  const passedGateCount = Math.max(0, gateLabels.length - (exitCode === 0 ? 0 : 1));
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-15",
    phase: exitCode === 0 ? "FINAL" : "CI_FAILED",
    invocationCount: 1,
    result: exitCode === 0 ? "PASS" : "FAIL",
    exitCode,
    signal,
    command,
    cwd: root,
    nodeExecutable: guard.toolchain.nodeExecutable,
    nodeVersion: guard.toolchain.node,
    corepackVersion: guard.toolchain.corepack,
    pnpmVersion: guard.toolchain.pnpm,
    startedAtUtc,
    finishedAtUtc,
    gitCommit: guard.gitCommit,
    workingTreeState: guard.workingTreeState,
    packageSha256: guard.packageSha256,
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
      passed: passedGateCount,
      failed: exitCode === 0 ? 0 : Math.max(1, gateLabels.length - passedGateCount),
      labels: gateLabels,
      failedGate: exitCode === 0 ? null : (gateLabels.at(-1) ?? "runner-before-first-gate"),
    },
    stage6Actions: 0,
  };
  await writeFile(executionPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const phase = exitCode === 0 ? "FINAL" : "CI_FAILED";
  const index = await writeStage5Final15EvidenceIndex({ root, phase });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.stdout.write(
    `${JSON.stringify(
      {
        candidate: "FINAL-15",
        result: receipt.result,
        exitCode,
        invocationCount: 1,
        command,
        ciLog: `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/ci-verify.log`,
        ciExecution: `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/ci-verify-execution.json`,
        evidenceIndexPhase: phase,
        evidenceIndexSha256: index.indexSha256,
        gateCounts: receipt.gateCounts,
        stage6Actions: 0,
      },
      null,
      2,
    )}\n`,
  );
  if (exitCode !== 0) process.exitCode = exitCode;
  return receipt;
};

export const runStage5Final15AuthoritativeCiOnce = async () => {
  await assertAbsent(guardPath);
  await assertAbsent(claimPath);
  assert.equal(
    git(["ls-files", "--", STAGE5_FINAL15_CI_VERIFY_INVOCATION_GUARD]).toString("utf8").trim(),
    "",
    "FINAL-15 invocation guard must remain local and untracked",
  );
  const readiness = await verifyStage5Final15Readiness({ root });
  assert.equal(readiness.result, "PASS");
  assert.equal(readiness.candidate, "FINAL-15");
  assert.equal(readiness.phase, "PRE_CI");
  assert.equal(readiness.ciVerifyInvocations, 0);
  assert.equal(readiness.stage6Actions, 0);
  const pins = toolchain();
  const packageBytes = await readFile(path.join(root, "package.json"));
  const baselineBytes = await readFile(
    path.join(root, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
  );
  const runnerBytes = await readFile(fileURLToPath(import.meta.url));
  const readinessBytes = await readFile(
    path.join(root, STAGE5_FINAL15_READINESS_PREFLIGHT_EVIDENCE),
  );
  const indexBytes = await readFile(path.join(root, STAGE5_FINAL15_EVIDENCE_INDEX));
  const migration = await migrationHead();
  const workingTreeState = await captureWorkingTree();
  const guard = {
    schemaVersion: 1,
    candidate: "FINAL-15",
    phase: "FINAL",
    result: "INVOCATION_GUARD",
    expectedCommand: command,
    toolchain: pins,
    packageSha256: hash(packageBytes),
    securityExtensionBaselineSha256: hash(baselineBytes),
    runnerSha256: hash(runnerBytes),
    migrationHead: migration,
    gitCommit: workingTreeState.commit,
    workingTreeState,
    readinessSha256: hash(readinessBytes),
    preCiEvidenceIndexSha256: hash(indexBytes),
    preCiEvidenceIndexAggregateSha256: readiness.evidenceAggregateSha256,
    guardedAtUtc: new Date().toISOString(),
    workingTreeCapturedBeforeInvocationGuard: true,
    stage6Actions: 0,
  };
  await mkdir(path.dirname(claimPath), { recursive: true });
  await writeFile(
    claimPath,
    `${JSON.stringify({ candidate: "FINAL-15", state: "STARTING", command, stage6Actions: 0 }, null, 2)}\n`,
    { flag: "wx" },
  );
  await spawnOnce(guard);
};

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) await runStage5Final15AuthoritativeCiOnce();
