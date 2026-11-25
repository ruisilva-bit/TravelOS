import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCandidateAdapter, GATES } from "./gates.mjs";
import * as adapter from "./inherited-compatibility-adapter.mjs";

test("both Stage 6 contract labels select the candidate-bound historical fixture regression", () => {
  assert.equal(typeof adapter.isStage6ContractGate, "function");
  for (const label of ["stage6-contract", "stage6-contract-tests"]) {
    assert.equal(hasCandidateAdapter(label), true);
    assert.equal(adapter.isStage6ContractGate(label), true);
  }
  assert.equal(adapter.isStage6ContractGate("stage6-bootstrap"), false);
  assert.equal(GATES.length, 60);
  assert.equal(new Set(GATES.map(({ label }) => label)).size, 60);
});
