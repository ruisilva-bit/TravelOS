import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { captureSource } from "./candidate.mjs";
import { scanFrozenSource } from "./source-scan-adapter.mjs";

const fixture = async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "stage10-source-scan-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  await writeFile(path.join(root, "safe.txt"), "ordinary content\n");
  return root;
};

test("scans every captured source byte and returns non-authoritative scope", async (context) => {
  const root = await fixture(context);
  const source = await captureSource(root);
  const report = await scanFrozenSource({ root, source });
  assert.equal(report.result, "PASS");
  assert.equal(report.authority, "LOCAL_SCAN_ONLY_NOT_PRIVACY_REVIEW");
  assert.deepEqual(report.files, source.files);
  assert.equal(report.findings.length, 0);
});

test("reports unreviewed synthetic finding without revealing its value", async (context) => {
  const root = await fixture(context);
  const sensitive = ["person", "example.com"].join("@");
  await writeFile(path.join(root, "safe.txt"), sensitive);
  const report = await scanFrozenSource({ root, source: await captureSource(root) });
  assert.equal(report.result, "FAIL");
  assert.deepEqual(report.findings, [{ file: "safe.txt", rule: "email-address", line: 1 }]);
  assert.equal(JSON.stringify(report).includes(sensitive), false);
});

test("rejects stale frozen scope including additional untracked files", async (context) => {
  const root = await fixture(context);
  const source = await captureSource(root);
  await writeFile(path.join(root, "new.txt"), "extra\n");
  await assert.rejects(scanFrozenSource({ root, source }), /source drift/i);
});

test("rejects changed bytes and fabricated subset", async (context) => {
  const root = await fixture(context);
  const source = await captureSource(root);
  await writeFile(path.join(root, "safe.txt"), "different\n");
  await assert.rejects(scanFrozenSource({ root, source }), /source drift/i);
  const current = await captureSource(root);
  await assert.rejects(
    scanFrozenSource({ root, source: { ...current, files: [] } }),
    /source drift/i,
  );
});
