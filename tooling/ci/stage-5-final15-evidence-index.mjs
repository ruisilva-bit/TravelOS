import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STAGE5_FINAL14_ARCHIVE_MANIFEST,
  STAGE5_FINAL14_ARCHIVE_MANIFEST_SHA256,
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
  STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL14_REVIEW_NO_GO,
  STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
  STAGE5_FINAL14_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL14_SOURCE_ARCHIVE,
  STAGE5_FINAL14_SOURCE_ARCHIVE_SHA256,
  STAGE5_FINAL15_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL15_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL15_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL15_EVIDENCE_DIRECTORY,
  STAGE5_FINAL15_EVIDENCE_INDEX,
  STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";
import {
  assertExactArtifactPathSet,
  compareArtifactPathSets,
} from "./stage-5-artifact-path-set.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const names = [...STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES].toSorted();
const evidencePath = (root, name) => path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY, name);
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${file} must be a regular file`);
  return readFile(file);
};
const verifyHistoricalFinal14 = async (root) => {
  const readPinned = async (relativePath, expectedHash) => {
    const bytes = await readRegular(path.join(root, relativePath));
    assert.equal(hash(bytes), expectedHash, `FINAL-14 historical bytes changed: ${relativePath}`);
    return bytes;
  };
  const indexBytes = await readPinned(
    `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`,
    "4c82b8f68547c3ec3b00673a9afcfd265b06013f51c01c78145fbe586add6478",
  );
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.equal(index.candidate, "FINAL-14");
  assert.equal(index.phase, "FINAL");
  assert.equal(index.artifactCount, STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length);
  const expectedPaths = STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(
    (name) => `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/${name}`,
  );
  const pathCheck = assertExactArtifactPathSet(
    expectedPaths,
    index.artifacts.map((row) => row.path),
    "FINAL-14 index artifacts",
  );
  const rows = [...index.artifacts];
  assert.deepEqual(
    rows.map((row) => row.path),
    expectedPaths,
    "FINAL-14 aggregate rows must preserve the pinned index's canonical order",
  );
  for (const row of rows) {
    const bytes = await readRegular(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes, `FINAL-14 byte count mismatch: ${row.path}`);
    assert.equal(hash(bytes), row.sha256, `FINAL-14 SHA-256 mismatch: ${row.path}`);
  }
  assert.equal(index.aggregateSha256, hash(Buffer.from(serialize(rows))));
  await readPinned(
    STAGE5_FINAL14_CANDIDATE_FREEZE,
    "282be00d175690e7e42ab925d09dd601cd7d310648b38b4ca475b1ba2a5b05bf",
  );
  await readPinned(
    STAGE5_FINAL14_CORRECTION_MATRIX,
    "7eb5131467754839732df46f711ff8992de49a5eeab66dbd0c9256d547113ff9",
  );
  await readPinned(STAGE5_FINAL14_REVIEW_NO_GO, STAGE5_FINAL14_REVIEW_NO_GO_SHA256);
  await readPinned(STAGE5_FINAL14_ARCHIVE_MANIFEST, STAGE5_FINAL14_ARCHIVE_MANIFEST_SHA256);
  await readPinned(STAGE5_FINAL14_SOURCE_ARCHIVE, STAGE5_FINAL14_SOURCE_ARCHIVE_SHA256);
  const final14BaselineCopy = `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/final14-security-extension-baseline.json`;
  await readPinned(final14BaselineCopy, STAGE5_FINAL14_SECURITY_BASELINE_SHA256);
  const review = JSON.parse(
    (await readRegular(path.join(root, STAGE5_FINAL14_REVIEW_NO_GO))).toString("utf8"),
  );
  assert.equal(review.candidate, "FINAL-14");
  assert.equal(review.decision, "NO_GO");
  assert.equal(review.reviewType, "independent-read-only-candidate-review");
  assert.equal(review.stage5ClosureEligible, false);
  assert.equal(review.stage6Actions, 0);
  return { index, indexSha256: hash(indexBytes), artifactCount: rows.length, pathCheck };
};

export const verifyStage5Final15Predecessor = async ({ root = process.cwd() } = {}) => {
  const predecessor = await verifyHistoricalFinal14(root);
  const directory = path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY);
  for (const name of STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
    const source = await readRegular(path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY, name));
    const copy = await readRegular(path.join(directory, `final14-${name}`));
    assert.deepEqual(copy, source, `FINAL-15 must preserve exact FINAL-14 indexed bytes: ${name}`);
  }
  const copies = [
    ["final14-EVIDENCE_INDEX.json", `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`],
    ["final14-correction-matrix.json", STAGE5_FINAL14_CORRECTION_MATRIX],
    [
      "final14-candidate-validation.md",
      "docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CANDIDATE_VALIDATION.md",
    ],
    ["final14-candidate-freeze.md", STAGE5_FINAL14_CANDIDATE_FREEZE],
    ["final14-independent-review-no-go.json", STAGE5_FINAL14_REVIEW_NO_GO],
    ["final14-archive-manifest.json", STAGE5_FINAL14_ARCHIVE_MANIFEST],
    ["final14-frozen-source-snapshot.tar.gz", STAGE5_FINAL14_SOURCE_ARCHIVE],
  ];
  for (const [copyName, sourcePath] of copies) {
    const source = await readRegular(path.join(root, sourcePath));
    const copy = await readRegular(path.join(directory, copyName));
    assert.deepEqual(copy, source, `FINAL-15 predecessor copy mismatch: ${copyName}`);
  }
  const baselineCopy = await readRegular(
    path.join(directory, "final14-security-extension-baseline.json"),
  );
  assert.equal(hash(baselineCopy), STAGE5_FINAL14_SECURITY_BASELINE_SHA256);
  return { result: "PASS", candidate: "FINAL-14", ...predecessor };
};

export const verifyStage5Final15EvidenceIndex = async ({
  root = process.cwd(),
  allowedPhases = ["PRE_CI", "FINAL", "CI_FAILED"],
  requiredPhase,
} = {}) => {
  const directory = path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY);
  const entries = await readdir(directory, { withFileTypes: true });
  assert(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()));
  const expectedNames = [...names, "EVIDENCE_INDEX.json"].toSorted();
  assertExactArtifactPathSet(
    expectedNames,
    entries.map((entry) => entry.name),
    "FINAL-15 evidence directory",
  );
  const indexBytes = await readRegular(evidencePath(root, "EVIDENCE_INDEX.json"));
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.candidate, "FINAL-15");
  assert(allowedPhases.includes(index.phase));
  if (requiredPhase) assert.equal(index.phase, requiredPhase);
  assert.equal(index.artifactCount, names.length);
  assert.equal(index.aggregateSerialization, STAGE5_FINAL15_EVIDENCE_AGGREGATE_SERIALIZATION);
  assert.equal(index.stage6Actions, 0);
  const expectedPaths = names.map((name) => `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/${name}`);
  const pathComparison = compareArtifactPathSets(
    expectedPaths,
    index.artifacts.map((row) => row.path),
  );
  assert.equal(
    pathComparison.result,
    "PASS",
    `FINAL-15 index path mismatch: ${JSON.stringify(pathComparison)}`,
  );
  const rows = [...index.artifacts].toSorted((left, right) => left.path.localeCompare(right.path));
  const actual = [];
  for (const row of rows) {
    const bytes = await readRegular(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes, `FINAL-15 byte count mismatch: ${row.path}`);
    assert.equal(hash(bytes), row.sha256, `FINAL-15 SHA-256 mismatch: ${row.path}`);
    actual.push({ path: row.path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const aggregateSha256 = hash(Buffer.from(serialize(actual)));
  assert.equal(index.aggregateSha256, aggregateSha256);
  const logBytes = await readRegular(evidencePath(root, "ci-verify.log"));
  const executionBytes = await readRegular(evidencePath(root, "ci-verify-execution.json"));
  if (index.phase === "PRE_CI") {
    assert.equal(index.ciVerify.invocationCount, 0);
    assert.equal(index.ciVerify.result, "NOT_RUN");
    assert.equal(logBytes.toString("utf8"), STAGE5_FINAL15_CI_LOG_PLACEHOLDER);
    assert.equal(executionBytes.toString("utf8"), STAGE5_FINAL15_CI_EXECUTION_PLACEHOLDER);
  } else {
    const execution = JSON.parse(executionBytes.toString("utf8"));
    assert.equal(execution.candidate, "FINAL-15");
    assert.equal(execution.invocationCount, 1);
    assert.equal(execution.command, "corepack pnpm ci:verify");
    assert.equal(execution.logBytes, logBytes.length);
    assert.equal(execution.logSha256, hash(logBytes));
    assert.equal(index.phase, execution.exitCode === 0 ? "FINAL" : "CI_FAILED");
    assert.equal(execution.result, execution.exitCode === 0 ? "PASS" : "FAIL");
    assert.equal(index.ciVerify.invocationCount, 1);
    assert.equal(index.ciVerify.exitCode, execution.exitCode);
    assert.equal(index.ciVerify.result, execution.result);
  }
  const predecessor = await verifyStage5Final15Predecessor({ root });
  return {
    result: "PASS",
    candidate: "FINAL-15",
    phase: index.phase,
    indexPath: STAGE5_FINAL15_EVIDENCE_INDEX,
    indexBytes: indexBytes.length,
    indexSha256: hash(indexBytes),
    artifactCount: rows.length,
    matched: rows.length,
    missing: [],
    unexpected: [],
    duplicates: [],
    hashMismatches: [],
    sizeMismatches: [],
    aggregateSha256,
    predecessorIndexSha256: predecessor.indexSha256,
    stage6Actions: 0,
  };
};

export const writeStage5Final15EvidenceIndex = async ({
  root = process.cwd(),
  phase = "PRE_CI",
  ciVerify,
} = {}) => {
  assert(["PRE_CI", "FINAL", "CI_FAILED"].includes(phase));
  const directory = path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY);
  const rows = [];
  for (const name of names) {
    const bytes = await readRegular(path.join(directory, name));
    rows.push({
      path: `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/${name}`,
      bytes: bytes.length,
      sha256: hash(bytes),
    });
  }
  rows.sort((left, right) => left.path.localeCompare(right.path));
  assertExactArtifactPathSet(
    names,
    rows.map((row) => path.posix.basename(row.path)),
    "FINAL-15 index input",
  );
  const index = {
    schemaVersion: 1,
    candidate: "FINAL-15",
    phase,
    artifactCount: rows.length,
    aggregateSerialization: STAGE5_FINAL15_EVIDENCE_AGGREGATE_SERIALIZATION,
    aggregateSha256: hash(Buffer.from(serialize(rows))),
    ciVerify: ciVerify ?? { invocationCount: 0, result: "NOT_RUN", exitCode: null },
    stage6Actions: 0,
    artifacts: rows,
  };
  await writeFile(evidencePath(root, "EVIDENCE_INDEX.json"), `${JSON.stringify(index, null, 2)}\n`);
  return verifyStage5Final15EvidenceIndex({ root, allowedPhases: [phase], requiredPhase: phase });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phaseArgument = process.argv.find((argument) => argument.startsWith("--phase="));
  const phase = phaseArgument?.slice("--phase=".length) ?? "PRE_CI";
  const result = process.argv.includes("--write")
    ? await writeStage5Final15EvidenceIndex({ phase })
    : await verifyStage5Final15EvidenceIndex({
        allowedPhases: [phase],
        requiredPhase: phase,
      });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
