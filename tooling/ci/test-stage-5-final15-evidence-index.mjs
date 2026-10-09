import assert from "node:assert/strict";

import {
  STAGE5_FINAL14_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL15_SECURITY_EXTENSION_PROTECTED_PATHS,
  STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final15EvidenceIndex } from "./stage-5-final15-evidence-index.mjs";
import { verifyStage5Final15FindingLineage } from "./stage-5-final15-finding-lineage.mjs";
import { verifyStage5Final15SecurityExtensionBaseline } from "./verify-stage-5-final15-security-extension-baseline.mjs";

const index = await verifyStage5Final15EvidenceIndex({ requiredPhase: "PRE_CI" });
assert.equal(index.result, "PASS");
assert.equal(index.phase, "PRE_CI");
assert.equal(index.artifactCount, STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length);
assert.deepEqual(index.missing, []);
assert.deepEqual(index.unexpected, []);
assert.deepEqual(index.duplicates, []);
assert.deepEqual(index.hashMismatches, []);
assert.deepEqual(index.sizeMismatches, []);
assert.equal(index.stage6Actions, 0);
const lineage = await verifyStage5Final15FindingLineage();
assert.equal(lineage.result, "PASS");
assert.equal(lineage.totalFindingCount, 49);
assert.equal(lineage.authorClosedCount, undefined);
assert.equal(lineage.stage6Actions, 0);
const baseline = await verifyStage5Final15SecurityExtensionBaseline();
assert.equal(baseline.result, "PASS");
assert.equal(baseline.previousBaselineSha256, STAGE5_FINAL14_SECURITY_BASELINE_SHA256);
assert.equal(baseline.protectedPathCount, STAGE5_FINAL15_SECURITY_EXTENSION_PROTECTED_PATHS.length);
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-15",
      indexSha256: index.indexSha256,
      aggregateSha256: index.aggregateSha256,
      artifactCount: index.artifactCount,
      findingCount: lineage.totalFindingCount,
      baselineSha256: baseline.baselineSha256,
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
