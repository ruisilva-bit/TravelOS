import assert from "node:assert/strict";

import {
  collectStage5SourceFiles,
  STAGE5_REQUIRED_SOURCE_PATHS,
  validateStage5SourceCoverage,
} from "./stage-5-source-scope.mjs";

const report = await collectStage5SourceFiles({ requireEvidence: true });
assert.equal(report.result, "PASS");
assert.ok(report.files.length > 100);
assert.ok(report.stage5EvidenceIndexes.length > 0);

const omittedSourcePath = STAGE5_REQUIRED_SOURCE_PATHS[0];
assert.ok(omittedSourcePath);
const omission = validateStage5SourceCoverage(
  report.files.filter((filePath) => filePath !== omittedSourcePath),
  {
    requireEvidence: true,
    expectedStage5EvidenceIndexes: report.stage5EvidenceIndexes,
  },
);
assert.equal(omission.result, "FAIL");
assert.ok(omission.failedRequirementIds.includes(`required:${omittedSourcePath}`));

const omittedEvidenceIndex = report.stage5EvidenceIndexes[0];
assert.ok(omittedEvidenceIndex);
const evidenceOmission = validateStage5SourceCoverage(
  report.files.filter((filePath) => filePath !== omittedEvidenceIndex),
  {
    requireEvidence: true,
    expectedStage5EvidenceIndexes: report.stage5EvidenceIndexes,
  },
);
assert.equal(evidenceOmission.result, "FAIL");
assert.ok(
  evidenceOmission.failedRequirementIds.includes(
    `stage5-evidence-index-missing:${omittedEvidenceIndex}`,
  ),
);

const evidenceOmissionMatrix = report.stage5EvidenceIndexes.map((omittedIndex) => {
  const result = validateStage5SourceCoverage(
    report.files.filter((filePath) => filePath !== omittedIndex),
    {
      requireEvidence: true,
      expectedStage5EvidenceIndexes: report.stage5EvidenceIndexes,
    },
  );
  assert.equal(result.result, "FAIL");
  assert.ok(result.missingStage5EvidenceIndexes.includes(omittedIndex));
  return { omittedIndex, result: result.result, missing: result.missingStage5EvidenceIndexes };
});

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      filesScanned: report.files.length,
      coverage: report.coverage,
      omissionProbe: {
        omittedSourcePath,
        result: omission.result,
      },
      evidenceOmissionProbe: {
        omittedEvidenceIndex,
        result: evidenceOmission.result,
        matrix: evidenceOmissionMatrix,
      },
    },
    null,
    2,
  ),
);
