import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createStage5FinalScanProvenance,
  STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION,
} from "./stage-5-scan-provenance.mjs";
import {
  collectStage5SourceFiles,
  STAGE5_EXPECTED_EVIDENCE_INDEXES,
  STAGE5_FINAL10_CANDIDATE_FREEZE,
  STAGE5_FINAL10_CANDIDATE_VALIDATION,
  STAGE5_FINAL10_CORRECTION_MATRIX,
  STAGE5_FINAL10_EVIDENCE_INDEX,
  STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT,
  STAGE5_FINAL10_POST_FREEZE_SCAN_REPORT,
  STAGE5_HISTORICAL_EVIDENCE_INDEXES,
  STAGE5_REQUIRED_SOURCE_PATHS,
  validateStage5Final10ScanReceiptDirectory,
  validateStage5SourceCoverage,
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
  STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL10_EVIDENCE_DIRECTORY,
  STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS,
  STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uniquePaths = (...paths) =>
  [...new Set(paths.flat())].sort((left, right) => left.localeCompare(right));

const report = await collectStage5SourceFiles({ phase: "PRE_INDEX" });
assert.equal(report.result, "PASS");
assert.ok(report.files.length > 100);
assert.ok(report.files.includes("docs/reviews/phase-1-m1/STAGE_5_FINAL_9_INDEPENDENT_REVIEW.md"));
assert.deepEqual(report.expectedStage5EvidenceIndexes, STAGE5_HISTORICAL_EVIDENCE_INDEXES);
assert.deepEqual(
  STAGE5_EXPECTED_EVIDENCE_INDEXES,
  [...STAGE5_HISTORICAL_EVIDENCE_INDEXES, STAGE5_FINAL10_EVIDENCE_INDEX].toSorted(),
);

const omittedSource = STAGE5_REQUIRED_SOURCE_PATHS[0];
const omittedSourceResult = validateStage5SourceCoverage(
  report.files.filter((filePath) => filePath !== omittedSource),
  { phase: "PRE_INDEX" },
);
assert.equal(omittedSourceResult.result, "FAIL");
assert.ok(omittedSourceResult.failedRequirementIds.includes(`required:${omittedSource}`));

const finalCandidateFiles = uniquePaths(
  report.files,
  STAGE5_FINAL10_EVIDENCE_INDEX,
  STAGE5_FINAL10_CORRECTION_MATRIX,
  STAGE5_FINAL10_CANDIDATE_VALIDATION,
  STAGE5_FINAL10_CANDIDATE_FREEZE,
);
assert.equal(
  validateStage5SourceCoverage(finalCandidateFiles, { phase: "FINAL_CANDIDATE" }).result,
  "PASS",
);
const missingFinal10Index = validateStage5SourceCoverage(
  finalCandidateFiles.filter((filePath) => filePath !== STAGE5_FINAL10_EVIDENCE_INDEX),
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(missingFinal10Index.result, "FAIL");
assert.ok(missingFinal10Index.missingStage5EvidenceIndexes.includes(STAGE5_FINAL10_EVIDENCE_INDEX));
const missingFinal9Review = validateStage5SourceCoverage(
  finalCandidateFiles.filter(
    (filePath) => filePath !== "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_INDEPENDENT_REVIEW.md",
  ),
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(missingFinal9Review.result, "FAIL");
assert.ok(
  missingFinal9Review.failedRequirementIds.includes(
    "required:docs/reviews/phase-1-m1/STAGE_5_FINAL_9_INDEPENDENT_REVIEW.md",
  ),
);
assert.equal(
  validateStage5SourceCoverage([...finalCandidateFiles, STAGE5_FINAL10_POST_FREEZE_SCAN_REPORT], {
    phase: "FINAL_CANDIDATE",
  }).result,
  "FAIL",
);

const receiptRoot = await mkdtemp(
  path.join(
    process.env.TMPDIR ?? "/home/hermes/.hermes/cache/scratch",
    "travelos-stage5-scan-receipt-",
  ),
);
try {
  const receiptDirectory = path.join(
    receiptRoot,
    path.dirname(STAGE5_FINAL10_POST_FREEZE_SCAN_REPORT),
  );
  assert.equal(
    (await validateStage5Final10ScanReceiptDirectory({ root: receiptRoot })).exists,
    false,
  );
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    path.join(receiptDirectory, path.basename(STAGE5_FINAL10_POST_FREEZE_SCAN_REPORT)),
    "{}\n",
  );
  assert.equal(
    (await validateStage5Final10ScanReceiptDirectory({ root: receiptRoot })).exists,
    true,
  );
  await writeFile(path.join(receiptDirectory, "unexpected.json"), "{}\n");
  await assert.rejects(
    validateStage5Final10ScanReceiptDirectory({ root: receiptRoot }),
    /unexpected entries/u,
  );
} finally {
  await rm(receiptRoot, { recursive: true, force: true });
}

const sourceReview = { bytes: 17, sha256: "d".repeat(64) };
const correctionMatrix = { bytes: 19, sha256: "b".repeat(64) };
const findingLineage = {
  result: "PASS",
  totalFindingCount: STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS.length,
  authorClosedCount: 0,
  independentPendingCount: STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS.length,
  stage6Actions: 0,
  sourceReview,
  correctionMatrix,
  protectedFinal8: {
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
  protectedFinal9: {
    result: "PASS",
    tag: STAGE5_FINAL9_REJECTED_TAG,
    target: STAGE5_FINAL9_REJECTED_TAG_TARGET,
    freeze: { sha256: STAGE5_FINAL9_FREEZE_SHA256 },
    evidenceIndex: {
      path: STAGE5_FINAL9_EVIDENCE_INDEX,
      sha256: STAGE5_FINAL9_EVIDENCE_INDEX_SHA256,
    },
  },
};
const artifact = (name) => {
  const filePath = `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/${name}`;
  if (filePath === STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT) {
    return { path: filePath, bytes: 38123, sha256: STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 };
  }
  if (filePath === STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT)
    return { path: filePath, ...sourceReview };
  return { path: filePath, bytes: 1, sha256: "a".repeat(64) };
};
const indexedArtifacts = STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(artifact).toSorted(
  (left, right) => left.path.localeCompare(right.path),
);
const aggregateSha256 = sha256(
  indexedArtifacts.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join(""),
);
const evidenceIndexVerification = {
  result: "PASS",
  phase: "FINAL",
  indexPath: STAGE5_FINAL10_EVIDENCE_INDEX,
  indexBytes: 1,
  indexSha256: "c".repeat(64),
  artifactCount: indexedArtifacts.length,
  artifactBytesManifest: indexedArtifacts,
  aggregateSerialization: STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION,
  matched: indexedArtifacts.length,
  missing: [],
  unexpected: [],
  invalidDirectoryEntries: [],
  sizeMismatches: [],
  hashMismatches: [],
  declaredAggregateSha256: aggregateSha256,
  recomputedAggregateSha256: aggregateSha256,
};
const manifestRow = (filePath) => {
  if (filePath === STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT) {
    return { path: filePath, bytes: 38123, sha256: STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 };
  }
  if (filePath === STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT)
    return { path: filePath, ...sourceReview };
  if (filePath === STAGE5_FINAL10_CORRECTION_MATRIX) return { path: filePath, ...correctionMatrix };
  if (filePath === STAGE5_FINAL10_EVIDENCE_INDEX) {
    return {
      path: filePath,
      bytes: evidenceIndexVerification.indexBytes,
      sha256: evidenceIndexVerification.indexSha256,
    };
  }
  return { path: filePath, bytes: 1, sha256: "a".repeat(64) };
};
const scanReport = (paths) => {
  const fileManifest = uniquePaths(paths).map(manifestRow);
  return {
    result: "PASS",
    findings: [],
    filesScanned: fileManifest.map((entry) => entry.path),
    fileManifest,
    scopeSerialization: STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION,
    scopeAggregateSha256: sha256(
      fileManifest.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join(""),
    ),
  };
};
const finalEvidenceFiles = uniquePaths(
  report.files,
  STAGE5_FINAL10_EVIDENCE_INDEX,
  STAGE5_FINAL10_CORRECTION_MATRIX,
  indexedArtifacts.map((entry) => entry.path),
);
const provenance = createStage5FinalScanProvenance({
  phase: "FINAL_EVIDENCE",
  sourceScopeFiles: finalEvidenceFiles,
  scanReport: scanReport(finalEvidenceFiles),
  findingLineage,
  evidenceIndexVerification,
});
assert.equal(provenance.protectedFinal8TagBytesVerified, true);
assert.equal(provenance.protectedFinal9TagBytesVerified, true);
assert.equal(provenance.final8HistoricalReviewIncluded, true);
assert.equal(provenance.final9IndependentReviewIncluded, true);
assert.throws(
  () =>
    createStage5FinalScanProvenance({
      phase: "FINAL_EVIDENCE",
      sourceScopeFiles: finalEvidenceFiles,
      scanReport: scanReport(finalEvidenceFiles),
      findingLineage: {
        ...findingLineage,
        protectedFinal9: { ...findingLineage.protectedFinal9, target: "0".repeat(40) },
      },
      evidenceIndexVerification,
    }),
  /protected FINAL-9/u,
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 2,
      result: "PASS",
      sourceFiles: report.files.length,
      historicalEvidenceIndexes: STAGE5_HISTORICAL_EVIDENCE_INDEXES.length,
      expectedEvidenceIndexes: STAGE5_EXPECTED_EVIDENCE_INDEXES.length,
      sourceOmissionRejected: true,
      final10IndexOmissionRejected: true,
      final9ReviewOmissionRejected: true,
      postFreezeReceiptSelfInclusionRejected: true,
      protectedFinal8AndFinal9ProvenanceRequired: true,
      final10IndependentReviewArtifactRequired: true,
      stage6Actions: 0,
    },
    null,
    2,
  ),
);
