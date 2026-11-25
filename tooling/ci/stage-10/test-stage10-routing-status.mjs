import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

// Rehearsal must not accept arbitrary failure responses (particularly 500) as denial.
const source = await readFile(
  new URL("./stage10-runtime-api-postgres.mjs", import.meta.url),
  "utf8",
);
assert.match(
  source,
  /assert\.equal\(\s*\(await request\(p,\s*["']invalid\.travelos\.test["'],\s*["']\/health\/live["']\)\)\.status,\s*404/,
);
assert.match(source, /assert\.equal\(response\.status,\s*404/);
console.log("stage10 exact denial statuses: PASS");
