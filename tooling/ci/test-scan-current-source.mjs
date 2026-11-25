import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateCurrentSource } from "./scan-current-source.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fixtureLine = 'const contact = "fixture@example.invalid";';

const withFixture = async (contents, run) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "travelos-current-scan-"));
  try {
    await writeFile(path.join(root, "sample.ts"), contents);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const classifiedEntry = {
  path: "sample.ts",
  rule: "email-address",
  lineSha256: sha256(fixtureLine),
  category: "SYNTHETIC_TEST_FIXTURE",
  rationale: "Reserved example domain.",
};

test("classified finding passes", async () => {
  await withFixture(`${fixtureLine}\n`, async (root) => {
    const outcome = await evaluateCurrentSource({
      root,
      files: ["sample.ts"],
      classifiedEntries: [classifiedEntry],
    });
    assert.equal(outcome.result, "PASS");
    assert.equal(outcome.classifiedFindingCount, 1);
  });
});

test("unclassified finding fails closed", async () => {
  await withFixture(`${fixtureLine}\n`, async (root) => {
    const outcome = await evaluateCurrentSource({
      root,
      files: ["sample.ts"],
      classifiedEntries: [],
    });
    assert.equal(outcome.result, "FAIL");
    assert.deepEqual(outcome.unclassified, [{ file: "sample.ts", line: 1, rule: "email-address" }]);
  });
});

test("an edited classified line is no longer covered", async () => {
  await withFixture('const contact = "other@example.invalid";\n', async (root) => {
    const outcome = await evaluateCurrentSource({
      root,
      files: ["sample.ts"],
      classifiedEntries: [classifiedEntry],
    });
    assert.equal(outcome.result, "FAIL");
    assert.equal(outcome.unclassified.length, 1);
    assert.deepEqual(outcome.stale, [{ file: "sample.ts", rule: "email-address" }]);
  });
});

test("stale classification fails so the allowlist stays exact", async () => {
  await withFixture("const clean = 1;\n", async (root) => {
    const outcome = await evaluateCurrentSource({
      root,
      files: ["sample.ts"],
      classifiedEntries: [classifiedEntry],
    });
    assert.equal(outcome.result, "FAIL");
    assert.equal(outcome.stale.length, 1);
  });
});
