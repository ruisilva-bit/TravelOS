import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import {
  collectStage3CorrectedFreezeInputs,
  STAGE_3_CORRECTED_CANDIDATE_FREEZE,
  STAGE_3_HISTORICAL_REJECTED_FREEZE,
  STAGE_3_HISTORICAL_REJECTED_FREEZE_SHA256,
} from "./stage-3-corrected-freeze-inputs.mjs";

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const collectionOptions = {
  mode: "FINAL_FREEZE",
  excludedOutputPaths: [STAGE_3_CORRECTED_CANDIDATE_FREEZE],
};
const pass1 = await collectStage3CorrectedFreezeInputs(collectionOptions);
const pass2 = await collectStage3CorrectedFreezeInputs(collectionOptions);
assert.equal(pass1.finalFreezeEligible, true);
assert.equal(pass2.finalFreezeEligible, true);
assert.equal(pass1.entryCount, pass2.entryCount);
assert.equal(pass1.aggregateSha256, pass2.aggregateSha256);
assert.deepEqual(pass1.entries, pass2.entries);

const rows = pass1.entries.map(
  (entry, index) => `| ${index + 1} | \`${entry.path}\` | ${entry.bytes} | \`${entry.sha256}\` |`,
);
const content = `# TravelOS Phase 1 M1 — Stage 3 Corrected Candidate Freeze

- **Status:** Corrected candidate frozen for independent non-authoring closure review
- **Scope:** Stage 3 PostgreSQL foundation plus corrections for TOS-S3-001 and TOS-S3-002; Stage 4 excluded
- **Historical rejected freeze:** \`${STAGE_3_HISTORICAL_REJECTED_FREEZE}\` — \`${STAGE_3_HISTORICAL_REJECTED_FREEZE_SHA256}\`
- **Excluded output (self-reference prevention):** \`${STAGE_3_CORRECTED_CANDIDATE_FREEZE}\`
- **Excluded later closure:** \`docs/reviews/phase-1-m1/STAGE_3_CORRECTED_INDEPENDENT_CLOSURE.md\`
- **Entry count:** ${pass1.entryCount}
- **Aggregate algorithm:** \`${pass1.aggregateAlgorithm}\`
- **Deterministic aggregate:** \`${pass1.aggregateSha256}\`
- **Stage 4 actions:** 0

## Freeze contract

Two strict final collections were field-identical for ordered paths, byte sizes, SHA-256 values, categories, and aggregate. The historical rejected freeze remains unchanged and is included as evidence of the correction lineage. This manifest excludes itself and the later independent closure. Reviewers must verify every row before semantic review. Any change to a listed byte requires a new corrected freeze.

## Frozen entries

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
${rows.join("\n")}
`;
await writeFile(STAGE_3_CORRECTED_CANDIDATE_FREEZE, content, "utf8");

const writtenBytes = await readFile(STAGE_3_CORRECTED_CANDIDATE_FREEZE);
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
  parsedRows.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
  pass1.entries.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
);
assert.equal(
  parsedRows.some((entry) => entry.path === STAGE_3_CORRECTED_CANDIDATE_FREEZE),
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
        path: STAGE_3_CORRECTED_CANDIDATE_FREEZE,
        bytes: writtenBytes.length,
        sha256: sha256(writtenBytes),
        entryCount: parsedRows.length,
        aggregateSha256: pass1.aggregateSha256,
      },
      historicalRejectedFreezePreserved: true,
      stage4Actions: 0,
    },
    null,
    2,
  ),
);
