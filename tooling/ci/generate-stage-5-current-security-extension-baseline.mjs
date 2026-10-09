import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";
import { verifyStage5CurrentFindingLineage } from "./stage-5-current-finding-lineage.mjs";
import { verifyStage5CurrentPredecessorEvidence } from "./prepare-stage-5-current-correction-matrix.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serializeRows = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
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
    assert.deepEqual(await readRegular(file), bytes, `Refusing divergent output reuse: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};

export const generateStage5CurrentSecurityExtensionBaseline = async ({
  candidateRoot = root,
  write = false,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifestPath = path.join(workspace, "tooling/ci/stage-5-current-candidate.json");
  const manifestBytes = await readRegular(manifestPath);
  const manifest = assertStage5CandidateManifest(JSON.parse(manifestBytes.toString("utf8")));
  const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
  const predecessorSlug = manifest.predecessor.toLowerCase().replaceAll("-", "");
  const previousBaselinePath = path.join(workspace, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
  const archivedPredecessorPath = path.join(
    evidenceDirectory,
    `${predecessorSlug}-security-extension-baseline.json`,
  );
  const predecessorEvidence = await verifyStage5CurrentPredecessorEvidence(manifest.predecessor, {
    candidateRoot: workspace,
  });
  const predecessorBaselineBytes = predecessorEvidence.baselineBytes;
  const predecessorBaselineSha256 = hash(predecessorBaselineBytes);
  assert.equal(predecessorBaselineSha256, manifest.historicalInputs.predecessorBaselineSha256);
  const predecessorBaseline = JSON.parse(predecessorBaselineBytes.toString("utf8"));
  assert.equal(predecessorBaseline.result, "PASS");
  assert.equal(predecessorBaseline.stage6Actions, 0);

  const lineageReport = await verifyStage5CurrentFindingLineage({ candidateRoot: workspace });
  assert.equal(lineageReport.result, "PASS");
  const findingLineageBytes = await readRegular(
    path.join(evidenceDirectory, "finding-lineage.json"),
  );
  const packageBytes = await readRegular(path.join(workspace, "package.json"));
  const runnerBytes = await readRegular(path.join(workspace, manifest.paths.runner));
  const verifierBytes = await readRegular(path.join(workspace, manifest.paths.baselineVerifier));
  const sharedVerifierBytes = await readRegular(
    path.join(workspace, manifest.paths.sharedBaselineVerifier),
  );
  const correctionMatrixBytes = await readRegular(path.join(workspace, manifest.correctionMatrix));
  const baselineRows = [];
  for (const relativePath of manifest.protectedPaths) {
    const bytes = await readRegular(path.join(workspace, relativePath));
    baselineRows.push({ path: relativePath, bytes: bytes.length, sha256: hash(bytes) });
  }
  const previousRows = predecessorBaseline.protectedFiles;
  assert(Array.isArray(previousRows), "Predecessor baseline protected-file manifest is invalid");
  const previousByPath = new Map(previousRows.map((row) => [row.path, row]));
  const currentByPath = new Map(baselineRows.map((row) => [row.path, row]));
  const added = [...currentByPath.keys()]
    .filter((relativePath) => !previousByPath.has(relativePath))
    .sort();
  const changed = [...currentByPath.keys()]
    .filter((relativePath) => {
      const previous = previousByPath.get(relativePath);
      const current = currentByPath.get(relativePath);
      return previous && (previous.bytes !== current.bytes || previous.sha256 !== current.sha256);
    })
    .sort();
  const removed = [...previousByPath.keys()]
    .filter((relativePath) => !currentByPath.has(relativePath))
    .sort();
  assert.deepEqual(
    { added, changed, removed },
    manifest.protectedPathDelta,
    "Declared protected-path delta differs from actual bytes",
  );
  const aggregateSha256 = hash(Buffer.from(serializeRows(baselineRows)));
  const baseline = JSON.parse(JSON.stringify(predecessorBaseline));
  baseline.result = "PASS";
  baseline.stage6Actions = manifest.stage6Actions;
  baseline.aggregateSha256 = aggregateSha256;
  baseline.protectedFiles = baselineRows;
  baseline.lineage.extensionDocument.sha256 = currentByPath.get(
    baseline.lineage.extensionDocument.path,
  ).sha256;
  baseline.lineage[manifest.generationKey] = {
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    predecessorBaselineSha256,
    packageJsonSha256: hash(packageBytes),
    runnerSha256: hash(runnerBytes),
    verifierSha256: hash(verifierBytes),
    sharedVerifierSha256: hash(sharedVerifierBytes),
    candidateManifestSha256: hash(manifestBytes),
    correctionMatrixSha256: hash(correctionMatrixBytes),
    findingLineageSha256: hash(findingLineageBytes),
    protectedPathDelta: JSON.parse(JSON.stringify(manifest.protectedPathDelta)),
    stage6Actions: manifest.stage6Actions,
  };
  const baselineBytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  const baselineSha256 = hash(baselineBytes);
  const semanticVerification = await verifyStage5SecurityExtensionBaseline({
    root: workspace,
    expectedBaselineSha256: baselineSha256,
    requireCandidate: manifest.candidate,
    baselineBytesOverride: baselineBytes,
    currentCandidateManifest: manifest,
  });
  assert.equal(semanticVerification.result, "PASS");
  assert.equal(semanticVerification.phase1.protectedFileCount, manifest.protectedPaths.length);

  const receipt = {
    schemaVersion: 1,
    result: "PASS",
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    predecessorBaselineSha256,
    baselinePath: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
    baselineSha256,
    packageJsonSha256: hash(packageBytes),
    runnerSha256: hash(runnerBytes),
    verifierSha256: hash(verifierBytes),
    sharedVerifierSha256: hash(sharedVerifierBytes),
    candidateManifestSha256: hash(manifestBytes),
    correctionMatrixSha256: hash(correctionMatrixBytes),
    protectedPathDelta: JSON.parse(JSON.stringify(manifest.protectedPathDelta)),
    protectedFileCount: baselineRows.length,
    missing: 0,
    mismatch: 0,
    duplicate: 0,
    unexpected: 0,
    semanticVerification,
    stage6Actions: manifest.stage6Actions,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  if (write) {
    await mkdir(evidenceDirectory, { recursive: true });
    await writeExclusiveOrMatch(archivedPredecessorPath, predecessorBaselineBytes);
    const currentBaselineBytes = await readRegular(previousBaselinePath);
    const currentBaselineSha256 = hash(currentBaselineBytes);
    if (currentBaselineSha256 === predecessorBaselineSha256) {
      await writeFile(previousBaselinePath, baselineBytes, { flag: "w" });
    } else {
      assert.equal(
        currentBaselineSha256,
        baselineSha256,
        "Refusing to overwrite a non-predecessor baseline",
      );
      assert.deepEqual(
        currentBaselineBytes,
        baselineBytes,
        "Current candidate baseline differs from deterministic output",
      );
    }
    await writeExclusiveOrMatch(
      path.join(evidenceDirectory, "security-extension-baseline-generation.json"),
      receiptBytes,
    );
  }
  return {
    result: "PASS",
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    baselinePath: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
    baselineSha256,
    protectedFileCount: baselineRows.length,
    protectedPathDelta: manifest.protectedPathDelta,
    receiptPath: path.relative(
      workspace,
      path.join(evidenceDirectory, "security-extension-baseline-generation.json"),
    ),
    semanticVerification: semanticVerification.result,
    missing: 0,
    mismatch: 0,
    duplicate: 0,
    unexpected: 0,
    stage6Actions: manifest.stage6Actions,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateStage5CurrentSecurityExtensionBaseline({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
