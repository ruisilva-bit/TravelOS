import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { reconcileReviewAdjudication } from "./stage-5-review-reconciliation.mjs";

const report = JSON.parse(
  await readFile(
    "docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_INDEPENDENT_REVIEW_NO_GO.json",
    "utf8",
  ),
);
const matrix = JSON.parse(
  await readFile("docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CORRECTION_MATRIX.json", "utf8"),
);
const findingIds = [
  ...matrix.carriedFindings.map((finding) => finding.id),
  ...matrix.independentReviewFindings.map((finding) => finding.id),
];
const reconciliation = reconcileReviewAdjudication(findingIds, report.findingAdjudication);
assert.equal(reconciliation.uniqueFindingCount, 49);
assert.deepEqual(reconciliation.sourceReportedCounts, {
  evidenceSupportedCorrection: 6,
  open: 5,
  unverified: 38,
});
assert.deepEqual(reconciliation.sourceListedCounts, {
  evidenceSupportedCorrection: 6,
  open: 5,
  unverified: 39,
});
assert.deepEqual(reconciliation.sourceOverlapIds, ["S5F7-AUTH-CACHE-001"]);
assert.deepEqual(reconciliation.normalizedCounts, {
  evidenceSupportedCorrection: 6,
  open: 5,
  unverified: 38,
});
assert.equal(reconciliation.normalizedCategoriesAreDisjoint, true);
assert.equal(reconciliation.allFindingsClassified, true);
process.stdout.write(`${JSON.stringify(reconciliation, null, 2)}\n`);
