import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import manifest from "./stage-5-current-candidate.json" with { type: "json" };
import { verifyStage5FreezeScanBoundary } from "./stage-5-current-candidate-freeze.mjs";
import { assertStage5CurrentScanProvenance } from "./stage-5-current-scan-provenance.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const required = [
  `${manifest.evidenceDirectory}/EVIDENCE_INDEX.json`,
  manifest.finalization.freeze,
  manifest.finalization.validation,
].toSorted((left, right) => left.localeCompare(right));
const files = required.map((path) => ({ path, bytes: 10, sha256: hash(Buffer.from(path)) }));
const fixture = {
  schemaVersion: 1,
  result: "PASS",
  phase: "FINAL_CANDIDATE",
  candidate: manifest.candidate,
  stage6Actions: 0,
  sourceCount: files.length,
  findingCount: 0,
  files,
  exclusions: [manifest.finalization.scan],
  scopeAggregateSha256: hash(
    Buffer.from(files.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("")),
  ),
};
assertStage5CurrentScanProvenance(manifest, fixture);
for (const missing of required) {
  const tampered = globalThis.structuredClone(fixture);
  tampered.files = tampered.files.filter((row) => row.path !== missing);
  tampered.sourceCount = tampered.files.length;
  assert.throws(() => assertStage5CurrentScanProvenance(manifest, tampered));
}
for (const alteration of [
  (report) => {
    report.phase = "FINAL";
  },
  (report) => {
    report.files[0].sha256 = "0".repeat(64);
  },
  (report) => {
    report.files.push(report.files[0]);
    report.sourceCount += 1;
  },
  (report) => {
    report.exclusions.push(manifest.finalization.freeze);
  },
  (report) => {
    report.files.push({ path: manifest.finalization.scan, bytes: 10, sha256: "a".repeat(64) });
    report.sourceCount += 1;
  },
]) {
  const tampered = globalThis.structuredClone(fixture);
  alteration(tampered);
  assert.throws(() => assertStage5CurrentScanProvenance(manifest, tampered));
}
const workspace = await mkdtemp(path.join(os.tmpdir(), "stage5-scan-boundary-"));
try {
  const scanPath = "scan.json";
  const sourceFiles = ["validation.md", "freeze.json"];
  const boundary = (requireScan, files = sourceFiles) =>
    verifyStage5FreezeScanBoundary({ workspace, sourceFiles: files, scanPath, requireScan });
  await boundary(false);
  await assert.rejects(boundary(true), { code: "ENOENT" });
  await writeFile(path.join(workspace, scanPath), "{}\n");
  await boundary(true);
  await assert.rejects(boundary(false), { code: "ERR_ASSERTION" });
  await assert.rejects(boundary(true, [...sourceFiles, scanPath]), {
    code: "ERR_ASSERTION",
  });
} finally {
  await rm(workspace, { recursive: true, force: true });
}
process.stdout.write(
  `${JSON.stringify({ result: "PASS", candidate: manifest.candidate, adversarialCases: 11, stage6Actions: 0 })}\n`,
);
