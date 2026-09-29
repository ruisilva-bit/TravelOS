import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const STAGE_4_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-4";
export const STAGE_4_EVIDENCE_INDEX = `${STAGE_4_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;

export const STAGE_4_EXPECTED_EVIDENCE_ARTIFACT_NAMES = [
  "auth-schema-drift.json",
  "ct-200-migration.json",
  "ct-200-post-migration-validation.json",
  "ct-200-preflight-restore-cleanup.json",
  "disposable-cleanup.json",
  "disposable-integration.json",
  "disposable-package-build.json",
  "disposable-postgresql-provenance.json",
  "disposable-postgresql-runtime.json",
  "migration-checksums.json",
  "qualification-summary.json",
  "repository-regression.json",
  "source-safety-pre-index.json",
].toSorted();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sortedUnique = (values) => [...new Set(values)].toSorted();

export const verifyStage4EvidenceIndex = async ({ root = process.cwd() } = {}) => {
  const evidenceDirectory = path.join(root, STAGE_4_EVIDENCE_DIRECTORY);
  const entries = await readdir(evidenceDirectory, { withFileTypes: true });
  const invalidDirectoryEntries = entries
    .filter((entry) => !entry.isFile())
    .map((entry) => entry.name)
    .toSorted();
  const actualNames = entries
    .filter((entry) => entry.isFile() && entry.name !== "EVIDENCE_INDEX.json")
    .map((entry) => entry.name)
    .toSorted();
  const expectedNames = STAGE_4_EXPECTED_EVIDENCE_ARTIFACT_NAMES;
  const expectedPaths = expectedNames.map((name) => `${STAGE_4_EVIDENCE_DIRECTORY}/${name}`);
  const expectedPathSet = new Set(expectedPaths);
  const actualSet = new Set(actualNames);
  const missing = expectedNames.filter((name) => !actualSet.has(name));
  const unexpected = actualNames.filter((name) => !expectedNames.includes(name));

  const indexBytes = await readFile(path.join(root, STAGE_4_EVIDENCE_INDEX));
  const index = JSON.parse(indexBytes.toString("utf8"));
  const artifacts = Array.isArray(index.artifacts) ? index.artifacts : [];
  const indexedPaths = artifacts.map((artifact) => artifact?.path);
  const duplicatePaths = indexedPaths.filter(
    (artifactPath, index) => indexedPaths.indexOf(artifactPath) !== index,
  );
  const missingIndexPaths = expectedPaths.filter(
    (artifactPath) => !indexedPaths.includes(artifactPath),
  );
  const unexpectedIndexPaths = indexedPaths.filter(
    (artifactPath) => !expectedPathSet.has(artifactPath),
  );
  const invalidIndexPaths = indexedPaths.filter(
    (artifactPath) =>
      typeof artifactPath !== "string" ||
      path.isAbsolute(artifactPath) ||
      artifactPath.split("/").some((segment) => segment.length === 0 || segment === ".."),
  );
  const orderingValid = indexedPaths.every(
    (artifactPath, index) => artifactPath === expectedPaths[index],
  );

  const sizeMismatches = [];
  const hashMismatches = [];
  let matched = 0;
  for (const artifact of artifacts) {
    if (!artifact || !expectedPathSet.has(artifact.path)) continue;
    const bytes = await readFile(path.join(root, artifact.path));
    if (bytes.length !== artifact.bytes) sizeMismatches.push(artifact.path);
    if (sha256(bytes) !== artifact.sha256) hashMismatches.push(artifact.path);
    if (bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256) matched += 1;
  }
  const recomputedAggregateSha256 = sha256(
    artifacts
      .map((artifact) => `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}\n`)
      .join(""),
  );
  const result =
    index.schemaVersion === 1 &&
    index.phase === "Phase 1 M1" &&
    index.stage === 4 &&
    index.result === "PASS" &&
    index.artifactCount === expectedNames.length &&
    artifacts.length === expectedNames.length &&
    matched === expectedNames.length &&
    missing.length === 0 &&
    unexpected.length === 0 &&
    missingIndexPaths.length === 0 &&
    unexpectedIndexPaths.length === 0 &&
    duplicatePaths.length === 0 &&
    invalidIndexPaths.length === 0 &&
    invalidDirectoryEntries.length === 0 &&
    sizeMismatches.length === 0 &&
    hashMismatches.length === 0 &&
    orderingValid &&
    index.aggregateAlgorithm === "sha256(path\\0bytes\\0sha256\\n ordered by path)" &&
    index.aggregateSha256 === recomputedAggregateSha256
      ? "PASS"
      : "FAIL";

  return {
    schemaVersion: 1,
    result,
    indexPath: STAGE_4_EVIDENCE_INDEX,
    indexBytes: indexBytes.length,
    indexSha256: sha256(indexBytes),
    declaredCount: index.artifactCount,
    parsedCount: artifacts.length,
    matched,
    missing,
    unexpected,
    missingIndexPaths,
    unexpectedIndexPaths,
    duplicatePaths: sortedUnique(duplicatePaths),
    invalidIndexPaths: sortedUnique(invalidIndexPaths),
    invalidDirectoryEntries,
    sizeMismatches: sortedUnique(sizeMismatches),
    hashMismatches: sortedUnique(hashMismatches),
    orderingValid,
    declaredAggregateSha256: index.aggregateSha256,
    recomputedAggregateSha256,
  };
};
