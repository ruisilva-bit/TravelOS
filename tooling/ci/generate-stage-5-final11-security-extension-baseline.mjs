import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL9_REJECTED_TAG,
  STAGE5_FINAL9_REJECTED_TAG_TARGET,
  STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
  STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
  STAGE5_FINAL10_PHASE1_BASELINE_PATH,
  STAGE5_FINAL10_REJECTED_TAG,
  STAGE5_FINAL10_REJECTED_TAG_TARGET,
  STAGE5_FINAL11_CANDIDATE_FREEZE,
  STAGE5_FINAL11_CANDIDATE_VALIDATION,
  STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL11_EVIDENCE_DIRECTORY,
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE,
} from "./stage-5-candidate-contract.mjs";
import {
  PHASE0_ACCEPTED_BASELINE_ENTRY_COUNT,
  PHASE0_ACCEPTED_BASELINE_SHA256,
  PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT,
  PHASE0_PERMISSIONS_PATH,
  PHASE0_PERMISSIONS_SHA256,
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_BASELINE_SHA256,
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS,
  verifyPhase0AcceptedBaselineLineage,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";
import { verifyStage5Final10RejectedTaggedBytes } from "./stage-5-final11-finding-lineage.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scratchRoot = path.resolve(process.env.TMPDIR ?? "");
const expectedPreviousAggregateSha256 =
  "528b8d760fcc468021e7b8e2dfdd44e20430f17119a11162bb6f93f2754bc668";
const expectedPreviousProtectedDeltas = Object.freeze(
  [STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH, "package.json"].toSorted(),
);
const expectedFinal11Scripts = Object.freeze({
  "evidence:stage5:matrix": "node tooling/ci/stage-5-final11-finding-lineage.mjs --write",
  "evidence:stage5:baseline":
    "node tooling/ci/generate-stage-5-final11-security-extension-baseline.mjs --write",
  "evidence:stage5:prepare": "node tooling/ci/prepare-stage-5-final11-evidence.mjs",
  "evidence:stage5:preflight": "node tooling/ci/stage-5-final11-readiness-preflight.mjs --write",
  "evidence:stage5:ci": "node tooling/ci/run-stage-5-final11-authoritative-ci.mjs",
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const compareProtectedPaths = (left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const serializeRows = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const readGitBlob = (tag, relativePath) =>
  execFileSync("git", ["show", `${tag}:${relativePath}`], {
    cwd: repositoryRoot,
    maxBuffer: 8 * 1024 * 1024,
  });
const gitCommitTarget = (tag) =>
  execFileSync("git", ["rev-parse", `${tag}^{commit}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
const readJson = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
};
const readRegularFile = async (root, relativePath, label) => {
  const absolutePath = path.join(root, relativePath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${relativePath}`);
  }
  return readFile(absolutePath);
};

const verifyHistoricalPhase1Baseline = async () => {
  const expectedScratchRoot = path.resolve(
    process.env.HOME ?? "/home/hermes",
    ".hermes/cache/scratch",
  );
  assert(
    scratchRoot === expectedScratchRoot,
    `FINAL-11 baseline verification must use the dedicated Hermes scratch directory: ${scratchRoot}`,
  );
  assert(
    gitCommitTarget(STAGE5_FINAL9_REJECTED_TAG) === STAGE5_FINAL9_REJECTED_TAG_TARGET,
    "FINAL-9 rejected tag target changed before successor baseline generation",
  );
  const worktreeContainer = await mkdtemp(
    path.join(scratchRoot, "travelos-stage5-final11-baseline-"),
  );
  const worktreePath = path.join(worktreeContainer, "phase1-final9");
  let worktreeAdded = false;
  try {
    execFileSync("git", ["worktree", "add", "--detach", worktreePath, STAGE5_FINAL9_REJECTED_TAG], {
      cwd: repositoryRoot,
      stdio: "pipe",
    });
    worktreeAdded = true;
    const result = spawnSync(
      process.execPath,
      ["tooling/ci/verify-stage-5-security-extension-baseline.mjs"],
      {
        cwd: worktreePath,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        `FINAL-9 tagged Phase 1 baseline verifier failed: ${result.error?.message ?? result.stderr}`,
      );
    }
    const stdout = result.stdout.trim();
    const verification = readJson(
      Buffer.from(stdout, "utf8"),
      "FINAL-9 predecessor verifier output",
    );
    assert(
      verification.result === "PASS" &&
        verification.phase0?.result === "PASS" &&
        verification.phase0.manifest?.entryCount === PHASE0_ACCEPTED_BASELINE_ENTRY_COUNT &&
        verification.phase1?.baselinePath === STAGE5_SECURITY_EXTENSION_BASELINE_PATH &&
        verification.phase1.baselineSha256 === STAGE5_FINAL10_PHASE1_BASELINE_SHA256 &&
        verification.phase1.protectedFileCount === 10 &&
        verification.phase1.aggregateSha256 === expectedPreviousAggregateSha256,
      "Original FINAL-9 tagged verifier did not PASS the protected Phase 1 predecessor",
    );
    const cleanWorktree = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      encoding: "utf8",
    });
    assert(
      cleanWorktree === "",
      "Read-only FINAL-9 baseline verification modified its temporary worktree",
    );
    return {
      result: "PASS",
      command: "node tooling/ci/verify-stage-5-security-extension-baseline.mjs",
      sourceTag: STAGE5_FINAL9_REJECTED_TAG,
      sourceTagTarget: STAGE5_FINAL9_REJECTED_TAG_TARGET,
      baselinePath: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
      baselineSha256: verification.phase1.baselineSha256,
      protectedFileCount: verification.phase1.protectedFileCount,
      aggregateSha256: verification.phase1.aggregateSha256,
      phase0Result: verification.phase0.result,
      phase0ManifestSha256: PHASE0_ACCEPTED_BASELINE_SHA256,
      phase0SourceCommit: PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT,
      phase0PermissionsPath: PHASE0_PERMISSIONS_PATH,
      phase0PermissionsSha256: PHASE0_PERMISSIONS_SHA256,
      verificationOutputSha256: sha256(Buffer.from(`${JSON.stringify(verification, null, 2)}\n`)),
      temporaryWorktreeClean: true,
      temporaryWorktreeRemoved: true,
    };
  } finally {
    if (worktreeAdded) {
      execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
        cwd: repositoryRoot,
        stdio: "pipe",
      });
    }
    await rm(worktreeContainer, { recursive: true, force: true });
  }
};

