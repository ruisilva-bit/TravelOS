import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { collectStage3FreezeInputs, STAGE_3_CANDIDATE_FREEZE } from "./stage-3-freeze-inputs.mjs";

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const collectionOptions = {
  mode: "FINAL_FREEZE",
  excludedOutputPaths: [STAGE_3_CANDIDATE_FREEZE],
};
const pass1 = await collectStage3FreezeInputs(collectionOptions);
const pass2 = await collectStage3FreezeInputs(collectionOptions);
assert.equal(pass1.finalFreezeEligible, true);
assert.equal(pass2.finalFreezeEligible, true);
assert.equal(pass1.entryCount, pass2.entryCount);
assert.equal(pass1.aggregateSha256, pass2.aggregateSha256);
assert.deepEqual(pass1.entries, pass2.entries);

const rows = pass1.entries.map(
  (entry, index) => `| ${index + 1} | \`${entry.path}\` | ${entry.bytes} | \`${entry.sha256}\` |`,
);
const content = `# TravelOS Phase 1 M1 — Stage 3 Candidate Freeze

- **Status:** Candidate frozen for independent non-authoring review
- **Scope:** Stage 3 PostgreSQL, migrations, roles, transaction foundation, final disposable evidence, and controlled CT 200 evidence
- **Excluded output (self-reference prevention):** \`${STAGE_3_CANDIDATE_FREEZE}\`
- **Stage 2 predecessor freeze:** \`docs/reviews/phase-1-m1/STAGE_2_CORRECTED_CANDIDATE_FREEZE_3.md\` — \`5f2e686c397e7bf9f81b455456e1088cb3c4a897e55e43cd1c09c83fde4ea122\`
- **Stage 2 independent closure:** \`docs/reviews/phase-1-m1/STAGE_2_FINAL_INDEPENDENT_CLOSURE.md\` — \`d4171545ee53a34791814d4cddf49080e06f5f0eab131954c3f8ed9baa13ef81\`
- **Entry count:** ${pass1.entryCount}
- **Aggregate algorithm:** \`${pass1.aggregateAlgorithm}\`
- **Deterministic aggregate:** \`${pass1.aggregateSha256}\`
- **Stage 4 actions:** 0

## Freeze contract

The two final collections were field-identical for ordered paths, byte sizes, SHA-256 values, and aggregate. This manifest excludes itself and the later independent closure report. Reviewers must verify every row before semantic review. Any later change to a listed byte invalidates this candidate and requires a new freeze; this document does not authorize Stage 4.

## Frozen entries

| # | Path | Bytes | SHA-256 |
|---:|---|---:|---|
${rows.join("\n")}
`;
await writeFile(STAGE_3_CANDIDATE_FREEZE, content, "utf8");

const writtenBytes = await readFile(STAGE_3_CANDIDATE_FREEZE);
const writtenText = writtenBytes.toString("utf8");
const parsedRows = [
  ...writtenText.matchAll(
    /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([a-f0-9]{64})`\s*\|$/gm,
  ),
].map((match) => ({
  sequence: Number(match[1]),
  path: match[2],
  bytes: Number(match[3]),
  sha256: match[4],
}));
assert.equal(parsedRows.length, pass1.entryCount);
assert.deepEqual(
  parsedRows.map(({ path: filePath, bytes, sha256: digest }) => ({
    path: filePath,
    bytes,
    sha256: digest,
  })),
  pass1.entries.map(({ path: filePath, bytes, sha256: digest }) => ({
    path: filePath,
    bytes,
    sha256: digest,
  })),
);
assert.equal(
  parsedRows.some((entry) => entry.path === STAGE_3_CANDIDATE_FREEZE),
  false,
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      deterministicFreezeEquality: true,
      pass1: {
        entryCount: pass1.entryCount,
        aggregateSha256: pass1.aggregateSha256,
      },
      pass2: {
        entryCount: pass2.entryCount,
        aggregateSha256: pass2.aggregateSha256,
      },
      freeze: {
        path: path.posix.normalize(STAGE_3_CANDIDATE_FREEZE),
        bytes: writtenBytes.length,
        sha256: sha256(writtenBytes),
        entryCount: parsedRows.length,
        aggregateSha256: pass1.aggregateSha256,
      },
    },
    null,
    2,
  ),
);
