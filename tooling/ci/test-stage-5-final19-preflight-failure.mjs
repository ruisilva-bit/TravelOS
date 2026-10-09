import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const receiptPath = ".hermes/state/stage5-final19-preflight-failure-01.json";
const expectedReceiptSha256 = "89664dd1c8a3538ca16badd6b3d1d8e25a40dab4192f00fefa076bc2b625d009";
const bytes = await readFile(path.join(root, receiptPath));
assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedReceiptSha256);
const receipt = JSON.parse(bytes.toString("utf8"));
assert.equal(receipt.candidate, "FINAL-19");
assert.equal(receipt.result, "REJECTED_PRE_CI_EVIDENCE_INDEX_INCOMPLETE");
assert.equal(receipt.evidenceIndex?.created, false);
assert.equal(receipt.ciVerifyInvoked, false);
assert.equal(receipt.ciVerifyInvocationCount, 0);
assert.equal(receipt.authorizedCiConsumed, false);
assert.equal(receipt.preCiFreezeGuardCreated, false);
assert.equal(receipt.stage6Actions, 0);
assert.equal(
  receipt.failure?.missingArtifact,
  "docs/evidence/phase-1-m1/stage-5-final-19/migration-checksums.json",
);
await assert.rejects(
  lstat(path.join(root, "docs/evidence/phase-1-m1/stage-5-final-19/EVIDENCE_INDEX.json")),
  { code: "ENOENT" },
);
process.stdout.write(
  `${JSON.stringify({ result: "PASS", candidate: "FINAL-19", preservedFailureReceiptSha256: expectedReceiptSha256, ciInvocations: 0, stage6Actions: 0 }, null, 2)}\n`,
);
