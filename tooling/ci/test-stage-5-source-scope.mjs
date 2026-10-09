import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import currentCandidateManifest from "./stage-5-current-candidate.json" with { type: "json" };

import {
  createStage5FinalScanProvenance,
  STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION,
} from "./stage-5-scan-provenance.mjs";
import {
  collectStage5SourceFiles,
  excludeActiveStage5ScanReceipt,
  STAGE5_EXPECTED_EVIDENCE_INDEXES,
  STAGE5_FINAL11_CANDIDATE_FREEZE,
  STAGE5_FINAL11_CANDIDATE_VALIDATION,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
  STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CANDIDATE_VALIDATION,
  STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL16_CORRECTION_MATRIX,
  STAGE5_FINAL16_EVIDENCE_INDEX,
  STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL17_CANDIDATE_FREEZE,
  STAGE5_FINAL17_CANDIDATE_VALIDATION,
  STAGE5_FINAL17_CORRECTION_MATRIX,
  STAGE5_FINAL17_EVIDENCE_INDEX,
  STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL18_CANDIDATE_VALIDATION,
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL18_EVIDENCE_INDEX,
  STAGE5_FINAL20_CANDIDATE_FREEZE,
  STAGE5_FINAL20_CANDIDATE_VALIDATION,
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_EVIDENCE_INDEX,
  STAGE5_FINAL21_EVIDENCE_INDEX,
  STAGE5_HISTORICAL_EVIDENCE_INDEXES,
  STAGE5_REQUIRED_SOURCE_PATHS,
  validateStage5Final11ScanReceiptDirectory,
  validateStage5Final15ScanReceiptDirectory,
  validateStage5Final16ScanReceiptDirectory,
  validateStage5Final17ScanReceiptDirectory,
  validateStage5Final18ScanReceiptDirectory,
  validateStage5Final20ScanReceiptDirectory,
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
  STAGE5_FINAL11_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL11_EVIDENCE_DIRECTORY,
  STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS,
  STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL12_EVIDENCE_INDEX,
  STAGE5_FINAL13_CANDIDATE_FREEZE,
  STAGE5_FINAL13_CANDIDATE_VALIDATION,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_EVIDENCE_INDEX,
  STAGE5_FINAL14_EVIDENCE_INDEX,
  STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final10RejectedTaggedBytes } from "./stage-5-final11-finding-lineage.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uniquePaths = (...paths) =>
  [...new Set(paths.flat())].sort((left, right) => left.localeCompare(right));

