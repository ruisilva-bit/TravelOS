import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_EVIDENCE_DIRECTORY,
  STAGE5_FINAL20_BASELINE_ATTEMPT_01_SHA256,
  STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
} from "./stage-5-candidate-contract.mjs";
import {
  STAGE5_FINAL18_SECURITY_EXTENSION_PROTECTED_PATHS,
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";
import { verifyStage5Final20FindingLineage } from "./stage-5-final20-finding-lineage.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const allowedDeltas = ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"];

export const buildStage5Final20SecurityExtensionBaseline = ({
  previousBaseline,
  currentFiles,
  lineage,
}) => {
  assert.equal(previousBaseline.result, "PASS");
  assert.equal(
    hash(Buffer.from(`${JSON.stringify(previousBaseline, null, 2)}\n`)),
    STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
  );
  assert.equal(previousBaseline.lineage.final19Generation?.candidate, "FINAL-19");
  assert.equal(lineage.result, "PASS");
  assert.equal(lineage.candidate, "FINAL-20");
  assert.equal(lineage.findings.total, 49);
  assert.equal(lineage.findings.authorClosed, 0);
  assert.equal(lineage.findings.pendingIndependent, 49);
  assert.equal(lineage.predecessor.candidate, "FINAL-19");
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
    "FINAL-20 refuses missing, extra or unauthorized protected drift",
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
  next.lineage.final20Generation = {
    candidate: "FINAL-20",
    previousBaselineSha256: STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
    packageJsonSha256: hash(packageBytes),
    runnerSha256: lineage.runner.sha256,
    correctionMatrixSha256: lineage.correctionMatrix.sha256,
    stage6Actions: 0,
    protectedPathDeltas: deltas,
  };
  next.lineage.rejectedFinal19Candidate = {
    candidate: "FINAL-19",
    status: "REJECTED / PRE-CI EVIDENCE INDEX INCOMPLETE / CI NOT STARTED",
    baselineSha256: STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
    failureReceiptSha256: STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
    evidenceIndexCreated: false,
    ciVerifyInvoked: false,
    ciInvocationCount: 0,
    authorizationConsumed: false,
    stage6Actions: 0,
  };
  next.protectedFiles = rows;
  next.aggregateSha256 = hash(Buffer.from(serialize(rows)));
  return next;
};

export const generateStage5Final20SecurityExtensionBaseline = async ({
  candidateRoot = root,
  write = false,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const baselinePath = path.join(workspace, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
  const evidenceDirectory = path.join(workspace, STAGE5_FINAL20_EVIDENCE_DIRECTORY);
  const predecessorBaselinePath = path.join(
    evidenceDirectory,
    "final19-security-extension-baseline.json",
  );
  const priorBytes = await readFile(predecessorBaselinePath);
  assert.equal(
    hash(priorBytes),
    STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
    "FINAL-20 must start from the immutable FINAL-19 baseline",
  );
  const activeBytes = await readFile(baselinePath);
  assert(
    [
      STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
      STAGE5_FINAL20_BASELINE_ATTEMPT_01_SHA256,
      STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
    ].includes(hash(activeBytes)),
    "active baseline is not a recognized FINAL-20 preparation generation",
  );
  const previousBaseline = JSON.parse(priorBytes.toString("utf8"));
  assert.equal(previousBaseline.result, "PASS");
  assert.equal(previousBaseline.lineage.final19Generation?.candidate, "FINAL-19");
  const failureBytes = await readFile(
    path.join(workspace, STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT),
  );
  assert.equal(hash(failureBytes), STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256);
  const lineage = await verifyStage5Final20FindingLineage({ candidateRoot: workspace });
  const runnerPath = "tooling/ci/run-stage-5-final20-authoritative-ci.mjs";
  const runnerBytes = await readFile(path.join(workspace, runnerPath));
  const matrixBytes = await readFile(path.join(workspace, STAGE5_FINAL20_CORRECTION_MATRIX));
  assert.equal(hash(matrixBytes), lineage.correctionMatrix.sha256);
  lineage.runner = { path: runnerPath, sha256: hash(runnerBytes) };
  const currentFiles = await Promise.all(
    STAGE5_FINAL18_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (relativePath) => ({
      path: relativePath,
      bytes: await readFile(path.join(workspace, relativePath)),
    })),
  );
  const baseline = buildStage5Final20SecurityExtensionBaseline({
    previousBaseline,
    currentFiles,
    lineage,
  });
  const bytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  if (write) {
    assert.equal(
      hash(bytes),
      STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
      "FINAL-20 baseline bytes differ from their pinned candidate hash",
    );
  }
  const verification = await verifyStage5SecurityExtensionBaseline({
    root: workspace,
    expectedBaselineSha256: hash(bytes),
    requireCandidate: "FINAL-20",
    baselineBytesOverride: bytes,
  });
  assert.equal(verification.result, "PASS");
  const receipt = {
    result: "PASS",
    candidate: "FINAL-20",
    previousBaselineSha256: STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
    baselineSha256: hash(bytes),
    protectedPathCount: baseline.protectedFiles.length,
    protectedPathDeltas: baseline.lineage.final20Generation.protectedPathDeltas,
    permittedDeltaPaths: baseline.lineage.final20Generation.protectedPathDeltas.map(
      (row) => row.path,
    ),
    lineageFindingCount: lineage.findings.total,
    predecessorFailureReceiptSha256: hash(failureBytes),
    stage6Actions: 0,
  };
  if (write) {
    await mkdir(evidenceDirectory, { recursive: true });
    const final19Archive = path.join(evidenceDirectory, "final19-security-extension-baseline.json");
    assert.deepEqual(
      await readFile(final19Archive),
      priorBytes,
      "FINAL-19 baseline archive differs",
    );
    if (hash(activeBytes) === STAGE5_FINAL20_BASELINE_ATTEMPT_01_SHA256) {
      const attemptArchive = path.join(evidenceDirectory, "baseline-attempt-01.json");
      try {
        assert.deepEqual(
          await readFile(attemptArchive),
          activeBytes,
          "FINAL-20 attempt 01 baseline archive differs",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await writeFile(attemptArchive, activeBytes, { flag: "wx" });
      }
      await writeFile(baselinePath, bytes);
    } else {
      assert.equal(
        hash(activeBytes),
        hash(bytes),
        "refusing to overwrite an unrecognized FINAL-20 baseline generation",
      );
    }
    assert.deepEqual(await readFile(baselinePath), bytes);
    await writeFile(
      path.join(evidenceDirectory, "baseline-generation-final.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: "wx" },
    );
  }
  return receipt;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateStage5Final20SecurityExtensionBaseline({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
