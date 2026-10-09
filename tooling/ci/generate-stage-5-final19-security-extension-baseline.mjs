import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL18_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import {
  STAGE5_FINAL18_SECURITY_EXTENSION_PROTECTED_PATHS,
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";
import { verifyStage5Final18EvidenceIndex } from "./stage-5-final18-evidence-index.mjs";
import { verifyStage5Final19FindingLineage } from "./stage-5-final19-finding-lineage.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const allowedDeltas = ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"];

export const buildStage5Final19SecurityExtensionBaseline = ({
  previousBaseline,
  currentFiles,
  lineage,
}) => {
  assert.equal(previousBaseline.result, "PASS");
  assert.equal(
    hash(Buffer.from(`${JSON.stringify(previousBaseline, null, 2)}\n`)),
    STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
  );
  assert.equal(previousBaseline.lineage.final18Generation?.candidate, "FINAL-18");
  assert.equal(
    previousBaseline.lineage.final18Generation?.runnerSha256,
    "eddc8bb4efbb53247f2c4b4b73b8abbfa19a8b24b9371e23b5d673494478eda7",
  );
  assert.equal(lineage.result, "PASS");
  assert.equal(lineage.candidate, "FINAL-19");
  assert.equal(lineage.findings.total, 49);
  assert.equal(lineage.findings.authorClosed, 0);
  assert.equal(lineage.findings.pendingIndependent, 49);
  assert.equal(lineage.predecessor.candidate, "FINAL-18");
  assert.equal(lineage.predecessor.ciVerifyInvoked, false);
  assert.equal(lineage.predecessor.ciVerifyInvocationCount, 0);
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
    deltas.map((row) => row.path),
    [...allowedDeltas].toSorted(),
    "FINAL-19 refuses missing, extra, duplicate or unauthorized protected drift",
  );

  const next = globalThis.structuredClone(previousBaseline);
  const extensionBytes = currentFiles.find(
    (entry) => entry.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  )?.bytes;
  const packageBytes = currentFiles.find((entry) => entry.path === "package.json")?.bytes;
  assert(extensionBytes && packageBytes);
  next.lineage.extensionDocument = {
    path: STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
    sha256: hash(extensionBytes),
  };
  next.lineage.final19Generation = {
    candidate: "FINAL-19",
    previousBaselineSha256: STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
    packageJsonSha256: hash(packageBytes),
    runnerSha256: lineage.runner.sha256,
    correctionMatrixSha256: lineage.correctionMatrix.sha256,
    stage6Actions: 0,
    protectedPathDeltas: deltas,
  };
  next.lineage.rejectedFinal18Candidate = {
    candidate: "FINAL-18",
    status: "REJECTED / PRE-CI FINAL VERIFICATION FAILURE / CI NOT STARTED",
    baselineSha256: STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
    evidenceIndexSha256: STAGE5_FINAL18_EVIDENCE_INDEX_SHA256,
    failureReceiptSha256: STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256,
    ciVerifyInvoked: false,
    ciInvocationCount: 0,
    authorizationConsumed: false,
    authorizationTransferred: false,
    stage6Actions: 0,
  };
  next.protectedFiles = rows;
  next.aggregateSha256 = hash(Buffer.from(serialize(rows)));
  return next;
};

export const generateStage5Final19SecurityExtensionBaseline = async ({
  candidateRoot = root,
  write = false,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const baselinePath = path.join(workspace, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
  const priorBytes = await readFile(baselinePath);
  assert.equal(
    hash(priorBytes),
    STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
    "FINAL-19 baseline must start from the immutable FINAL-18 baseline",
  );
  const previousBaseline = JSON.parse(priorBytes.toString("utf8"));
  const predecessorIndex = await verifyStage5Final18EvidenceIndex({
    root: workspace,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(predecessorIndex.indexSha256, STAGE5_FINAL18_EVIDENCE_INDEX_SHA256);
  const failureBytes = await readFile(
    path.join(workspace, STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT),
  );
  assert.equal(hash(failureBytes), STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256);
  const lineage = await verifyStage5Final19FindingLineage({ candidateRoot: workspace });
  const runnerPath = "tooling/ci/run-stage-5-final19-authoritative-ci.mjs";
  const runnerBytes = await readFile(path.join(workspace, runnerPath));
  const matrixBytes = await readFile(path.join(workspace, STAGE5_FINAL19_CORRECTION_MATRIX));
  assert.equal(hash(matrixBytes), lineage.correctionMatrix.sha256);
  lineage.runner = { path: runnerPath, sha256: hash(runnerBytes) };
  const currentFiles = await Promise.all(
    STAGE5_FINAL18_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (relativePath) => ({
      path: relativePath,
      bytes: await readFile(path.join(workspace, relativePath)),
    })),
  );
  const baseline = buildStage5Final19SecurityExtensionBaseline({
    previousBaseline,
    currentFiles,
    lineage,
  });
  const bytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  const verification = await verifyStage5SecurityExtensionBaseline({
    root: workspace,
    expectedBaselineSha256: hash(bytes),
    requireCandidate: "FINAL-19",
    baselineBytesOverride: bytes,
  });
  assert.equal(verification.result, "PASS");
  const receipt = {
    result: "PASS",
    candidate: "FINAL-19",
    previousBaselineSha256: STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
    baselineSha256: hash(bytes),
    protectedPathCount: baseline.protectedFiles.length,
    protectedPathDeltas: baseline.lineage.final19Generation.protectedPathDeltas,
    permittedDeltaPaths: baseline.lineage.final19Generation.protectedPathDeltas.map(
      (row) => row.path,
    ),
    lineageFindingCount: lineage.findings.total,
    predecessorFailureReceiptSha256: hash(failureBytes),
    stage6Actions: 0,
  };
  if (write) {
    const evidenceDirectory = path.join(workspace, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
    await mkdir(evidenceDirectory, { recursive: true });
    const archivePath = path.join(evidenceDirectory, "final18-security-extension-baseline.json");
    try {
      assert.deepEqual(
        await readFile(archivePath),
        priorBytes,
        "FINAL-18 baseline archive differs; refusing overwrite",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(archivePath, priorBytes, { flag: "wx" });
    }
    assert.equal(hash(await readFile(baselinePath)), STAGE5_FINAL18_SECURITY_BASELINE_SHA256);
    await writeFile(baselinePath, bytes);
    assert.deepEqual(await readFile(baselinePath), bytes);
    await writeFile(
      path.join(evidenceDirectory, "baseline-generation.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: "wx" },
    );
  }
  return receipt;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateStage5Final19SecurityExtensionBaseline({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
