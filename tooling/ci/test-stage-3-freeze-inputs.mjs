import assert from "node:assert/strict";

import {
  collectStage3FreezeInputs,
  STAGE_3_CANDIDATE_FREEZE,
  STAGE_3_CANDIDATE_VALIDATION,
  STAGE_3_EVIDENCE_INDEX,
  validateStage3FreezeInputEntries,
} from "./stage-3-freeze-inputs.mjs";

const options = {
  mode: "PRE_FINAL",
  excludedOutputPaths: [STAGE_3_CANDIDATE_FREEZE],
};
const report = await collectStage3FreezeInputs(options);
const repeatedReport = await collectStage3FreezeInputs(options);
assert.equal(report.result, "PASS");
assert.equal(report.mode, "PRE_FINAL");
assert.equal(report.finalFreezeCreated, false);
assert.equal(report.finalFreezeEligible, false);
assert.deepEqual(report.preFinalAllowedMissingPaths, [
  STAGE_3_EVIDENCE_INDEX,
  STAGE_3_CANDIDATE_VALIDATION,
]);
assert.equal(report.completeness.result, "PASS");
assert.deepEqual(repeatedReport.entries, report.entries);
assert.equal(repeatedReport.aggregateSha256, report.aggregateSha256);
assert.ok(report.entryCount > 250);
assert.ok(
  report.entries.some((entry) => entry.path === "deploy/database/bootstrap-database-and-roles.sql"),
);
assert.ok(report.entries.some((entry) => entry.path === "migrations/checksums.json"));
assert.ok(
  report.entries.some((entry) => entry.path === "tests/integration/stage-3-postgresql.test.ts"),
);
assert.equal(
  report.entries.filter((entry) =>
    entry.path.startsWith("docs/evidence/phase-1-m1/stage-3/ct-200-"),
  ).length,
  7,
);
assert.ok(!report.entries.some((entry) => entry.path === STAGE_3_EVIDENCE_INDEX));
assert.ok(!report.entries.some((entry) => entry.path === STAGE_3_CANDIDATE_VALIDATION));
assert.ok(!report.entries.some((entry) => entry.path === STAGE_3_CANDIDATE_FREEZE));

const finalModeProbe = validateStage3FreezeInputEntries({ entries: report.entries });
assert.equal(finalModeProbe.result, "FAIL");
assert.ok(finalModeProbe.failedRequirementIds.includes("stage-3-evidence-index"));
assert.ok(finalModeProbe.failedRequirementIds.includes("stage-3-candidate-validation"));

const omittedPath = "migrations/checksums.json";
const omissionProbe = validateStage3FreezeInputEntries({
  entries: report.entries.filter((entry) => entry.path !== omittedPath),
  requireEvidenceIndex: false,
  requireCandidateValidation: false,
});
assert.equal(omissionProbe.result, "FAIL");
assert.ok(omissionProbe.failedRequirementIds.includes("stage-3-migrations"));

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      mode: report.mode,
      finalFreezeCreated: false,
      finalFreezeEligible: false,
      deterministicRepeatedCollection: true,
      collectedInputs: report.entryCount,
      aggregateSha256: report.aggregateSha256,
      completenessRequirements: report.completeness.requirementCount,
      preFinalAllowedMissingPaths: report.preFinalAllowedMissingPaths,
      finalModeProbe: {
        result: "REJECTED_AS_EXPECTED",
        failedRequirementIds: finalModeProbe.failedRequirementIds,
      },
      omissionProbe: {
        omittedPath,
        result: "REJECTED_AS_EXPECTED",
        intendedRequirement: "stage-3-migrations",
      },
    },
    null,
    2,
  ),
);
