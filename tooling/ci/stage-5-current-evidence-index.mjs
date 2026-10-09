import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MAIN_INDEX = "EVIDENCE_INDEX.json";
const PRE_CI_INDEX = "PRE_CI_EVIDENCE_INDEX.json";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serializeRows = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const safeRelative = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.includes("\\") &&
  !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const writeExclusiveOrMatch = async (file, bytes) => {
  try {
    assert.deepEqual(
      await readRegular(file),
      bytes,
      `Refusing divergent evidence-index reuse: ${file}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};
const expectedPaths = async (workspace, manifest, phase) => {
  const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
  const entries = await readdir(evidenceDirectory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (entry.name === MAIN_INDEX) continue;
    if (phase === "PRE_CI" && entry.name === PRE_CI_INDEX) continue;
    // The post-freeze scan is verified by independent provenance, never self-indexed.
    if (entry.name === path.basename(manifest.finalization.scan)) continue;
    assert(
      entry.isFile() && !entry.isSymbolicLink(),
      `Evidence index input must be a regular file: ${entry.name}`,
    );
    paths.push(`${manifest.evidenceDirectory}/${entry.name}`);
  }
  paths.push(
    manifest.correctionMatrix,
    "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json",
    manifest.paths.manifest,
  );
  const sorted = paths.toSorted((left, right) => left.localeCompare(right));
  assert.equal(new Set(sorted).size, sorted.length, "Evidence index artifact paths must be unique");
  return sorted;
};
const rowsFor = async (workspace, paths) => {
  const rows = [];
  for (const relativePath of paths) {
    assert(safeRelative(relativePath), `Unsafe evidence path: ${relativePath}`);
    const bytes = await readRegular(path.join(workspace, relativePath));
    rows.push({ path: relativePath, bytes: bytes.length, sha256: hash(bytes) });
  }
  return rows;
};
const verifyIndexObject = async (
  workspace,
  manifest,
  index,
  { strictCurrentPaths = true } = {},
) => {
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.candidate, manifest.candidate);
  assert.equal(index.predecessor, manifest.predecessor);
  assert.equal(index.stage6Actions, manifest.stage6Actions);
  assert(["PRE_CI", "FINAL", "CI_FAILED"].includes(index.phase));
  assert(Array.isArray(index.artifacts));
  assert.equal(index.artifactCount, index.artifacts.length);
  const paths = index.artifacts.map(({ path: artifactPath }) => artifactPath);
  assert.equal(
    new Set(paths).size,
    paths.length,
    "Evidence index contains duplicate artifact paths",
  );
  assert.deepEqual(
    paths,
    paths.toSorted((left, right) => left.localeCompare(right)),
    "Evidence paths are not canonical",
  );
  for (const row of index.artifacts) {
    assert(safeRelative(row.path));
    assert(Number.isSafeInteger(row.bytes) && row.bytes > 0);
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    const bytes = await readRegular(path.join(workspace, row.path));
    assert.equal(bytes.length, row.bytes, `Evidence size mismatch: ${row.path}`);
    assert.equal(hash(bytes), row.sha256, `Evidence hash mismatch: ${row.path}`);
  }
  assert.equal(
    hash(Buffer.from(serializeRows(index.artifacts))),
    index.aggregateSha256,
    "Evidence aggregate hash mismatch",
  );
  if (strictCurrentPaths) {
    const expected = await expectedPaths(workspace, manifest, index.phase);
    assert.deepEqual(
      paths,
      expected,
      "Evidence index does not exactly cover the current candidate artifact set",
    );
  }
  if (index.phase === "PRE_CI") {
    assert.deepEqual(index.ciVerify, { invocationCount: 0, result: "NOT_RUN", exitCode: null });
  } else {
    assert.equal(index.ciVerify?.invocationCount, 1);
    assert.equal(index.ciVerify?.result, index.phase === "FINAL" ? "PASS" : "FAIL");
    assert(Number.isInteger(index.ciVerify?.exitCode));
  }
  return {
    result: "PASS",
    candidate: index.candidate,
    phase: index.phase,
    artifactCount: index.artifactCount,
    aggregateSha256: index.aggregateSha256,
    indexSha256: hash(Buffer.from(`${JSON.stringify(index, null, 2)}\n`)),
    stage6Actions: index.stage6Actions,
  };
};

export const verifyStage5CurrentEvidenceIndex = async ({ candidateRoot = root } = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
  const index = JSON.parse(await readFile(path.join(evidenceDirectory, MAIN_INDEX), "utf8"));
  const verification = await verifyIndexObject(workspace, manifest, index);
  if (index.phase !== "PRE_CI") {
    const preCiBytes = await readRegular(path.join(evidenceDirectory, PRE_CI_INDEX));
    const preCiIndex = JSON.parse(preCiBytes.toString("utf8"));
    assert.equal(preCiIndex.phase, "PRE_CI");
    await verifyIndexObject(workspace, manifest, preCiIndex, { strictCurrentPaths: false });
  }
  return verification;
};

export const writeStage5CurrentEvidenceIndex = async ({
  candidateRoot = root,
  phase = "PRE_CI",
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  assert(
    ["PRE_CI", "FINAL", "CI_FAILED"].includes(phase),
    `Invalid current evidence phase: ${phase}`,
  );
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
  const paths = await expectedPaths(workspace, manifest, phase);
  const artifacts = await rowsFor(workspace, paths);
  let ciVerify = { invocationCount: 0, result: "NOT_RUN", exitCode: null };
  if (phase !== "PRE_CI") {
    const receipt = JSON.parse(
      await readFile(path.join(evidenceDirectory, "ci-verify-execution.json"), "utf8"),
    );
    const logBytes = await readRegular(path.join(evidenceDirectory, "ci-verify.log"));
    assert.equal(receipt.candidate, manifest.candidate);
    assert.equal(receipt.command, "corepack pnpm ci:verify");
    assert.equal(receipt.invocationCount, 1);
    assert.equal(receipt.logBytes, logBytes.length);
    assert.equal(receipt.logSha256, hash(logBytes));
    ciVerify = { invocationCount: 1, result: receipt.result, exitCode: receipt.exitCode };
  }
  const index = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    phase,
    ciVerify,
    artifactCount: artifacts.length,
    artifacts,
    aggregateSha256: hash(Buffer.from(serializeRows(artifacts))),
    stage6Actions: manifest.stage6Actions,
  };
  const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  await verifyIndexObject(workspace, manifest, index, { strictCurrentPaths: false });
  const indexPath = path.join(evidenceDirectory, MAIN_INDEX);
  const preCiIndexPath = path.join(evidenceDirectory, PRE_CI_INDEX);
  if (phase === "PRE_CI") {
    await writeExclusiveOrMatch(indexPath, bytes);
    await writeExclusiveOrMatch(preCiIndexPath, bytes);
  } else {
    const priorBytes = await readRegular(indexPath);
    const priorIndex = JSON.parse(priorBytes.toString("utf8"));
    if (priorIndex.phase === "PRE_CI") {
      const preservedPreCi = await readRegular(preCiIndexPath);
      assert.deepEqual(
        preservedPreCi,
        priorBytes,
        "Pre-CI index copy differs from the prior index",
      );
      await writeFile(indexPath, bytes, { flag: "w" });
    } else {
      assert.equal(
        priorIndex.phase,
        phase,
        "Refusing to transition an already-final evidence index",
      );
      assert.deepEqual(priorBytes, bytes, "Refusing divergent final evidence index reuse");
    }
  }
  return await verifyStage5CurrentEvidenceIndex({ candidateRoot: workspace });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase =
    process.argv.find((argument) => argument.startsWith("--phase="))?.split("=")[1] ?? "PRE_CI";
  const result = process.argv.includes("--write")
    ? await writeStage5CurrentEvidenceIndex({ phase })
    : await verifyStage5CurrentEvidenceIndex();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
