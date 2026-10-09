import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";

const root = process.cwd();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baselineBytes = await readFile(
  path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY, "final18-security-extension-baseline.json"),
);
assert.equal(digest(baselineBytes), STAGE5_FINAL18_SECURITY_BASELINE_SHA256);
const baseline = JSON.parse(baselineBytes.toString("utf8"));
assert.equal(baseline.lineage.final18Generation.candidate, "FINAL-18");
assert.equal(baseline.lineage.final18Generation.stage6Actions, 0);
assert.equal(
  baseline.lineage.final18Generation.runnerSha256,
  "eddc8bb4efbb53247f2c4b4b73b8abbfa19a8b24b9371e23b5d673494478eda7",
);
assert.equal(baseline.lineage.rejectedFinal17Candidate.authorizationConsumed, true);
assert.equal(baseline.lineage.rejectedFinal17Candidate.authorizationTransferred, false);
const failureBytes = await readFile(path.join(root, STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT));
assert.equal(digest(failureBytes), STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256);
const failure = JSON.parse(failureBytes.toString("utf8"));
assert.equal(failure.candidate, "FINAL-18");
assert.equal(failure.ciVerifyInvoked, false);
assert.equal(failure.ciVerifyInvocationCount, 0);
assert.equal(failure.stage6Actions, 0);
process.stdout.write(
  `${JSON.stringify({ result: "PASS", candidate: "FINAL-18-HISTORICAL", baselineSha256: digest(baselineBytes), failureReceiptSha256: digest(failureBytes), ciVerifyInvoked: false, stage6Actions: 0 }, null, 2)}\n`,
);
