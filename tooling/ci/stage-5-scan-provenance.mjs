import { createHash } from "node:crypto";

import {
  STAGE5_FINAL11_CANDIDATE_FREEZE,
  STAGE5_FINAL11_CANDIDATE_VALIDATION,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT,
} from "./stage-5-source-scope.mjs";
import {
  STAGE5_FINAL8_EVIDENCE_INDEX,
  STAGE5_FINAL8_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL8_FREEZE,
  STAGE5_FINAL8_FREEZE_SHA256,
  STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256,
  STAGE5_FINAL8_REJECTED_TAG,
  STAGE5_FINAL8_REJECTED_TAG_TARGET,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL9_FREEZE_SHA256,
  STAGE5_FINAL9_REJECTED_TAG,
  STAGE5_FINAL9_REJECTED_TAG_TARGET,
  STAGE5_FINAL10_CI_EXECUTION_SHA256,
  STAGE5_FINAL10_CI_LOG_SHA256,
  STAGE5_FINAL10_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS,
  STAGE5_FINAL10_INVOCATION_GUARD_SHA256,
  STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
  STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL10_REJECTED_TAG,
  STAGE5_FINAL10_REJECTED_TAG_TARGET,
  STAGE5_FINAL10_REJECTION_RECORD_SHA256,
  STAGE5_FINAL11_EVIDENCE_DIRECTORY,
  STAGE5_FINAL11_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS,
  STAGE5_FINAL11_FINAL10_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL11_FINAL9_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
} from "./stage-5-candidate-contract.mjs";

export const STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SCAN_PHASES = new Set(["FINAL_EVIDENCE", "FINAL_CANDIDATE"]);
const sameArray = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const serializeFileManifest = (fileManifest) =>
  fileManifest.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join("");

