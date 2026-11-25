import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  assertDigest,
  exclusiveBytes,
  jsonBytes,
  privateDirectory,
  regularBytes,
  syncDirectory,
} from "./io.mjs";

const location = (ledger, inputDigest) => {
  assertDigest(inputDigest);
  return path.join(path.resolve(ledger), inputDigest);
};
export const claimOnce = async (ledger, inputDigest, record) => {
  const directory = location(ledger, inputDigest);
  await privateDirectory(ledger);
  // mkdir is the consuming operation. Even a crash before claim.json is durable
  // leaves a consumed attempt. Never repair, delete, overwrite or resume it.
  await mkdir(directory, { mode: 0o700 });
  await syncDirectory(ledger);
  const claim = {
    schemaVersion: 1,
    inputDigest,
    record,
    invocationCount: 1,
    startedAtUtc: new Date().toISOString(),
    state: "CLAIMED_CONSUMED",
  };
  await exclusiveBytes(path.join(directory, "claim.json"), jsonBytes(claim));
  return { directory, claim };
};
export const finishOnce = async (ledger, inputDigest, receipt) => {
  assert.ok(["PASS", "FAIL", "INTERRUPTED"].includes(receipt.result), "Invalid one-shot outcome");
  const directory = location(ledger, inputDigest);
  const claim = JSON.parse(await regularBytes(path.join(directory, "claim.json")));
  assert.equal(claim.inputDigest, inputDigest);
  const result = {
    schemaVersion: 1,
    inputDigest,
    receipt,
    completedAtUtc: new Date().toISOString(),
  };
  await exclusiveBytes(path.join(directory, "outcome.json"), jsonBytes(result));
  return result;
};
export const inspectClaim = async (ledger, inputDigest) => {
  const directory = location(ledger, inputDigest);
  let claim;
  try {
    claim = JSON.parse(await regularBytes(path.join(directory, "claim.json")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // Validate the directory separately: absent is UNUSED; incomplete is consumed.
    const { lstat } = await import("node:fs/promises");
    try {
      await lstat(directory);
      return { state: "INTERRUPTED_CONSUMED" };
    } catch (missing) {
      if (missing.code === "ENOENT") return { state: "UNUSED" };
      throw missing;
    }
  }
  assert.equal(claim.inputDigest, inputDigest);
  try {
    const outcome = JSON.parse(await regularBytes(path.join(directory, "outcome.json")));
    assert.equal(outcome.inputDigest, inputDigest);
    assert.ok(["PASS", "FAIL", "INTERRUPTED"].includes(outcome.receipt.result));
    return {
      state:
        outcome.receipt.result === "PASS"
          ? "PASSED_CONSUMED"
          : outcome.receipt.result === "FAIL"
            ? "FAILED_CONSUMED"
            : "INTERRUPTED_CONSUMED",
      claim,
      outcome,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { state: "INTERRUPTED_OR_RUNNING_CONSUMED", claim };
  }
};
