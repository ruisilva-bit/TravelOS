import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STAGE5_FINAL19_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL19_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL19_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
  STAGE5_FINAL19_EVIDENCE_INDEX,
  STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";
import { assertExactArtifactPathSet } from "./stage-5-artifact-path-set.mjs";
import { verifyStage5Final19FindingLineage } from "./stage-5-final19-finding-lineage.mjs";
import { verifyStage5Final18EvidenceIndex } from "./stage-5-final18-evidence-index.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const expectedNames = [...STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES].toSorted();
const evidencePath = (root, name) => path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY, name);

const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};

export const verifyStage5Final19EvidenceIndex = async ({
  root = process.cwd(),
  allowedPhases = ["PRE_CI", "FINAL", "CI_FAILED"],
  requiredPhase,
} = {}) => {
  const directory = path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
  const entries = await readdir(directory, { withFileTypes: true });
  assert(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()));
  assertExactArtifactPathSet(
    [...expectedNames, "EVIDENCE_INDEX.json"],
    entries.map((entry) => entry.name),
    "FINAL-19 evidence directory",
  );

  const indexBytes = await readRegular(evidencePath(root, "EVIDENCE_INDEX.json"));
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.candidate, "FINAL-19");
  assert(allowedPhases.includes(index.phase));
  if (requiredPhase) assert.equal(index.phase, requiredPhase);
  assert.equal(index.artifactCount, expectedNames.length);
  assert.equal(index.aggregateSerialization, STAGE5_FINAL19_EVIDENCE_AGGREGATE_SERIALIZATION);
  assert.equal(index.stage6Actions, 0);

  const expectedPaths = expectedNames.map((name) => `${STAGE5_FINAL19_EVIDENCE_DIRECTORY}/${name}`);
  assertExactArtifactPathSet(
    expectedPaths,
    index.artifacts.map((row) => row.path),
    "FINAL-19 index rows",
  );
  const rows = [...index.artifacts].toSorted((left, right) => left.path.localeCompare(right.path));
  const actual = [];
  for (const row of rows) {
    const bytes = await readRegular(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes, `FINAL-19 byte count mismatch: ${row.path}`);
    assert.equal(hash(bytes), row.sha256, `FINAL-19 SHA-256 mismatch: ${row.path}`);
    actual.push({ path: row.path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const aggregateSha256 = hash(Buffer.from(serialize(actual)));
  assert.equal(index.aggregateSha256, aggregateSha256);

  const logBytes = await readRegular(evidencePath(root, "ci-verify.log"));
  const executionBytes = await readRegular(evidencePath(root, "ci-verify-execution.json"));
  if (index.phase === "PRE_CI") {
    assert.equal(index.ciVerify.invocationCount, 0);
    assert.equal(index.ciVerify.result, "NOT_RUN");
    assert.equal(logBytes.toString("utf8"), STAGE5_FINAL19_CI_LOG_PLACEHOLDER);
    assert.equal(executionBytes.toString("utf8"), STAGE5_FINAL19_CI_EXECUTION_PLACEHOLDER);
  } else {
    const execution = JSON.parse(executionBytes.toString("utf8"));
    assert.equal(execution.candidate, "FINAL-19");
    assert.equal(execution.invocationCount, 1);
    assert.equal(execution.command, "corepack pnpm ci:verify");
    assert.equal(execution.logBytes, logBytes.length);
    assert.equal(execution.logSha256, hash(logBytes));
    assert.equal(index.phase, execution.result === "PASS" ? "FINAL" : "CI_FAILED");
    assert.equal(
      execution.result,
      execution.exitCode === 0 && execution.childVerification?.result === "PASS" ? "PASS" : "FAIL",
    );
    assert.equal(index.ciVerify.invocationCount, 1);
    assert.equal(index.ciVerify.exitCode, execution.exitCode);
    assert.equal(index.ciVerify.result, execution.result);
  }

  const predecessor = await verifyStage5Final18EvidenceIndex({ root, requiredPhase: "PRE_CI" });
  const lineage = await verifyStage5Final19FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  return {
    result: "PASS",
    candidate: "FINAL-19",
    phase: index.phase,
    indexPath: STAGE5_FINAL19_EVIDENCE_INDEX,
    aggregateSerialization: STAGE5_FINAL19_EVIDENCE_AGGREGATE_SERIALIZATION,
    indexBytes: indexBytes.length,
    indexSha256: hash(indexBytes),
    artifactCount: rows.length,
    matched: rows.length,
    artifactBytesManifest: actual,
    recomputedAggregateSha256: aggregateSha256,
    aggregateSha256,
    missing: [],
    unexpected: [],
    duplicates: [],
    hashMismatches: [],
    sizeMismatches: [],
    predecessorIndexSha256: predecessor.indexSha256,
    lineageMatrixSha256: lineage.correctionMatrix.sha256,
    stage6Actions: 0,
  };
};

export const writeStage5Final19EvidenceIndex = async ({
  root = process.cwd(),
  phase = "PRE_CI",
  ciVerify,
} = {}) => {
  assert(["PRE_CI", "FINAL", "CI_FAILED"].includes(phase));
  const directory = path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
  const rows = [];
  for (const name of expectedNames) {
    const bytes = await readRegular(path.join(directory, name));
    rows.push({
      path: `${STAGE5_FINAL19_EVIDENCE_DIRECTORY}/${name}`,
      bytes: bytes.length,
      sha256: hash(bytes),
    });
  }
  rows.sort((left, right) => left.path.localeCompare(right.path));
  assertExactArtifactPathSet(
    expectedNames,
    rows.map((row) => path.posix.basename(row.path)),
    "FINAL-19 index input",
  );
  const index = {
    schemaVersion: 1,
    candidate: "FINAL-19",
    phase,
    artifactCount: rows.length,
    aggregateSerialization: STAGE5_FINAL19_EVIDENCE_AGGREGATE_SERIALIZATION,
    aggregateSha256: hash(Buffer.from(serialize(rows))),
    ciVerify: ciVerify ?? { invocationCount: 0, result: "NOT_RUN", exitCode: null },
    stage6Actions: 0,
    artifacts: rows,
  };
  await writeFile(evidencePath(root, "EVIDENCE_INDEX.json"), `${JSON.stringify(index, null, 2)}\n`);
  return verifyStage5Final19EvidenceIndex({ root, allowedPhases: [phase], requiredPhase: phase });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phaseArgument = process.argv.find((argument) => argument.startsWith("--phase="));
  const phase = phaseArgument?.slice("--phase=".length) ?? "PRE_CI";
  const result = process.argv.includes("--write")
    ? await writeStage5Final19EvidenceIndex({ root: process.cwd(), phase })
    : await verifyStage5Final19EvidenceIndex({
        root: process.cwd(),
        allowedPhases: [phase],
        requiredPhase: phase,
      });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
