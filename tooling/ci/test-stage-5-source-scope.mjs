import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createStage5FinalScanProvenance,
  STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION,
} from "./stage-5-scan-provenance.mjs";
import {
  collectStage5SourceFiles,
  STAGE5_FINAL9_CORRECTION_MATRIX,
  STAGE5_EXPECTED_EVIDENCE_INDEXES,
  STAGE5_FINAL9_CANDIDATE_FREEZE,
  STAGE5_FINAL9_CANDIDATE_VALIDATION,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT,
  STAGE5_HISTORICAL_EVIDENCE_INDEXES,
  STAGE5_REQUIRED_SOURCE_PATHS,
  validateStage5SourceCoverage,
  validateStage5Final9ScanReceiptDirectory,
} from "./stage-5-source-scope.mjs";
import {
  STAGE5_FINAL8_EVIDENCE_INDEX,
  STAGE5_FINAL8_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL8_FREEZE,
  STAGE5_FINAL8_FREEZE_SHA256,
  STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256,
  STAGE5_FINAL8_REJECTED_TAG,
  STAGE5_FINAL8_REJECTED_TAG_TARGET,
  STAGE5_FINAL9_EVIDENCE_DIRECTORY,
  STAGE5_FINAL9_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL9_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";

const report = await collectStage5SourceFiles({ phase: "PRE_INDEX" });
assert.equal(report.result, "PASS");
assert.ok(report.files.length > 100);
assert.ok(report.files.includes("docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md"));
assert.equal(report.postFreezeScanReceiptState.result, "PASS");
assert.equal(typeof report.postFreezeScanReceiptState.exists, "boolean");
assert.equal(report.postFreezeScanReceipt.excludedFromScan, true);
assert.deepEqual(report.expectedStage5EvidenceIndexes, STAGE5_HISTORICAL_EVIDENCE_INDEXES);
assert.deepEqual(
  report.stage5EvidenceIndexes.filter((filePath) =>
    STAGE5_HISTORICAL_EVIDENCE_INDEXES.includes(filePath),
  ),
  STAGE5_HISTORICAL_EVIDENCE_INDEXES,
);
assert.ok(
  report.stage5EvidenceIndexes.every((filePath) =>
    STAGE5_EXPECTED_EVIDENCE_INDEXES.includes(filePath),
  ),
);
assert.deepEqual(
  STAGE5_EXPECTED_EVIDENCE_INDEXES,
  [...STAGE5_HISTORICAL_EVIDENCE_INDEXES, STAGE5_FINAL9_EVIDENCE_INDEX].toSorted(),
);

const omittedSourcePath = STAGE5_REQUIRED_SOURCE_PATHS[0];
assert.ok(omittedSourcePath);
const omission = validateStage5SourceCoverage(
  report.files.filter((filePath) => filePath !== omittedSourcePath),
  {
    phase: "PRE_INDEX",
  },
);
assert.equal(omission.result, "FAIL");
assert.ok(omission.failedRequirementIds.includes(`required:${omittedSourcePath}`));

const finalCandidateFiles = [
  ...report.files,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_CORRECTION_MATRIX,
  STAGE5_FINAL9_CANDIDATE_VALIDATION,
  STAGE5_FINAL9_CANDIDATE_FREEZE,
];
const finalCandidate = validateStage5SourceCoverage(finalCandidateFiles, {
  phase: "FINAL_CANDIDATE",
});
assert.equal(finalCandidate.result, "PASS");

const missingCorrectionMatrix = validateStage5SourceCoverage(
  [
    ...report.files.filter((filePath) => filePath !== STAGE5_FINAL9_CORRECTION_MATRIX),
    STAGE5_FINAL9_EVIDENCE_INDEX,
    STAGE5_FINAL9_CANDIDATE_VALIDATION,
    STAGE5_FINAL9_CANDIDATE_FREEZE,
  ],
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(missingCorrectionMatrix.result, "FAIL");
assert.ok(
  missingCorrectionMatrix.failedRequirementIds.includes(
    `stage5-final-candidate-input-missing:${STAGE5_FINAL9_CORRECTION_MATRIX}`,
  ),
);

const missingFinal9EvidenceIndex = validateStage5SourceCoverage(
  report.files.filter((filePath) => filePath !== STAGE5_FINAL9_EVIDENCE_INDEX),
  { phase: "FINAL_EVIDENCE" },
);
assert.equal(missingFinal9EvidenceIndex.result, "FAIL");
assert.ok(
  missingFinal9EvidenceIndex.missingStage5EvidenceIndexes.includes(STAGE5_FINAL9_EVIDENCE_INDEX),
);

const evidenceOmissionMatrix = STAGE5_EXPECTED_EVIDENCE_INDEXES.map((omittedIndex) => {
  const result = validateStage5SourceCoverage(
    finalCandidateFiles.filter((filePath) => filePath !== omittedIndex),
    { phase: "FINAL_CANDIDATE" },
  );
  assert.equal(result.result, "FAIL");
  assert.ok(result.missingStage5EvidenceIndexes.includes(omittedIndex));
  return { omittedIndex, result: result.result, missing: result.missingStage5EvidenceIndexes };
});

const missingValidation = validateStage5SourceCoverage(
  finalCandidateFiles.filter((filePath) => filePath !== STAGE5_FINAL9_CANDIDATE_VALIDATION),
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(missingValidation.result, "FAIL");
assert.ok(
  missingValidation.failedRequirementIds.includes(
    `stage5-final-candidate-input-missing:${STAGE5_FINAL9_CANDIDATE_VALIDATION}`,
  ),
);

const missingFreeze = validateStage5SourceCoverage(
  finalCandidateFiles.filter((filePath) => filePath !== STAGE5_FINAL9_CANDIDATE_FREEZE),
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(missingFreeze.result, "FAIL");
assert.ok(
  missingFreeze.failedRequirementIds.includes(
    `stage5-final-candidate-input-missing:${STAGE5_FINAL9_CANDIDATE_FREEZE}`,
  ),
);

const unexpectedEvidenceIndex = "docs/evidence/phase-1-m1/stage-5-final-10/EVIDENCE_INDEX.json";
const unexpectedIndexResult = validateStage5SourceCoverage(
  [...finalCandidateFiles, unexpectedEvidenceIndex],
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(unexpectedIndexResult.result, "FAIL");
assert.ok(
  unexpectedIndexResult.failedRequirementIds.includes(
    `stage5-evidence-index-unexpected:${unexpectedEvidenceIndex}`,
  ),
);

const selfIncludingReceipt = validateStage5SourceCoverage(
  [...finalCandidateFiles, STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT],
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(selfIncludingReceipt.result, "FAIL");
assert.ok(
  selfIncludingReceipt.failedRequirementIds.includes(
    `stage5-scan-receipt-self-inclusion:${STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT}`,
  ),
);

const receiptRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage5-scan-receipt-scope-"));
try {
  const receiptDirectory = path.join(
    receiptRoot,
    path.dirname(STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT),
  );
  const absentReceipt = await validateStage5Final9ScanReceiptDirectory({ root: receiptRoot });
  assert.equal(absentReceipt.result, "PASS");
  assert.equal(absentReceipt.exists, false);
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    path.join(receiptDirectory, path.basename(STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT)),
    "{}\n",
  );
  const expectedReceipt = await validateStage5Final9ScanReceiptDirectory({ root: receiptRoot });
  assert.equal(expectedReceipt.result, "PASS");
  assert.equal(expectedReceipt.exists, true);
  await writeFile(path.join(receiptDirectory, "unexpected.json"), "{}\n");
  await assert.rejects(
    validateStage5Final9ScanReceiptDirectory({ root: receiptRoot }),
    /unexpected entries/u,
  );
} finally {
  await rm(receiptRoot, { recursive: true, force: true });
}

const uniquePaths = (...paths) =>
  [...new Set(paths.flat())].sort((left, right) => left.localeCompare(right));
const syntheticFindingLineage = {
  result: "PASS",
  totalFindingCount: 45,
  authorClosedCount: 0,
  independentPendingCount: 45,
  stage6Actions: 0,
  sourceReview: { bytes: 38123, sha256: STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 },
  correctionMatrix: { bytes: 1, sha256: "b".repeat(64) },
  protectedPredecessor: {
    result: "PASS",
    tag: STAGE5_FINAL8_REJECTED_TAG,
    target: STAGE5_FINAL8_REJECTED_TAG_TARGET,
    files: [
      {
        path: STAGE5_FINAL8_FREEZE,
        bytes: 1,
        sha256: STAGE5_FINAL8_FREEZE_SHA256,
        matchesRejectedTag: true,
      },
      {
        path: STAGE5_FINAL8_EVIDENCE_INDEX,
        bytes: 1,
        sha256: STAGE5_FINAL8_EVIDENCE_INDEX_SHA256,
        matchesRejectedTag: true,
      },
    ],
  },
};
const syntheticEvidenceIndexArtifacts = STAGE5_FINAL9_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(
  (name) => {
    const filePath = `${STAGE5_FINAL9_EVIDENCE_DIRECTORY}/${name}`;
    return {
      path: filePath,
      ...(filePath === STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT
        ? { bytes: 38123, sha256: STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 }
        : { bytes: 1, sha256: "a".repeat(64) }),
    };
  },
);
const syntheticEvidenceAggregateSha256 = createHash("sha256")
  .update(
    syntheticEvidenceIndexArtifacts
      .map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`)
      .join(""),
  )
  .digest("hex");
const syntheticEvidenceIndexVerification = {
  result: "PASS",
  phase: "FINAL",
  indexPath: STAGE5_FINAL9_EVIDENCE_INDEX,
  indexBytes: 1,
  indexSha256: "c".repeat(64),
  artifactCount: syntheticEvidenceIndexArtifacts.length,
  artifactBytesManifest: syntheticEvidenceIndexArtifacts,
  aggregateSerialization: STAGE5_FINAL9_EVIDENCE_AGGREGATE_SERIALIZATION,
  matched: syntheticEvidenceIndexArtifacts.length,
  missing: [],
  unexpected: [],
  invalidDirectoryEntries: [],
  sizeMismatches: [],
  hashMismatches: [],
  declaredAggregateSha256: syntheticEvidenceAggregateSha256,
  recomputedAggregateSha256: syntheticEvidenceAggregateSha256,
};
const createSyntheticScanReport = (paths) => {
  const fileManifest = uniquePaths(paths).map((filePath) => ({
    path: filePath,
    ...(filePath === STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT
      ? { bytes: 38123, sha256: STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 }
      : filePath === STAGE5_FINAL9_CORRECTION_MATRIX
        ? syntheticFindingLineage.correctionMatrix
        : filePath === STAGE5_FINAL9_EVIDENCE_INDEX
          ? {
              bytes: syntheticEvidenceIndexVerification.indexBytes,
              sha256: syntheticEvidenceIndexVerification.indexSha256,
            }
          : { bytes: 1, sha256: "a".repeat(64) }),
  }));
  const serialized = fileManifest
    .map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`)
    .join("");
  return {
    result: "PASS",
    findings: [],
    filesScanned: fileManifest.map((entry) => entry.path),
    fileManifest,
    scopeSerialization: STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION,
    scopeAggregateSha256: createHash("sha256").update(serialized).digest("hex"),
  };
};

const finalEvidenceFiles = uniquePaths(
  report.files,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_CORRECTION_MATRIX,
  syntheticEvidenceIndexArtifacts.map((entry) => entry.path),
);
const finalEvidenceProvenance = createStage5FinalScanProvenance({
  phase: "FINAL_EVIDENCE",
  sourceScopeFiles: finalEvidenceFiles,
  scanReport: createSyntheticScanReport(finalEvidenceFiles),
  findingLineage: syntheticFindingLineage,
  evidenceIndexVerification: syntheticEvidenceIndexVerification,
});
assert.equal(finalEvidenceProvenance.phase, "FINAL_EVIDENCE");
assert.equal(finalEvidenceProvenance.evidenceIndexIncluded, true);
assert.equal(finalEvidenceProvenance.evidenceIndexVerified, true);
assert.equal(finalEvidenceProvenance.correctionMatrixIncluded, true);
assert.equal(finalEvidenceProvenance.validationIncluded, false);
assert.equal(finalEvidenceProvenance.freezeIncluded, false);
assert.equal(finalEvidenceProvenance.historicalReviewIncluded, true);
assert.equal(finalEvidenceProvenance.scopeFileManifest.length, finalEvidenceFiles.length);

const finalCandidateFilesUnique = uniquePaths(
  finalCandidateFiles,
  syntheticEvidenceIndexArtifacts.map((entry) => entry.path),
);
const finalCandidateScanReport = createSyntheticScanReport(finalCandidateFilesUnique);
const finalCandidateProvenance = createStage5FinalScanProvenance({
  phase: "FINAL_CANDIDATE",
  sourceScopeFiles: finalCandidateFilesUnique,
  scanReport: finalCandidateScanReport,
  findingLineage: syntheticFindingLineage,
  evidenceIndexVerification: syntheticEvidenceIndexVerification,
});
assert.equal(finalCandidateProvenance.phase, "FINAL_CANDIDATE");
assert.equal(finalCandidateProvenance.validationIncluded, true);
assert.equal(finalCandidateProvenance.freezeIncluded, true);
assert.equal(
  finalCandidateProvenance.indexedEvidenceArtifactCount,
  STAGE5_FINAL9_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length,
);
assert.equal(finalCandidateProvenance.protectedFinal8TagBytesVerified, true);
assert.equal(finalCandidateProvenance.postFreezeScanReportExcludedFromScope, true);

const missingFinalEvidenceMatrixFiles = uniquePaths(
  report.files.filter((filePath) => filePath !== STAGE5_FINAL9_CORRECTION_MATRIX),
  STAGE5_FINAL9_EVIDENCE_INDEX,
);
const missingFinalEvidenceMatrix = validateStage5SourceCoverage(missingFinalEvidenceMatrixFiles, {
  phase: "FINAL_EVIDENCE",
});
assert.equal(missingFinalEvidenceMatrix.result, "FAIL");
assert.ok(
  missingFinalEvidenceMatrix.failedRequirementIds.includes(
    `stage5-final-candidate-input-missing:${STAGE5_FINAL9_CORRECTION_MATRIX}`,
  ),
);

assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_CANDIDATE",
      sourceScopeFiles: finalCandidateFilesUnique.filter(
        (filePath) => filePath !== STAGE5_FINAL9_CANDIDATE_FREEZE,
      ),
      scanReport: createSyntheticScanReport(
        finalCandidateFilesUnique.filter((filePath) => filePath !== STAGE5_FINAL9_CANDIDATE_FREEZE),
      ),
      findingLineage: syntheticFindingLineage,
      evidenceIndexVerification: syntheticEvidenceIndexVerification,
    }),
  /missing required inputs/u,
);

assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_CANDIDATE",
      sourceScopeFiles: finalCandidateFilesUnique,
      scanReport: {
        ...finalCandidateScanReport,
        scopeAggregateSha256: "0".repeat(64),
      },
      findingLineage: syntheticFindingLineage,
      evidenceIndexVerification: syntheticEvidenceIndexVerification,
    }),
  /aggregate does not match/u,
);

