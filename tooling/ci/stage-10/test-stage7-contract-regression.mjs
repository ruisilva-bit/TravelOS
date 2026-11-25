import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { digest } from "./io.mjs";
import { runStage7ContractRegression, historicalPrefix } from "./stage7-contract-regression.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const state = JSON.parse(
  await readFile(path.join(root, ".hermes/state/stage10-latest-mutable-package.json"), "utf8"),
);
const inputs = JSON.parse(
  await readFile(path.join(state.payload, "provenance/inputs.json"), "utf8"),
);
const receipt = JSON.parse(
  await readFile(path.join(state.temporary, "artifact-receipt.json"), "utf8"),
);
const options = {
  root,
  payload: state.payload,
  archive: path.join(state.temporary, "artifact.tar.gz"),
  receipt,
  expectedReceiptSha256: digest(receipt),
  inputs,
  expectedNodeSha256: inputs.runtimeNodeSha256,
};

test("rejects altered historical prefix", async () => {
  const current = await readFile(path.join(root, "migrations/checksums.json"));
  const manifest = JSON.parse(current);
  manifest.migrations[0].sha256 = "0".repeat(64);
  await assert.rejects(
    historicalPrefix(root, Buffer.from(JSON.stringify(manifest))),
    /historical.*prefix/i,
  );
});
test("rejects wrong artifact binding", async () => {
  await assert.rejects(
    runStage7ContractRegression({ ...options, expectedReceiptSha256: "0".repeat(64) }),
  );
});
test(
  "executes every original Stage 7 assertion with qualified artifact",
  { timeout: 240000 },
  async () => {
    const result = await runStage7ContractRegression(options);
    assert.equal(result.result, "PASS");
    console.log(result.stdout.trim());
    assert.deepEqual(result.report, {
      result: "PASS",
      cases: 12,
      positiveCases: 3,
      negativeControls: 9,
    });
  },
);
