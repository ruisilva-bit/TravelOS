import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { digest } from "./io.mjs";
import { runStage7ArtifactRegression } from "./stage7-artifact-regression.mjs";

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

test("rejects wrong artifact binding", async () => {
  await assert.rejects(
    runStage7ArtifactRegression({ ...options, expectedReceiptSha256: "0".repeat(64) }),
  );
});
test(
  "qualifies current artifact and runs every unchanged historical suite",
  { timeout: 900000 },
  async () => {
    const result = await runStage7ArtifactRegression(options);
    assert.equal(result.result, "PASS");
    assert.equal(result.obligations, 67);
    assert.equal(result.skipped, 0);
    assert.deepEqual(
      result.reports.map(({ count }) => count),
      [16, 4, 26, 15, 6],
    );
    console.log(JSON.stringify(result));
  },
);
