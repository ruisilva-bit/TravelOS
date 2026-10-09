import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STAGE5_FINAL9_INDEPENDENT_REVIEW,
  STAGE5_FINAL10_CI_EXECUTION,
  STAGE5_FINAL10_CI_EXECUTION_SHA256,
  STAGE5_FINAL10_CI_LOG,
  STAGE5_FINAL10_CI_LOG_SHA256,
  STAGE5_FINAL10_CORRECTION_MATRIX_PATH,
  STAGE5_FINAL10_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS,
  STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT,
  STAGE5_FINAL10_INVOCATION_GUARD_PATH,
  STAGE5_FINAL10_INVOCATION_GUARD_SHA256,
  STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
  STAGE5_FINAL10_PHASE1_BASELINE_PATH,
  STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
  STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX,
  STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL10_REJECTED_TAG,
  STAGE5_FINAL10_REJECTED_TAG_TARGET,
  STAGE5_FINAL10_REJECTION_RECORD,
  STAGE5_FINAL10_REJECTION_RECORD_SHA256,
  STAGE5_FINAL11_CANDIDATE_FREEZE,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS,
  STAGE5_FINAL11_FINAL10_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL11_FINAL9_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
} from "./stage-5-candidate-contract.mjs";
import {
  verifyStage5Final8TaggedBytes,
  verifyStage5Final9RejectedTaggedBytes,
} from "./stage-5-finding-lineage.mjs";

const FINAL10_PRESERVED_FILES = Object.freeze([
  { path: STAGE5_FINAL10_REJECTION_RECORD, sha256: STAGE5_FINAL10_REJECTION_RECORD_SHA256 },
  { path: STAGE5_FINAL10_CORRECTION_MATRIX_PATH, sha256: STAGE5_FINAL10_CORRECTION_MATRIX_SHA256 },
  {
    path: STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX,
    sha256: STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX_SHA256,
  },
  { path: STAGE5_FINAL10_CI_LOG, sha256: STAGE5_FINAL10_CI_LOG_SHA256 },
  { path: STAGE5_FINAL10_CI_EXECUTION, sha256: STAGE5_FINAL10_CI_EXECUTION_SHA256 },
  { path: STAGE5_FINAL10_PHASE1_BASELINE_PATH, sha256: STAGE5_FINAL10_PHASE1_BASELINE_SHA256 },
]);
const FINAL10_CURRENT_BYTES_TO_PRESERVE = new Set(
  FINAL10_PRESERVED_FILES.filter((file) => file.path !== STAGE5_FINAL10_PHASE1_BASELINE_PATH).map(
    (file) => file.path,
  ),
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const parseJson = (bytes, description) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${description} is not valid JSON`);
  }
};
const readGitBlob = (root, revision, relativePath) =>
  execFileSync("git", ["show", `${revision}:${relativePath}`], { cwd: root });
const readGitTagTarget = (root, tag) =>
  execFileSync("git", ["rev-parse", `${tag}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const assertRegularFile = async (root, relativePath, description) => {
  const absolutePath = path.join(root, relativePath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`${description} must be a unique regular file: ${relativePath}`);
  }
  return readFile(absolutePath);
};

