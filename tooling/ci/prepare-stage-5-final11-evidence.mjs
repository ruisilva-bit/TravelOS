import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import {
  STAGE5_FINAL10_CI_EXECUTION,
  STAGE5_FINAL10_CI_LOG,
  STAGE5_FINAL10_CORRECTION_MATRIX_PATH,
  STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT,
  STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX,
  STAGE5_FINAL10_PHASE1_BASELINE_PATH,
  STAGE5_FINAL10_REJECTION_RECORD,
  STAGE5_FINAL10_REJECTED_TAG,
  STAGE5_FINAL11_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL11_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL11_EVIDENCE_DIRECTORY,
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL11_FINAL10_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE,
} from "./stage-5-candidate-contract.mjs";
import {
  buildStage5Final10RejectedTagArtifact,
  verifyStage5Final10RejectedTaggedBytes,
} from "./stage-5-final11-finding-lineage.mjs";
import { verifyStage5SecurityExtensionBaseline } from "./verify-stage-5-security-extension-baseline.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(repositoryRoot, STAGE5_FINAL11_EVIDENCE_DIRECTORY);
const scratchRoot = path.resolve(process.env["TMPDIR"] ?? os.tmpdir());
const postgresEvidenceDirectory = path.join(
  scratchRoot,
  "travelos-stage5-final11-disposable-qualification",
);
const expectedPreparedArtifactNames = STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
  (name) => name !== "readiness-preflight.json",
).toSorted();
const commandEnvironment = { ...process.env };

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const writeJson = async (relativePath, value) =>
  writeFile(path.join(evidenceDirectory, relativePath), `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
const run = (command, args, env = commandEnvironment) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 60 * 1024 * 1024,
    env,
  });
  return {
    command: [command, ...args].join(" "),
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
};
const assertPass = (label, execution) => {
  if (execution.exitCode !== 0) {
    throw new Error(
      `${label} failed with exit ${execution.exitCode}: ${execution.stderr.slice(0, 5_000)}`,
    );
  }
  return execution;
};
const readGitBlob = (tag, relativePath) =>
  execFileSync("git", ["show", `${tag}:${relativePath}`], {
    cwd: repositoryRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
const copyBytes = async (name, bytes) =>
  writeFile(path.join(evidenceDirectory, name), bytes, { flag: "wx" });
const captureCommand = async ({ command, args, fileName, schemaVersion = 1 }) => {
  const execution = run(command, args);
  await writeFile(
    path.join(evidenceDirectory, fileName),
    `${execution.stdout}${execution.stderr}`,
    {
      flag: "wx",
    },
  );
  const report = {
    schemaVersion,
    candidate: "FINAL-11",
    result: execution.exitCode === 0 ? "PASS" : "FAIL",
    command: execution.command,
    exitCode: execution.exitCode,
    stdoutSha256: sha256(Buffer.from(execution.stdout)),
    stderrSha256: sha256(Buffer.from(execution.stderr)),
    outputBytes: Buffer.byteLength(execution.stdout) + Buffer.byteLength(execution.stderr),
    nodeVersion: process.version,
  };
  return { execution, report };
};
const assertPinnedToolchain = () => {
  const node = process.version;
  const corepack = assertPass("Corepack version", run("corepack", ["--version"])).stdout.trim();
  const pnpm = assertPass("pnpm version", run("corepack", ["pnpm", "--version"])).stdout.trim();
  if (node !== "v24.19.0" || corepack !== "0.35.0" || pnpm !== "11.21.0") {
    throw new Error(`FINAL-11 preparation requires exact pins; got ${node}/${corepack}/${pnpm}`);
  }
  return { node, corepack, pnpm, processExecPath: process.execPath };
};
const resetUnfrozenEvidence = async () => {
  if (await pathExists(STAGE5_FINAL11_EVIDENCE_INDEX)) {
    throw new Error("FINAL-11 evidence index already exists; do not rewrite a prepared candidate");
  }
  if (await pathExists(STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD)) {
    throw new Error("FINAL-11 CI guard already exists; evidence preparation is no longer allowed");
  }
  if (await pathExists(STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE)) {
    throw new Error(
      "FINAL-11 readiness state already exists; evidence preparation is no longer allowed",
    );
  }
  for (const protectedOutput of [
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_11_CANDIDATE_VALIDATION.md",
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_11_CANDIDATE_FREEZE.md",
  ]) {
    if (await pathExists(protectedOutput)) {
      throw new Error(
        `FINAL-11 evidence preparation cannot alter a later closure artifact: ${protectedOutput}`,
      );
    }
  }
  const directory = await lstat(evidenceDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error("FINAL-11 evidence directory must be a regular directory");
  }
  const entries = await readdir(evidenceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error(`FINAL-11 evidence directory contains an unsafe entry: ${entry.name}`);
    }
    const absolutePath = path.join(evidenceDirectory, entry.name);
    if (entry.name === "baseline-generation.json" && entry.isFile()) continue;
    if (entry.isDirectory()) await rm(absolutePath, { recursive: true, force: true });
    else await rm(absolutePath, { force: true });
  }
  const remaining = (await readdir(evidenceDirectory)).toSorted();
  if (remaining.length !== 1 || remaining[0] !== "baseline-generation.json") {
    throw new Error(
      "FINAL-11 evidence staging did not retain exactly its verified baseline receipt",
    );
  }
};
const pathExists = async (relativePath) => {
  try {
    await lstat(path.join(repositoryRoot, relativePath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};
const writePredecessorArtifacts = async (final10Lineage, baselineVerification) => {
  const taggedArtifactSources = [
    ["final10-ci-verify.log", STAGE5_FINAL10_CI_LOG],
    ["final10-ci-verify-execution.json", STAGE5_FINAL10_CI_EXECUTION],
    ["final10-pre-ci-evidence-index.json", STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX],
    ["final10-correction-matrix.json", STAGE5_FINAL10_CORRECTION_MATRIX_PATH],
    ["final10-rejection-record.md", STAGE5_FINAL10_REJECTION_RECORD],
    ["final10-security-extension-baseline.json", STAGE5_FINAL10_PHASE1_BASELINE_PATH],
    ["final8-independent-review.json", STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT],
    ["final9-independent-review.md", STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT],
    ["final9-rejected-tag.json", STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT],
  ];
  for (const [name, sourcePath] of taggedArtifactSources) {
    await copyBytes(name, readGitBlob(STAGE5_FINAL10_REJECTED_TAG, sourcePath));
  }
  const final10TagBytes = Buffer.from(
    `${JSON.stringify(buildStage5Final10RejectedTagArtifact(final10Lineage), null, 2)}\n`,
  );
  await copyBytes(path.basename(STAGE5_FINAL11_FINAL10_REJECTED_TAG_ARTIFACT), final10TagBytes);
  await copyBytes("ci-verify.log", Buffer.from(STAGE5_FINAL11_CI_LOG_PLACEHOLDER));
  await copyBytes("ci-verify-execution.json", Buffer.from(STAGE5_FINAL11_CI_EXECUTION_PLACEHOLDER));
  const baselineBytes = await readFile(path.join(evidenceDirectory, "baseline-generation.json"));
  const baselineGeneration = JSON.parse(baselineBytes.toString("utf8"));
  if (
    baselineGeneration.result !== "PASS" ||
    baselineGeneration.candidate !== "FINAL-11" ||
    baselineGeneration.baselineSha256 !== baselineVerification.baselineSha256
  ) {
    throw new Error(
      "FINAL-11 baseline-generation receipt does not bind the verified successor baseline",
    );
  }
};
const runAndCaptureQualifications = async () => {
  await resetUnfrozenEvidence();
  const toolchain = assertPinnedToolchain();
  const baselineVerification = await verifyStage5SecurityExtensionBaseline({
    root: repositoryRoot,
  });
  if (baselineVerification.result !== "PASS") {
    throw new Error("FINAL-11 protected Phase 1 extension baseline did not verify");
  }
  const baselineTests = assertPass(
    "FINAL-11 security-extension regression tests",
    run("corepack", ["pnpm", "run", "test:stage5-security-extension-baseline"]),
  );
  const final10Lineage = await verifyStage5Final10RejectedTaggedBytes({ root: repositoryRoot });
  if (
    final10Lineage.result !== "PASS" ||
    final10Lineage.status !== "REJECTED" ||
    final10Lineage.stage6Actions !== 0 ||
    final10Lineage.invocationCount !== 1
  ) {
    throw new Error("FINAL-10 rejection lineage no longer verifies exactly");
  }
  await writePredecessorArtifacts(final10Lineage, baselineVerification);
  await writeJson("security-extension-baseline.json", {
    schemaVersion: 1,
    candidate: "FINAL-11",
    result: "PASS",
    verification: baselineVerification,
    regressionTests: {
      result: "PASS",
      command: "corepack pnpm run test:stage5-security-extension-baseline",
      exitCode: baselineTests.exitCode,
      stdoutSha256: sha256(Buffer.from(baselineTests.stdout)),
      stderrSha256: sha256(Buffer.from(baselineTests.stderr)),
    },
    rejectedFinal10Tag: {
      tag: final10Lineage.tag,
      target: final10Lineage.target,
      ciResult: "FAIL",
      invocationCount: 1,
      stage6Actions: 0,
    },
  });

  assertPass(
    "FINAL-11 focused Stage 5 suite",
    run("corepack", ["pnpm", "run", "test:stage5:focused"]),
  );
  const focusedExecutionPath = path.join(evidenceDirectory, "focused-test-execution.json");
  const focusedExecution = JSON.parse(await readFile(focusedExecutionPath, "utf8"));
  if (
    focusedExecution.candidate !== "FINAL-11" ||
    focusedExecution.result !== "PASS" ||
    focusedExecution.exitCode !== 0 ||
    focusedExecution.toolchain.node !== toolchain.node ||
    focusedExecution.toolchain.corepack !== toolchain.corepack ||
    focusedExecution.toolchain.pnpm !== toolchain.pnpm
  ) {
    throw new Error("FINAL-11 focused suite receipt does not prove the pinned passing run");
  }
  const focusedLog = await readFile(path.join(evidenceDirectory, "focused-tests.log"));

  const auth = await captureCommand({
    command: "corepack",
    args: [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "--config",
      "tooling/testing/vitest.config.ts",
      "--reporter=verbose",
      "apps/admin-api/test/auth-bridge.test.ts",
      "apps/portal-api/test/auth-bridge.test.ts",
    ],
    fileName: "auth-bridge-tests.log",
  });
  assertPass("FINAL-11 Admin and Portal auth bridge tests", auth.execution);
  await writeJson("auth-bridge-tests.json", auth.report);

  const migration = await captureCommand({
    command: "corepack",
    args: ["pnpm", "exec", "tsx", "tooling/database/verify-migration-checksums.ts"],
    fileName: "migration-checksums.output.log",
  });
  assertPass("FINAL-11 migration checksum verification", migration.execution);
  await writeJson("migration-checksums.json", {
    ...migration.report,
    verifiedMigrationChain: "migrations/checksums.json",
    output: migration.execution.stdout.trim(),
  });
  await rm(path.join(evidenceDirectory, "migration-checksums.output.log"), { force: true });

  const build = run("corepack", ["pnpm", "run", "build"]);
  assertPass("FINAL-11 production build", build);
  const smoke = run("corepack", ["pnpm", "run", "test:smoke"]);
  assertPass("FINAL-11 built-artifact manifest smoke", smoke);
  await writeJson("package-build.json", {
    schemaVersion: 1,
    candidate: "FINAL-11",
    result: "PASS",
    nodeVersion: toolchain.node,
    commands: ["corepack pnpm run build", "corepack pnpm run test:smoke"],
    build: {
      exitCode: build.exitCode,
      stdoutSha256: sha256(Buffer.from(build.stdout)),
      stderrSha256: sha256(Buffer.from(build.stderr)),
      outputBytes: Buffer.byteLength(build.stdout) + Buffer.byteLength(build.stderr),
    },
    smoke: {
      exitCode: smoke.exitCode,
      stdoutSha256: sha256(Buffer.from(smoke.stdout)),
      stderrSha256: sha256(Buffer.from(smoke.stderr)),
      outputBytes: Buffer.byteLength(smoke.stdout) + Buffer.byteLength(smoke.stderr),
    },
  });

  const sourceScope = await captureCommand({
    command: "corepack",
    args: ["pnpm", "run", "test:stage5-source-scope"],
    fileName: "stage5-source-scope-test.log",
    schemaVersion: 1,
  });
  assertPass("FINAL-11 source-scope/evidence regression tests", sourceScope.execution);
  await mkdir(scratchRoot, { recursive: true });
  const postgres = run("node", ["tooling/database/run-stage-5-disposable.mjs"], {
    ...commandEnvironment,
    TRAVELOS_STAGE5_EVIDENCE_DIR: postgresEvidenceDirectory,
  });
  if (postgres.exitCode !== 0) {
    throw new Error(
      `FINAL-11 disposable PostgreSQL 18.6 qualification failed: ${postgres.stderr.slice(0, 5_000)}`,
    );
  }
  const postgresArtifactNames = [
    "disposable-cleanup.json",
    "integration-test-execution.json",
    "integration-tests.log",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
  ];
  for (const name of postgresArtifactNames) {
    const bytes = await readFile(path.join(postgresEvidenceDirectory, name));
    await copyBytes(name, bytes);
  }
  const integrationExecution = JSON.parse(
    await readFile(path.join(evidenceDirectory, "integration-test-execution.json"), "utf8"),
  );
  const cleanup = JSON.parse(
    await readFile(path.join(evidenceDirectory, "disposable-cleanup.json"), "utf8"),
  );
  const postgresRuntime = JSON.parse(
    await readFile(path.join(evidenceDirectory, "postgresql-runtime.json"), "utf8"),
  );
  if (
    integrationExecution.result !== "PASS" ||
    integrationExecution.exitCode !== 0 ||
    cleanup.result !== "PASS" ||
    cleanup.disposableRootAbsent !== true ||
    postgresRuntime.serverVersionNumber !== 180006 ||
    postgresRuntime.bindScope !== "loopback-only"
  ) {
    throw new Error(
      "FINAL-11 PostgreSQL qualification receipts failed version/runtime/cleanup assertions",
    );
  }

  const qualificationArtifacts = [
    "auth-bridge-tests.json",
    "disposable-cleanup.json",
    "focused-test-execution.json",
    "integration-test-execution.json",
    "migration-checksums.json",
    "package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "security-extension-baseline.json",
    "stage5-source-scope-test.log",
  ];
  const receiptManifest = [];
  for (const name of qualificationArtifacts) {
    const bytes = await readFile(path.join(evidenceDirectory, name));
    let parsed = null;
    if (name.endsWith(".json")) parsed = JSON.parse(bytes.toString("utf8"));
    receiptManifest.push({
      name,
      bytes: bytes.length,
      sha256: sha256(bytes),
      result: parsed?.result ?? (name.endsWith(".log") ? "CAPTURED" : undefined),
    });
  }
  await writeJson("qualification-summary.json", {
    schemaVersion: 1,
    candidate: "FINAL-11",
    result: "PASS",
    toolchain,
    focused: {
      result: focusedExecution.result,
      files: focusedExecution.files,
      tests: focusedExecution.tests,
      logBytes: focusedLog.length,
    },
    authBridge: auth.report,
    postgres: {
      serverVersionNumber: postgresRuntime.serverVersionNumber,
      integrationTests: integrationExecution,
      cleanup,
    },
    migration: migration.report,
    packageBuild: {
      result: "PASS",
      buildStdoutSha256: sha256(Buffer.from(build.stdout)),
      smokeStdoutSha256: sha256(Buffer.from(smoke.stdout)),
    },
    stage6Actions: 0,
    artifacts: receiptManifest,
  });

  const expectedNames = expectedPreparedArtifactNames;
  const actualNames = (await readdir(evidenceDirectory)).toSorted();
  if (
    expectedNames.length !== actualNames.length ||
    expectedNames.some((name, index) => name !== actualNames[index])
  ) {
    throw new Error(
      `FINAL-11 evidence preparation produced a non-exact artifact set: ${JSON.stringify({ expectedNames, actualNames })}`,
    );
  }
  return {
    result: "PASS",
    candidate: "FINAL-11",
    evidenceDirectory: STAGE5_FINAL11_EVIDENCE_DIRECTORY,
    artifactCount: actualNames.length,
    phase: "PRE_CI",
    ciInvocationCount: 0,
    stage6Actions: 0,
  };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const report = await runAndCaptureQualifications();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