const report = await collectStage5SourceFiles({ phase: "PRE_INDEX" });
assert.equal(report.result, "PASS");
const candidateScan = currentCandidateManifest.finalization.scan;
const historicalScan = currentCandidateManifest.historicalInputs.predecessorFinalScan;
assert.deepEqual(
  excludeActiveStage5ScanReceipt([candidateScan, historicalScan, candidateScan]),
  [historicalScan],
  "Only the active scan output is excluded; frozen historical scans remain in scope",
);
assert.ok(report.files.includes(historicalScan));
assert.ok(!report.files.includes(candidateScan));
assert.ok(report.files.length > 100);
assert.ok(report.files.includes("docs/reviews/phase-1-m1/STAGE_5_FINAL_9_INDEPENDENT_REVIEW.md"));
assert.deepEqual(report.expectedStage5EvidenceIndexes, STAGE5_HISTORICAL_EVIDENCE_INDEXES);
assert.deepEqual(
  STAGE5_EXPECTED_EVIDENCE_INDEXES,
  [
    ...STAGE5_HISTORICAL_EVIDENCE_INDEXES,
    STAGE5_FINAL11_EVIDENCE_INDEX,
    STAGE5_FINAL12_EVIDENCE_INDEX,
    STAGE5_FINAL13_EVIDENCE_INDEX,
    STAGE5_FINAL14_EVIDENCE_INDEX,
    STAGE5_FINAL16_EVIDENCE_INDEX,
    STAGE5_FINAL17_EVIDENCE_INDEX,
    STAGE5_FINAL18_EVIDENCE_INDEX,
    STAGE5_FINAL20_EVIDENCE_INDEX,
    STAGE5_FINAL21_EVIDENCE_INDEX,
  ].toSorted(),
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
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_CANDIDATE_VALIDATION,
  STAGE5_FINAL11_CANDIDATE_FREEZE,
  STAGE5_FINAL12_EVIDENCE_INDEX,
  STAGE5_FINAL13_EVIDENCE_INDEX,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_CANDIDATE_VALIDATION,
  STAGE5_FINAL13_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CANDIDATE_VALIDATION,
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL16_EVIDENCE_INDEX,
  STAGE5_FINAL16_CORRECTION_MATRIX,
  STAGE5_FINAL17_EVIDENCE_INDEX,
  STAGE5_FINAL17_CORRECTION_MATRIX,
  STAGE5_FINAL17_CANDIDATE_VALIDATION,
  STAGE5_FINAL17_CANDIDATE_FREEZE,
  STAGE5_FINAL18_EVIDENCE_INDEX,
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL20_EVIDENCE_INDEX,
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_CANDIDATE_VALIDATION,
  STAGE5_FINAL20_CANDIDATE_FREEZE,
  STAGE5_FINAL21_EVIDENCE_INDEX,
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_21_CORRECTION_MATRIX.json",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_21_CANDIDATE_VALIDATION.md",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_21_CANDIDATE_FREEZE.json",
);
assert.equal(
  validateStage5SourceCoverage(finalCandidateFiles, { phase: "FINAL_CANDIDATE" }).result,
  "PASS",
);
const currentIndex = `${currentCandidateManifest.evidenceDirectory}/EVIDENCE_INDEX.json`;
const currentEvidenceFiles = uniquePaths(
  finalCandidateFiles,
  currentIndex,
  currentCandidateManifest.historicalInputs.predecessorCorrectionMatrix,
  currentCandidateManifest.correctionMatrix,
);
assert.equal(
  validateStage5SourceCoverage(currentEvidenceFiles, {
    phase: "FINAL_EVIDENCE",
    candidate: currentCandidateManifest.candidate,
  }).result,
  "PASS",
);
const beforeFreeze = validateStage5SourceCoverage(currentEvidenceFiles, {
  phase: "FINAL_CANDIDATE",
  candidate: currentCandidateManifest.candidate,
});
assert.equal(beforeFreeze.result, "FAIL");
for (const requiredPath of [
  currentCandidateManifest.finalization.validation,
  currentCandidateManifest.finalization.freeze,
]) {
  assert(beforeFreeze.missingFinalCandidateInputs.includes(requiredPath));
}
const currentFrozenFiles = uniquePaths(
  currentEvidenceFiles,
  currentCandidateManifest.finalization.validation,
  currentCandidateManifest.finalization.freeze,
);
const currentFrozenCoverage = validateStage5SourceCoverage(currentFrozenFiles, {
  phase: "FINAL_CANDIDATE",
  candidate: currentCandidateManifest.candidate,
});
assert.deepEqual(currentFrozenCoverage.failedRequirementIds, []);
for (const requiredPath of [
  currentIndex,
  currentCandidateManifest.finalization.validation,
  currentCandidateManifest.finalization.freeze,
]) {
  const missing = validateStage5SourceCoverage(
    currentFrozenFiles.filter((filePath) => filePath !== requiredPath),
    { phase: "FINAL_CANDIDATE", candidate: currentCandidateManifest.candidate },
  );
  assert.equal(missing.result, "FAIL", `Missing current-candidate artifact: ${requiredPath}`);
}
assert.ok(
  !finalCandidateFiles.includes("docs/reviews/phase-1-m1/STAGE_5_FINAL_15_CANDIDATE_VALIDATION.md"),
);
assert.ok(
  !finalCandidateFiles.includes("docs/reviews/phase-1-m1/STAGE_5_FINAL_15_CANDIDATE_FREEZE.md"),
);
assert.ok(
  !finalCandidateFiles.includes("docs/reviews/phase-1-m1/STAGE_5_FINAL_16_CANDIDATE_VALIDATION.md"),
);
assert.ok(
  !finalCandidateFiles.includes("docs/reviews/phase-1-m1/STAGE_5_FINAL_16_CANDIDATE_FREEZE.md"),
);
const rejectedFinal18Absent = validateStage5SourceCoverage(finalCandidateFiles, {
  phase: "FINAL_CANDIDATE",
});
assert.equal(rejectedFinal18Absent.result, "PASS");
assert.ok(
  !rejectedFinal18Absent.missingFinalCandidateInputs.includes(STAGE5_FINAL18_CANDIDATE_VALIDATION),
);
const fabricatedFinal18 = validateStage5SourceCoverage(
  [...finalCandidateFiles, STAGE5_FINAL18_CANDIDATE_VALIDATION],
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(fabricatedFinal18.result, "FAIL");
assert.ok(
  fabricatedFinal18.failedRequirementIds.some((id) => id.includes("unexpected forbidden artifact")),
);
const missingFinal19Freeze = validateStage5SourceCoverage(
  finalCandidateFiles.filter((filePath) => filePath !== STAGE5_FINAL20_CANDIDATE_FREEZE),
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(missingFinal19Freeze.result, "FAIL");
assert.ok(
  missingFinal19Freeze.missingFinalCandidateInputs.includes(STAGE5_FINAL20_CANDIDATE_FREEZE),
);
const missingFinal11Index = validateStage5SourceCoverage(
  finalCandidateFiles.filter((filePath) => filePath !== STAGE5_FINAL11_EVIDENCE_INDEX),
  { phase: "FINAL_CANDIDATE" },
);
assert.equal(missingFinal11Index.result, "FAIL");
assert.ok(missingFinal11Index.missingStage5EvidenceIndexes.includes(STAGE5_FINAL11_EVIDENCE_INDEX));
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
  validateStage5SourceCoverage([...finalCandidateFiles, STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT], {
    phase: "FINAL_CANDIDATE",
  }).result,
  "FAIL",
);
assert.equal(
  validateStage5SourceCoverage([...finalCandidateFiles, STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT], {
    phase: "FINAL_CANDIDATE",
  }).result,
  "PASS",
);
assert.equal(
  validateStage5SourceCoverage([...finalCandidateFiles, STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT], {
    phase: "FINAL_CANDIDATE",
  }).result,
  "FAIL",
);
assert.equal(
  validateStage5SourceCoverage([...finalCandidateFiles, STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT], {
    phase: "FINAL_CANDIDATE",
  }).result,
  "FAIL",
);
assert.equal(
  validateStage5SourceCoverage([...finalCandidateFiles, STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT], {
    phase: "FINAL_CANDIDATE",
  }).result,
  "PASS",
);
assert.equal(
  validateStage5SourceCoverage([...finalCandidateFiles, STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT], {
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
    path.dirname(STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT),
  );
  assert.equal(
    (await validateStage5Final11ScanReceiptDirectory({ root: receiptRoot })).exists,
    false,
  );
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    path.join(receiptDirectory, path.basename(STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT)),
    "{}\n",
  );
  assert.equal(
    (await validateStage5Final11ScanReceiptDirectory({ root: receiptRoot })).exists,
    true,
  );
  await writeFile(path.join(receiptDirectory, "unexpected.json"), "{}\n");
  await assert.rejects(
    validateStage5Final11ScanReceiptDirectory({ root: receiptRoot }),
    /unexpected entries/u,
  );
} finally {
  await rm(receiptRoot, { recursive: true, force: true });
}

const final15ReceiptRoot = await mkdtemp(
  path.join(
    process.env.TMPDIR ?? "/home/hermes/.hermes/cache/scratch",
    "travelos-stage5-final15-scan-",
  ),
);
try {
  const receiptDirectory = path.join(
    final15ReceiptRoot,
    path.dirname(STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT),
  );
  assert.equal(
    (await validateStage5Final15ScanReceiptDirectory({ root: final15ReceiptRoot })).exists,
    false,
  );
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    path.join(receiptDirectory, path.basename(STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT)),
    "{}\n",
  );
  assert.equal(
    (await validateStage5Final15ScanReceiptDirectory({ root: final15ReceiptRoot })).exists,
    true,
  );
  await writeFile(path.join(receiptDirectory, "unexpected.json"), "{}\n");
  await assert.rejects(
    validateStage5Final15ScanReceiptDirectory({ root: final15ReceiptRoot }),
    /unexpected entries/u,
  );
} finally {
  await rm(final15ReceiptRoot, { recursive: true, force: true });
}

