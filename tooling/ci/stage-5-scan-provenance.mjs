import { createHash } from "node:crypto";

import {
  STAGE5_FINAL10_CANDIDATE_FREEZE,
  STAGE5_FINAL10_CANDIDATE_VALIDATION,
  STAGE5_FINAL10_CORRECTION_MATRIX,
  STAGE5_FINAL10_EVIDENCE_INDEX,
  STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT,
  STAGE5_FINAL10_POST_FREEZE_SCAN_REPORT,
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
  STAGE5_FINAL10_EVIDENCE_DIRECTORY,
  STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS,
} from "./stage-5-candidate-contract.mjs";

export const STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SCAN_PHASES = new Set(["FINAL_EVIDENCE", "FINAL_CANDIDATE"]);

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
    findingLineage?.totalFindingCount !== STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS.length ||
    findingLineage?.authorClosedCount !== 0 ||
    findingLineage?.independentPendingCount !== STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS.length ||
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
  const expectedEvidenceArtifactPaths = STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(
    (name) => `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/${name}`,
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
    evidenceIndexVerification.indexPath !== STAGE5_FINAL10_EVIDENCE_INDEX ||
    evidenceIndexVerification.aggregateSerialization !==
      STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION ||
    !["PRE_CI", "FINAL"].includes(evidenceIndexVerification.phase) ||
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
    throw new Error("Stage 5 final scan lacks exact verified FINAL-10 evidence-index coverage");
  }

  const expectedFiles = [...sourceScopeFiles].sort((left, right) => left.localeCompare(right));
  const expectedUniqueFiles = [...new Set(expectedFiles)];
  if (expectedFiles.length !== expectedUniqueFiles.length) {
    throw new Error("Stage 5 source-scope collector returned duplicate file paths");
  }
  if (expectedUniqueFiles.includes(STAGE5_FINAL10_POST_FREEZE_SCAN_REPORT)) {
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

  const requiredPaths = [STAGE5_FINAL10_EVIDENCE_INDEX, STAGE5_FINAL10_CORRECTION_MATRIX];
  requiredPaths.push(STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT, STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT);
  if (phase === "FINAL_CANDIDATE") {
    requiredPaths.push(STAGE5_FINAL10_CANDIDATE_VALIDATION, STAGE5_FINAL10_CANDIDATE_FREEZE);
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
  const scannedEvidenceIndex = manifestByPath.get(STAGE5_FINAL10_EVIDENCE_INDEX);
  if (
    scannedEvidenceIndex?.bytes !== evidenceIndexVerification.indexBytes ||
    scannedEvidenceIndex?.sha256 !== evidenceIndexVerification.indexSha256
  ) {
    throw new Error("Stage 5 scan did not bind the verified FINAL-10 evidence-index bytes");
  }
  for (const indexedArtifact of indexedEvidenceArtifacts) {
    const scannedArtifact = manifestByPath.get(indexedArtifact.path);
    if (
      scannedArtifact?.bytes !== indexedArtifact.bytes ||
      scannedArtifact?.sha256 !== indexedArtifact.sha256
    ) {
      throw new Error(
        `Stage 5 scan bytes do not match FINAL-10 evidence index: ${indexedArtifact.path}`,
      );
    }
  }
  const final8ReviewArtifact = manifestByPath.get(STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT);
  const final9ReviewArtifact = manifestByPath.get(STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT);
  const matrixArtifact = manifestByPath.get(STAGE5_FINAL10_CORRECTION_MATRIX);
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
    postFreezeScanReportPath: STAGE5_FINAL10_POST_FREEZE_SCAN_REPORT,
    postFreezeScanReportExcludedFromScope: true,
    selfReferencePrevention: "post-freeze report is written only after the final scan completes",
    evidenceIndexIncluded: expectedUniqueFiles.includes(STAGE5_FINAL10_EVIDENCE_INDEX),
    final8HistoricalReviewIncluded: expectedUniqueFiles.includes(
      STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
    ),
    final9IndependentReviewIncluded: expectedUniqueFiles.includes(
      STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT,
    ),
    correctionMatrixIncluded: expectedUniqueFiles.includes(STAGE5_FINAL10_CORRECTION_MATRIX),
    validationIncluded: expectedUniqueFiles.includes(STAGE5_FINAL10_CANDIDATE_VALIDATION),
    freezeIncluded: expectedUniqueFiles.includes(STAGE5_FINAL10_CANDIDATE_FREEZE),
    historicalFindingLineage: findingLineage,
    matchedValuesEmitted: false,
  };
};
