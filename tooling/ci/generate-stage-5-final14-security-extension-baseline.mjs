import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL13_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL13_FREEZE_SHA256,
  STAGE5_FINAL13_INDEX_SHA256,
  STAGE5_FINAL13_REVIEW_NO_GO_SHA256,
  STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final14FindingLineage } from "./stage-5-final14-finding-lineage.mjs";
import {
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const baselinePath = path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const allowedDeltas = [
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
  "package.json",
].toSorted();

export const buildStage5Final14SecurityExtensionBaseline = ({
  previousBaseline,
  currentFiles,
  lineage,
}) => {
  assert.equal(previousBaseline.result, "PASS");
  assert.equal(
    hash(Buffer.from(`${JSON.stringify(previousBaseline, null, 2)}\n`)),
    STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
  );
  assert.equal(previousBaseline.lineage.final13Generation?.candidate, "FINAL-13");
  assert.equal(lineage.result, "PASS");
  assert.equal(lineage.candidate, "FINAL-14");
  assert.equal(lineage.totalFindingCount, 49);
  assert.equal(lineage.stage6Actions, 0);
  const previousRows = previousBaseline.protectedFiles;
  const rows = currentFiles.map(({ path: relativePath, bytes }) => ({
    path: relativePath,
    bytes: bytes.length,
    sha256: hash(bytes),
  }));
  assert.deepEqual(
    rows.map((row) => row.path),
    [...STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS],
  );
  const previous = new Map(previousRows.map((row) => [row.path, row]));
  const deltas = rows
    .filter((row) => previous.get(row.path)?.sha256 !== row.sha256)
    .map((row) => ({
      path: row.path,
      previousSha256: previous.get(row.path)?.sha256,
      currentSha256: row.sha256,
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(
    deltas.map((delta) => delta.path),
    allowedDeltas,
    "FINAL-14 refuses missing, extra, duplicate or unauthorized protected drift",
  );
  const next = JSON.parse(JSON.stringify(previousBaseline));
  const extensionDocument = currentFiles.find(
    (file) => file.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  )?.bytes;
  assert(extensionDocument);
  next.lineage.extensionDocument = {
    path: STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
    sha256: hash(extensionDocument),
  };
  const packageBytes = currentFiles.find((file) => file.path === "package.json")?.bytes;
  assert(packageBytes);
  next.lineage.final14Generation = {
    candidate: "FINAL-14",
    previousBaselineSha256: STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
    packageJsonSha256: hash(packageBytes),
    runnerSha256: lineage.runner.sha256,
    correctionMatrixSha256: lineage.correctionMatrix.sha256,
    independentReviewNoGoSha256: STAGE5_FINAL13_REVIEW_NO_GO_SHA256,
    stage6Actions: 0,
    protectedPathDeltas: deltas,
  };
  next.lineage.rejectedFinal13Candidate = {
    candidate: "FINAL-13",
    status: "REJECTED / CI CONSUMED / CI PASS / INDEPENDENT REVIEW NO-GO",
    ciCommand: "corepack pnpm ci:verify",
    ciInvocationCount: 1,
    ciResult: "PASS",
    ciExitCode: 0,
    ciLogSha256: lineage.final13.ciLogSha256,
    ciExecutionSha256: lineage.final13.ciExecutionSha256,
    invocationGuardSha256: lineage.final13.invocationGuardSha256,
    evidenceIndexSha256: STAGE5_FINAL13_INDEX_SHA256,
    correctionMatrixSha256: STAGE5_FINAL13_CORRECTION_MATRIX_SHA256,
    independentReviewNoGoSha256: STAGE5_FINAL13_REVIEW_NO_GO_SHA256,
    freezeSha256: STAGE5_FINAL13_FREEZE_SHA256,
    stage6Actions: 0,
  };
  next.protectedFiles = rows;
  next.aggregateSha256 = hash(Buffer.from(serialize(rows)));
  return next;
};

export const generateStage5Final14SecurityExtensionBaseline = async ({
  root: candidateRoot = root,
} = {}) => {
  const rootDir = path.resolve(candidateRoot);
  const evidenceDirectory = path.join(rootDir, STAGE5_FINAL14_EVIDENCE_DIRECTORY);
  const priorBaselinePath = path.join(
    evidenceDirectory,
    "final13-security-extension-baseline.json",
  );
  const currentBaselineBytes = await readFile(
    path.join(rootDir, STAGE5_SECURITY_EXTENSION_BASELINE_PATH),
  );
  const currentHash = hash(currentBaselineBytes);
  let priorBytes;
  if (currentHash === STAGE5_FINAL13_SECURITY_BASELINE_SHA256) {
    priorBytes = currentBaselineBytes;
  } else {
    const active = JSON.parse(currentBaselineBytes.toString("utf8"));
    assert.equal(
      active.lineage.final14Generation?.candidate,
      "FINAL-14",
      "active baseline belongs to an unknown candidate",
    );
    priorBytes = await readFile(priorBaselinePath);
  }
  assert.equal(
    hash(priorBytes),
    STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
    "preserved FINAL-13 baseline bytes changed",
  );
  const previousBaseline = JSON.parse(priorBytes.toString("utf8"));
  const lineage = await verifyStage5Final14FindingLineage({ root: rootDir });
  const currentFiles = await Promise.all(
    STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (relativePath) => ({
      path: relativePath,
      bytes: await readFile(path.join(rootDir, relativePath)),
    })),
  );
  const baseline = buildStage5Final14SecurityExtensionBaseline({
    previousBaseline,
    currentFiles,
    lineage,
  });
  const bytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  const baselineSha256 = hash(bytes);
  await mkdir(evidenceDirectory, { recursive: true });
  try {
    const existing = await readFile(priorBaselinePath);
    assert.deepEqual(existing, priorBytes, "preserved FINAL-13 baseline copy changed");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(priorBaselinePath, priorBytes, { flag: "wx" });
  }
  await writeFile(baselinePath, bytes);
  const verification = await verifyStage5SecurityExtensionBaseline({
    root: rootDir,
    expectedBaselineSha256: baselineSha256,
    requireCandidate: "FINAL-14",
  });
  assert.equal(verification.result, "PASS");
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-14",
    result: "PASS",
    generationOrder: [
      "FINAL-14 runner/script references finalized",
      "package.json finalized",
      "candidate-specific tooling/configuration finalized",
      "Phase 1 baseline computed and written",
      "baseline verified against current protected bytes",
    ],
    previousBaselineSha256: hash(priorBytes),
    baselineSha256,
    baselineBytes: bytes.length,
    protectedPathCount: rowsCount(baseline.protectedFiles),
    permittedDeltaPaths: baseline.lineage.final14Generation.protectedPathDeltas.map(
      (delta) => delta.path,
    ),
    packageJsonSha256: baseline.lineage.final14Generation.packageJsonSha256,
    runnerSha256: baseline.lineage.final14Generation.runnerSha256,
    final13ReviewNoGoSha256: STAGE5_FINAL13_REVIEW_NO_GO_SHA256,
    toolchain: { node: process.version },
    stage6Actions: 0,
  };
  await writeFile(
    path.join(evidenceDirectory, "baseline-generation.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
};

function rowsCount(rows) {
  assert.equal(rows.length, STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.length);
  return rows.length;
}

if (process.argv.includes("--write")) {
  const receipt = await generateStage5Final14SecurityExtensionBaseline();
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
