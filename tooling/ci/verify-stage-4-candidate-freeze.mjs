import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  collectStage4FreezeInputs,
  STAGE_3_PREDECESSOR_CLOSURE,
  STAGE_3_PREDECESSOR_CLOSURE_SHA256,
  STAGE_3_PREDECESSOR_FREEZE,
  STAGE_3_PREDECESSOR_FREEZE_SHA256,
  STAGE_4_CANDIDATE_FREEZE,
} from "./stage-4-freeze-inputs.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const freezeBytes = await readFile(STAGE_4_CANDIDATE_FREEZE);
const freezeText = freezeBytes.toString("utf8");
const declaredCountMatch = freezeText.match(/^- \*\*Entry count:\*\* (\d+)$/m);
const declaredAggregateMatch = freezeText.match(
  /^- \*\*Deterministic aggregate:\*\* `([a-f0-9]{64})`$/m,
);
if (!declaredCountMatch || !declaredAggregateMatch) {
  throw new Error("Stage 4 freeze declarations could not be parsed");
}
const declaredCount = Number(declaredCountMatch[1]);
const declaredAggregateSha256 = declaredAggregateMatch[1];
const rows = [
  ...freezeText.matchAll(
    /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([a-f0-9]{64})`\s*\|$/gm,
  ),
].map((match) => ({
  sequence: Number(match[1]),
  path: match[2],
  bytes: Number(match[3]),
  sha256: match[4],
}));
const duplicatePaths = rows
  .map((entry) => entry.path)
  .filter((filePath, index, paths) => paths.indexOf(filePath) !== index);
const invalidPaths = rows
  .map((entry) => entry.path)
  .filter(
    (filePath) =>
      filePath.length === 0 ||
      path.isAbsolute(filePath) ||
      filePath.split("/").some((segment) => segment === "" || segment === ".."),
  );
const selfReferenceRows = rows.filter((entry) => entry.path === STAGE_4_CANDIDATE_FREEZE);
const missing = [];
const mismatches = [];
let matched = 0;
for (const entry of rows) {
  try {
    const bytes = await readFile(entry.path);
    const actualSha256 = sha256(bytes);
    if (bytes.length !== entry.bytes || actualSha256 !== entry.sha256) {
      mismatches.push({
        path: entry.path,
        expectedBytes: entry.bytes,
        actualBytes: bytes.length,
        expectedSha256: entry.sha256,
        actualSha256,
      });
    } else {
      matched += 1;
    }
  } catch (error) {
    if (error?.code === "ENOENT") missing.push(entry.path);
    else throw error;
  }
}
const recomputedAggregateSha256 = sha256(
  rows.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n"),
);
const collection = await collectStage4FreezeInputs({
  mode: "FINAL_FREEZE",
  excludedOutputPaths: [STAGE_4_CANDIDATE_FREEZE],
});
const rowPaths = new Set(rows.map((entry) => entry.path));
const collectedPaths = new Set(collection.entries.map((entry) => entry.path));
const missingCollectorRows = collection.entries
  .map((entry) => entry.path)
  .filter((filePath) => !rowPaths.has(filePath));
const unexpectedRows = rows
  .map((entry) => entry.path)
  .filter((filePath) => !collectedPaths.has(filePath));
const sequenceValid = rows.every((entry, index) => entry.sequence === index + 1);
const predecessorFreezeBytes = await readFile(STAGE_3_PREDECESSOR_FREEZE);
const predecessorClosureBytes = await readFile(STAGE_3_PREDECESSOR_CLOSURE);
const predecessorIntegrity = {
  freeze: {
    path: STAGE_3_PREDECESSOR_FREEZE,
    actualSha256: sha256(predecessorFreezeBytes),
    expectedSha256: STAGE_3_PREDECESSOR_FREEZE_SHA256,
  },
  closure: {
    path: STAGE_3_PREDECESSOR_CLOSURE,
    actualSha256: sha256(predecessorClosureBytes),
    expectedSha256: STAGE_3_PREDECESSOR_CLOSURE_SHA256,
  },
};
const result =
  declaredCount === rows.length &&
  matched === declaredCount &&
  missing.length === 0 &&
  mismatches.length === 0 &&
  duplicatePaths.length === 0 &&
  invalidPaths.length === 0 &&
  selfReferenceRows.length === 0 &&
  missingCollectorRows.length === 0 &&
  unexpectedRows.length === 0 &&
  sequenceValid &&
  recomputedAggregateSha256 === declaredAggregateSha256 &&
  collection.entryCount === declaredCount &&
  collection.aggregateSha256 === declaredAggregateSha256 &&
  predecessorIntegrity.freeze.actualSha256 === predecessorIntegrity.freeze.expectedSha256 &&
  predecessorIntegrity.closure.actualSha256 === predecessorIntegrity.closure.expectedSha256
    ? "PASS"
    : "FAIL";
const report = {
  schemaVersion: 1,
  result,
  freezePath: STAGE_4_CANDIDATE_FREEZE,
  freezeBytes: freezeBytes.length,
  freezeSha256: sha256(freezeBytes),
  declaredCount,
  parsedCount: rows.length,
  matched,
  missing,
  mismatches,
  duplicatePaths: [...new Set(duplicatePaths)].toSorted(),
  invalidPaths: [...new Set(invalidPaths)].toSorted(),
  missingCollectorRows,
  unexpectedRows,
  selfReferenceRows: selfReferenceRows.length,
  sequenceValid,
  declaredAggregateSha256,
  recomputedAggregateSha256,
  collectorAggregateSha256: collection.aggregateSha256,
  evidenceVerification: collection.evidenceVerification,
  predecessorIntegrity,
};
console.log(JSON.stringify(report, null, 2));
if (result !== "PASS") process.exit(1);
