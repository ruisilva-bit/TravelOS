import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  STAGE5_FINAL13_CANDIDATE_FREEZE,
  STAGE5_FINAL13_CANDIDATE_VALIDATION,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
  STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL13_INDEX_SHA256,
  STAGE5_FINAL13_REVIEW_NO_GO,
  STAGE5_FINAL13_ARCHIVE_MANIFEST,
  STAGE5_FINAL13_SOURCE_ARCHIVE,
  STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL14_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL14_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
  STAGE5_FINAL14_EVIDENCE_INDEX,
  STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final14FindingLineage } from "./stage-5-final14-finding-lineage.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const names = [...STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES].toSorted();
const filePath = (root, name) => path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY, name);
const assertRegular = async (file) => {
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${file} must be a regular file`);
  return readFile(file);
};
const exactDirectory = async (root, includeIndex) => {
  const directory = path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY);
  const metadata = await lstat(directory);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink());
  const entries = await readdir(directory, { withFileTypes: true });
  const expected = includeIndex ? [...names, "EVIDENCE_INDEX.json"].toSorted() : names;
  assert.deepEqual(entries.map((entry) => entry.name).toSorted(), expected);
  assert(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()));
};

export const verifyStage5Final14EvidenceIndex = async ({
  root = process.cwd(),
  allowedPhases = ["PRE_CI", "FINAL", "CI_FAILED"],
  requiredPhase,
} = {}) => {
  await exactDirectory(root, true);
  const indexBytes = await assertRegular(filePath(root, "EVIDENCE_INDEX.json"));
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.candidate, "FINAL-14");
  assert(allowedPhases.includes(index.phase));
  if (requiredPhase) assert.equal(index.phase, requiredPhase);
  assert.equal(index.artifactCount, names.length);
  assert.equal(index.aggregateSerialization, STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION);
  assert.equal(index.stage6Actions, 0);
  const expectedPaths = names
    .map((name) => `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/${name}`)
    .toSorted();
  const rows = [...index.artifacts].toSorted((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  assert.deepEqual(
    rows.map((row) => row.path),
    expectedPaths,
  );
  const actual = [];
  for (const row of rows) {
    const bytes = await assertRegular(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes, `byte count mismatch ${row.path}`);
    assert.equal(hash(bytes), row.sha256, `SHA-256 mismatch ${row.path}`);
    actual.push({ path: row.path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const aggregate = hash(Buffer.from(serialize(actual)));
  assert.equal(index.aggregateSha256, aggregate);
  const logBytes = await assertRegular(filePath(root, "ci-verify.log"));
  const executionBytes = await assertRegular(filePath(root, "ci-verify-execution.json"));
  if (index.phase === "PRE_CI") {
    assert.equal(index.ciVerify.invocationCount, 0);
    assert.equal(index.ciVerify.result, "NOT_RUN");
    assert.equal(logBytes.toString("utf8"), STAGE5_FINAL14_CI_LOG_PLACEHOLDER);
    assert.equal(executionBytes.toString("utf8"), STAGE5_FINAL14_CI_EXECUTION_PLACEHOLDER);
  } else {
    const execution = JSON.parse(executionBytes.toString("utf8"));
    assert.equal(execution.candidate, "FINAL-14");
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
  const predecessorIndexBytes = await assertRegular(filePath(root, "final13-EVIDENCE_INDEX.json"));
  assert.equal(hash(predecessorIndexBytes), STAGE5_FINAL13_INDEX_SHA256);
  for (const name of STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
    const source = await assertRegular(path.join(root, STAGE5_FINAL13_EVIDENCE_DIRECTORY, name));
    const copy = await assertRegular(filePath(root, `final13-${name}`));
    assert.deepEqual(copy, source, `FINAL-14 must preserve exact FINAL-13 evidence bytes: ${name}`);
  }
  for (const [copy, source] of [
    ["final13-correction-matrix.json", STAGE5_FINAL13_CORRECTION_MATRIX],
    ["final13-candidate-validation.md", STAGE5_FINAL13_CANDIDATE_VALIDATION],
    ["final13-candidate-freeze.md", STAGE5_FINAL13_CANDIDATE_FREEZE],
    ["final13-independent-review-no-go.json", STAGE5_FINAL13_REVIEW_NO_GO],
    ["final13-archive-manifest.json", STAGE5_FINAL13_ARCHIVE_MANIFEST],
    ["final13-frozen-source-snapshot.tar.gz", STAGE5_FINAL13_SOURCE_ARCHIVE],
  ]) {
    assert.deepEqual(
      await assertRegular(filePath(root, copy)),
      await assertRegular(path.join(root, source)),
    );
  }
  const baselineCopy = await assertRegular(
    filePath(root, "final13-security-extension-baseline.json"),
  );
  assert.equal(hash(baselineCopy), STAGE5_FINAL13_SECURITY_BASELINE_SHA256);
  const lineage = await verifyStage5Final14FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  return {
    result: "PASS",
    candidate: "FINAL-14",
    phase: index.phase,
    indexPath: STAGE5_FINAL14_EVIDENCE_INDEX,
    indexBytes: indexBytes.length,
    indexSha256: hash(indexBytes),
    artifactCount: rows.length,
    matched: rows.length,
    missing: [],
    unexpected: [],
    hashMismatches: [],
    sizeMismatches: [],
    aggregateSerialization: STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION,
    recomputedAggregateSha256: aggregate,
    aggregateSha256: aggregate,
    artifactBytesManifest: actual,
    final13IndexSha256: STAGE5_FINAL13_INDEX_SHA256,
    stage6Actions: index.stage6Actions,
  };
};

export const writeStage5Final14EvidenceIndex = async ({ root = process.cwd(), phase } = {}) => {
  assert(["PRE_CI", "FINAL", "CI_FAILED"].includes(phase));
  const directory = path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  if (phase === "PRE_CI") {
    for (const [name, expected] of [
      ["ci-verify.log", STAGE5_FINAL14_CI_LOG_PLACEHOLDER],
      ["ci-verify-execution.json", STAGE5_FINAL14_CI_EXECUTION_PLACEHOLDER],
    ]) {
      try {
        assert.equal(
          await readFile(filePath(root, name), "utf8"),
          expected,
          `refusing to replace non-placeholder ${name}`,
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await writeFile(filePath(root, name), expected, { flag: "wx" });
      }
    }
  }
  let indexAlreadyExists = false;
  try {
    await lstat(filePath(root, "EVIDENCE_INDEX.json"));
    indexAlreadyExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await exactDirectory(root, indexAlreadyExists);
  const artifacts = [];
  for (const name of names) {
    const bytes = await assertRegular(filePath(root, name));
    artifacts.push({
      path: `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/${name}`,
      bytes: bytes.length,
      sha256: hash(bytes),
    });
  }
  const ciVerify =
    phase === "PRE_CI"
      ? { invocationCount: 0, result: "NOT_RUN", exitCode: null }
      : {
          ...JSON.parse(
            (await readFile(filePath(root, "ci-verify-execution.json"))).toString("utf8"),
          ),
          logSha256: hash(await readFile(filePath(root, "ci-verify.log"))),
          logBytes: (await readFile(filePath(root, "ci-verify.log"))).length,
        };
  const index = {
    schemaVersion: 1,
    candidate: "FINAL-14",
    phase,
    result: phase === "PRE_CI" ? "READY" : "RECORDED",
    artifactCount: artifacts.length,
    aggregateSerialization: STAGE5_FINAL14_EVIDENCE_AGGREGATE_SERIALIZATION,
    aggregateSha256: hash(Buffer.from(serialize(artifacts))),
    ciVerify,
    artifacts,
    stage6Actions: 0,
  };
  await writeFile(filePath(root, "EVIDENCE_INDEX.json"), `${JSON.stringify(index, null, 2)}\n`);
  return verifyStage5Final14EvidenceIndex({ root, allowedPhases: [phase], requiredPhase: phase });
};
