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

test("Stage 8 scanner exposes its candidate file scan", () => {
  assert.equal(typeof scanner?.scanStage8SensitiveFiles, "function");
});

test("only exact reviewed findings are allowed and matched text is not returned", async (context) => {
  if (typeof scanner?.scanStage8SensitiveFiles !== "function") {
    context.skip("Stage 8 scanner is not implemented yet");
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage8-sensitive-scan-"));
  const file = "apps/admin-api/test/correlation.test.ts";
  const filePath = path.join(root, file);
  const synthetic = ["private", "example.test"].join("@");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    const lines = [...Array.from({ length: 16 }, () => "safe"), synthetic];
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");

    const reviewed = await scanner.scanStage8SensitiveFiles({ root, files: [file] });
    assert.equal(reviewed.result, "PASS");
    assert.equal(reviewed.allowlistedFindingCount, 1);
    assert.equal(JSON.stringify(reviewed).includes(synthetic), false);

    lines.push(synthetic);
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
    const unreviewed = await scanner.scanStage8SensitiveFiles({ root, files: [file] });
    assert.equal(unreviewed.result, "FAIL");
    assert.deepEqual(unreviewed.findings, [{ file, rule: "email-address", line: 18 }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