const selfIncludingReceiptFiles = uniquePaths(
  finalCandidateFilesUnique,
  STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT,
);
assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_CANDIDATE",
      sourceScopeFiles: selfIncludingReceiptFiles,
      scanReport: createSyntheticScanReport(selfIncludingReceiptFiles),
      findingLineage: syntheticFindingLineage,
      evidenceIndexVerification: syntheticEvidenceIndexVerification,
    }),
  /must remain excluded/u,
);

const missingReviewFiles = finalCandidateFilesUnique.filter(
  (filePath) => filePath !== STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT,
);
assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_CANDIDATE",
      sourceScopeFiles: missingReviewFiles,
      scanReport: createSyntheticScanReport(missingReviewFiles),
      findingLineage: syntheticFindingLineage,
      evidenceIndexVerification: syntheticEvidenceIndexVerification,
    }),
  /missing required inputs/u,
);

assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_CANDIDATE",
      sourceScopeFiles: finalCandidateFilesUnique,
      scanReport: finalCandidateScanReport,
      findingLineage: { ...syntheticFindingLineage, authorClosedCount: 1 },
      evidenceIndexVerification: syntheticEvidenceIndexVerification,
    }),
  /complete fail-closed finding-lineage proof/u,
);

assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_CANDIDATE",
      sourceScopeFiles: finalCandidateFilesUnique,
      scanReport: finalCandidateScanReport,
      findingLineage: { ...syntheticFindingLineage, protectedPredecessor: null },
      evidenceIndexVerification: syntheticEvidenceIndexVerification,
    }),
  /exact protected FINAL-8 tag-byte provenance/u,
);

assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_CANDIDATE",
      sourceScopeFiles: finalCandidateFilesUnique,
      scanReport: finalCandidateScanReport,
      findingLineage: syntheticFindingLineage,
      evidenceIndexVerification: {
        ...syntheticEvidenceIndexVerification,
        indexSha256: "e".repeat(64),
      },
    }),
  /did not bind the verified FINAL-9 evidence-index bytes/u,
);

assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_CANDIDATE",
      sourceScopeFiles: finalCandidateFilesUnique,
      scanReport: finalCandidateScanReport,
      findingLineage: syntheticFindingLineage,
      evidenceIndexVerification: {
        ...syntheticEvidenceIndexVerification,
        declaredAggregateSha256: "f".repeat(64),
        recomputedAggregateSha256: "f".repeat(64),
      },
    }),
  /exact verified FINAL-9 evidence-index coverage/u,
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      livePhase: report.phase,
      filesScanned: report.files.length,
      coverage: report.coverage,
      historicalEvidenceIndexCount: STAGE5_HISTORICAL_EVIDENCE_INDEXES.length,
      finalEvidenceIndexCount: STAGE5_EXPECTED_EVIDENCE_INDEXES.length,
      omissionProbe: {
        omittedSourcePath,
        result: omission.result,
      },
      evidenceOmissionProbe: {
        matrix: evidenceOmissionMatrix,
        missingCorrectionMatrix: missingCorrectionMatrix.result,
        missingFinal9EvidenceIndex: missingFinal9EvidenceIndex.result,
        missingValidation: missingValidation.result,
        missingFreeze: missingFreeze.result,
        unexpectedIndex: unexpectedIndexResult.result,
      },
      scanProvenanceProbe: {
        finalEvidence: finalEvidenceProvenance.phase,
        finalCandidate: finalCandidateProvenance.phase,
        protectedFinal8TagBytesVerified: finalCandidateProvenance.protectedFinal8TagBytesVerified,
        receiptExcludedFromOwnScope: finalCandidateProvenance.postFreezeScanReportExcludedFromScope,
        missingFreezeRejected: true,
        alteredAggregateRejected: true,
        missingProtectedTagBytesRejected: true,
        scanManifestBoundToEvidenceIndex: true,
        falseEvidenceAggregateRejected: true,
      },
    },
    null,
    2,
  ),
);
