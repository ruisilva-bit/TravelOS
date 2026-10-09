import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL17_EVIDENCE_DIRECTORY,
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL18_EVIDENCE_DIRECTORY,
  STAGE5_FINAL18_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL18_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL18_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL18_READINESS_PREFLIGHT_EVIDENCE,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final17EvidenceIndex } from "./stage-5-final17-evidence-index.mjs";
import { verifyStage5Final18FindingLineage } from "./stage-5-final18-finding-lineage.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const destination = path.join(root, STAGE5_FINAL18_EVIDENCE_DIRECTORY);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (relativePath) => {
  const file = path.join(root, relativePath);
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${relativePath} must be a regular file`);
  return readFile(file);
};
const copyExclusive = async (name, sourcePath) => {
  const bytes = await readRegular(sourcePath);
  const output = path.join(destination, name);
  try {
    const existing = await readFile(output);
    assert.deepEqual(existing, bytes, `refusing to overwrite divergent evidence: ${name}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(output, bytes, { flag: "wx" });
  }
  return { name, bytes: bytes.length, sha256: hash(bytes) };
};

const predecessor = await verifyStage5Final17EvidenceIndex({ root, requiredPhase: "FINAL" });
assert.equal(predecessor.result, "PASS");
assert.equal(predecessor.candidate, "FINAL-17");
try {
  const metadata = await lstat(destination);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink());
  const existing = await readdir(destination, { withFileTypes: true });
  const allowed = new Set([
    ...STAGE5_FINAL18_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
    "EVIDENCE_INDEX.json",
  ]);
  assert(
    existing.every((entry) => entry.isFile() && !entry.isSymbolicLink() && allowed.has(entry.name)),
    "existing FINAL-18 evidence directory contains an unexpected path",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await mkdir(destination, { recursive: false });
}
const predecessorCopies = [
  ["final17-EVIDENCE_INDEX.json", `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`],
  [
    "final17-baseline-generation.json",
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/baseline-generation.json`,
  ],
  [
    "final17-candidate-validation.md",
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_17_CANDIDATE_VALIDATION.md",
  ],
  [
    "final17-candidate-freeze-placeholder.md",
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_17_CANDIDATE_FREEZE.md",
  ],
  [
    "final17-correction-matrix.json",
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_17_CORRECTION_MATRIX.json",
  ],
  ["final17-ci-verify.log", `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/ci-verify.log`],
  [
    "final17-ci-verify-execution.json",
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/ci-verify-execution.json`,
  ],
  [
    "final17-post-ci-finalization-failure.json",
    ".hermes/state/stage5-final17-post-ci-finalization-failure.json",
  ],
  [
    "final17-post-ci-finalization-failure.log",
    ".hermes/state/stage5-final17-post-ci-finalization-failure.log",
  ],
  [
    "final17-invalid-final-index-attempt.json",
    ".hermes/state/stage5-final17-invalid-final-index-attempt.json",
  ],
  [
    "final17-final-candidate-scope-failure.json",
    ".hermes/state/stage5-final17-final-candidate-scope-failure.json",
  ],
  [
    "final17-final-candidate-scope-failure.log",
    ".hermes/state/stage5-final17-final-candidate-scope-failure.log",
  ],

  ["final17-ci-invocation-guard.json", ".hermes/state/stage5-final17-ci-verify-invocation.json"],
  ["final17-pre-ci-freeze-guard.json", ".hermes/state/stage5-final17-pre-ci-freeze-guard.json"],
];
const copied = [];
for (const [name, sourcePath] of predecessorCopies)
  copied.push(await copyExclusive(name, sourcePath));
const baselinePath = "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json";
const baselineBytes = await readRegular(baselinePath);
const baseline = JSON.parse(baselineBytes.toString("utf8"));
assert.equal(baseline.lineage.final17Generation.candidate, "FINAL-17");
assert.equal(baseline.lineage.final17Generation.stage6Actions, 0);

const matrixBytes = await readRegular(STAGE5_FINAL18_CORRECTION_MATRIX);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
assert.equal(matrix.candidate, "FINAL-18");
assert.equal(matrix.findings.length, 49);
assert.equal(matrix.summary.authorClosedCount, 0);
assert.equal(matrix.stage6Actions, 0);
copied.push(
  await copyExclusive("final18-correction-matrix.json", STAGE5_FINAL18_CORRECTION_MATRIX),
);
const lineage = await verifyStage5Final18FindingLineage({ root, write: true });
assert.equal(lineage.result, "PASS");
const lineagePath = `${STAGE5_FINAL18_EVIDENCE_DIRECTORY}/finding-lineage.json`;
copied.push({
  name: "finding-lineage.json",
  bytes: (await readFile(path.join(root, lineagePath))).length,
  sha256: hash(await readFile(path.join(root, lineagePath))),
});

const writePending = async (name, bytes) => {
  const output = path.join(destination, name);
  try {
    assert.deepEqual(await readFile(output), bytes, `divergent pre-existing ${name}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(output, bytes, { flag: "wx" });
  }
};
await writePending("ci-verify.log", Buffer.from(STAGE5_FINAL18_CI_LOG_PLACEHOLDER));
await writePending(
  "ci-verify-execution.json",
  Buffer.from(STAGE5_FINAL18_CI_EXECUTION_PLACEHOLDER),
);
await writePending(
  path.basename(STAGE5_FINAL18_READINESS_PREFLIGHT_EVIDENCE),
  Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: "FINAL-18",
        phase: "PRE_CI",
        result: "PENDING",
        ciVerifyInvoked: false,
        invocationCount: 0,
        stage6Actions: 0,
      },
      null,
      2,
    )}\n`,
  ),
);
await copyExclusive("migration-checksums.json", "migrations/checksums.json");
const names = (await readdir(destination)).toSorted();
const expectedNames = [...STAGE5_FINAL18_EXPECTED_EVIDENCE_ARTIFACT_NAMES].filter(
  (name) =>
    ![
      "baseline-generation.json",
      "final17-security-extension-baseline.json",
      "focused-test-execution.json",
      "focused-tests.log",
      "format-check-execution.json",
      "format-check.log",
      "lint-check-execution.json",
      "lint-check.log",
      "typecheck-execution.json",
      "typecheck.log",
      "migration-check-execution.json",
      "migration-check.log",
      "postgresql-qualification-continuity.json",
      "postgresql-disposable-cleanup.json",
      "postgresql-integration-test-execution.json",
      "postgresql-integration-tests.log",
      "postgresql-package-build.json",
      "postgresql-package-provenance.json",
      "postgresql-runtime.json",
      "postgresql-qualification-execution.json",
      "postgresql-qualification-runner.log",
      "postgresql-qualification.json",
      "source-scope-test.json",
      "source-scope-tests.log",
    ].includes(name),
);
assert.deepEqual({ names, expectedNames }, { names: expectedNames, expectedNames });
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-18",
      predecessorArtifactsCopied: predecessorCopies.length,
      copiedArtifactCount: copied.length,
      predecessorIndexSha256: predecessor.indexSha256,
      matrixSha256: hash(matrixBytes),
      baselineStillFinal17: hash(baselineBytes),
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
