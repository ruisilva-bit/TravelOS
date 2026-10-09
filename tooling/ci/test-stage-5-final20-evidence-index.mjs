import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { verifyStage5Final20EvidenceIndex } from "./stage-5-final20-evidence-index.mjs";
import { STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256 } from "./stage-5-candidate-contract.mjs";

const phase = process.argv.includes("--pre-ci") ? "PRE_CI" : "FINAL";
const result = await verifyStage5Final20EvidenceIndex({
  root: process.cwd(),
  allowedPhases: [phase],
  requiredPhase: phase,
});
assert.equal(result.result, "PASS");
assert.equal(result.candidate, "FINAL-20");
assert.equal(result.artifactCount, result.matched);
assert.equal(result.missing.length, 0);
assert.equal(result.unexpected.length, 0);
assert.equal(result.duplicates.length, 0);
assert.equal(result.hashMismatches.length, 0);
assert.equal(result.sizeMismatches.length, 0);
assert.equal(
  result.predecessorFailureReceiptSha256,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
);
assert.equal(
  createHash("sha256")
    .update(await readFile(".hermes/state/stage5-final19-preflight-failure-01.json"))
    .digest("hex"),
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
);
assert.equal(result.stage6Actions, 0);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
