import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseReviewedClassifications } from "./source-final-gate.mjs";

const base = "docs/reviews/phase-1-m1/stage-10/";
const markdown = await readFile(base + "SOURCE_FINDING_CLASSIFICATION.md", "utf8");
const inherited = await readFile(base + "INHERITED_SOURCE_FINDING_CLASSIFICATION.json");

test("preserves all exact reviewed findings including duplicate-rule lines", () => {
  const entries = parseReviewedClassifications(markdown, inherited);
  assert.equal(entries.length, 160);
  assert.equal(
    new Set(entries.map((entry) => JSON.stringify([entry.file, entry.line, entry.rule]))).size,
    160,
  );
});

test("rejects missing classifications instead of silently reducing scope", () => {
  const changed = markdown
    .split("\n")
    .filter((line) => !line.startsWith("| 19 |"))
    .join("\n");
  assert.throws(() => parseReviewedClassifications(changed, inherited), /count drift/);
});

test("rejects duplicate classifications with unchanged declared count", () => {
  const value = JSON.parse(inherited);
  value.findings[1] = value.findings[0];
  assert.throws(() => parseReviewedClassifications(markdown, Buffer.from(JSON.stringify(value))));
});
