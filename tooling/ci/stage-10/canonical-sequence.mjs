import assert from "node:assert/strict";
import path from "node:path";
import { STAGE } from "./constants.mjs";
import { exclusiveBytes, jsonBytes, regularBytes, sha256 } from "./io.mjs";
import { claimOnce, finishOnce } from "./one-shot.mjs";
import { RESULT_MARKER } from "./receipt.mjs";

// Internal trusted composition seam. Never expose these arguments through the CLI
// or canonical entry point; callers must perform all preflight before invoking it.
export async function executeSequence({
  root,
  ledger,
  inputDigest,
  candidate,
  gates,
  run,
  verify,
}) {
  const claim = await claimOnce(ledger, inputDigest, { operation: "CANONICAL_CI_ONCE", candidate });
  const records = [];
  try {
    const outputDirectory = path.join(claim.directory, "gates");
    for (const gate of gates) {
      await verify();
      const record = await run({ label: gate.label, root, outputDirectory, candidate });
      assert.equal(record.label, gate.label, "Gate label mismatch");
      records.push({ ...record, result: record.status });
      assert.equal(record.status, "PASS", `Gate failed: ${gate.label}`);
      assert.equal(record.exitCode, 0, `Gate exit nonzero: ${gate.label}`);
      assert.equal(record.signal, null, `Gate interrupted: ${gate.label}`);
      assert.equal(record.spawnError, null, `Gate spawn failed: ${gate.label}`);
      await verify();
    }
    await verify();
    const finalMarker = {
      stage: STAGE,
      result: "PASS",
      inputDigest,
      completedGateCount: gates.length,
    };
    // Only bounded metadata is placed in the aggregate log. Raw output remains
    // in the gate files, so process output cannot forge a final marker.
    const log = Buffer.from(
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n${RESULT_MARKER}${JSON.stringify(finalMarker)}\n`,
    );
    const claimBytes = await regularBytes(path.join(claim.directory, "claim.json"));
    const receipt = {
      stage: STAGE,
      result: "PASS",
      inputDigest,
      invocationCount: 1,
      claimSha256: sha256(claimBytes),
      logBytes: log.length,
      logSha256: sha256(log),
      gates: records,
      finalMarker,
      stage11Actions: 0,
    };
    await exclusiveBytes(path.join(claim.directory, "ci.log"), log);
    await exclusiveBytes(path.join(claim.directory, "receipt.json"), jsonBytes(receipt));
    await finishOnce(ledger, inputDigest, {
      result: "PASS",
      receiptSha256: sha256(jsonBytes(receipt)),
    });
    return { receipt, claimDirectory: claim.directory };
  } catch (error) {
    await finishOnce(ledger, inputDigest, {
      result: "FAIL",
      code: "CANONICAL_CI_FAILED_PRESERVE_PARTIAL_OUTPUT",
      gates: records,
    });
    throw error;
  }
}