const final16ReceiptRoot = await mkdtemp(
  path.join(
    process.env.TMPDIR ?? "/home/hermes/.hermes/cache/scratch",
    "travelos-stage5-final16-scan-",
  ),
);
try {
  const receiptDirectory = path.join(
    final16ReceiptRoot,
    path.dirname(STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT),
  );
  assert.equal(
    (await validateStage5Final16ScanReceiptDirectory({ root: final16ReceiptRoot })).exists,
    false,
  );
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    path.join(receiptDirectory, path.basename(STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT)),
    "{}\\n",
  );
  assert.equal(
    (await validateStage5Final16ScanReceiptDirectory({ root: final16ReceiptRoot })).exists,
    true,
  );
  await writeFile(path.join(receiptDirectory, "unexpected.json"), "{}\\n");
  await assert.rejects(
    validateStage5Final16ScanReceiptDirectory({ root: final16ReceiptRoot }),
    /unexpected entries/u,
  );
} finally {
  await rm(final16ReceiptRoot, { recursive: true, force: true });
}

const final17ReceiptRoot = await mkdtemp(
  path.join(
    process.env.TMPDIR ?? "/home/hermes/.hermes/cache/scratch",
    "travelos-stage5-final17-scan-",
  ),
);
try {
  const receiptDirectory = path.join(
    final17ReceiptRoot,
    path.dirname(STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT),
  );
  assert.equal(
    (await validateStage5Final17ScanReceiptDirectory({ root: final17ReceiptRoot })).exists,
    false,
  );
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    path.join(receiptDirectory, path.basename(STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT)),
    "{}\n",
  );
  assert.equal(
    (await validateStage5Final17ScanReceiptDirectory({ root: final17ReceiptRoot })).exists,
    true,
  );
  await writeFile(path.join(receiptDirectory, "unexpected.json"), "{}\n");
  await assert.rejects(
    validateStage5Final17ScanReceiptDirectory({ root: final17ReceiptRoot }),
    /unexpected entries/u,
  );
} finally {
  await rm(final17ReceiptRoot, { recursive: true, force: true });
}

