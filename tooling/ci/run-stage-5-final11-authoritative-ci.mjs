import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import {
  STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL11_EVIDENCE_DIRECTORY,
  STAGE5_FINAL11_EVIDENCE_INDEX,
} from "./stage-5-candidate-contract.mjs";
import { writeStage5Final11EvidenceIndex } from "./stage-5-evidence-index.mjs";
import { verifyStage5Final11ReadinessPreflight } from "./stage-5-final11-readiness-preflight.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(repositoryRoot, STAGE5_FINAL11_EVIDENCE_DIRECTORY);
const ciLogPath = path.join(evidenceDirectory, "ci-verify.log");
const ciExecutionPath = path.join(evidenceDirectory, "ci-verify-execution.json");
const guardPath = path.join(repositoryRoot, STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD);
const command = "corepack pnpm ci:verify";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const assertGuardAbsent = async () => {
  try {
    const metadata = await lstat(guardPath);
    throw new Error(
      `FINAL-11 invocation guard already exists (${metadata.isSymbolicLink() ? "symlink" : "consumed candidate"}); never rerun CI`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
const assertLocalOnlyGuard = () => {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--", STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  if (tracked !== "") throw new Error("FINAL-11 invocation guard must remain local-only");
};
const gitBuffer = (args) =>
  execFileSync("git", args, { cwd: repositoryRoot, maxBuffer: 40 * 1024 * 1024 });
const captureWorkingTreeState = async () => {
  const status = gitBuffer(["status", "--porcelain=v1", "--untracked-files=all"]);
  const diff = gitBuffer(["diff", "HEAD", "--binary", "--"]);
  const untrackedPaths = gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .toSorted();
  const untrackedFiles = [];
  for (const relativePath of untrackedPaths) {
    const bytes = await readFile(path.join(repositoryRoot, relativePath));
    untrackedFiles.push({ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return {
    statusPorcelainSha256: sha256(status),
    statusPorcelainBytes: status.length,
    trackedDiffFromHeadSha256: sha256(diff),
    trackedDiffFromHeadBytes: diff.length,
    untrackedFiles,
  };
};
const writeGuard = async (guard) => {
  await mkdir(path.dirname(guardPath), { recursive: true });
  await writeFile(guardPath, `${JSON.stringify(guard, null, 2)}\n`, { flag: "wx" });
};
const runAuthoritativeCiOnce = () => {
  const startedAtUtc = new Date().toISOString();
  const execution = spawnSync("corepack", ["pnpm", "ci:verify"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
    env: { ...process.env },
  });
  const stdout = execution.stdout ?? "";
  const stderr = execution.stderr ?? (execution.error ? String(execution.error) : "");
  const exitCode = execution.status ?? 127;
  const finishedAtUtc = new Date().toISOString();
  const logBytes = Buffer.from(`${stdout}${stderr}`, "utf8");
  return {
    stdout,
    stderr,
    exitCode,
    logBytes,
    startedAtUtc,
    finishedAtUtc,
    execution: {
      schemaVersion: 1,
      candidate: "FINAL-11",
      phase: "FINAL",
      invocationCount: 1,
      result: exitCode === 0 ? "PASS" : "FAIL",
      exitCode,
      command,
      cwd: repositoryRoot,
      nodeExecutable: process.execPath,
      nodeVersion: process.version,
      corepackVersion: "0.35.0",
      pnpmVersion: "11.21.0",
      startedAtUtc,
      finishedAtUtc,
      logBytes: logBytes.length,
      logSha256: sha256(logBytes),
    },
  };
};
const execute = async () => {
  if (process.version !== "v24.19.0") {
    throw new Error(
      `FINAL-11 authoritative runner requires Node v24.19.0; received ${process.version}`,
    );
  }
  await assertGuardAbsent();
  assertLocalOnlyGuard();
  const readiness = await verifyStage5Final11ReadinessPreflight({ root: repositoryRoot });
  if (
    readiness.result !== "PASS" ||
    readiness.candidate !== "FINAL-11" ||
    readiness.phase !== "PRE_CI" ||
    readiness.ciVerifyInvocations !== 0 ||
    readiness.stage6Actions !== 0
  ) {
    throw new Error("FINAL-11 pinned readiness is not green; refusing the sole CI invocation");
  }
  const packageBytes = await readFile(path.join(repositoryRoot, "package.json"));
  const baselineBytes = await readFile(
    path.join(repositoryRoot, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
  );
  const runnerBytes = await readFile(fileURLToPath(import.meta.url));
  const migrationManifestBytes = await readFile(
    path.join(repositoryRoot, "migrations/checksums.json"),
  );
  const migrationManifest = JSON.parse(migrationManifestBytes.toString("utf8"));
  const migrationHead = migrationManifest.migrations?.at(-1);
  if (
    !migrationHead ||
    typeof migrationHead.file !== "string" ||
    typeof migrationHead.sha256 !== "string"
  ) {
    throw new Error("FINAL-11 migration checksum manifest has no valid migration head");
  }
  const workingTreeState = await captureWorkingTreeState();
  const readinessBytes = await readFile(
    path.join(repositoryRoot, "docs/evidence/phase-1-m1/stage-5-final-11/readiness-preflight.json"),
  );
  const indexBytes = await readFile(path.join(repositoryRoot, STAGE5_FINAL11_EVIDENCE_INDEX));
  const armedGuard = {
    schemaVersion: 1,
    candidate: "FINAL-11",
    phase: "FINAL",
    invocationCount: 1,
    result: "RUNNING",
    exitCode: null,
    command,
    startedAtUtc: new Date().toISOString(),
    nodeExecutable: process.execPath,
    nodeVersion: process.version,
    corepackVersion: readiness.toolchain.corepack,
    pnpmVersion: readiness.toolchain.pnpm,
    packageSha256: sha256(packageBytes),
    securityExtensionBaselineSha256: sha256(baselineBytes),
    runnerSha256: sha256(runnerBytes),
    migrationHead: { file: migrationHead.file, sha256: migrationHead.sha256 },
    gitCommit: gitBuffer(["rev-parse", "HEAD"]).toString("utf8").trim(),
    workingTreeState,
    workingTreeCapturedBeforeGuardWrite: true,
    readinessSha256: sha256(readinessBytes),
    preCiEvidenceIndexSha256: sha256(indexBytes),
    stage6Actions: 0,
  };
  await writeGuard(armedGuard);

  const result = runAuthoritativeCiOnce();
  await writeFile(ciLogPath, result.logBytes);
  const receiptBytes = Buffer.from(`${JSON.stringify(result.execution, null, 2)}\n`, "utf8");
  await writeFile(ciExecutionPath, receiptBytes);
  const indexPhase = result.exitCode === 0 ? "FINAL" : "CI_FAILED";
  const finalIndex = await writeStage5Final11EvidenceIndex({
    root: repositoryRoot,
    phase: indexPhase,
  });
  const finalGuard = {
    ...armedGuard,
    result: result.execution.result,
    exitCode: result.exitCode,
    finishedAtUtc: result.finishedAtUtc,
    logBytes: result.logBytes.length,
    logSha256: result.execution.logSha256,
    executionBytes: receiptBytes.length,
    executionSha256: sha256(receiptBytes),
    evidenceIndexSha256: finalIndex.indexSha256,
    evidenceIndexPhase: indexPhase,
    gateEligibleForFreeze: result.exitCode === 0,
  };
  await writeFile(guardPath, `${JSON.stringify(finalGuard, null, 2)}\n`);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.stdout.write(
    `${JSON.stringify(
      {
        candidate: "FINAL-11",
        result: result.execution.result,
        exitCode: result.exitCode,
        invocationCount: 1,
        command,
        ciLog: "docs/evidence/phase-1-m1/stage-5-final-11/ci-verify.log",
        ciExecution: "docs/evidence/phase-1-m1/stage-5-final-11/ci-verify-execution.json",
        evidenceIndexPhase: indexPhase,
        evidenceIndexSha256: finalIndex.indexSha256,
        gateEligibleForFreeze: result.exitCode === 0,
        stage6Actions: 0,
      },
      null,
      2,
    )}\n`,
  );
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
  return finalGuard;
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) await execute();

export { execute as runStage5Final11AuthoritativeCiOnce };