const verifyAnnotatedRejectedTag = (root) => {
  const tagRef = `refs/tags/${STAGE5_FINAL10_REJECTED_TAG}`;
  const tagType = execFileSync("git", ["cat-file", "-t", tagRef], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const tagObjectText = execFileSync("git", ["cat-file", "-p", tagRef], {
    cwd: root,
    encoding: "utf8",
  });
  const tagObject = execFileSync("git", ["rev-parse", tagRef], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const target = readGitTagTarget(root, STAGE5_FINAL10_REJECTED_TAG);
  if (
    tagType !== "tag" ||
    target !== STAGE5_FINAL10_REJECTED_TAG_TARGET ||
    !tagObjectText.includes("FINAL-10 rejected") ||
    !tagObjectText.includes("stage5-security-extension:pre")
  ) {
    throw new Error("FINAL-10 rejected annotated tag or exact target is invalid");
  }
  return { tagObject, target };
};

const verifyPredecessorBaseline = (root, baselineBytes) => {
  if (sha256(baselineBytes) !== STAGE5_FINAL10_PHASE1_BASELINE_SHA256) {
    throw new Error("FINAL-10 tagged Phase 1 baseline bytes changed");
  }
  const baseline = parseJson(baselineBytes, "FINAL-10 tagged Phase 1 security-extension baseline");
  const packageEntry = baseline.protectedFiles?.find((entry) => entry.path === "package.json");
  if (
    baseline.result !== "PASS" ||
    baseline.stage6Actions !== 0 ||
    baseline.lineage?.phase0AcceptedBaseline?.path !==
      "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md" ||
    baseline.lineage.phase0AcceptedBaseline.sha256 !==
      "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb" ||
    baseline.lineage.phase0AcceptedBaseline.sourceCommit !==
      "32b7d2f0a8b628c5c368d22983c5d631aad520fb" ||
    baseline.lineage.phase0AcceptedBaseline.entryCount !== 40 ||
    packageEntry?.sha256 !== STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256
  ) {
    throw new Error("FINAL-10 tagged Phase 1 baseline does not bind its accepted Phase 0 ancestry");
  }
  execFileSync(
    "git",
    [
      "merge-base",
      "--is-ancestor",
      baseline.lineage.phase0AcceptedBaseline.sourceCommit,
      STAGE5_FINAL10_REJECTED_TAG_TARGET,
    ],
    { cwd: root },
  );
  return baseline;
};

export const verifyStage5Final10RejectedTaggedBytes = async ({ root = process.cwd() } = {}) => {
  const tagProof = verifyAnnotatedRejectedTag(root);
  const taggedFiles = new Map();
  for (const entry of FINAL10_PRESERVED_FILES) {
    const bytes = readGitBlob(root, STAGE5_FINAL10_REJECTED_TAG, entry.path);
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`FINAL-10 rejected tag does not reproduce protected bytes: ${entry.path}`);
    }
    taggedFiles.set(entry.path, bytes);
  }
  for (const relativePath of FINAL10_CURRENT_BYTES_TO_PRESERVE) {
    const currentBytes = await assertRegularFile(
      root,
      relativePath,
      "FINAL-10 historical artifact",
    );
    if (!currentBytes.equals(taggedFiles.get(relativePath))) {
      throw new Error(
        `FINAL-10 historical artifact differs from its rejected tag: ${relativePath}`,
      );
    }
  }

  const logBytes = taggedFiles.get(STAGE5_FINAL10_CI_LOG);
  const execution = parseJson(
    taggedFiles.get(STAGE5_FINAL10_CI_EXECUTION),
    "FINAL-10 authoritative CI execution receipt",
  );
  const index = parseJson(
    taggedFiles.get(STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX),
    "FINAL-10 pre-CI evidence index",
  );
  const matrix = parseJson(
    taggedFiles.get(STAGE5_FINAL10_CORRECTION_MATRIX_PATH),
    "FINAL-10 carried finding matrix",
  );
  const rejectionRecord = taggedFiles.get(STAGE5_FINAL10_REJECTION_RECORD);
  const baselineBytes = taggedFiles.get(STAGE5_FINAL10_PHASE1_BASELINE_PATH);
  const baseline = verifyPredecessorBaseline(root, baselineBytes);
  const packageBytesAtCi = readGitBlob(root, STAGE5_FINAL10_REJECTED_TAG, "package.json");
  const packageSha256AtCi = sha256(packageBytesAtCi);
  const packageProtectedEntry = baseline.protectedFiles.find(
    (entry) => entry.path === "package.json",
  );
  if (
    execution.schemaVersion !== 1 ||
    execution.candidate !== "FINAL-10" ||
    execution.phase !== "FINAL" ||
    execution.invocationCount !== 1 ||
    execution.result !== "FAIL" ||
    execution.exitCode !== 1 ||
    execution.command !== "corepack pnpm ci:verify" ||
    execution.logSha256 !== STAGE5_FINAL10_CI_LOG_SHA256 ||
    execution.logBytes !== logBytes.length ||
    packageProtectedEntry?.sha256 !== STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256 ||
    packageSha256AtCi === packageProtectedEntry.sha256 ||
    !logBytes.toString("utf8").includes("stage5-security-extension:pre") ||
    !logBytes.toString("utf8").includes("package.json")
  ) {
    throw new Error("FINAL-10 failure receipt does not prove its exact one-run pre-gate failure");
  }
  if (
    index.schemaVersion !== 1 ||
    index.result !== "PASS" ||
    index.candidate !== "FINAL-10" ||
    index.phase !== "PRE_CI" ||
    index.artifactCount !== 18 ||
    index.aggregateSha256 !== "2b3db58c4e595cdd52a8beb503483f1241f7fa9614adaf9017cb1fd5588c5e2b"
  ) {
    throw new Error(
      "FINAL-10 pre-CI index is not preserved as its original, explicitly pre-CI record",
    );
  }
  if (
    matrix.schemaVersion !== 1 ||
    matrix.result !== "PASS" ||
    matrix.candidate !== "FINAL-10" ||
    matrix.stage6Actions !== 0 ||
    matrix.summary?.totalFindingCount !== STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS.length ||
    matrix.summary.authorClosedCount !== 0 ||
    matrix.summary.independentPendingCount !== STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS.length ||
    !Array.isArray(matrix.findings) ||
    !sameJson(
      matrix.findings.map((finding) => finding?.id),
      STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS,
    )
  ) {
    throw new Error("FINAL-10 rejected candidate does not retain every finding as pending");
  }

  const guardBytes = await assertRegularFile(
    root,
    STAGE5_FINAL10_INVOCATION_GUARD_PATH,
    "FINAL-10 local-only invocation guard",
  );
  if (sha256(guardBytes) !== STAGE5_FINAL10_INVOCATION_GUARD_SHA256) {
    throw new Error("FINAL-10 local-only invocation guard bytes changed");
  }
  const guard = parseJson(guardBytes, "FINAL-10 local-only invocation guard");
  if (
    guard.candidate !== "FINAL-10" ||
    guard.phase !== "FINAL" ||
    guard.invocationCount !== 1 ||
    guard.result !== "FAIL" ||
    guard.exitCode !== 1 ||
    guard.command !== "corepack pnpm ci:verify"
  ) {
    throw new Error("FINAL-10 local-only guard does not agree with the immutable failure receipt");
  }

  return {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-10",
    status: "REJECTED",
    tag: STAGE5_FINAL10_REJECTED_TAG,
    tagObject: tagProof.tagObject,
    target: tagProof.target,
    stage6Actions: 0,
    failedGate: "stage5-security-extension:pre",
    invocationCount: execution.invocationCount,
    command: execution.command,
    exitCode: execution.exitCode,
    startedAtUtc: execution.startedAtUtc,
    finishedAtUtc: execution.finishedAtUtc,
    toolchain: {
      node: execution.nodeVersion,
      corepack: execution.corepackVersion,
      pnpm: execution.pnpmVersion,
    },
    packageSha256AtCi,
    staleBaselinePackageSha256: packageProtectedEntry.sha256,
    ciLog: { path: STAGE5_FINAL10_CI_LOG, bytes: logBytes.length, sha256: sha256(logBytes) },
    ciExecution: {
      path: STAGE5_FINAL10_CI_EXECUTION,
      bytes: taggedFiles.get(STAGE5_FINAL10_CI_EXECUTION).length,
      sha256: sha256(taggedFiles.get(STAGE5_FINAL10_CI_EXECUTION)),
    },
    preCiIndex: {
      path: STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX,
      bytes: taggedFiles.get(STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX).length,
      sha256: sha256(taggedFiles.get(STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX)),
      phase: "PRE_CI",
      caveat:
        "The pre-CI index is preserved as a historical snapshot; the runner replaced its two placeholder receipt paths with the actual failure receipts.",
    },
    correctionMatrix: {
      path: STAGE5_FINAL10_CORRECTION_MATRIX_PATH,
      bytes: taggedFiles.get(STAGE5_FINAL10_CORRECTION_MATRIX_PATH).length,
      sha256: sha256(taggedFiles.get(STAGE5_FINAL10_CORRECTION_MATRIX_PATH)),
      findingCount: matrix.findings.length,
    },
    rejectionRecord: {
      path: STAGE5_FINAL10_REJECTION_RECORD,
      bytes: rejectionRecord.length,
      sha256: sha256(rejectionRecord),
    },
    phase1Baseline: {
      path: STAGE5_FINAL10_PHASE1_BASELINE_PATH,
      bytes: baselineBytes.length,
      sha256: sha256(baselineBytes),
      packageSha256: packageProtectedEntry.sha256,
      preservedInTag: true,
    },
    localOnlyInvocationGuard: {
      path: STAGE5_FINAL10_INVOCATION_GUARD_PATH,
      bytes: guardBytes.length,
      sha256: sha256(guardBytes),
      invocationCount: guard.invocationCount,
      result: guard.result,
      committed: false,
    },
    findingIds: matrix.findings.map((finding) => finding.id),
    preservedTaggedPaths: [...FINAL10_CURRENT_BYTES_TO_PRESERVE].toSorted(),
  };
};

