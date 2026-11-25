import assert from "node:assert/strict";
import test from "node:test";
import { ACCEPTED_STAGE7, assertStage7Lineage } from "./successor-baseline.mjs";
test("accepts only the exact accepted Stage 7 tag and ancestry", () => {
  assertStage7Lineage(ACCEPTED_STAGE7.commit, 0);
  assert.throws(() => assertStage7Lineage("0".repeat(40), 0), /tag moved/);
  assert.throws(() => assertStage7Lineage(ACCEPTED_STAGE7.commit, 1), /must precede/);
});
