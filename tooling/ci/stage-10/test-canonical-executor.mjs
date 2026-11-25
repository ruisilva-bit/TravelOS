import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { executeSequence } from "./canonical-sequence.mjs";
import { _runBoundedProcess } from "./gate-process.mjs";
import { GATES } from "./gates.mjs";
import { inspectClaim } from "./one-shot.mjs";
import { verifyCiReceipt } from "./receipt.mjs";
import { sha256 } from "./io.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(process.env.TMPDIR, "canonical-sequence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const inputDigest = "a".repeat(64);
const realProcess =
  (code) =>
  ({ label, root, outputDirectory }) =>
    _runBoundedProcess({
      label,
      root,
      outputDirectory,
      command: process.execPath,
      args: ["-e", code],
      environment: { PATH: "/usr/bin:/bin" },
      timeout: 3000,
      outputLimit: 1024,
    });
test("sequential subprocess results produce verifier-compatible receipt and consume input once", async (t) => {
  const root = await fixture(t);
  const ledger = path.join(root, "ledger");
  let checks = 0;
  const options = {
    root,
    ledger,
    inputDigest,
    candidate: "gen01",
    gates: GATES,
    run: (args) => {
      assert.equal(args.candidate, "gen01", "sequence must propagate the claimed candidate");
      return realProcess("console.log('ok')")(args);
    },
    verify: async () => {
      checks++;
    },
  };
  const result = await executeSequence(options);
  assert.equal(checks, GATES.length * 2 + 1);
  const directory = result.claimDirectory;
  const receiptBytes = await readFile(path.join(directory, "receipt.json"));
  const verified = verifyCiReceipt({
    inputDigest,
    claimBytes: await readFile(path.join(directory, "claim.json")),
    receiptBytes,
    logBytes: await readFile(path.join(directory, "ci.log")),
    expectedReceiptSha256: sha256(receiptBytes),
  });
  assert.equal(verified.result, "STRUCTURE_ONLY_NOT_CANONICAL_ACCEPTANCE");
  assert.equal((await inspectClaim(ledger, inputDigest)).state, "PASSED_CONSUMED");
  await assert.rejects(executeSequence(options));
});
test("failure and input drift stop sequence and permanently consume claim", async (t) => {
  for (const drift of [false, true]) {
    const root = await fixture(t);
    const ledger = path.join(root, "ledger");
    let checks = 0,
      runs = 0;
    const run = realProcess(drift ? "process.exit(0)" : "process.exit(7)");
    const options = {
      root,
      ledger,
      inputDigest,
      candidate: "gen01",
      gates: GATES.slice(0, 2),
      run: async (args) => {
        runs++;
        return run(args);
      },
      verify: async () => {
        if (drift && ++checks === 2) throw new Error("drift");
      },
    };
    await assert.rejects(executeSequence(options));
    assert.equal(runs, 1);
    assert.equal((await inspectClaim(ledger, inputDigest)).state, "FAILED_CONSUMED");
    await assert.rejects(executeSequence(options));
  }
});
