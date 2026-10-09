import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  STAGE5_FINAL11_CI_FAILED_INDEX_SHA256,
  STAGE5_FINAL12_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL12_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL12_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL12_EVIDENCE_DIRECTORY,
  STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const serialize = (rows) => rows.map((r) => `${r.path}\t${r.bytes}\t${r.sha256}\n`).join("");
const names = [...STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES].toSorted();
const file = (root, name) => path.join(root, STAGE5_FINAL12_EVIDENCE_DIRECTORY, name);
const exactNames = async (root, includeIndex) => {
  const dir = path.join(root, STAGE5_FINAL12_EVIDENCE_DIRECTORY);
  const s = await lstat(dir);
  assert(s.isDirectory() && !s.isSymbolicLink());
  const entries = await readdir(dir, { withFileTypes: true });
  const expected = includeIndex ? [...names, "EVIDENCE_INDEX.json"].toSorted() : names;
  assert.deepEqual(entries.map((e) => e.name).toSorted(), expected);
  assert(entries.every((e) => e.isFile() && !e.isSymbolicLink()));
};
export const verifyStage5Final12EvidenceIndex = async ({
  root = process.cwd(),
  allowedPhases = ["PRE_CI", "FINAL", "CI_FAILED"],
  requiredPhase,
} = {}) => {
  await exactNames(root, true);
  const indexBytes = await readFile(file(root, "EVIDENCE_INDEX.json"));
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.candidate, "FINAL-12");
  assert(allowedPhases.includes(index.phase));
  if (requiredPhase) assert.equal(index.phase, requiredPhase);
  assert.equal(index.artifactCount, names.length);
  assert.equal(index.aggregateSerialization, STAGE5_FINAL12_EVIDENCE_AGGREGATE_SERIALIZATION);
  assert.equal(index.stage6Actions, 0);
  const expectedPaths = names.map((n) => `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/${n}`).toSorted();
  const rows = [...index.artifacts].toSorted((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  assert.deepEqual(
    rows.map((r) => r.path),
    expectedPaths,
  );
  const actual = [];
  for (const row of rows) {
    const bytes = await readFile(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes, `byte count mismatch ${row.path}`);
    assert.equal(sha256(bytes), row.sha256, `SHA-256 mismatch ${row.path}`);
    actual.push({ path: row.path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const aggregate = sha256(Buffer.from(serialize(actual)));
  assert.equal(index.aggregateSha256, aggregate);
  const logBytes = await readFile(file(root, "ci-verify.log"));
  const executionBytes = await readFile(file(root, "ci-verify-execution.json"));
  if (index.phase === "PRE_CI") {
    assert.equal(index.ciVerify.invocationCount, 0);
    assert.equal(index.ciVerify.result, "NOT_RUN");
    assert.equal(logBytes.toString("utf8"), STAGE5_FINAL12_CI_LOG_PLACEHOLDER);
    assert.equal(executionBytes.toString("utf8"), STAGE5_FINAL12_CI_EXECUTION_PLACEHOLDER);
  } else {
    const execution = JSON.parse(executionBytes.toString("utf8"));
    assert.equal(execution.candidate, "FINAL-12");
    assert.equal(execution.invocationCount, 1);
    assert.equal(execution.command, "corepack pnpm ci:verify");
    assert.equal(execution.logBytes, logBytes.length);
    assert.equal(execution.logSha256, sha256(logBytes));
    assert.equal(index.phase, execution.exitCode === 0 ? "FINAL" : "CI_FAILED");
    assert.equal(execution.result, execution.exitCode === 0 ? "PASS" : "FAIL");
    assert.equal(index.ciVerify.invocationCount, 1);
    assert.equal(index.ciVerify.exitCode, execution.exitCode);
    assert.equal(index.ciVerify.result, execution.result);
  }
  const predecessorBytes = await readFile(file(root, "final11-EVIDENCE_INDEX.json"));
  const predecessor = JSON.parse(predecessorBytes.toString("utf8"));
  assert.equal(predecessor.candidate, "FINAL-11");
  assert.equal(predecessor.phase, "CI_FAILED");
  assert.equal(sha256(predecessorBytes), STAGE5_FINAL11_CI_FAILED_INDEX_SHA256);
  return {
    result: "PASS",
    candidate: "FINAL-12",
    phase: index.phase,
    indexBytes: indexBytes.length,
    indexSha256: sha256(indexBytes),
    artifactCount: rows.length,
    aggregateSha256: aggregate,
    artifactBytesManifest: actual,
    final11IndexSha256: STAGE5_FINAL11_CI_FAILED_INDEX_SHA256,
    stage6Actions: index.stage6Actions,
  };
};
export const writeStage5Final12EvidenceIndex = async ({ root = process.cwd(), phase } = {}) => {
  assert(["PRE_CI", "FINAL", "CI_FAILED"].includes(phase));
  await mkdir(path.join(root, STAGE5_FINAL12_EVIDENCE_DIRECTORY), { recursive: true });
  if (phase === "PRE_CI") {
    for (const [name, expected] of [
      ["ci-verify.log", STAGE5_FINAL12_CI_LOG_PLACEHOLDER],
      ["ci-verify-execution.json", STAGE5_FINAL12_CI_EXECUTION_PLACEHOLDER],
    ]) {
      try {
        const current = await readFile(file(root, name), "utf8");
        assert.equal(current, expected, `refusing to replace non-placeholder ${name}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await writeFile(file(root, name), expected, { flag: "wx" });
      }
    }
  }
  let indexAlreadyExists = false;
  try {
    await lstat(file(root, "EVIDENCE_INDEX.json"));
    indexAlreadyExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await exactNames(root, indexAlreadyExists);
  const artifacts = [];
  for (const name of names) {
    const bytes = await readFile(file(root, name));
    artifacts.push({
      path: `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/${name}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  const ciVerify =
    phase === "PRE_CI"
      ? { invocationCount: 0, result: "NOT_RUN", exitCode: null }
      : {
          ...JSON.parse((await readFile(file(root, "ci-verify-execution.json"))).toString("utf8")),
          logSha256: sha256(await readFile(file(root, "ci-verify.log"))),
          logBytes: (await readFile(file(root, "ci-verify.log"))).length,
        };
  const index = {
    schemaVersion: 1,
    candidate: "FINAL-12",
    phase,
    result: phase === "PRE_CI" ? "READY" : "RECORDED",
    artifactCount: artifacts.length,
    aggregateSerialization: STAGE5_FINAL12_EVIDENCE_AGGREGATE_SERIALIZATION,
    aggregateSha256: sha256(Buffer.from(serialize(artifacts))),
    ciVerify,
    artifacts,
    stage6Actions: 0,
  };
  await writeFile(file(root, "EVIDENCE_INDEX.json"), `${JSON.stringify(index, null, 2)}\n`);
  return verifyStage5Final12EvidenceIndex({ root, allowedPhases: [phase], requiredPhase: phase });
};