const final18ReceiptRoot = await mkdtemp(
  path.join(
    process.env.TMPDIR ?? "/home/hermes/.hermes/cache/scratch",
    "travelos-stage5-final18-scan-",
  ),
);
try {
  const receiptDirectory = path.join(
    final18ReceiptRoot,
    path.dirname(STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT),
  );
  assert.equal(
    (await validateStage5Final18ScanReceiptDirectory({ root: final18ReceiptRoot })).exists,
    false,
  );
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    path.join(receiptDirectory, path.basename(STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT)),
    "{}\n",
  );
  assert.equal(
    (await validateStage5Final18ScanReceiptDirectory({ root: final18ReceiptRoot })).exists,
    true,
  );
  await writeFile(path.join(receiptDirectory, "unexpected.json"), "{}\n");
  await assert.rejects(
    validateStage5Final18ScanReceiptDirectory({ root: final18ReceiptRoot }),
    /unexpected entries/u,
  );
} finally {
  await rm(final18ReceiptRoot, { recursive: true, force: true });
}

const final19ReceiptRoot = await mkdtemp(
  path.join(
    process.env.TMPDIR ?? "/home/hermes/.hermes/cache/scratch",
    "travelos-stage5-final19-scan-",
  ),
);
try {
  const receiptDirectory = path.join(
    final19ReceiptRoot,
    path.dirname(STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT),
  );
  assert.equal(
    (await validateStage5Final20ScanReceiptDirectory({ root: final19ReceiptRoot })).exists,
    false,
  );
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(
    path.join(receiptDirectory, path.basename(STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT)),
    "{}\n",
  );
  assert.equal(
    (await validateStage5Final20ScanReceiptDirectory({ root: final19ReceiptRoot })).exists,
    true,
  );
  await writeFile(path.join(receiptDirectory, "unexpected.json"), "{}\n");
  await assert.rejects(
    validateStage5Final20ScanReceiptDirectory({ root: final19ReceiptRoot }),
    /unexpected entries/u,
  );
} finally {
  await rm(final19ReceiptRoot, { recursive: true, force: true });
}

