import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL12_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL12_EVIDENCE_DIRECTORY,
  STAGE5_FINAL12_EVIDENCE_INDEX,
} from "./stage-5-candidate-contract.mjs";
import { writeStage5Final12EvidenceIndex } from "./stage-5-final12-evidence-index.mjs";
import { verifyStage5Final12Readiness } from "./stage-5-final12-readiness-preflight.mjs";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const guardPath = path.join(root, STAGE5_FINAL12_CI_VERIFY_INVOCATION_GUARD);
const evidenceDir = path.join(root, STAGE5_FINAL12_EVIDENCE_DIRECTORY);
const logPath = path.join(evidenceDir, "ci-verify.log");
const executionPath = path.join(evidenceDir, "ci-verify-execution.json");
const command = "corepack pnpm ci:verify";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: root, maxBuffer: 50 * 1024 * 1024 });
const absent = async () => {
  try {
    const s = await lstat(guardPath);
    throw new Error(
      `FINAL-12 authorization already consumed (${s.isSymbolicLink() ? "symlink" : "guard exists"}); never retry`,
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
};
const localOnly = () =>
  assert.equal(
    git(["ls-files", "--", STAGE5_FINAL12_CI_VERIFY_INVOCATION_GUARD]).toString("utf8").trim(),
    "",
  );
const captureTree = async () => {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const diff = git(["diff", "HEAD", "--binary", "--"]);
  const paths = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .toSorted();
  const files = [];
  for (const p of paths) {
    const b = await readFile(path.join(root, p));
    files.push({ path: p, bytes: b.length, sha256: sha256(b) });
  }
  return {
    statusPorcelainBytes: status.length,
    statusPorcelainSha256: sha256(status),
    trackedDiffFromHeadBytes: diff.length,
    trackedDiffFromHeadSha256: sha256(diff),
    untrackedFiles: files,
  };
};
const toolVersion = async () => {
  const cp = execFileSync("corepack", ["--version"], { cwd: root, encoding: "utf8" }).trim();
  const pnpm = execFileSync("corepack", ["pnpm", "--version"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  assert.deepEqual(
    { node: process.version, corepack: cp, pnpm },
    { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" },
  );
  return { node: process.version, corepack: cp, pnpm, nodeExecutable: process.execPath };
};
const run = async () => {
  if (process.version !== "v24.19.0")
    throw new Error(`FINAL-12 runner requires Node v24.19.0, got ${process.version}`);
  await absent();
  localOnly();
  const readiness = await verifyStage5Final12Readiness({ root });
  assert.equal(readiness.result, "PASS");
  assert.equal(readiness.candidate, "FINAL-12");
  assert.equal(readiness.phase, "PRE_CI");
  assert.equal(readiness.ciVerifyInvocations, 0);
  assert.equal(readiness.stage6Actions, 0);
  const pins = await toolVersion();
  const packageBytes = await readFile(path.join(root, "package.json"));
  const baselineBytes = await readFile(
    path.join(root, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
  );
  const runnerBytes = await readFile(fileURLToPath(import.meta.url));
  const readinessBytes = await readFile(
    path.join(root, "docs/evidence/phase-1-m1/stage-5-final-12/readiness-preflight.json"),
  );
  const indexBytes = await readFile(path.join(root, STAGE5_FINAL12_EVIDENCE_INDEX));
  const migration = JSON.parse(
    await readFile(path.join(root, "migrations/checksums.json"), "utf8"),
  );
  const head = migration.migrations?.at(-1);
  assert(head && typeof head.file === "string" && typeof head.sha256 === "string");
  const workingTreeState = await captureTree();
  const armed = {
    schemaVersion: 1,
    candidate: "FINAL-12",
    phase: "FINAL",
    invocationCount: 1,
    result: "RUNNING",
    exitCode: null,
    command,
    armedAtUtc: new Date().toISOString(),
    toolchain: pins,
    packageSha256: sha256(packageBytes),
    securityExtensionBaselineSha256: sha256(baselineBytes),
    runnerSha256: sha256(runnerBytes),
    migrationHead: { file: head.file, sha256: head.sha256 },
    gitCommit: git(["rev-parse", "HEAD"]).toString("utf8").trim(),
    workingTreeState,
    workingTreeCapturedBeforeGuardWrite: true,
    readinessSha256: sha256(readinessBytes),
    preCiEvidenceIndexSha256: sha256(indexBytes),
    stage6Actions: 0,
  };
  await mkdir(path.dirname(guardPath), { recursive: true });
  await writeFile(guardPath, `${JSON.stringify(armed, null, 2)}\n`, { flag: "wx" });
  const startedAtUtc = new Date().toISOString();
  const child = spawnSync("corepack", ["pnpm", "ci:verify"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 250 * 1024 * 1024,
    env: { ...process.env },
  });
  if (child.error) {
    await rm(guardPath);
    throw new Error(
      `FINAL-12 ci:verify was not started; authorization remains unconsumed: ${child.error.message}`,
    );
  }
  const stdout = child.stdout ?? "";
  const stderr = child.stderr ?? "";
  const exitCode = child.status ?? (child.signal ? 128 : 127);
  const finishedAtUtc = new Date().toISOString();
  const log = Buffer.from(`${stdout}${stderr}`);
  await writeFile(logPath, log);
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-12",
    phase: "FINAL",
    invocationCount: 1,
    result: exitCode === 0 ? "PASS" : "FAIL",
    exitCode,
    command,
    cwd: root,
    nodeExecutable: pins.nodeExecutable,
    nodeVersion: pins.node,
    corepackVersion: pins.corepack,
    pnpmVersion: pins.pnpm,
    startedAtUtc,
    finishedAtUtc,
    gitCommit: armed.gitCommit,
    workingTreeState: armed.workingTreeState,
    packageSha256: armed.packageSha256,
    securityExtensionBaselineSha256: armed.securityExtensionBaselineSha256,
    runnerSha256: armed.runnerSha256,
    migrationHead: armed.migrationHead,
    readinessSha256: armed.readinessSha256,
    preCiEvidenceIndexSha256: armed.preCiEvidenceIndexSha256,
    logBytes: log.length,
    logSha256: sha256(log),
    stage6Actions: 0,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(executionPath, receiptBytes);
  const phase = exitCode === 0 ? "FINAL" : "CI_FAILED";
  const index = await writeStage5Final12EvidenceIndex({ root, phase });
  const finalGuard = {
    ...armed,
    result: receipt.result,
    exitCode,
    finishedAtUtc,
    logBytes: log.length,
    logSha256: receipt.logSha256,
    executionBytes: receiptBytes.length,
    executionSha256: sha256(receiptBytes),
    evidenceIndexSha256: index.indexSha256,
    evidenceIndexPhase: phase,
    gateEligibleForFreeze: exitCode === 0,
  };
  await writeFile(guardPath, `${JSON.stringify(finalGuard, null, 2)}\n`);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.stdout.write(
    `${JSON.stringify({ candidate: "FINAL-12", result: receipt.result, exitCode, invocationCount: 1, command, ciLog: "docs/evidence/phase-1-m1/stage-5-final-12/ci-verify.log", ciExecution: "docs/evidence/phase-1-m1/stage-5-final-12/ci-verify-execution.json", evidenceIndexPhase: phase, evidenceIndexSha256: index.indexSha256, gateEligibleForFreeze: exitCode === 0, stage6Actions: 0 }, null, 2)}\n`,
  );
  if (exitCode !== 0) process.exitCode = exitCode;
  return finalGuard;
};
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) await run();
export { run as runStage5Final12AuthoritativeCiOnce };
