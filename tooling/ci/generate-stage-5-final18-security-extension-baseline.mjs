import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import {
  STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL18_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import {
  STAGE5_FINAL18_SECURITY_EXTENSION_PROTECTED_PATHS,
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";
import { verifyStage5Final18FindingLineage } from "./stage-5-final18-finding-lineage.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const allowedDeltas = ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"];

export const buildStage5Final18SecurityExtensionBaseline = ({
  previousBaseline,
  currentFiles,
  lineage,
}) => {
  assert.equal(previousBaseline.result, "PASS");
  assert.equal(
    hash(Buffer.from(`${JSON.stringify(previousBaseline, null, 2)}\n`)),
    STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
  );
  assert.equal(previousBaseline.lineage.final17Generation?.candidate, "FINAL-17");
  assert.equal(lineage.result, "PASS");
  assert.equal(lineage.candidate, "FINAL-18");
  assert.equal(lineage.findings.total, 49);
  assert.equal(lineage.findings.authorClosed, 0);
  assert.equal(lineage.findings.pendingIndependent, 49);
  assert.equal(lineage.predecessor.candidate, "FINAL-17");
  assert.equal(lineage.predecessor.ciInvocationCount, 1);
  assert.equal(lineage.predecessor.ciResult, "PASS");
  assert.equal(lineage.predecessor.ciAuthorizationConsumed, true);
  assert.equal(lineage.predecessor.ciAuthorizationTransferred, false);
  assert.equal(lineage.stage6Actions, 0);

  const rows = currentFiles.map(({ path: relativePath, bytes }) => ({
    path: relativePath,
    bytes: bytes.length,
    sha256: hash(bytes),
  }));
  assert.deepEqual(
    rows.map((row) => row.path),
    [...STAGE5_FINAL18_SECURITY_EXTENSION_PROTECTED_PATHS],
  );
  const previous = new Map(previousBaseline.protectedFiles.map((row) => [row.path, row]));
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
    [...allowedDeltas].toSorted(),
    "FINAL-18 refuses missing, extra, duplicate or unauthorized protected drift",
  );

  const next = JSON.parse(JSON.stringify(previousBaseline));
  const extensionDocument = currentFiles.find(
    (file) => file.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  )?.bytes;
  const packageBytes = currentFiles.find((file) => file.path === "package.json")?.bytes;
  assert(extensionDocument);
  assert(packageBytes);
  next.lineage.extensionDocument = {
    path: STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
    sha256: hash(extensionDocument),
  };
  next.lineage.final18Generation = {
    candidate: "FINAL-18",
    previousBaselineSha256: STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
    packageJsonSha256: hash(packageBytes),
    runnerSha256: lineage.runner.sha256,
    correctionMatrixSha256: lineage.correctionMatrix.sha256,
    stage6Actions: 0,
    protectedPathDeltas: deltas,
  };
  next.lineage.rejectedFinal17Candidate = {
    candidate: "FINAL-17",
    status: "REJECTED / POST-CI SOURCE-SCOPE FAILURE / FREEZE NOT CREATED",
    ciCommand: "corepack pnpm ci:verify",
    ciInvocationCount: 1,
    ciResult: "PASS",
    ciExitCode: 0,
    ciLogSha256: lineage.predecessor.ciLogSha256,
    ciExecutionSha256: lineage.predecessor.ciExecutionSha256,
    evidenceIndexSha256: lineage.predecessor.evidenceIndexSha256,
    evidenceAggregateSha256: lineage.predecessor.evidenceAggregateSha256,
    scopeFailureReceiptSha256: lineage.predecessor.scopeFailureReceiptSha256,
    authorizationConsumed: true,
    authorizationTransferred: false,
    stage6Actions: 0,
  };
  next.protectedFiles = rows;
  next.aggregateSha256 = hash(Buffer.from(serialize(rows)));
  return next;
};

export const generateStage5Final18SecurityExtensionBaseline = async ({
  root: candidateRoot = root,
  write = false,
} = {}) => {
  const candidate = path.resolve(candidateRoot);
  const baselinePath = path.join(candidate, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
  const priorBytes = await readFile(baselinePath);
  assert.equal(
    hash(priorBytes),
    STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
    "FINAL-18 baseline generation is one-shot from the immutable FINAL-17 baseline",
  );
  const previousBaseline = JSON.parse(priorBytes.toString("utf8"));
  const lineage = await verifyStage5Final18FindingLineage({ root: candidate });
  const runnerPath = "tooling/ci/run-stage-5-final18-authoritative-ci.mjs";
  const runnerBytes = await readFile(path.join(candidate, runnerPath));
  const matrixBytes = await readFile(path.join(candidate, STAGE5_FINAL18_CORRECTION_MATRIX));
  assert.equal(hash(matrixBytes), lineage.correctionMatrix.sha256);
  lineage.runner = { path: runnerPath, sha256: hash(runnerBytes) };
  const currentFiles = await Promise.all(
    STAGE5_FINAL18_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (relativePath) => ({
      path: relativePath,
      bytes: await readFile(path.join(candidate, relativePath)),
    })),
  );
  const baseline = buildStage5Final18SecurityExtensionBaseline({
    previousBaseline,
    currentFiles,
    lineage,
  });
  const bytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  const verification = await verifyStage5SecurityExtensionBaseline({
    root: candidate,
    expectedBaselineSha256: hash(bytes),
    requireCandidate: "FINAL-18",
    baselineBytesOverride: bytes,
  });
  assert.equal(verification.result, "PASS");
  const result = {
    result: "PASS",
    candidate: "FINAL-18",
    previousBaselineSha256: STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
    baselineSha256: hash(bytes),
    protectedPathCount: baseline.protectedFiles.length,
    protectedPathDeltas: baseline.lineage.final18Generation.protectedPathDeltas,
    permittedDeltaPaths: baseline.lineage.final18Generation.protectedPathDeltas.map(
      (delta) => delta.path,
    ),
    lineageFindingCount: lineage.findings.total,
    stage6Actions: 0,
  };
  if (write) {
    const evidenceDirectory = path.join(candidate, STAGE5_FINAL18_EVIDENCE_DIRECTORY);
    await mkdir(evidenceDirectory, { recursive: true });
    const backupPath = path.join(evidenceDirectory, "final17-security-extension-baseline.json");
    await writeFile(backupPath, priorBytes, { flag: "wx" });
    const currentBytes = await readFile(baselinePath);
    assert.equal(hash(currentBytes), STAGE5_FINAL17_SECURITY_BASELINE_SHA256);
    await writeFile(baselinePath, bytes);
    const actual = await readFile(baselinePath);
    assert.deepEqual(
      actual,
      bytes,
      "written FINAL-18 security baseline differs from verified bytes",
    );
    assert.equal(hash(actual), result.baselineSha256);
    const receiptPath = path.join(evidenceDirectory, "baseline-generation.json");
    const receiptBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    await writeFile(receiptPath, receiptBytes, { flag: "wx" });
    assert.deepEqual(await readFile(receiptPath), receiptBytes);
  }
  return result;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateStage5Final18SecurityExtensionBaseline({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