export const buildStage5Final11CorrectionMatrix = ({ final10Lineage }) => {
  const final10Matrix = final10Lineage?.matrix;
  if (
    final10Lineage?.result !== "PASS" ||
    final10Lineage?.candidate !== "FINAL-10" ||
    final10Lineage?.status !== "REJECTED" ||
    final10Lineage?.tag !== STAGE5_FINAL10_REJECTED_TAG ||
    final10Lineage?.target !== STAGE5_FINAL10_REJECTED_TAG_TARGET ||
    final10Lineage.stage6Actions !== 0 ||
    final10Lineage.failedGate !== "stage5-security-extension:pre" ||
    final10Lineage.invocationCount !== 1 ||
    final10Lineage.command !== "corepack pnpm ci:verify" ||
    final10Lineage.exitCode !== 1 ||
    final10Lineage.ciLog?.sha256 !== STAGE5_FINAL10_CI_LOG_SHA256 ||
    final10Lineage.ciExecution?.sha256 !== STAGE5_FINAL10_CI_EXECUTION_SHA256 ||
    final10Lineage.phase1Baseline?.sha256 !== STAGE5_FINAL10_PHASE1_BASELINE_SHA256 ||
    final10Matrix?.schemaVersion !== 1 ||
    final10Matrix?.result !== "PASS" ||
    final10Matrix?.candidate !== "FINAL-10" ||
    final10Matrix?.stage6Actions !== 0 ||
    final10Matrix?.summary?.totalFindingCount !== STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS.length ||
    final10Matrix?.summary?.authorClosedCount !== 0 ||
    final10Matrix?.summary?.independentPendingCount !==
      STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS.length
  ) {
    throw new Error("FINAL-11 cannot carry an unverified or author-closed FINAL-10 matrix");
  }
  const findings = final10Matrix.findings.map((finding) => ({
    id: finding.id,
    sourceType: "REJECTED_FINAL_10_CARRY_FORWARD",
    predecessorSourceType: finding.sourceType,
    predecessorDisposition: finding.final10Disposition,
    predecessorIndependentStatus: finding.final10IndependentStatus,
    final11Disposition: "PENDING_REMEDIATION_REQUALIFICATION",
    final11IndependentStatus: "PENDING_FINAL11_REVIEW",
    sourceRecord: finding.sourceRecord,
  }));
  if (
    final10Matrix.findings.some(
      (finding) =>
        finding?.final10Disposition !== "PENDING_REMEDIATION_REQUALIFICATION" ||
        finding?.final10IndependentStatus !== "PENDING_FINAL10_REVIEW" ||
        finding?.sourceRecord?.id !== finding?.id,
    )
  ) {
    throw new Error("FINAL-11 may not inherit author-closed or malformed FINAL-10 finding rows");
  }
  if (
    !sameJson(
      findings.map((finding) => finding.id),
      STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS,
    )
  ) {
    throw new Error("FINAL-11 must carry the exact ordered FINAL-10 finding IDs");
  }
  return {
    schemaVersion: 1,
    result: "PASS",
    stage: "PHASE_1_M1_STAGE_5",
    candidate: "FINAL-11",
    predecessor: {
      rejectedFinal10Tag: final10Lineage.tag,
      tagObject: final10Lineage.tagObject,
      target: final10Lineage.target,
      status: "REJECTED_PRESERVED",
      ciFailure: {
        failedGate: final10Lineage.failedGate,
        invocationCount: final10Lineage.invocationCount,
        command: final10Lineage.command,
        exitCode: final10Lineage.exitCode,
        startedAtUtc: final10Lineage.startedAtUtc,
        finishedAtUtc: final10Lineage.finishedAtUtc,
        packageSha256AtCi: final10Lineage.packageSha256AtCi,
        staleBaselinePackageSha256: final10Lineage.staleBaselinePackageSha256,
        ciLog: final10Lineage.ciLog,
        ciExecution: final10Lineage.ciExecution,
      },
      preCiIndex: final10Lineage.preCiIndex,
      correctionMatrix: final10Lineage.correctionMatrix,
      rejectionRecord: final10Lineage.rejectionRecord,
      previousPhase1Baseline: final10Lineage.phase1Baseline,
      localOnlyInvocationGuard: final10Lineage.localOnlyInvocationGuard,
    },
    stage6Actions: 0,
    statusPolicy: {
      authorMayCloseFindings: false,
      final11IndependentReviewRequired: true,
      authorDisposition: "PENDING_REMEDIATION_REQUALIFICATION",
      independentDisposition: "PENDING_FINAL11_REVIEW",
      priorGenerationFailureAdjudication: "PENDING_FINAL11_REVIEW",
    },
    priorGenerationFailures: [
      {
        candidate: "FINAL-10",
        category: "CANDIDATE_GENERATION_BASELINE_MISMATCH",
        status: "REMEDIATION_EVIDENCE_PENDING_INDEPENDENT_REVIEW",
        failedGate: final10Lineage.failedGate,
        consequence:
          "The one authorized full CI invocation failed before tests and cannot be repeated.",
        plannedSuccessorControl:
          "Finalize and pin every FINAL-11 package/tooling byte before generating the successor baseline; verify the exact path/hash delta and child runner binding before the single CI authorization is consumed.",
        sourceRecord: final10Lineage.rejectionRecord,
        independentAdjudication: "PENDING_FINAL11_REVIEW",
      },
    ],
    summary: {
      carriedFinal10FindingCount: findings.length,
      totalFindingCount: findings.length,
      authorClosedCount: 0,
      independentPendingCount: findings.length,
      priorGenerationFailureCount: 1,
      priorGenerationFailurePendingReviewCount: 1,
    },
    findings,
  };
};

