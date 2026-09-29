import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import {
  collectStage4FreezeInputs,
  STAGE_3_PREDECESSOR_CLOSURE,
  STAGE_3_PREDECESSOR_CLOSURE_SHA256,
  STAGE_3_PREDECESSOR_FREEZE,
  STAGE_3_PREDECESSOR_FREEZE_SHA256,
  STAGE_4_CANDIDATE_FREEZE,
  STAGE_4_HISTORICAL_REJECTED_FREEZE,
  STAGE_4_HISTORICAL_REJECTED_FREEZE_SHA256,
} from "./stage-4-freeze-inputs.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const collectionOptions = {
  mode: "FINAL_FREEZE",
  excludedOutputPaths: [STAGE_4_CANDIDATE_FREEZE],
};
const pass1 = await collectStage4FreezeInputs(collectionOptions);
const pass2 = await collectStage4FreezeInputs(collectionOptions);
assert.equal(pass1.finalFreezeEligible, true);
assert.equal(pass2.finalFreezeEligible, true);
assert.equal(pass1.entryCount, pass2.entryCount);
assert.equal(pass1.aggregateSha256, pass2.aggregateSha256);
assert.deepEqual(pass1.entries, pass2.entries);

const rows = pass1.entries.map(
  (entry, index) => `| ${index + 1} | \`${entry.path}\` | ${entry.bytes} | \`${entry.sha256}\` |`,
);
const content = `# TravelOS Phase 1 M1 — Stage 4 Corrected Candidate Freeze

- **Status:** Corrected candidate frozen for independent non-authoring review
- **Scope:** Stage 4 Better Auth realm integration, root Agency/Staff authorization foundation, and corrective hardening after the first independent review
- **Historical rejected freeze:** \`${STAGE_4_HISTORICAL_REJECTED_FREEZE}\` — \`${STAGE_4_HISTORICAL_REJECTED_FREEZE_SHA256}\`
- **Accepted predecessor freeze:** \`${STAGE_3_PREDECESSOR_FREEZE}\` — \`${STAGE_3_PREDECESSOR_FREEZE_SHA256}\`
- **Accepted predecessor closure:** \`${STAGE_3_PREDECESSOR_CLOSURE}\` — \`${STAGE_3_PREDECESSOR_CLOSURE_SHA256}\`
- **Excluded output (self-reference prevention):** \`${STAGE_4_CANDIDATE_FREEZE}\`
- **Excluded later review/closure:** \`docs/reviews/phase-1-m1/STAGE_4_INDEPENDENT_REVIEW.json\`, \`docs/reviews/phase-1-m1/STAGE_4_INDEPENDENT_CLOSURE.md\`
- **Entry count:** ${pass1.entryCount}
- **Aggregate algorithm:** \`${pass1.aggregateAlgorithm}\`
- **Deterministic aggregate:** \`${pass1.aggregateSha256}\`
- **Production actions:** 0

## Freeze contract

Two strict final collections were field-identical for ordered paths, byte sizes, SHA-256 values, categories, and aggregate. The historical rejected Stage 4 freeze remains unchanged; the accepted Stage 3 predecessor is integrity-pinned. The Stage 4 evidence index passed exact verification before this freeze. This manifest excludes itself and later independent review/closure outputs. Reviewers must verify every row before semantic review. Any change to a listed byte requires a new corrected Stage 4 candidate freeze.

## Frozen entries

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
${rows.join("\n")}
`;
await writeFile(STAGE_4_CANDIDATE_FREEZE, content, "utf8");

const writtenBytes = await readFile(STAGE_4_CANDIDATE_FREEZE);
const parsedRows = [
  ...writtenBytes
    .toString("utf8")
    .matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([a-f0-9]{64})`\s*\|$/gm),
].map((match) => ({
  sequence: Number(match[1]),
  path: match[2],
  bytes: Number(match[3]),
  sha256: match[4],
}));
assert.equal(parsedRows.length, pass1.entryCount);
assert.deepEqual(
  parsedRows.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest })),
  pass1.entries.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest })),
);
assert.equal(
  parsedRows.some((entry) => entry.path === STAGE_4_CANDIDATE_FREEZE),
  false,
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      deterministicFreezeEquality: true,
      pass1: { entryCount: pass1.entryCount, aggregateSha256: pass1.aggregateSha256 },
      pass2: { entryCount: pass2.entryCount, aggregateSha256: pass2.aggregateSha256 },
      freeze: {
        path: STAGE_4_CANDIDATE_FREEZE,
        bytes: writtenBytes.length,
        sha256: sha256(writtenBytes),
        entryCount: parsedRows.length,
        aggregateSha256: pass1.aggregateSha256,
      },
      productionActions: 0,
    },
    null,
    2,
  ),
);
