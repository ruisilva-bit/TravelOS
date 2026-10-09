import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  STAGE5_FINAL21_CANDIDATE_FREEZE,
  STAGE5_FINAL21_CANDIDATE_VALIDATION,
  STAGE5_FINAL21_CORRECTION_MATRIX,
  STAGE5_FINAL21_EVIDENCE_INDEX,
  STAGE5_FINAL21_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT,
} from "./stage-5-candidate-contract.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join("");

export const createStage5Final21ScanProvenance = ({
  phase,
  sourceScopeFiles,
  scanReport,
  findingLineage,
  evidenceIndexVerification,
}) => {
  assert(["FINAL_EVIDENCE", "FINAL_CANDIDATE"].includes(phase));
  assert.equal(scanReport?.result, "PASS");
  assert.deepEqual(scanReport.findings, []);
  assert(Array.isArray(sourceScopeFiles));
  assert(Array.isArray(scanReport.filesScanned));
  assert(Array.isArray(scanReport.fileManifest));
  assert.equal(
    scanReport.scopeSerialization,
    "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path",
  );
  const expected = [...sourceScopeFiles].toSorted((left, right) => left.localeCompare(right));
  assert.equal(new Set(expected).size, expected.length, "duplicate source-scope paths");
  assert.deepEqual(scanReport.filesScanned, expected, "scan did not consume exact collected paths");
  assert.deepEqual(
    scanReport.fileManifest.map((entry) => entry.path),
    expected,
    "scan byte manifest does not match collected source paths",
  );
  assert.equal(
    scanReport.scopeAggregateSha256,
    hash(Buffer.from(serialize(scanReport.fileManifest))),
  );
  assert.equal(evidenceIndexVerification?.result, "PASS");
  assert.equal(evidenceIndexVerification.indexPath, STAGE5_FINAL21_EVIDENCE_INDEX);
  assert.equal(
    evidenceIndexVerification.aggregateSerialization,
    STAGE5_FINAL21_EVIDENCE_AGGREGATE_SERIALIZATION,
  );
  assert.equal(evidenceIndexVerification.phase, phase === "FINAL_CANDIDATE" ? "FINAL" : "PRE_CI");
  assert.equal(findingLineage?.result, "PASS");
  assert.equal(findingLineage?.candidate, "FINAL-21");
  assert.equal(findingLineage?.findings.total, 49);
  assert.equal(findingLineage?.findings.authorClosed, 0);
  assert.equal(findingLineage?.findings.pendingIndependent, 49);
  assert.equal(findingLineage?.stage6Actions, 0);
  const scannedByPath = new Map(scanReport.fileManifest.map((entry) => [entry.path, entry]));
  const required = [STAGE5_FINAL21_EVIDENCE_INDEX, STAGE5_FINAL21_CORRECTION_MATRIX];
  if (phase === "FINAL_CANDIDATE")
    required.push(STAGE5_FINAL21_CANDIDATE_VALIDATION, STAGE5_FINAL21_CANDIDATE_FREEZE);
  for (const filePath of required)
    assert(scannedByPath.has(filePath), `scan is missing ${filePath}`);
  const indexed = evidenceIndexVerification.artifactBytesManifest ?? [];
  assert.equal(evidenceIndexVerification.artifactCount, indexed.length);
  assert.equal(evidenceIndexVerification.matched, indexed.length);
  assert.equal(evidenceIndexVerification.missing?.length, 0);
  assert.equal(evidenceIndexVerification.unexpected?.length, 0);
  assert.equal(evidenceIndexVerification.hashMismatches?.length, 0);
  assert.equal(evidenceIndexVerification.sizeMismatches?.length, 0);
  for (const row of indexed) {
    const scanned = scannedByPath.get(row.path);
    assert.equal(scanned?.bytes, row.bytes);
    assert.equal(scanned?.sha256, row.sha256);
  }
  const index = scannedByPath.get(STAGE5_FINAL21_EVIDENCE_INDEX);
  assert.equal(index?.bytes, evidenceIndexVerification.indexBytes);
  assert.equal(index?.sha256, evidenceIndexVerification.indexSha256);
  return {
    schemaVersion: 1,
    candidate: "FINAL-21",
    phase,
    scanner: "tooling/ci/scan-source-secrets.mjs",
    sourceScope:
      "FINAL-21 repository-owned source, indexed evidence and correction matrix; validation/freeze are mandatory in FINAL_CANDIDATE",
    filesScanned: expected.length,
    scopeSerialization: scanReport.scopeSerialization,
    scopeAggregateSha256: hash(Buffer.from(serialize(scanReport.fileManifest))),
    scopeFileManifest: scanReport.fileManifest,
    inputsMatchFailClosedCollector: true,
    evidenceIndex: {
      path: STAGE5_FINAL21_EVIDENCE_INDEX,
      phase: evidenceIndexVerification.phase,
      sha256: evidenceIndexVerification.indexSha256,
      aggregateSha256: evidenceIndexVerification.recomputedAggregateSha256,
      artifactCount: indexed.length,
    },
    correctionMatrix: {
      path: STAGE5_FINAL21_CORRECTION_MATRIX,
      sha256: scannedByPath.get(STAGE5_FINAL21_CORRECTION_MATRIX).sha256,
      findingCount: 49,
      authorClosedCount: 0,
      independentPendingCount: 49,
    },
    validationIncluded: scannedByPath.has(STAGE5_FINAL21_CANDIDATE_VALIDATION),
    freezeIncluded: scannedByPath.has(STAGE5_FINAL21_CANDIDATE_FREEZE),
    postFreezeScanReportPath: STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT,
    postFreezeScanReportExcludedFromScope: true,
    stage6Actions: 0,
    matchedValuesEmitted: false,
  };
};