export const buildStage5Final10RejectedTagArtifact = (final10Lineage) => ({
  schemaVersion: 1,
  result: "PASS",
  status: "REJECTED_PRESERVED",
  candidate: "FINAL-10",
  tag: final10Lineage.tag,
  tagObject: final10Lineage.tagObject,
  target: final10Lineage.target,
  stage6Actions: 0,
  authoritativeCi: {
    phase: "FINAL",
    invocationCount: final10Lineage.invocationCount,
    command: final10Lineage.command,
    result: "FAIL",
    exitCode: final10Lineage.exitCode,
    failedGate: final10Lineage.failedGate,
    startedAtUtc: final10Lineage.startedAtUtc,
    finishedAtUtc: final10Lineage.finishedAtUtc,
    toolchain: final10Lineage.toolchain,
  },
  failureProvenance: {
    packageSha256AtCi: final10Lineage.packageSha256AtCi,
    staleBaselinePackageSha256: final10Lineage.staleBaselinePackageSha256,
    ciLog: final10Lineage.ciLog,
    ciExecution: final10Lineage.ciExecution,
  },
  predecessorBaseline: final10Lineage.phase1Baseline,
  localOnlyInvocationGuard: final10Lineage.localOnlyInvocationGuard,
});

export const verifyStage5Final11FindingLineageData = async ({ root = process.cwd() } = {}) => {
  const protectedFinal8 = await verifyStage5Final8TaggedBytes({ root });
  const protectedFinal9 = await verifyStage5Final9RejectedTaggedBytes({ root });
  const final10Lineage = await verifyStage5Final10RejectedTaggedBytes({ root });
  final10Lineage.matrix = parseJson(
    readGitBlob(root, STAGE5_FINAL10_REJECTED_TAG, STAGE5_FINAL10_CORRECTION_MATRIX_PATH),
    "FINAL-10 tagged correction matrix",
  );
  const expectedMatrix = buildStage5Final11CorrectionMatrix({ final10Lineage });
  const matrixBytes = await assertRegularFile(
    root,
    STAGE5_FINAL11_CORRECTION_MATRIX,
    "FINAL-11 correction matrix",
  );
  const actualMatrix = parseJson(matrixBytes, "FINAL-11 correction matrix");
  if (!sameJson(actualMatrix, expectedMatrix)) {
    throw new Error("FINAL-11 correction matrix changes, closes, or omits predecessor findings");
  }

  const indexBytes = await assertRegularFile(
    root,
    STAGE5_FINAL11_EVIDENCE_INDEX,
    "FINAL-11 evidence index",
  );
  const evidenceIndex = parseJson(indexBytes, "FINAL-11 evidence index");
  const indexedPaths = new Set(
    Array.isArray(evidenceIndex.artifacts)
      ? evidenceIndex.artifacts.map((artifact) => artifact?.path)
      : [],
  );
  const requiredArtifacts = [
    STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT,
    STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
    STAGE5_FINAL11_FINAL9_REJECTED_TAG_ARTIFACT,
    STAGE5_FINAL11_FINAL10_REJECTED_TAG_ARTIFACT,
    `${path.dirname(STAGE5_FINAL11_EVIDENCE_INDEX)}/final10-ci-verify.log`,
    `${path.dirname(STAGE5_FINAL11_EVIDENCE_INDEX)}/final10-ci-verify-execution.json`,
    `${path.dirname(STAGE5_FINAL11_EVIDENCE_INDEX)}/final10-pre-ci-evidence-index.json`,
    `${path.dirname(STAGE5_FINAL11_EVIDENCE_INDEX)}/final10-correction-matrix.json`,
    `${path.dirname(STAGE5_FINAL11_EVIDENCE_INDEX)}/final10-rejection-record.md`,
    `${path.dirname(STAGE5_FINAL11_EVIDENCE_INDEX)}/final10-security-extension-baseline.json`,
  ];
  if (requiredArtifacts.some((artifactPath) => !indexedPaths.has(artifactPath))) {
    throw new Error("FINAL-11 evidence index omits a required rejected-predecessor artifact");
  }

  const final10TaggedArtifactBytes = new Map(
    [
      ["final10-ci-verify.log", STAGE5_FINAL10_CI_LOG],
      ["final10-ci-verify-execution.json", STAGE5_FINAL10_CI_EXECUTION],
      ["final10-pre-ci-evidence-index.json", STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX],
      ["final10-correction-matrix.json", STAGE5_FINAL10_CORRECTION_MATRIX_PATH],
      ["final10-rejection-record.md", STAGE5_FINAL10_REJECTION_RECORD],
      ["final10-security-extension-baseline.json", STAGE5_FINAL10_PHASE1_BASELINE_PATH],
      ["final8-independent-review.json", STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT],
      ["final9-independent-review.md", STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT],
      ["final9-rejected-tag.json", STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT],
    ].map(([name, taggedPath]) => [
      `${path.dirname(STAGE5_FINAL11_EVIDENCE_INDEX)}/${name}`,
      readGitBlob(root, STAGE5_FINAL10_REJECTED_TAG, taggedPath),
    ]),
  );
  final10TaggedArtifactBytes.set(
    STAGE5_FINAL11_FINAL10_REJECTED_TAG_ARTIFACT,
    Buffer.from(
      `${JSON.stringify(buildStage5Final10RejectedTagArtifact(final10Lineage), null, 2)}\n`,
    ),
  );
  for (const [relativePath, expectedBytes] of final10TaggedArtifactBytes) {
    const actualBytes = await assertRegularFile(
      root,
      relativePath,
      "FINAL-11 predecessor artifact",
    );
    if (!actualBytes.equals(expectedBytes)) {
      throw new Error(`FINAL-11 does not preserve exact FINAL-10 lineage bytes: ${relativePath}`);
    }
  }
  const predecessorArtifacts = [...final10TaggedArtifactBytes.entries()]
    .map(([artifactPath, bytes]) => ({
      path: artifactPath,
      bytes: bytes.length,
      sha256: sha256(bytes),
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const final9SourceBytes = await assertRegularFile(
    root,
    STAGE5_FINAL9_INDEPENDENT_REVIEW,
    "FINAL-9 independent review source",
  );
  const final9ArtifactBytes = await assertRegularFile(
    root,
    STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
    "FINAL-11 FINAL-9 independent review copy",
  );
  if (!final9ArtifactBytes.equals(final9SourceBytes)) {
    throw new Error("FINAL-11 evidence does not preserve the independent FINAL-9 review bytes");
  }
  const protectedFinal10 = { ...final10Lineage };
  delete protectedFinal10.matrix;

  return {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-11",
    totalFindingCount: expectedMatrix.summary.totalFindingCount,
    authorClosedCount: expectedMatrix.summary.authorClosedCount,
    independentPendingCount: expectedMatrix.summary.independentPendingCount,
    priorGenerationFailureCount: expectedMatrix.summary.priorGenerationFailureCount,
    priorGenerationFailurePendingReviewCount:
      expectedMatrix.summary.priorGenerationFailurePendingReviewCount,
    stage6Actions: 0,
    correctionMatrix: {
      path: STAGE5_FINAL11_CORRECTION_MATRIX,
      bytes: matrixBytes.length,
      sha256: sha256(matrixBytes),
    },
    sourceReview: {
      path: STAGE5_FINAL9_INDEPENDENT_REVIEW,
      bytes: final9ArtifactBytes.length,
      sha256: sha256(final9ArtifactBytes),
    },
    protectedFinal8,
    protectedFinal9,
    protectedFinal10: {
      ...protectedFinal10,
      findingIds: final10Lineage.findingIds,
      predecessorArtifacts,
    },
  };
};

export const verifyStage5Final11FindingLineage = async ({ root = process.cwd() } = {}) =>
  verifyStage5Final11FindingLineageData({ root });

export const writeStage5Final11CorrectionMatrix = async ({ root = process.cwd() } = {}) => {
  const freezePath = path.join(root, STAGE5_FINAL11_CANDIDATE_FREEZE);
  try {
    await lstat(freezePath);
    throw new Error("FINAL-11 freeze exists; do not rewrite its correction matrix");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await verifyStage5Final8TaggedBytes({ root });
  await verifyStage5Final9RejectedTaggedBytes({ root });
  const final10Lineage = await verifyStage5Final10RejectedTaggedBytes({ root });
  final10Lineage.matrix = parseJson(
    readGitBlob(root, STAGE5_FINAL10_REJECTED_TAG, STAGE5_FINAL10_CORRECTION_MATRIX_PATH),
    "FINAL-10 tagged correction matrix",
  );
  const matrix = buildStage5Final11CorrectionMatrix({ final10Lineage });
  const matrixPath = path.join(root, STAGE5_FINAL11_CORRECTION_MATRIX);
  const expectedBytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`, "utf8");
  try {
    const existingBytes = await readFile(matrixPath);
    if (!existingBytes.equals(expectedBytes)) {
      throw new Error("FINAL-11 correction matrix already exists with non-reproducible bytes");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(matrixPath, expectedBytes, { flag: "wx" });
  }
  return {
    result: "PASS",
    candidate: "FINAL-11",
    matrixPath: STAGE5_FINAL11_CORRECTION_MATRIX,
    totalFindingCount: matrix.summary.totalFindingCount,
    authorClosedCount: 0,
    independentPendingCount: matrix.summary.independentPendingCount,
    pendingPriorGenerationFailures: matrix.summary.priorGenerationFailurePendingReviewCount,
    stage6Actions: 0,
  };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const report = process.argv.includes("--write")
    ? await writeStage5Final11CorrectionMatrix()
    : await verifyStage5Final11FindingLineage();
  console.log(JSON.stringify(report, null, 2));
}
