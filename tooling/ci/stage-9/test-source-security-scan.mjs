import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

let scanner;
try {
  scanner = await import("./source-security-scan.mjs");
} catch {
  scanner = undefined;
}

test("Stage 9 scanner exposes exact candidate scanning and collection", () => {
  assert.equal(typeof scanner?.scanStage9SensitiveFiles, "function");
  assert.equal(typeof scanner?.collectStage9CandidateFiles, "function");
});

test("only exact reviewed findings are allowed and matched text is not returned", async (context) => {
  if (typeof scanner?.scanStage9SensitiveFiles !== "function") {
    context.skip("Stage 9 scanner is not implemented yet");
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-sensitive-scan-"));
  const file = "apps/admin-web/src/api.ts";
  const filePath = path.join(root, file);
  const synthetic = ["same", "origin"].join("-");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    const lines = [
      ...Array.from({ length: 81 }, () => "safe"),
      `credentials: "${synthetic}"`,
      ...Array.from({ length: 39 }, () => "safe"),
      `credentials: "${synthetic}"`,
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");

    const reviewed = await scanner.scanStage9SensitiveFiles({ root, files: [file] });
    assert.equal(reviewed.result, "PASS");
    assert.equal(reviewed.allowlistedFindingCount, 2);
    assert.equal(JSON.stringify(reviewed).includes(synthetic), false);

    lines.push(`credentials: "${synthetic}"`);
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
    const unreviewed = await scanner.scanStage9SensitiveFiles({ root, files: [file] });
    assert.equal(unreviewed.result, "FAIL");
    assert.deepEqual(unreviewed.findings, [{ file, rule: "secret-assignment", line: 122 }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate collection is anchored to the Stage 8 predecessor and excludes local evidence", async (context) => {
  if (typeof scanner?.collectStage9CandidateFiles !== "function") {
    context.skip("Stage 9 candidate collection is not implemented yet");
    return;
  }

  const files = await scanner.collectStage9CandidateFiles();
  assert.ok(files.includes("apps/admin-web/src/app.tsx"));
  assert.ok(files.includes("apps/admin-api/test/static-web.test.ts"));
  assert.ok(files.every((file) => !file.startsWith(".hermes/")));
});

test("the complete Stage 9 candidate source has no unreviewed sensitive findings", async () => {
  const files = await scanner.collectStage9CandidateFiles();
  const report = await scanner.scanStage9SensitiveFiles({ files });

  assert.equal(report.result, "PASS");
  assert.equal(report.findingCount, 0);
  assert.ok(report.allowlistedFindingCount > 0);
});
