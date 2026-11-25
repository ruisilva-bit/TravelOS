import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { digest } from "./io.mjs";
import { runStage8ArtifactRegression } from "./stage8-artifact-regression.mjs";

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

test("rejects mismatched artifact binding before running inherited assertions", async () => {
  await assert.rejects(
    runStage8ArtifactRegression({ ...options, expectedReceiptSha256: "0".repeat(64) }),
  );
});
test(
  "executes all sixteen inherited obligations against the qualified mutable artifact",
  { timeout: 240000 },
  async () => {
    const result = await runStage8ArtifactRegression(options);
    assert.deepEqual(
      [result.obligations, result.adapted, result.unchanged, result.skipped],
      [16, 2, 14, 0],
    );
    assert.equal(result.result, "PASS");
    console.log(result.stdout);
  },
);
