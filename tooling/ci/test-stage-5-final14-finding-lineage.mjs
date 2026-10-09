import assert from "node:assert/strict";

import { verifyStage5Final14FindingLineage } from "./stage-5-final14-finding-lineage.mjs";

const result = await verifyStage5Final14FindingLineage();
assert.equal(result.result, "PASS");
assert.equal(result.candidate, "FINAL-14");
assert.equal(result.totalFindingCount, 49);
assert.equal(result.authorClosedCount, 0);
assert.equal(result.independentPendingCount, 49);
assert.equal(result.predecessorReview, "NO-GO_PRESERVED");
assert.equal(result.final13.ciExecutionSha256.length, 64);
assert.equal(result.final13.invocationGuardSha256.length, 64);
assert.equal(result.postgresQualification.integrationExecution.result, "PASS");
assert.equal(result.postgresQualification.disposableCleanup.result, "PASS");
assert.equal(result.stage6Actions, 0);
process.stdout.write(
  `${JSON.stringify({ result: "PASS", findingCount: result.totalFindingCount, authorClosed: result.authorClosedCount, stage6Actions: 0 })}\n`,
);
