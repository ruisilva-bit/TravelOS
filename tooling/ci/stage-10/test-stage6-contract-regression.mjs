import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import { digest } from "./io.mjs";
import { runStage6ContractRegression } from "./stage6-contract-regression.mjs";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const state = JSON.parse(
  await readFile(path.join(root, ".hermes/state/stage10-latest-mutable-package.json")),
);
const inputs = JSON.parse(await readFile(path.join(state.payload, "provenance/inputs.json")));
const receipt = JSON.parse(await readFile(path.join(state.temporary, "artifact-receipt.json")));
const options = {
  root,
  payload: state.payload,
  archive: path.join(state.temporary, "artifact.tar.gz"),
  receipt,
  expectedReceiptSha256: digest(receipt),
  inputs,
  expectedNodeSha256: inputs.runtimeNodeSha256,
};
test("rejects incorrect Stage 10 artifact binding before historical execution", async () => {
  await assert.rejects(
    runStage6ContractRegression({ ...options, expectedReceiptSha256: "0".repeat(64) }),
  );
});
test(
  "preserves Stage 6 fixture assertions and separately qualifies real Stage 10 contract",
  { timeout: 240000 },
  async () => {
    const outputDirectory = await mkdtemp(
      path.join(root, ".hermes/state/stage10-stage6-contract-"),
    );
    const result = await runStage6ContractRegression({ ...options, outputDirectory });
    assert.equal(result.result, "PASS");
    assert.equal(result.historicalAssertions, 8);
    await writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify(result)}\n`);
    console.log(JSON.stringify({ outputDirectory, ...result }));
  },
);
