import assert from "node:assert/strict";

import { STAGE5_FINAL17_EXPECTED_EVIDENCE_ARTIFACT_NAMES } from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final17EvidenceIndex } from "./stage-5-final17-evidence-index.mjs";
import { verifyStage5Final17FindingLineage } from "./stage-5-final17-finding-lineage.mjs";

const index = await verifyStage5Final17EvidenceIndex({ requiredPhase: "FINAL" });
assert.equal(index.result, "PASS");
assert.equal(index.phase, "FINAL");
assert.equal(index.artifactCount, STAGE5_FINAL17_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length);
assert.deepEqual(index.missing, []);
assert.deepEqual(index.unexpected, []);
assert.deepEqual(index.duplicates, []);
assert.deepEqual(index.hashMismatches, []);
assert.deepEqual(index.sizeMismatches, []);
assert.equal(index.stage6Actions, 0);
const lineage = await verifyStage5Final17FindingLineage();
assert.equal(lineage.result, "PASS");
assert.equal(lineage.totalFindingCount, 49);
assert.equal(lineage.authorClosedCount, 0);
assert.equal(lineage.independentPendingCount, 49);
assert.equal(lineage.stage6Actions, 0);
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-17 historical evidence",
      indexSha256: index.indexSha256,
      aggregateSha256: index.aggregateSha256,
      artifactCount: index.artifactCount,
      findingCount: lineage.totalFindingCount,
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
