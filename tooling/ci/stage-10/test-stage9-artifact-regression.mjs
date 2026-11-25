import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { digest } from "./io.mjs";
import { replaceExactly, runStage9ArtifactRegression } from "./stage9-artifact-regression.mjs";

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

test("rejects wrong artifact binding before inherited programs", async () => {
  await assert.rejects(
    runStage9ArtifactRegression({ ...options, expectedReceiptSha256: "0".repeat(64) }),
  );
});
test("rejects missing or duplicated transformation anchors", () => {
  assert.throws(() => replaceExactly("no anchor", "anchor!", "x"));
  assert.throws(() => replaceExactly("anchor anchor", "anchor", "x"));
});
test(
  "runs all historical successor obligations and real browser host",
  { timeout: 600000 },
  async () => {
    const report = await runStage9ArtifactRegression(options);
    assert.equal(report.result, "PASS");
    assert.equal(report.obligations, 51);
    assert.equal(report.skipped, 0);
    console.log(report.stdout);
  },
);
