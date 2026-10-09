import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";
import { verifyStage5CurrentEvidenceIndex } from "./stage-5-current-evidence-index.mjs";
import { collectStage5SourceFiles } from "./stage-5-source-scope.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const readRegular = async (file) => {
  const stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Not a regular file: ${file}`);
  return readFile(file);
};
const context = async (workspace) => {
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readRegular(path.join(workspace, "tooling/ci/stage-5-current-candidate.json")),
    ),
  );
  const index = await verifyStage5CurrentEvidenceIndex({ candidateRoot: workspace });
  assert.equal(index.phase, "FINAL", "A PASS CI index is required before freezing");
  return manifest;
};
const rowsFor = async (workspace, paths) => {
  const rows = [];
  for (const relativePath of paths) {
    const bytes = await readRegular(path.join(workspace, relativePath));
    rows.push({ path: relativePath, bytes: bytes.length, sha256: hash(bytes) });
  }
  return rows;
};
export const verifyStage5FreezeScanBoundary = async ({
  workspace,
  sourceFiles,
  scanPath,
  requireScan,
}) => {
  assert(!sourceFiles.includes(scanPath), "The active scan output must not scan itself");
  if (requireScan) {
    await readRegular(path.join(workspace, scanPath));
  } else {
    await assert.rejects(readRegular(path.join(workspace, scanPath)), { code: "ENOENT" });
  }
};
export const writeStage5CurrentCandidateFreeze = async ({ candidateRoot = root } = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = await context(workspace);
  const { validation, freeze, scan } = manifest.finalization;
  const first = await collectStage5SourceFiles({
    root: workspace,
    phase: "FINAL_EVIDENCE",
    candidate: manifest.candidate,
  });
  assert(first.files.includes(validation), "Final validation must exist before the freeze");
  assert(
    !first.files.includes(freeze) && !first.files.includes(scan),
    "Freeze/scan already exists",
  );
  const second = await collectStage5SourceFiles({
    root: workspace,
    phase: "FINAL_EVIDENCE",
    candidate: manifest.candidate,
  });
  assert.deepEqual(first.files, second.files, "Freeze collection order changed");
  const entries = await rowsFor(workspace, first.files);
  assert.deepEqual(entries, await rowsFor(workspace, second.files), "Freeze bytes changed");
  const frozen = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    status: "FROZEN_PENDING_INDEPENDENT_REVIEW",
    collectionPhase: "FINAL_EVIDENCE",
    collectionCount: 2,
    entryCount: entries.length,
    aggregateSerialization:
      "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by source collector relative-path order",
    aggregateSha256: hash(Buffer.from(serialize(entries))),
    selfExclusion: { path: freeze, excluded: true },
    postFreezeScanReport: { path: scan, excluded: true },
    entries,
    stage6Actions: manifest.stage6Actions,
  };
  const bytes = Buffer.from(`${JSON.stringify(frozen, null, 2)}\n`);
  await writeFile(path.join(workspace, freeze), bytes, { flag: "wx" });
  await verifyStage5CurrentCandidateFreeze({ candidateRoot: workspace, requireScan: false });
  return {
    result: "PASS",
    candidate: manifest.candidate,
    freeze,
    sha256: hash(bytes),
    entries: entries.length,
  };
};
export const verifyStage5CurrentCandidateFreeze = async ({
  candidateRoot = root,
  requireScan = true,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = await context(workspace);
  const { validation, freeze, scan } = manifest.finalization;
  const bytes = await readRegular(path.join(workspace, freeze));
  const frozen = JSON.parse(bytes);
  assert.equal(frozen.candidate, manifest.candidate);
  assert.equal(frozen.status, "FROZEN_PENDING_INDEPENDENT_REVIEW");
  assert.equal(frozen.collectionPhase, "FINAL_EVIDENCE");
  assert.equal(frozen.collectionCount, 2);
  assert.equal(frozen.stage6Actions, 0);
  assert.deepEqual(frozen.selfExclusion, { path: freeze, excluded: true });
  assert.deepEqual(frozen.postFreezeScanReport, { path: scan, excluded: true });
  const scope = await collectStage5SourceFiles({
    root: workspace,
    phase: "FINAL_CANDIDATE",
    candidate: manifest.candidate,
  });
  assert.equal(scope.result, "PASS");
  assert(scope.files.includes(validation) && scope.files.includes(freeze));
  await verifyStage5FreezeScanBoundary({
    workspace,
    sourceFiles: scope.files,
    scanPath: scan,
    requireScan,
  });
  const paths = scope.files.filter((file) => file !== freeze && file !== scan);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(frozen.entryCount, frozen.entries.length);
  assert.deepEqual(
    frozen.entries.map((entry) => entry.path),
    paths,
  );
  assert.deepEqual(frozen.entries, await rowsFor(workspace, paths));
  assert.equal(frozen.aggregateSha256, hash(Buffer.from(serialize(frozen.entries))));
  return {
    result: "PASS",
    candidate: manifest.candidate,
    freeze,
    sha256: hash(bytes),
    entryCount: frozen.entryCount,
    aggregateSha256: frozen.aggregateSha256,
    stage6Actions: 0,
  };
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = process.argv.includes("--write")
    ? await writeStage5CurrentCandidateFreeze()
    : await verifyStage5CurrentCandidateFreeze();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
