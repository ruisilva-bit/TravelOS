import assert from "node:assert/strict";

import { STAGE5_FINAL18_EXPECTED_EVIDENCE_ARTIFACT_NAMES } from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final18EvidenceIndex } from "./stage-5-final18-evidence-index.mjs";
import { verifyStage5Final18FindingLineage } from "./stage-5-final18-finding-lineage.mjs";

const index = await verifyStage5Final18EvidenceIndex({
  allowedPhases: ["PRE_CI"],
  requiredPhase: "PRE_CI",
});
assert.equal(index.result, "PASS");
assert.equal(index.candidate, "FINAL-18");
assert.equal(index.phase, "PRE_CI");
assert.equal(index.artifactCount, STAGE5_FINAL18_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length);
assert.equal(index.matched, index.artifactCount);
assert.equal(index.stage6Actions, 0);
const lineage = await verifyStage5Final18FindingLineage();
assert.equal(lineage.result, "PASS");
assert.equal(lineage.findings.total, 49);
assert.equal(lineage.findings.authorClosed, 0);
assert.equal(lineage.findings.pendingIndependent, 49);
assert.equal(lineage.stage6Actions, 0);
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-18",
      phase: index.phase,
      indexSha256: index.indexSha256,
      aggregateSha256: index.aggregateSha256,
      artifactCount: index.artifactCount,
      findings: lineage.findings.total,
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
