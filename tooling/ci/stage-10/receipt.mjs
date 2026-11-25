import assert from "node:assert/strict";
import { STAGE } from "./constants.mjs";
import { GATES } from "./gates.mjs";
import { assertDigest, jsonBytes, sha256 } from "./io.mjs";

export const RESULT_MARKER = "=== TRAVELOS_STAGE10_CANONICAL_CI_RESULT ===\n";
// A consistency check over independently pinned receipt bytes, never a signature
// check or proof that declared commands ran. No receipt producer exists yet.
export const verifyCiReceipt = ({
  inputDigest,
  claimBytes,
  receiptBytes,
  logBytes,
  expectedReceiptSha256,
}) => {
  assertDigest(inputDigest);
  assertDigest(expectedReceiptSha256);
  assert.equal(
    sha256(receiptBytes),
    expectedReceiptSha256,
    "CI receipt independent digest mismatch",
  );
  const receipt = JSON.parse(receiptBytes);
  assert.deepEqual(receiptBytes, jsonBytes(receipt), "Noncanonical CI receipt serialization");
  assert.equal(receipt.stage, STAGE);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.inputDigest, inputDigest, "CI receipt input drift");
  assert.equal(receipt.invocationCount, 1);
  assert.equal(receipt.claimSha256, sha256(claimBytes), "CI claim digest mismatch");
  const claim = JSON.parse(claimBytes);
  assert.equal(claim.inputDigest, inputDigest, "CI claim input drift");
  assert.equal(claim.invocationCount, 1);
  assert.equal(claim.state, "CLAIMED_CONSUMED");
  assert.equal(receipt.logBytes, logBytes.length, "CI log byte count mismatch");
  assert.equal(receipt.logSha256, sha256(logBytes), "CI log digest mismatch");
  assert.deepEqual(
    receipt.gates.map((gate) => gate.label),
    GATES.map((gate) => gate.label),
    "CI gate coverage/order mismatch",
  );
  for (const gate of receipt.gates) {
    assert.equal(gate.result, "PASS", `CI gate failed: ${gate.label}`);
    assert.equal(gate.exitCode, 0, `CI gate exit nonzero: ${gate.label}`);
  }
  const text = logBytes.toString("utf8");
  assert.equal(text.split(RESULT_MARKER).length, 2, "Missing or duplicate CI completion marker");
  const marker = JSON.parse(text.split(RESULT_MARKER)[1]);
  assert.deepEqual(marker, receipt.finalMarker, "CI completion marker differs from receipt");
  assert.deepEqual(
    marker,
    { stage: STAGE, result: "PASS", inputDigest, completedGateCount: GATES.length },
    "Incomplete CI marker",
  );
  assert.equal(receipt.stage11Actions, 0);
  // Deliberately do not propagate any caller-written trust/privacy acceptance.
  return {
    result: "STRUCTURE_ONLY_NOT_CANONICAL_ACCEPTANCE",
    inputDigest,
    expectedReceiptSha256,
    trust: "PENDING",
    privacy: "PENDING",
  };
};
