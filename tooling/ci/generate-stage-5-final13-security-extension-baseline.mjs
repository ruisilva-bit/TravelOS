import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL12_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import {
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";
import { verifyStage5Final13FindingLineage } from "./stage-5-final13-finding-lineage.mjs";
const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const serialize = (rows) => rows.map((r) => `${r.path}\t${r.bytes}\t${r.sha256}\n`).join("");
const allowed = ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"].toSorted();
export const buildStage5Final13SecurityExtensionBaseline = ({
  previousBaseline,
  currentFiles,
  lineage,
}) => {
  assert.equal(previousBaseline.result, "PASS");
  assert.equal(
    previousBaseline.protectedFiles.length,
    STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.length,
  );
  assert.equal(previousBaseline.lineage.final12Generation?.candidate, "FINAL-12");
  assert.equal(previousBaseline.lineage.rejectedFinal10Candidate?.candidate, "FINAL-10");
  assert.equal(lineage.result, "PASS");
  assert.equal(lineage.candidate, "FINAL-12");
  assert.equal(lineage.status, "REJECTED");
  assert.equal(lineage.failedGate, "lint");
  const previousRows = [...previousBaseline.protectedFiles];
  const rows = currentFiles.map(({ path: p, bytes }) => ({
    path: p,
    bytes: bytes.length,
    sha256: sha256(bytes),
  }));
  assert.deepEqual(
    rows.map((r) => r.path),
    [...STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS],
  );
  const previous = new Map(previousRows.map((r) => [r.path, r]));
  const changed = rows
    .filter((r) => previous.get(r.path)?.sha256 !== r.sha256)
    .map((r) => r.path)
    .toSorted();
  assert.deepEqual(
    changed,
    allowed,
    "FINAL-13 refuses missing, extra or unauthorized protected drift",
  );
  const next = JSON.parse(JSON.stringify(previousBaseline));
  const doc = currentFiles.find((f) => f.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH)?.bytes;
  assert(doc);
  next.lineage.extensionDocument = {
    path: STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
    sha256: sha256(doc),
  };
  next.lineage.final13Generation = {
    candidate: "FINAL-13",
    previousBaselineSha256: STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
    stage6Actions: 0,
    protectedPathDeltas: changed.map((p) => ({
      path: p,
      previousSha256: previous.get(p).sha256,
      currentSha256: rows.find((r) => r.path === p).sha256,
    })),
  };
  next.lineage.rejectedFinal12Candidate = {
    candidate: "FINAL-12",
    status: "REJECTED / CI CONSUMED / LINT-GATE FAILURE",
    failedGate: "lint",
    command: "corepack pnpm ci:verify",
    invocationCount: 1,
    result: "FAIL",
    exitCode: 1,
    ciLogSha256: lineage.ciLog.sha256,
    ciExecutionSha256: lineage.ciExecution.sha256,
    ciFailedIndexSha256: lineage.evidenceIndex.sha256,
    invocationGuardSha256: lineage.invocationGuard.sha256,
    rejectionRecordSha256: lineage.rejectionRecord.sha256,
    rejectionMatrixSha256: lineage.rejectionMatrix.sha256,
    correctionMatrixSha256: STAGE5_FINAL12_CORRECTION_MATRIX_SHA256,
    previousBaselineSha256: lineage.priorSecurityBaseline.sha256,
    stage6Actions: 0,
  };
  next.protectedFiles = rows;
  next.aggregateSha256 = sha256(Buffer.from(serialize(rows)));
  return next;
};
export const generateStage5Final13SecurityExtensionBaseline = async ({
  root = repositoryRoot,
} = {}) => {
  const baselinePath = path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
  const dir = path.join(root, STAGE5_FINAL13_EVIDENCE_DIRECTORY);
  await mkdir(dir, { recursive: true });
  const priorPath = path.join(dir, "final12-security-extension-baseline.json");
  let priorBytes;
  try {
    const active = await readFile(baselinePath);
    if (sha256(active) === STAGE5_FINAL12_SECURITY_BASELINE_SHA256) priorBytes = active;
    else {
      const current = JSON.parse(active.toString("utf8"));
      assert.equal(
        current.lineage?.final13Generation?.candidate,
        "FINAL-13",
        "active baseline belongs to an unknown candidate",
      );
      priorBytes = await readFile(priorPath);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw error;
  }
  assert.equal(
    sha256(priorBytes),
    STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
    "preserved FINAL-12 baseline bytes changed",
  );
  const previousBaseline = JSON.parse(priorBytes.toString("utf8"));
  const lineage = await verifyStage5Final13FindingLineage({ root });
  try {
    const existing = await readFile(priorPath);
    assert.deepEqual(existing, priorBytes, "preserved FINAL-12 baseline copy changed");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(priorPath, priorBytes, { flag: "wx" });
  }
  const currentFiles = await Promise.all(
    STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (p) => ({
      path: p,
      bytes: await readFile(path.join(root, p)),
    })),
  );
  const baseline = buildStage5Final13SecurityExtensionBaseline({
    previousBaseline,
    currentFiles,
    lineage,
  });
  const bytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  await writeFile(baselinePath, bytes);
  const verification = await verifyStage5SecurityExtensionBaseline({
    root,
    expectedBaselineSha256: sha256(bytes),
  });
  assert.equal(verification.result, "PASS");
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-13",
    result: "PASS",
    previousBaselineSha256: sha256(priorBytes),
    baselineSha256: sha256(bytes),
    baselineBytes: bytes.length,
    protectedPathCount: currentFiles.length,
    permittedDeltaPaths: baseline.lineage.final13Generation.protectedPathDeltas.map((d) => d.path),
    final12RejectedCiLogSha256: lineage.ciLog.sha256,
    final12RejectedInvocationGuardSha256: lineage.invocationGuard.sha256,
    toolchain: { node: process.version },
    stage6Actions: 0,
  };
  await writeFile(
    path.join(dir, "baseline-generation.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
};
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const out = process.argv.includes("--write")
    ? await generateStage5Final13SecurityExtensionBaseline()
    : await verifyStage5SecurityExtensionBaseline();
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
