import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION } from "./stage-5-scan-provenance.mjs";
import {
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CANDIDATE_VALIDATION,
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_INDEX,
  STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT,
} from "./stage-5-candidate-contract.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const serializeManifest = (manifest) =>
  manifest.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join("");

export const createStage5Final14ScanProvenance = ({
  phase,
  sourceScopeFiles,
  scanReport,
  findingLineage,
  evidenceIndexVerification,
}) => {
  assert(
    ["FINAL_EVIDENCE", "FINAL_CANDIDATE"].includes(phase),
    `invalid FINAL-14 scan phase ${phase}`,
  );
  assert(
    scanReport?.result === "PASS" && scanReport.findings?.length === 0,
    "FINAL-14 source scan must pass with zero findings",
  );
  assert(
    Array.isArray(sourceScopeFiles) && Array.isArray(scanReport.filesScanned),
    "FINAL-14 scan source scope is missing",
  );
  assert(Array.isArray(scanReport.fileManifest), "FINAL-14 scan byte manifest is missing");
  assert.equal(scanReport.scopeSerialization, STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION);
  const expectedFiles = [...sourceScopeFiles].toSorted((left, right) => left.localeCompare(right));
  assert.equal(
    new Set(expectedFiles).size,
    expectedFiles.length,
    "FINAL-14 source collector returned duplicate paths",
  );
  assert.deepEqual(
    scanReport.filesScanned,
    expectedFiles,
    "FINAL-14 scan did not consume exact collected paths",
  );
  assert.deepEqual(
    scanReport.fileManifest.map((entry) => entry.path),
    expectedFiles,
  );
  assert.equal(scanReport.fileManifest.length, expectedFiles.length);
  assert.equal(
    scanReport.scopeAggregateSha256,
    hash(Buffer.from(serializeManifest(scanReport.fileManifest))),
  );
  assert.equal(evidenceIndexVerification?.result, "PASS");
  assert.equal(evidenceIndexVerification.indexPath, STAGE5_FINAL14_EVIDENCE_INDEX);
  assert.equal(
    evidenceIndexVerification.aggregateSerialization,
    STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION,
  );
  assert(["PRE_CI", "FINAL", "CI_FAILED"].includes(evidenceIndexVerification.phase));
  assert.equal(
    phase === "FINAL_CANDIDATE" ? evidenceIndexVerification.phase === "FINAL" : true,
    true,
  );
  assert.equal(findingLineage?.result, "PASS");
  assert.equal(findingLineage?.candidate, "FINAL-14");
  assert.equal(findingLineage?.totalFindingCount, 49);
  assert.equal(findingLineage?.authorClosedCount, 0);
  assert.equal(findingLineage?.independentPendingCount, 49);
  assert.equal(findingLineage?.stage6Actions, 0);
  const manifestByPath = new Map(scanReport.fileManifest.map((entry) => [entry.path, entry]));
  const expectedRequired = [STAGE5_FINAL14_EVIDENCE_INDEX, STAGE5_FINAL14_CORRECTION_MATRIX];
  if (phase === "FINAL_CANDIDATE") {
    expectedRequired.push(STAGE5_FINAL14_CANDIDATE_VALIDATION, STAGE5_FINAL14_CANDIDATE_FREEZE);
  }
  for (const relativePath of expectedRequired) {
    assert(manifestByPath.has(relativePath), `FINAL-14 scan is missing ${relativePath}`);
  }
  const indexed = evidenceIndexVerification.artifactBytesManifest ?? [];
  assert.equal(evidenceIndexVerification.artifactCount, indexed.length);
  assert.equal(evidenceIndexVerification.matched, indexed.length);
  assert.equal(evidenceIndexVerification.missing?.length, 0);
  assert.equal(evidenceIndexVerification.unexpected?.length, 0);
  assert.equal(evidenceIndexVerification.hashMismatches?.length, 0);
  assert.equal(evidenceIndexVerification.sizeMismatches?.length, 0);
  for (const row of indexed) {
    const scanned = manifestByPath.get(row.path);
    assert.equal(scanned?.bytes, row.bytes, `FINAL-14 scan/index byte mismatch: ${row.path}`);
    assert.equal(scanned?.sha256, row.sha256, `FINAL-14 scan/index SHA mismatch: ${row.path}`);
  }
  const evidenceIndex = manifestByPath.get(STAGE5_FINAL14_EVIDENCE_INDEX);
  assert.equal(evidenceIndex?.bytes, evidenceIndexVerification.indexBytes);
  assert.equal(evidenceIndex?.sha256, evidenceIndexVerification.indexSha256);
  return {
    schemaVersion: 1,
    candidate: "FINAL-14",
    phase,
    scanner: "tooling/ci/scan-source-secrets.mjs",
    sourceScope:
      "FINAL-14 current candidate; all Stage 5 evidence indexes, current correction matrix, and current validation/freeze when phase is FINAL_CANDIDATE",
    filesScanned: expectedFiles.length,
    scopeSerialization: STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION,
    scopeAggregateSha256: hash(Buffer.from(serializeManifest(scanReport.fileManifest))),
    scopeFileManifest: scanReport.fileManifest,
    inputsMatchFailClosedCollector: true,
    evidenceIndex: {
      path: STAGE5_FINAL14_EVIDENCE_INDEX,
      phase: evidenceIndexVerification.phase,
      sha256: evidenceIndexVerification.indexSha256,
      aggregateSha256: evidenceIndexVerification.recomputedAggregateSha256,
      artifactCount: indexed.length,
    },
    correctionMatrix: {
      path: STAGE5_FINAL14_CORRECTION_MATRIX,
      sha256: manifestByPath.get(STAGE5_FINAL14_CORRECTION_MATRIX).sha256,
      findingCount: findingLineage.totalFindingCount,
      authorClosedCount: findingLineage.authorClosedCount,
      independentPendingCount: findingLineage.independentPendingCount,
    },
    validationIncluded: manifestByPath.has(STAGE5_FINAL14_CANDIDATE_VALIDATION),
    freezeIncluded: manifestByPath.has(STAGE5_FINAL14_CANDIDATE_FREEZE),
    postFreezeScanReportPath: STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT,
    postFreezeScanReportExcludedFromScope: true,
    selfReferencePrevention:
      "FINAL-14 post-freeze report is written only after scan completion and resides outside the Stage 5 evidence-directory collector scope",
    stage6Actions: 0,
    matchedValuesEmitted: false,
  };
};
