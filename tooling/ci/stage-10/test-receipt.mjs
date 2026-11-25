import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import { GATES } from "./gates.mjs";
const bytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const load = async () => {
  const url = new URL("./receipt.mjs", import.meta.url);
  assert.ok(existsSync(url), "Stage 10 receipt verifier missing");
  return import(url);
};
const fixture = () => {
  const inputDigest = "a".repeat(64);
  const claimBytes = bytes({
    schemaVersion: 1,
    inputDigest,
    state: "CLAIMED_CONSUMED",
    invocationCount: 1,
  });
  const marker = {
    stage: "PHASE_1_M1_STAGE_10",
    result: "PASS",
    inputDigest,
    completedGateCount: GATES.length,
  };
  const logBytes = Buffer.from(
    `SYNTHETIC UNIT FIXTURE — NOT CANONICAL CI\n=== TRAVELOS_STAGE10_CANONICAL_CI_RESULT ===\n${bytes(marker)}`,
  );
  const receipt = {
    schemaVersion: 1,
    stage: "PHASE_1_M1_STAGE_10",
    result: "PASS",
    inputDigest,
    claimSha256: hash(claimBytes),
    logBytes: logBytes.length,
    logSha256: hash(logBytes),
    gates: GATES.map((gate) => ({ label: gate.label, result: "PASS", exitCode: 0 })),
    finalMarker: marker,
    invocationCount: 1,
    trust: "PENDING",
    privacy: "PENDING",
    stage11Actions: 0,
  };
  return {
    inputDigest,
    claimBytes,
    logBytes,
    receiptBytes: bytes(receipt),
    expectedReceiptSha256: hash(bytes(receipt)),
  };
};
test("CI receipt checks structure only and never turns pending trust/privacy into acceptance", async () => {
  const { verifyCiReceipt } = await load();
  const input = fixture();
  const result = verifyCiReceipt(input);
  assert.equal(result.result, "STRUCTURE_ONLY_NOT_CANONICAL_ACCEPTANCE");
  assert.equal(result.trust, "PENDING");
  assert.equal(result.privacy, "PENDING");
});
test("CI receipt rejects different log, claim, pinned receipt and missing cumulative gate", async () => {
  const { verifyCiReceipt } = await load();
  const input = fixture();
  assert.throws(() => verifyCiReceipt({ ...input, logBytes: Buffer.from("tampered") }), /log/i);
  assert.throws(() => verifyCiReceipt({ ...input, claimBytes: Buffer.from("{}") }), /claim/i);
  assert.throws(
    () => verifyCiReceipt({ ...input, expectedReceiptSha256: "f".repeat(64) }),
    /receipt/i,
  );
  const receipt = JSON.parse(input.receiptBytes);
  receipt.gates.pop();
  const receiptBytes = bytes(receipt);
  assert.throws(
    () => verifyCiReceipt({ ...input, receiptBytes, expectedReceiptSha256: hash(receiptBytes) }),
    /gate/i,
  );
});
test("CI receipt rejects source/input drift, nonzero command and absent completion marker", async () => {
  const { verifyCiReceipt } = await load();
  const input = fixture();
  assert.throws(() => verifyCiReceipt({ ...input, inputDigest: "c".repeat(64) }), /input/i);
  const receipt = JSON.parse(input.receiptBytes);
  receipt.gates[0].exitCode = 1;
  let receiptBytes = bytes(receipt);
  assert.throws(
    () => verifyCiReceipt({ ...input, receiptBytes, expectedReceiptSha256: hash(receiptBytes) }),
    /gate/i,
  );
  const other = JSON.parse(input.receiptBytes);
  const logBytes = Buffer.from("SYNTHETIC incomplete log\n");
  other.logBytes = logBytes.length;
  other.logSha256 = hash(logBytes);
  receiptBytes = bytes(other);
  assert.throws(
    () =>
      verifyCiReceipt({
        ...input,
        logBytes,
        receiptBytes,
        expectedReceiptSha256: hash(receiptBytes),
      }),
    /marker/i,
  );
});
