import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { STAGE_3_CANDIDATE_FREEZE } from "./stage-3-freeze-inputs.mjs";

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const freezeBytes = await readFile(STAGE_3_CANDIDATE_FREEZE);
const freezeText = freezeBytes.toString("utf8");
const declaredCountMatch = freezeText.match(/^- \*\*Entry count:\*\* (\d+)$/m);
const declaredAggregateMatch = freezeText.match(
  /^- \*\*Deterministic aggregate:\*\* `([a-f0-9]{64})`$/m,
);
if (!declaredCountMatch || !declaredAggregateMatch) {
  throw new Error("Stage 3 freeze declarations could not be parsed");
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
const selfReferenceRows = rows.filter((entry) => entry.path === STAGE_3_CANDIDATE_FREEZE);
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
const sequenceValid = rows.every((entry, index) => entry.sequence === index + 1);
const extraRows = Math.max(0, rows.length - declaredCount);
const result =
  declaredCount === rows.length &&
  matched === declaredCount &&
  missing.length === 0 &&
  mismatches.length === 0 &&
  duplicatePaths.length === 0 &&
  invalidPaths.length === 0 &&
  selfReferenceRows.length === 0 &&
  extraRows === 0 &&
  sequenceValid &&
  recomputedAggregateSha256 === declaredAggregateSha256
    ? "PASS"
    : "FAIL";
const report = {
  schemaVersion: 1,
  result,
  freezePath: STAGE_3_CANDIDATE_FREEZE,
  freezeBytes: freezeBytes.length,
  freezeSha256: sha256(freezeBytes),
  declaredCount,
  parsedCount: rows.length,
  matched,
  missing,
  mismatches,
  duplicatePaths: sortedUnique(duplicatePaths),
  invalidPaths: sortedUnique(invalidPaths),
  extraRows,
  selfReferenceRows: selfReferenceRows.length,
  sequenceValid,
  declaredAggregateSha256,
  recomputedAggregateSha256,
};
console.log(JSON.stringify(report, null, 2));
if (result !== "PASS") process.exit(1);

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
