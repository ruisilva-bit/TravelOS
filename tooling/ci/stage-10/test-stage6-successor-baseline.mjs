import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import * as baseline from "./successor-baseline.mjs";
const root = fileURLToPath(new URL("../../..", import.meta.url));

test("Stage 6 successor requires its exact GO tag and Stage 9 ancestry", () => {
  assert.equal(typeof baseline.assertStage6Lineage, "function");
  const accepted = "6242e023953ccb8fe883bff97a0d62e64af8b66a";
  baseline.assertStage6Lineage(accepted, 0);
  assert.throws(() => baseline.assertStage6Lineage("0".repeat(40), 0), /tag moved/u);
  assert.throws(() => baseline.assertStage6Lineage(accepted, 1), /must precede/u);
});

test("reads and validates all accepted Stage 6 manifest blobs without historical checkout writes", async () => {
  assert.equal(typeof baseline.verifyAcceptedStage6Baseline, "function");
  const result = await baseline.verifyAcceptedStage6Baseline({ root });
  assert.equal(result.sourceCount, 61);
  assert.equal(
    result.sourceAggregateSha256,
    "a736add8226933ac9d2a78268357dd654d16322f722fe377cdb28bbd9a8cde6b",
  );
  assert.equal(result.acceptedStage6.commit, "6242e023953ccb8fe883bff97a0d62e64af8b66a");
  assert.equal(result.scope, "ACCEPTED_STAGE6_HISTORY_NOT_CURRENT_CANDIDATE_QUALIFICATION");
});
