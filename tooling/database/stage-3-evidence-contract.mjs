import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const STAGE_3_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-3";
export const STAGE_3_EVIDENCE_INDEX = `${STAGE_3_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;

export const STAGE_3_ORIGINAL_EVIDENCE_ARTIFACT_NAMES = [
  "backup-restore.json",
  "ct-200-backup-restore.json",
  "ct-200-bootstrap-migrations.json",
  "ct-200-final-state.json",
  "ct-200-management-pre-state.json",
  "ct-200-postgresql-installation.json",
  "ct-200-runtime-validation.json",
  "ct-200-scope-and-access-cleanup.json",
  "default-public-privileges.json",
  "disposable-bootstrap.json",
  "disposable-cleanup.json",
  "integration-test-execution.json",
  "integration-tests.log",
  "migration-chain.json",
  "migration-concurrency.json",
  "migration-failure-rollback.json",
  "owner-migrator-privileges.json",
  "persistence-build.json",
  "postgresql-package-provenance.json",
  "postgresql-runtime.json",
  "privilege-matrix.json",
  "qualification-summary.json",
  "role-topology.json",
  "stage-2-regression.json",
  "stage-2-regression.log",
  "transaction-results.json",
].toSorted();

export const STAGE_3_CORRECTION_EVIDENCE_ARTIFACT_NAMES = [
  "correction-ci-verify.json",
  "correction-ci-verify.log",
  "correction-sensitive-data-pre-index.json",
  "correction-tos-s3-001.json",
  "correction-tos-s3-002.json",
  "ct-200-focused-access-cleanup.json",
  "ct-200-focused-role-topology.json",
].toSorted();

export const STAGE_3_EXPECTED_EVIDENCE_ARTIFACT_NAMES = [
  ...STAGE_3_ORIGINAL_EVIDENCE_ARTIFACT_NAMES,
  ...STAGE_3_CORRECTION_EVIDENCE_ARTIFACT_NAMES,
].toSorted();

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const sortedUnique = (values) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

export const verifyStage3EvidenceIndex = async ({ root = process.cwd() } = {}) => {
  const evidenceDirectory = path.join(root, STAGE_3_EVIDENCE_DIRECTORY);
  const directoryEntries = await readdir(evidenceDirectory, { withFileTypes: true });
  const invalidDirectoryEntries = directoryEntries
    .filter((entry) => !entry.isFile())
    .map((entry) => entry.name)
    .toSorted();
  const actualNames = directoryEntries
    .filter((entry) => entry.isFile() && entry.name !== "EVIDENCE_INDEX.json")
    .map((entry) => entry.name)
    .toSorted();
  const expectedNames = STAGE_3_EXPECTED_EVIDENCE_ARTIFACT_NAMES;
  const expectedSet = new Set(expectedNames);
  const actualSet = new Set(actualNames);
  const missing = expectedNames.filter((name) => !actualSet.has(name));
  const unexpected = actualNames.filter((name) => !expectedSet.has(name));

  const indexBytes = await readFile(path.join(root, STAGE_3_EVIDENCE_INDEX));
  const index = JSON.parse(indexBytes.toString("utf8"));
  const indexedArtifacts = Array.isArray(index.artifacts) ? index.artifacts : [];
  const indexedPaths = indexedArtifacts.map(({ path: artifactPath }) => artifactPath);
  const duplicatePaths = indexedPaths.filter(
    (artifactPath, indexPosition) => indexedPaths.indexOf(artifactPath) !== indexPosition,
  );
  const expectedPaths = expectedNames.map((name) => `${STAGE_3_EVIDENCE_DIRECTORY}/${name}`);
  const indexedPathSet = new Set(indexedPaths);
  const expectedPathSet = new Set(expectedPaths);
  const missingIndexPaths = expectedPaths.filter(
    (artifactPath) => !indexedPathSet.has(artifactPath),
  );
  const unexpectedIndexPaths = indexedPaths.filter(
    (artifactPath) => !expectedPathSet.has(artifactPath),
  );
  const invalidIndexPaths = indexedPaths.filter(
    (artifactPath) =>
      typeof artifactPath !== "string" ||
      path.isAbsolute(artifactPath) ||
      artifactPath.split("/").some((segment) => segment === "" || segment === ".."),
  );
  const orderingValid = indexedPaths.every(
    (artifactPath, indexPosition) => artifactPath === expectedPaths[indexPosition],
  );

  const sizeMismatches = [];
  const hashMismatches = [];
  let matched = 0;
  for (const artifact of indexedArtifacts) {
    if (!expectedPathSet.has(artifact.path)) continue;
    const bytes = await readFile(path.join(root, artifact.path));
    if (bytes.length !== artifact.bytes) sizeMismatches.push(artifact.path);
    if (sha256(bytes) !== artifact.sha256) hashMismatches.push(artifact.path);
    if (bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256) matched += 1;
  }
  const recomputedAggregateSha256 = sha256(
    indexedArtifacts
      .map((artifact) => `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}\n`)
      .join(""),
  );
  const result =
    index.schemaVersion === 1 &&
    index.result === "PASS" &&
    index.artifactCount === expectedNames.length &&
    indexedArtifacts.length === expectedNames.length &&
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
    recomputedAggregateSha256 === index.aggregateSha256
      ? "PASS"
      : "FAIL";

  return {
    schemaVersion: 1,
    result,
    indexPath: STAGE_3_EVIDENCE_INDEX,
    indexBytes: indexBytes.length,
    indexSha256: sha256(indexBytes),
    declaredCount: index.artifactCount,
    parsedCount: indexedArtifacts.length,
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