const sourceReviewBytes = await readFile(STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT);
const sourceReview = {
  bytes: sourceReviewBytes.length,
  sha256: sha256(sourceReviewBytes),
};
const correctionMatrixBytes = await readFile(STAGE5_FINAL11_CORRECTION_MATRIX);
const correctionMatrix = {
  bytes: correctionMatrixBytes.length,
  sha256: sha256(correctionMatrixBytes),
};
const verifiedFinal10Lineage = await verifyStage5Final10RejectedTaggedBytes();
const final10ArtifactNames = [
  "final10-rejected-tag.json",
  "final8-independent-review.json",
  "final9-rejected-tag.json",
  "final9-independent-review.md",
  "final10-ci-verify-execution.json",
  "final10-ci-verify.log",
  "final10-correction-matrix.json",
  "final10-pre-ci-evidence-index.json",
  "final10-rejection-record.md",
  "final10-security-extension-baseline.json",
];
const final10ArtifactManifest = await Promise.all(
  final10ArtifactNames.map(async (name) => {
    const artifactPath = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/${name}`;
    const bytes = await readFile(artifactPath);
    return { path: artifactPath, bytes: bytes.length, sha256: sha256(bytes) };
  }),
);
const protectedFinal10 = {
  ...verifiedFinal10Lineage,
  predecessorArtifacts: final10ArtifactManifest.toSorted((left, right) =>
    left.path.localeCompare(right.path),
  ),
};
const final10ArtifactByPath = new Map(final10ArtifactManifest.map((entry) => [entry.path, entry]));
const findingLineage = {
  result: "PASS",
  totalFindingCount: STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS.length,
  authorClosedCount: 0,
  independentPendingCount: STAGE5_FINAL11_EXPECTED_ALL_FINDING_IDS.length,
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
  protectedFinal10,
};
const artifact = (name) => {
  const filePath = `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/${name}`;
  if (final10ArtifactByPath.has(filePath)) return final10ArtifactByPath.get(filePath);
  if (filePath === STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT) {
    return { path: filePath, bytes: 38123, sha256: STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 };
  }
  if (filePath === STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT)
    return { path: filePath, ...sourceReview };
  return { path: filePath, bytes: 1, sha256: "a".repeat(64) };
};
const indexedArtifacts = STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(artifact).toSorted(
  (left, right) => left.path.localeCompare(right.path),
);
const aggregateSha256 = sha256(
  indexedArtifacts.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join(""),
);
const evidenceIndexVerification = {
  result: "PASS",
  phase: "FINAL",
  indexPath: STAGE5_FINAL11_EVIDENCE_INDEX,
  indexBytes: 1,
  indexSha256: "c".repeat(64),
  artifactCount: indexedArtifacts.length,
  artifactBytesManifest: indexedArtifacts,
  aggregateSerialization: STAGE5_FINAL11_EVIDENCE_AGGREGATE_SERIALIZATION,
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
  if (final10ArtifactByPath.has(filePath)) return final10ArtifactByPath.get(filePath);
  if (filePath === STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT) {
    return { path: filePath, bytes: 38123, sha256: STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 };
  }
  if (filePath === STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT)
    return { path: filePath, ...sourceReview };
  if (filePath === STAGE5_FINAL11_CORRECTION_MATRIX) return { path: filePath, ...correctionMatrix };
  if (filePath === STAGE5_FINAL11_EVIDENCE_INDEX) {
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
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_CORRECTION_MATRIX,
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
