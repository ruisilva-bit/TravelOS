import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";
import { verifyStage5CurrentCandidateFreeze } from "./stage-5-current-candidate-freeze.mjs";
import { verifyStage5CurrentEvidenceIndex } from "./stage-5-current-evidence-index.mjs";
import { scanStage5CurrentSource } from "./scan-stage-5-current-source.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Not a regular file: ${file}`);
  return readFile(file);
};
export const assertStage5CurrentScanProvenance = (manifest, report) => {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.result, "PASS");
  assert.equal(report.phase, "FINAL_CANDIDATE");
  assert.equal(report.candidate, manifest.candidate);
  assert.equal(report.stage6Actions, 0);
  assert.equal(report.findingCount, 0);
  assert(Array.isArray(report.files));
  assert.equal(report.sourceCount, report.files.length);
  const paths = report.files.map(({ path: file }) => file);
  assert.deepEqual(
    paths,
    paths.toSorted((left, right) => left.localeCompare(right)),
  );
  assert.equal(new Set(paths).size, paths.length);
  for (const required of [
    manifest.finalization.validation,
    manifest.finalization.freeze,
    `${manifest.evidenceDirectory}/EVIDENCE_INDEX.json`,
  ]) {
    assert(paths.includes(required), `Final-candidate scan omits ${required}`);
    assert(!report.exclusions.includes(required), `Required scan input excluded: ${required}`);
  }
  assert(!paths.includes(manifest.finalization.scan), "Scan must exclude itself");
  assert(report.exclusions.includes(manifest.finalization.scan));
  const rows = report.files.map(({ path: file, bytes, sha256 }) => {
    assert(Number.isSafeInteger(bytes) && bytes > 0);
    assert.match(sha256, /^[a-f0-9]{64}$/u);
    return `${file}\t${bytes}\t${sha256}\n`;
  });
  assert.equal(report.scopeAggregateSha256, hash(Buffer.from(rows.join(""))));
};
export const verifyStage5CurrentScanProvenance = async ({ candidateRoot = root } = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readRegular(path.join(workspace, "tooling/ci/stage-5-current-candidate.json")),
    ),
  );
  const index = await verifyStage5CurrentEvidenceIndex({ candidateRoot: workspace });
  assert.equal(index.phase, "FINAL");
  const freeze = await verifyStage5CurrentCandidateFreeze({ candidateRoot: workspace });
  const bytes = await readRegular(path.join(workspace, manifest.finalization.scan));
  const report = JSON.parse(bytes);
  assertStage5CurrentScanProvenance(manifest, report);
  const live = await scanStage5CurrentSource({
    candidateRoot: workspace,
    phase: "FINAL_CANDIDATE",
    write: false,
  });
  assert.equal(live.reportPath, manifest.finalization.scan);
  assert.equal(live.reportSha256, hash(bytes), "Final scan is stale or its scope has changed");
  for (const required of [
    manifest.finalization.validation,
    manifest.finalization.freeze,
    `${manifest.evidenceDirectory}/EVIDENCE_INDEX.json`,
  ]) {
    const row = report.files.find((entry) => entry.path === required);
    assert.equal(row.sha256, hash(await readRegular(path.join(workspace, required))));
  }
  return {
    result: "PASS",
    candidate: manifest.candidate,
    indexSha256: index.indexSha256,
    freezeSha256: freeze.sha256,
    scanSha256: hash(bytes),
    sourceCount: report.sourceCount,
    scopeAggregateSha256: report.scopeAggregateSha256,
    stage6Actions: 0,
  };
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await verifyStage5CurrentScanProvenance(), null, 2)}\n`);
}
