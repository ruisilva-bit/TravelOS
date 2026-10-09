import assert from "node:assert/strict";

import { verifyStage5Final14EvidenceIndex } from "./stage-5-final14-evidence-index.mjs";
import { STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES } from "./stage-5-candidate-contract.mjs";

const result = await verifyStage5Final14EvidenceIndex({
  allowedPhases: ["FINAL"],
  requiredPhase: "FINAL",
});
assert.equal(result.result, "PASS");
assert.equal(result.candidate, "FINAL-14");
assert.equal(result.phase, "FINAL");
assert.equal(result.artifactCount, STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length);
assert.equal(result.matched, result.artifactCount);
assert.deepEqual(result.missing, []);
assert.deepEqual(result.unexpected, []);
assert.deepEqual(result.hashMismatches, []);
assert.equal(result.stage6Actions, 0);
process.stdout.write(
  `${JSON.stringify({ result: "PASS", phase: result.phase, artifacts: result.artifactCount, indexSha256: result.indexSha256 })}\n`,
);
