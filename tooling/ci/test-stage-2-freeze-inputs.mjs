import assert from "node:assert/strict";

import {
  collectStage2FreezeInputs,
  validateStage2FreezeInputEntries,
} from "./stage-2-freeze-inputs.mjs";

const report = await collectStage2FreezeInputs({ mode: "PRE_FINAL" });
const repeatedReport = await collectStage2FreezeInputs({ mode: "PRE_FINAL" });
assert.equal(report.result, "PASS");
assert.equal(report.mode, "PRE_FINAL");
assert.equal(report.finalFreezeCreated, false);
assert.equal(report.finalFreezeEligible, false);
assert.deepEqual(report.preFinalAllowedMissingPaths, [
  "docs/evidence/phase-1-m1/stage-2/EVIDENCE_INDEX.json",
  "docs/reviews/phase-1-m1/STAGE_2_CORRECTED_CANDIDATE_VALIDATION.md",
]);
assert.equal(report.completeness.result, "PASS");
const workspacePackageManifests = report.completeness.requirements.find(
  (item) => item.id === "workspace-package-manifests",
);
assert.equal(workspacePackageManifests.matchedPaths.length, 15);
assert.ok(workspacePackageManifests.matchedPaths.includes("packages/migrator/package.json"));
assert.deepEqual(repeatedReport.entries, report.entries);
assert.equal(repeatedReport.aggregateSha256, report.aggregateSha256);
assert.ok(report.entryCount > 200);
assert.ok(
  report.entries.some((entry) => entry.path === "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md"),
);
assert.ok(
  report.entries.some(
    (entry) => entry.path === "docs/reviews/phase-1-m1/STAGE_2_REVIEW_CORRECTIONS.md",
  ),
);
assert.ok(
  report.entries.some((entry) => entry.path.startsWith("docs/evidence/phase-1-m1/stage-2/")),
);
assert.ok(
  !report.entries.some(
    (entry) => entry.path === "docs/reviews/phase-1-m1/STAGE_2_CORRECTED_CANDIDATE_VALIDATION.md",
  ),
);
assert.ok(
  !report.entries.some(
    (entry) => entry.path === "docs/evidence/phase-1-m1/stage-2/EVIDENCE_INDEX.json",
  ),
);

const requiredBaselinePaths = report.completeness.requirements.find(
  (item) => item.id === "phase-0-baseline-content",
).matchedPaths;
const omittedPath = "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md";
const omissionResult = validateStage2FreezeInputEntries({
  entries: report.entries.filter((entry) => entry.path !== omittedPath),
  requiredBaselinePaths,
});
assert.equal(omissionResult.result, "FAIL");
assert.ok(omissionResult.failedRequirementIds.includes(`required:${omittedPath}`));

const finalModeResult = validateStage2FreezeInputEntries({
  entries: report.entries,
  requiredBaselinePaths,
});
assert.equal(finalModeResult.result, "FAIL");
assert.ok(finalModeResult.failedRequirementIds.includes("stage-2-evidence-index"));
assert.ok(finalModeResult.failedRequirementIds.includes("stage-2-corrected-validation"));

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
        failedRequirementIds: finalModeResult.failedRequirementIds,
      },
      omissionProbe: {
        omittedPath,
        result: "REJECTED_AS_EXPECTED",
        intendedRequirement: `required:${omittedPath}`,
      },
    },
    null,
    2,
  ),
);