const verifyCandidatePreconditions = async () => {
  await verifyPhase0AcceptedBaselineLineage({ root: repositoryRoot });
  const final10 = await verifyStage5Final10RejectedTaggedBytes({ root: repositoryRoot });
  assert(
    final10.result === "PASS" &&
      final10.candidate === "FINAL-10" &&
      final10.status === "REJECTED" &&
      final10.failedGate === "stage5-security-extension:pre" &&
      final10.invocationCount === 1 &&
      final10.command === "corepack pnpm ci:verify" &&
      final10.exitCode === 1 &&
      final10.phase1Baseline?.sha256 === STAGE5_FINAL10_PHASE1_BASELINE_SHA256 &&
      final10.localOnlyInvocationGuard?.sha256,
    "FINAL-10 rejection tag, consumed CI receipts, baseline or local once-only guard did not verify",
  );
  const final9Predecessor = await verifyHistoricalPhase1Baseline();
  const final9BaselineBytes = readGitBlob(
    STAGE5_FINAL9_REJECTED_TAG,
    STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  );
  const final10BaselineBytes = readGitBlob(
    STAGE5_FINAL10_REJECTED_TAG,
    STAGE5_FINAL10_PHASE1_BASELINE_PATH,
  );
  assert(
    sha256(final9BaselineBytes) === STAGE5_FINAL10_PHASE1_BASELINE_SHA256 &&
      final9BaselineBytes.equals(final10BaselineBytes),
    "FINAL-10 altered the predecessor Phase 1 baseline bytes",
  );
  const final10PackageBytes = readGitBlob(STAGE5_FINAL10_REJECTED_TAG, "package.json");
  const final10PackageSha256 = sha256(final10PackageBytes);
  assert(
    final10PackageSha256 !== STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256 &&
      final10PackageSha256 === final10.packageSha256AtCi,
    "FINAL-10 package bytes do not prove the exact stale-baseline failure source",
  );
  const packageManifest = readJson(
    await readRegularFile(repositoryRoot, "package.json", "FINAL-11 package manifest"),
    "FINAL-11 package manifest",
  );
  for (const [name, command] of Object.entries(expectedFinal11Scripts)) {
    assert(
      packageManifest.scripts?.[name] === command,
      `FINAL-11 package script is missing or altered: ${name}`,
    );
  }
  for (const relativePath of [
    "tooling/ci/run-stage-5-final11-authoritative-ci.mjs",
    "tooling/ci/prepare-stage-5-final11-evidence.mjs",
    "tooling/ci/stage-5-final11-readiness-preflight.mjs",
    "tooling/ci/test-stage-5-final11-security-extension-baseline.mjs",
  ]) {
    await readRegularFile(repositoryRoot, relativePath, "FINAL-11 candidate tooling");
  }
  const expectedPreviousBytes = readGitBlob(
    STAGE5_FINAL9_REJECTED_TAG,
    STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  );
  const previousBaseline = readJson(expectedPreviousBytes, "FINAL-9 predecessor baseline");
  const currentFiles = [];
  for (const relativePath of STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS) {
    const bytes = await readRegularFile(repositoryRoot, relativePath, "FINAL-11 protected input");
    currentFiles.push({ path: relativePath, bytes, sha256: sha256(bytes) });
  }
  const previousByPath = new Map(
    previousBaseline.protectedFiles.map((entry) => [entry.path, entry]),
  );
  const currentByPath = new Map(currentFiles.map((entry) => [entry.path, entry]));
  const changedProtectedPaths = STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.filter(
    (relativePath) =>
      previousByPath.get(relativePath)?.sha256 !== currentByPath.get(relativePath)?.sha256,
  ).toSorted();
  assert(
    JSON.stringify(changedProtectedPaths) === JSON.stringify(expectedPreviousProtectedDeltas),
    `FINAL-11 protected-file delta is unauthorized: ${JSON.stringify(changedProtectedPaths)}`,
  );
  assert(
    STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.includes("ci-verify-execution.json") &&
      STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.includes("ci-verify.log") &&
      new Set(STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES).size ===
        STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length,
    "FINAL-11 evidence artifact contract is internally inconsistent",
  );
  for (const relativePath of [
    STAGE5_FINAL11_EVIDENCE_INDEX,
    STAGE5_FINAL11_CANDIDATE_VALIDATION,
    STAGE5_FINAL11_CANDIDATE_FREEZE,
    STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE,
    STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD,
  ]) {
    try {
      await lstat(path.join(repositoryRoot, relativePath));
      throw new Error(
        `FINAL-11 generation is already indexed, validated, frozen or consumed: ${relativePath}`,
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return {
    final10,
    final9Predecessor,
    previousBaseline,
    currentFiles,
    previousByPath,
    currentByPath,
    changedProtectedPaths,
    final10PackageSha256,
  };
};

export const buildStage5Final11SecurityExtensionBaseline = ({
  previousBaseline,
  currentFiles,
  final10Lineage,
  final10PackageSha256,
  predecessorVerification,
}) => {
  assert(
    previousBaseline.result === "PASS" &&
      previousBaseline.protectedFiles?.length ===
        STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.length &&
      previousBaseline.aggregateSha256 === expectedPreviousAggregateSha256,
    "FINAL-11 builder requires the exact passing Phase 1 predecessor manifest",
  );
  const previousRows = [...previousBaseline.protectedFiles];
  assert(
    JSON.stringify(previousRows.map((entry) => entry.path)) ===
      JSON.stringify([...STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS]) &&
      sha256(Buffer.from(serializeRows(previousRows), "utf8")) === previousBaseline.aggregateSha256,
    "FINAL-11 builder received predecessor rows with changed paths or aggregate bytes",
  );
  const currentRows = [...currentFiles]
    .map(({ path: relativePath, bytes }) => ({
      path: relativePath,
      bytes: bytes.length,
      sha256: sha256(bytes),
    }))
    .toSorted(compareProtectedPaths);
  assert(
    JSON.stringify(currentRows.map((entry) => entry.path)) ===
      JSON.stringify([...STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS]),
    "FINAL-11 builder received a changed protected path set",
  );
  const previousByPath = new Map(previousRows.map((entry) => [entry.path, entry]));
  const currentByPath = new Map(currentRows.map((entry) => [entry.path, entry]));
  const changedPaths = currentRows
    .filter((entry) => previousByPath.get(entry.path)?.sha256 !== entry.sha256)
    .map((entry) => entry.path)
    .toSorted();
  assert(
    JSON.stringify(changedPaths) === JSON.stringify(expectedPreviousProtectedDeltas),
    `FINAL-11 builder found an unapproved protected-byte delta: ${JSON.stringify(changedPaths)}`,
  );
  assert(
    final10Lineage.result === "PASS" &&
      final10Lineage.candidate === "FINAL-10" &&
      final10Lineage.status === "REJECTED" &&
      final10Lineage.failedGate === "stage5-security-extension:pre" &&
      final10Lineage.invocationCount === 1 &&
      final10Lineage.command === "corepack pnpm ci:verify" &&
      final10Lineage.result === "PASS" &&
      final10Lineage.exitCode === 1 &&
      final10Lineage.phase1Baseline.sha256 === STAGE5_FINAL10_PHASE1_BASELINE_SHA256 &&
      final10Lineage.localOnlyInvocationGuard?.sha256,
    "FINAL-11 builder requires exact verification of the consumed rejected FINAL-10 candidate",
  );
  assert(
    final10PackageSha256 !== STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
    "FINAL-10 cause no longer proves its protected package mismatch",
  );
  const next = JSON.parse(JSON.stringify(previousBaseline));
  const documentBytes = currentFiles.find(
    (entry) => entry.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  )?.bytes;
  assert(documentBytes, "FINAL-11 extension document is absent from protected inputs");
  next.lineage.extensionDocument = {
    path: STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
    sha256: sha256(documentBytes),
  };
  next.lineage.predecessorPhase1ExtensionBaseline = {
    path: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
    sha256: STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
    tag: STAGE5_FINAL9_REJECTED_TAG,
    target: STAGE5_FINAL9_REJECTED_TAG_TARGET,
    verificationResult: "PASS",
    protectedFileCount: previousRows.length,
    aggregateSha256: previousBaseline.aggregateSha256,
  };
  next.lineage.rejectedFinal10Candidate = {
    candidate: "FINAL-10",
    phase: "FINAL",
    status: "REJECTED",
    tag: STAGE5_FINAL10_REJECTED_TAG,
    target: STAGE5_FINAL10_REJECTED_TAG_TARGET,
    failedGate: "stage5-security-extension:pre",
    command: "corepack pnpm ci:verify",
    invocationCount: 1,
    result: "FAIL",
    exitCode: 1,
    ciLogSha256: final10Lineage.ciLog.sha256,
    ciExecutionSha256: final10Lineage.ciExecution.sha256,
    preCiEvidenceIndexSha256: final10Lineage.preCiIndex.sha256,
    correctionMatrixSha256: final10Lineage.correctionMatrix.sha256,
    rejectionRecordSha256: final10Lineage.rejectionRecord.sha256,
    previousPhase1BaselineSha256: final10Lineage.phase1Baseline.sha256,
    staleBaselinePackageSha256: STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
    packageSha256AtCi: final10PackageSha256,
    localInvocationGuardSha256: final10Lineage.localOnlyInvocationGuard.sha256,
    stage6Actions: 0,
  };
  next.lineage.final11Generation = {
    candidate: "FINAL-11",
    stage6Actions: 0,
    protectedPathDeltas: changedPaths.map((relativePath) => ({
      path: relativePath,
      previousSha256: previousByPath.get(relativePath).sha256,
      currentSha256: currentByPath.get(relativePath).sha256,
    })),
  };
  next.protectedFiles = currentRows;
  next.aggregateSha256 = sha256(Buffer.from(serializeRows(currentRows), "utf8"));
  assert(
    predecessorVerification.result === "PASS" &&
      predecessorVerification.baselineSha256 === STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
    "FINAL-11 builder requires a real PASS from the original tagged predecessor verifier",
  );
  return next;
};

const verifyCandidateEvidenceDirectoryState = async () => {
  const evidencePath = path.join(repositoryRoot, STAGE5_FINAL11_EVIDENCE_DIRECTORY);
  try {
    const metadata = await lstat(evidencePath);
    assert(
      metadata.isDirectory() && !metadata.isSymbolicLink(),
      "FINAL-11 evidence path is not a directory",
    );
    const entries = await readdir(evidencePath, { withFileTypes: true });
    const allowedNames = new Set(["baseline-generation.json"]);
    assert(
      entries.every(
        (entry) => entry.isFile() && !entry.isSymbolicLink() && allowedNames.has(entry.name),
      ),
      "FINAL-11 baseline regeneration refuses unrelated or indexed candidate evidence",
    );
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
};

const buildGenerationReport = ({ checks, baselineBytes, baseline, predecessorVerification }) => ({
  schemaVersion: 1,
  candidate: "FINAL-11",
  phase: "BASELINE_GENERATION",
  result: "PASS",
  stage6Actions: 0,
  predecessor: {
    tag: STAGE5_FINAL9_REJECTED_TAG,
    target: STAGE5_FINAL9_REJECTED_TAG_TARGET,
    baselinePath: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
    baselineSha256: predecessorVerification.baselineSha256,
    verifierResult: predecessorVerification.result,
    verifierOutputSha256: predecessorVerification.verificationOutputSha256,
    protectedFileCount: predecessorVerification.protectedFileCount,
    aggregateSha256: predecessorVerification.aggregateSha256,
    phase0Result: predecessorVerification.phase0Result,
  },
  rejectedFinal10: {
    tag: STAGE5_FINAL10_REJECTED_TAG,
    target: STAGE5_FINAL10_REJECTED_TAG_TARGET,
    result: "REJECTED",
    failedGate: checks.final10.failedGate,
    invocationCount: checks.final10.invocationCount,
    exitCode: checks.final10.exitCode,
    command: checks.final10.command,
    ciLogSha256: checks.final10.ciLog.sha256,
    ciExecutionSha256: checks.final10.ciExecution.sha256,
    staleBaselineSha256: checks.final10.phase1Baseline.sha256,
    localOnlyInvocationGuardSha256: checks.final10.localOnlyInvocationGuard.sha256,
    packageSha256AtCi: checks.final10.packageSha256AtCi,
  },
  protectedPathDeltas: baseline.lineage.final11Generation.protectedPathDeltas,
  protectedFileCount: baseline.protectedFiles.length,
  aggregateSha256: baseline.aggregateSha256,
  baselineManifest: {
    path: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
    bytes: baselineBytes.length,
    sha256: sha256(baselineBytes),
  },
  final11CiVerifyInvocation: "NOT_RUN",
});

const main = async () => {
  const checks = await verifyCandidatePreconditions();
  const predecessorVerification = await verifyHistoricalPhase1Baseline();
  const baselineBytesFromTag = readGitBlob(
    STAGE5_FINAL9_REJECTED_TAG,
    STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  );
  const previousBaseline = readJson(baselineBytesFromTag, "FINAL-9 predecessor baseline");
  const baseline = buildStage5Final11SecurityExtensionBaseline({
    previousBaseline,
    currentFiles: checks.currentFiles,
    final10Lineage: checks.final10,
    final10PackageSha256: checks.final10PackageSha256,
    predecessorVerification,
  });
  const serializedBaseline = `${JSON.stringify(baseline, null, 2)}\n`;
  const baselineBytes = Buffer.from(serializedBaseline, "utf8");
  const proposedBaselineSha256 = sha256(baselineBytes);
  const report = buildGenerationReport({
    checks,
    baselineBytes,
    baseline,
    predecessorVerification,
  });
  const mode = process.argv.includes("--write") ? "WRITE" : "PREVIEW";
  if (mode === "PREVIEW") {
    console.log(
      JSON.stringify(
        {
          ...report,
          mode,
          requiredVerifierPin: {
            path: "tooling/ci/verify-stage-5-security-extension-baseline.mjs",
            current: STAGE5_SECURITY_EXTENSION_BASELINE_SHA256,
            next: proposedBaselineSha256,
            updateRequired: STAGE5_SECURITY_EXTENSION_BASELINE_SHA256 !== proposedBaselineSha256,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  assert(
    STAGE5_SECURITY_EXTENSION_BASELINE_SHA256 === proposedBaselineSha256,
    `Pinned Phase 1 baseline SHA must be updated to ${proposedBaselineSha256} before generation`,
  );
  await verifyCandidateEvidenceDirectoryState();
  const currentBaselinePath = path.join(repositoryRoot, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
  let currentBaselineBytes;
  try {
    currentBaselineBytes = await readFile(currentBaselinePath);
  } catch (error) {
    throw new Error("Current Phase 1 baseline must be present before generation", { cause: error });
  }
  const currentBaselineSha256 = sha256(currentBaselineBytes);
  assert(
    currentBaselineSha256 === STAGE5_FINAL10_PHASE1_BASELINE_SHA256 ||
      currentBaselineSha256 === proposedBaselineSha256,
    "Refusing to overwrite an unrecognized Phase 1 baseline generation",
  );

  const evidenceDirectory = path.join(repositoryRoot, STAGE5_FINAL11_EVIDENCE_DIRECTORY);
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(currentBaselinePath, baselineBytes);
  const persistedBaseline = await readFile(currentBaselinePath);
  assert(
    persistedBaseline.equals(baselineBytes),
    "Generated Phase 1 baseline failed byte verification",
  );
  const verification = await verifyStage5SecurityExtensionBaseline({
    root: repositoryRoot,
    expectedBaselineSha256: proposedBaselineSha256,
  });
  assert(
    verification.result === "PASS",
    "Generated FINAL-11 Phase 1 security baseline did not verify",
  );
  const finalizedReport = {
    ...report,
    manifestVerification: {
      result: verification.result,
      baselineSha256: verification.phase1.baselineSha256,
      protectedFileCount: verification.phase1.protectedFileCount,
      aggregateSha256: verification.phase1.aggregateSha256,
    },
  };
  const finalizedReportBytes = Buffer.from(`${JSON.stringify(finalizedReport, null, 2)}\n`, "utf8");
  const reportPath = path.join(
    repositoryRoot,
    STAGE5_FINAL11_EVIDENCE_DIRECTORY,
    "baseline-generation.json",
  );
  await writeFile(reportPath, finalizedReportBytes);
  const persistedReport = await readFile(reportPath);
  assert(
    persistedReport.equals(finalizedReportBytes),
    "Baseline-generation receipt failed byte verification",
  );
  console.log(JSON.stringify(finalizedReport, null, 2));
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) await main();