export const createStage5FinalScanProvenance = ({
  phase,
  sourceScopeFiles,
  scanReport,
  findingLineage,
  evidenceIndexVerification,
}) => {
  if (!SCAN_PHASES.has(phase)) {
    throw new Error(`Invalid Stage 5 final scan phase: ${phase}`);
  }
  if (!Array.isArray(sourceScopeFiles) || !Array.isArray(scanReport?.filesScanned)) {
    throw new Error("Stage 5 final scan is missing source-scope or scanned-file paths");
  }
  if (!Array.isArray(scanReport.fileManifest) || scanReport.fileManifest.length === 0) {
    throw new Error("Stage 5 final scan is missing its byte-level file manifest");
  }
  if (scanReport.result !== "PASS" || (scanReport.findings ?? []).length !== 0) {
    throw new Error("Stage 5 final scan did not pass the sensitive-data rules");
  }
  if (
    findingLineage?.result !== "PASS" ||
    findingLineage?.totalFindingCount !== STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS.length ||
    findingLineage?.authorClosedCount !== 0 ||
    findingLineage?.independentPendingCount !== STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS.length ||
    findingLineage?.stage6Actions !== 0
  ) {
    throw new Error("Stage 5 final scan is missing complete fail-closed finding-lineage proof");
  }
  const predecessorProof = findingLineage.protectedFinal8;
  const predecessorFiles = new Map(
    Array.isArray(predecessorProof?.files)
      ? predecessorProof.files.map((entry) => [entry.path, entry])
      : [],
  );
  const protectedPredecessorPaths = [
    { path: STAGE5_FINAL8_FREEZE, sha256: STAGE5_FINAL8_FREEZE_SHA256 },
    { path: STAGE5_FINAL8_EVIDENCE_INDEX, sha256: STAGE5_FINAL8_EVIDENCE_INDEX_SHA256 },
  ];
  if (
    predecessorProof?.result !== "PASS" ||
    predecessorProof.tag !== STAGE5_FINAL8_REJECTED_TAG ||
    predecessorProof.target !== STAGE5_FINAL8_REJECTED_TAG_TARGET ||
    predecessorProof.files?.length !== protectedPredecessorPaths.length ||
    predecessorFiles.size !== protectedPredecessorPaths.length ||
    protectedPredecessorPaths.some((expected) => {
      const actual = predecessorFiles.get(expected.path);
      return (
        actual?.sha256 !== expected.sha256 ||
        actual.matchesRejectedTag !== true ||
        !Number.isSafeInteger(actual.bytes) ||
        actual.bytes <= 0
      );
    })
  ) {
    throw new Error("Stage 5 final scan lacks exact protected FINAL-8 tag-byte provenance");
  }
  const final9Proof = findingLineage.protectedFinal9;
  if (
    final9Proof?.result !== "PASS" ||
    final9Proof.tag !== STAGE5_FINAL9_REJECTED_TAG ||
    final9Proof.target !== STAGE5_FINAL9_REJECTED_TAG_TARGET ||
    final9Proof.freeze?.sha256 !== STAGE5_FINAL9_FREEZE_SHA256 ||
    final9Proof.evidenceIndex?.path !== STAGE5_FINAL9_EVIDENCE_INDEX ||
    final9Proof.evidenceIndex?.sha256 !== STAGE5_FINAL9_EVIDENCE_INDEX_SHA256
  ) {
    throw new Error("Stage 5 final scan lacks exact protected FINAL-9 tag-byte provenance");
  }
  const final10Proof = findingLineage.protectedFinal10;
  const expectedFinal10ArtifactPaths = [
    STAGE5_FINAL11_FINAL10_REJECTED_TAG_ARTIFACT,
    STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT,
    STAGE5_FINAL11_FINAL9_REJECTED_TAG_ARTIFACT,
    STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
    `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final10-ci-verify-execution.json`,
    `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final10-ci-verify.log`,
    `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final10-correction-matrix.json`,
    `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final10-pre-ci-evidence-index.json`,
    `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final10-rejection-record.md`,
    `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/final10-security-extension-baseline.json`,
  ].toSorted();
  const final10ArtifactManifest = Array.isArray(final10Proof?.predecessorArtifacts)
    ? final10Proof.predecessorArtifacts
    : [];
  const final10ArtifactPaths = final10ArtifactManifest.map((entry) => entry.path);
  const final10ArtifactRows = new Map(final10ArtifactManifest.map((entry) => [entry.path, entry]));
  if (
    final10Proof?.result !== "PASS" ||
    final10Proof.candidate !== "FINAL-10" ||
    final10Proof.status !== "REJECTED" ||
    final10Proof.tag !== STAGE5_FINAL10_REJECTED_TAG ||
    final10Proof.target !== STAGE5_FINAL10_REJECTED_TAG_TARGET ||
    final10Proof.stage6Actions !== 0 ||
    final10Proof.failedGate !== "stage5-security-extension:pre" ||
    final10Proof.invocationCount !== 1 ||
    final10Proof.command !== "corepack pnpm ci:verify" ||
    final10Proof.exitCode !== 1 ||
    final10Proof.ciLog?.sha256 !== STAGE5_FINAL10_CI_LOG_SHA256 ||
    final10Proof.ciExecution?.sha256 !== STAGE5_FINAL10_CI_EXECUTION_SHA256 ||
    final10Proof.preCiIndex?.sha256 !== STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX_SHA256 ||
    final10Proof.correctionMatrix?.sha256 !== STAGE5_FINAL10_CORRECTION_MATRIX_SHA256 ||
    final10Proof.rejectionRecord?.sha256 !== STAGE5_FINAL10_REJECTION_RECORD_SHA256 ||
    final10Proof.phase1Baseline?.sha256 !== STAGE5_FINAL10_PHASE1_BASELINE_SHA256 ||
    final10Proof.localOnlyInvocationGuard?.sha256 !== STAGE5_FINAL10_INVOCATION_GUARD_SHA256 ||
    !sameArray(final10Proof.findingIds ?? [], STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS) ||
    !sameArray(final10ArtifactPaths, expectedFinal10ArtifactPaths) ||
    final10ArtifactRows.size !== expectedFinal10ArtifactPaths.length ||
    final10ArtifactManifest.some(
      (entry) =>
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes <= 0 ||
        !SHA256_PATTERN.test(entry.sha256),
    )
  ) {
    throw new Error(
      "Stage 5 final scan lacks exact protected FINAL-10 rejection/tag-byte provenance",
    );
  }
  const expectedEvidenceArtifactPaths = STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(
    (name) => `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/${name}`,
  ).toSorted();
  const indexedEvidenceArtifacts = evidenceIndexVerification?.artifactBytesManifest ?? [];
  const recomputedEvidenceAggregateSha256 = createHash("sha256")
    .update(
      indexedEvidenceArtifacts
        .map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`)
        .join(""),
    )
    .digest("hex");
  if (
    evidenceIndexVerification?.result !== "PASS" ||
    evidenceIndexVerification.indexPath !== STAGE5_FINAL11_EVIDENCE_INDEX ||
    evidenceIndexVerification.aggregateSerialization !==
      STAGE5_FINAL11_EVIDENCE_AGGREGATE_SERIALIZATION ||
    !["PRE_CI", "FINAL", "CI_FAILED"].includes(evidenceIndexVerification.phase) ||
    (phase === "FINAL_CANDIDATE" && evidenceIndexVerification.phase !== "FINAL") ||
    evidenceIndexVerification.artifactCount !== expectedEvidenceArtifactPaths.length ||
    evidenceIndexVerification.matched !== expectedEvidenceArtifactPaths.length ||
    evidenceIndexVerification.missing?.length !== 0 ||
    evidenceIndexVerification.unexpected?.length !== 0 ||
    evidenceIndexVerification.invalidDirectoryEntries?.length !== 0 ||
    evidenceIndexVerification.sizeMismatches?.length !== 0 ||
    evidenceIndexVerification.hashMismatches?.length !== 0 ||
    evidenceIndexVerification.declaredAggregateSha256 !== recomputedEvidenceAggregateSha256 ||
    evidenceIndexVerification.recomputedAggregateSha256 !== recomputedEvidenceAggregateSha256 ||
    !Array.isArray(evidenceIndexVerification.artifactBytesManifest) ||
    indexedEvidenceArtifacts.length !== expectedEvidenceArtifactPaths.length ||
    indexedEvidenceArtifacts.some(
      (entry, index) => entry.path !== expectedEvidenceArtifactPaths[index],
    )
  ) {
    throw new Error("Stage 5 final scan lacks exact verified FINAL-11 evidence-index coverage");
  }
  const indexedEvidenceByPath = new Map(
    indexedEvidenceArtifacts.map((entry) => [entry.path, entry]),
  );
  for (const expectedPath of expectedFinal10ArtifactPaths) {
    const predecessorEntry = final10ArtifactRows.get(expectedPath);
    const indexedEntry = indexedEvidenceByPath.get(expectedPath);
    if (
      indexedEntry?.bytes !== predecessorEntry?.bytes ||
      indexedEntry?.sha256 !== predecessorEntry?.sha256
    ) {
      throw new Error(
        `FINAL-11 index does not bind exact FINAL-10 predecessor bytes: ${expectedPath}`,
      );
    }
  }

  const expectedFiles = [...sourceScopeFiles].sort((left, right) => left.localeCompare(right));
  const expectedUniqueFiles = [...new Set(expectedFiles)];
  if (expectedFiles.length !== expectedUniqueFiles.length) {
    throw new Error("Stage 5 source-scope collector returned duplicate file paths");
  }
  if (expectedUniqueFiles.includes(STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT)) {
    throw new Error(
      "Stage 5 post-freeze scan report must remain excluded from its own input scope",
    );
  }
  if (
    scanReport.filesScanned.length !== expectedFiles.length ||
    scanReport.filesScanned.some((filePath, index) => filePath !== expectedFiles[index]) ||
    scanReport.fileManifest.length !== expectedFiles.length ||
    scanReport.fileManifest.some((entry, index) => entry.path !== expectedFiles[index])
  ) {
    throw new Error("Stage 5 final scan inputs do not match the fail-closed source scope");
  }

  for (const entry of scanReport.fileManifest) {
    if (
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.path !== "string" ||
      !SHA256_PATTERN.test(entry.sha256)
    ) {
      throw new Error(`Stage 5 final scan contains an invalid file-manifest row: ${entry.path}`);
    }
  }
  if (scanReport.scopeSerialization !== STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION) {
    throw new Error("Stage 5 final scan uses an unsupported scope serialization");
  }

  const scopeAggregateSha256 = createHash("sha256")
    .update(serializeFileManifest(scanReport.fileManifest))
    .digest("hex");
  if (scanReport.scopeAggregateSha256 !== scopeAggregateSha256) {
    throw new Error("Stage 5 final scan aggregate does not match its byte-level file manifest");
  }

  const requiredPaths = [STAGE5_FINAL11_EVIDENCE_INDEX, STAGE5_FINAL11_CORRECTION_MATRIX];
  requiredPaths.push(STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT, STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT);
  if (phase === "FINAL_CANDIDATE") {
    requiredPaths.push(STAGE5_FINAL11_CANDIDATE_VALIDATION, STAGE5_FINAL11_CANDIDATE_FREEZE);
  }
  const missingRequiredPaths = requiredPaths.filter(
    (filePath) => !expectedUniqueFiles.includes(filePath),
  );
  if (missingRequiredPaths.length > 0) {
    throw new Error(
      `Stage 5 ${phase} scan is missing required inputs: ${missingRequiredPaths.join(", ")}`,
    );
  }

  const manifestByPath = new Map(scanReport.fileManifest.map((entry) => [entry.path, entry]));
  const scannedEvidenceIndex = manifestByPath.get(STAGE5_FINAL11_EVIDENCE_INDEX);
  if (
    scannedEvidenceIndex?.bytes !== evidenceIndexVerification.indexBytes ||
    scannedEvidenceIndex?.sha256 !== evidenceIndexVerification.indexSha256
  ) {
    throw new Error("Stage 5 scan did not bind the verified FINAL-11 evidence-index bytes");
  }
  for (const indexedArtifact of indexedEvidenceArtifacts) {
    const scannedArtifact = manifestByPath.get(indexedArtifact.path);
    if (
      scannedArtifact?.bytes !== indexedArtifact.bytes ||
      scannedArtifact?.sha256 !== indexedArtifact.sha256
    ) {
      throw new Error(
        `Stage 5 scan bytes do not match FINAL-11 evidence index: ${indexedArtifact.path}`,
      );
    }
  }
  const final8ReviewArtifact = manifestByPath.get(STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT);
  const final9ReviewArtifact = manifestByPath.get(STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT);
  const matrixArtifact = manifestByPath.get(STAGE5_FINAL11_CORRECTION_MATRIX);
  if (
    final8ReviewArtifact?.sha256 !== STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 ||
    !Number.isSafeInteger(final8ReviewArtifact?.bytes) ||
    final8ReviewArtifact.bytes <= 0 ||
    final9ReviewArtifact?.bytes !== findingLineage.sourceReview.bytes ||
    final9ReviewArtifact?.sha256 !== findingLineage.sourceReview.sha256 ||
    matrixArtifact?.bytes !== findingLineage.correctionMatrix.bytes ||
    matrixArtifact?.sha256 !== findingLineage.correctionMatrix.sha256
  ) {
    throw new Error(
      "Stage 5 scan byte manifest does not bind the exact review and correction-matrix bytes",
    );
  }

  return {
    schemaVersion: 1,
    phase,
    scanner: "tooling/ci/scan-source-secrets.mjs",
    filesScanned: scanReport.filesScanned.length,
    scopeSerialization: STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION,
    scopeAggregateSha256,
    scopeFileManifest: scanReport.fileManifest,
    inputsMatchFailClosedCollector: true,
    evidenceIndexVerified: true,
    evidenceIndexPhase: evidenceIndexVerification.phase,
    evidenceIndexSha256: evidenceIndexVerification.indexSha256,
    indexedEvidenceArtifactCount: indexedEvidenceArtifacts.length,
    protectedFinal8TagBytesVerified: true,
    protectedFinal9TagBytesVerified: true,
    protectedFinal10RejectedTagBytesVerified: true,
    protectedFinal10InvocationCount: final10Proof.invocationCount,
    protectedFinal10FailedGate: final10Proof.failedGate,
    protectedFinal10EvidenceCopies: final10ArtifactManifest,
    postFreezeScanReportPath: STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT,
    postFreezeScanReportExcludedFromScope: true,
    selfReferencePrevention: "post-freeze report is written only after the final scan completes",
    evidenceIndexIncluded: expectedUniqueFiles.includes(STAGE5_FINAL11_EVIDENCE_INDEX),
    final8HistoricalReviewIncluded: expectedUniqueFiles.includes(
      STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT,
    ),
    final9IndependentReviewIncluded: expectedUniqueFiles.includes(
      STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
    ),
    correctionMatrixIncluded: expectedUniqueFiles.includes(STAGE5_FINAL11_CORRECTION_MATRIX),
    validationIncluded: expectedUniqueFiles.includes(STAGE5_FINAL11_CANDIDATE_VALIDATION),
    freezeIncluded: expectedUniqueFiles.includes(STAGE5_FINAL11_CANDIDATE_FREEZE),
    historicalFindingLineage: findingLineage,
    matchedValuesEmitted: false,
  };
};
