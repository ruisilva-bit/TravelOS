import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createStage5Final14ScanProvenance } from "./stage-5-final14-scan-provenance.mjs";
import {
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CANDIDATE_VALIDATION,
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL14_EVIDENCE_INDEX,
  STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT,
} from "./stage-5-candidate-contract.mjs";
import { STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION } from "./stage-5-scan-provenance.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = [
  {
    path: "docs/evidence/phase-1-m1/stage-5-final-14/readiness-preflight.json",
    bytes: 19,
    sha256: "a".repeat(64),
  },
  { path: STAGE5_FINAL14_EVIDENCE_INDEX, bytes: 37, sha256: "b".repeat(64) },
  { path: STAGE5_FINAL14_CORRECTION_MATRIX, bytes: 43, sha256: "c".repeat(64) },
  { path: STAGE5_FINAL14_CANDIDATE_VALIDATION, bytes: 47, sha256: "d".repeat(64) },
  { path: STAGE5_FINAL14_CANDIDATE_FREEZE, bytes: 53, sha256: "e".repeat(64) },
].toSorted((left, right) => left.path.localeCompare(right.path));
const aggregate = hash(
  Buffer.from(files.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join("")),
);
const indexFile = files.find((entry) => entry.path === STAGE5_FINAL14_EVIDENCE_INDEX);
const indexedArtifact = files.find((entry) => entry.path.endsWith("/readiness-preflight.json"));
assert(indexFile && indexedArtifact);
const base = {
  phase: "FINAL_CANDIDATE",
  sourceScopeFiles: files.map((entry) => entry.path),
  scanReport: {
    result: "PASS",
    findings: [],
    filesScanned: files.map((entry) => entry.path),
    fileManifest: files,
    scopeSerialization: STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION,
    scopeAggregateSha256: aggregate,
  },
  findingLineage: {
    result: "PASS",
    candidate: "FINAL-14",
    totalFindingCount: 49,
    authorClosedCount: 0,
    independentPendingCount: 49,
    stage6Actions: 0,
  },
  evidenceIndexVerification: {
    result: "PASS",
    indexPath: STAGE5_FINAL14_EVIDENCE_INDEX,
    phase: "FINAL",
    aggregateSerialization: STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION,
    artifactCount: 1,
    matched: 1,
    artifactBytesManifest: [indexedArtifact],
    missing: [],
    unexpected: [],
    hashMismatches: [],
    sizeMismatches: [],
    indexBytes: indexFile.bytes,
    indexSha256: indexFile.sha256,
    recomputedAggregateSha256: "f".repeat(64),
  },
};
const provenance = createStage5Final14ScanProvenance(base);
assert.equal(provenance.candidate, "FINAL-14");
assert.equal(provenance.filesScanned, files.length);
assert.equal(provenance.validationIncluded, true);
assert.equal(provenance.freezeIncluded, true);
assert.equal(provenance.postFreezeScanReportPath, STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT);
assert.equal(provenance.postFreezeScanReportExcludedFromScope, true);
assert.equal(provenance.stage6Actions, 0);
assert.equal(provenance.matchedValuesEmitted, false);
assert.equal(provenance.scopeFileManifest.length, files.length);
assert.equal(provenance.scopeSerialization, STAGE5_FINAL_SCAN_SCOPE_SERIALIZATION);
assert.equal(STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION.includes("newline-terminated"), true);
assert.throws(
  () =>
    createStage5Final14ScanProvenance({
      ...base,
      scanReport: { ...base.scanReport, filesScanned: base.scanReport.filesScanned.slice(0, -1) },
    }),
  /exact collected paths/u,
);
assert.throws(
  () =>
    createStage5Final14ScanProvenance({
      ...base,
      evidenceIndexVerification: { ...base.evidenceIndexVerification, phase: "PRE_CI" },
    }),
  /true/u,
);
process.stdout.write(
  `${JSON.stringify({ result: "PASS", candidate: "FINAL-14", filesScanned: provenance.filesScanned })}\n`,
);
