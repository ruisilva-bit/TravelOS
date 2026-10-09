import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
  STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL20_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL20_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_EVIDENCE_DIRECTORY,
  STAGE5_FINAL20_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL20_PREDECESSOR_EVIDENCE_NAMES,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final20FindingLineage } from "./stage-5-final20-finding-lineage.mjs";
import { STAGE5_SECURITY_EXTENSION_BASELINE_PATH } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceDirectory = path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
const targetDirectory = path.join(root, STAGE5_FINAL20_EVIDENCE_DIRECTORY);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const writeExclusiveOrMatch = async (file, bytes) => {
  try {
    const existing = await readRegular(file);
    assert.deepEqual(existing, bytes, `Refusing divergent FINAL-20 evidence reuse: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};

export const prepareStage5Final20Evidence = async () => {
  const predecessorNames = [...STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES]
    .filter((name) => name !== "migration-checksums.json")
    .toSorted();
  const actualNames = (await readdir(sourceDirectory)).toSorted();
  assert.deepEqual(
    actualNames,
    predecessorNames,
    "FINAL-19 rejected evidence directory has unexplained drift",
  );
  assert.equal(STAGE5_FINAL20_PREDECESSOR_EVIDENCE_NAMES.length, predecessorNames.length + 3);
  await mkdir(targetDirectory, { recursive: true });

  for (const name of predecessorNames) {
    const source = await readRegular(path.join(sourceDirectory, name));
    const archiveName = `final19-${name}`;
    assert(STAGE5_FINAL20_PREDECESSOR_EVIDENCE_NAMES.includes(archiveName));
    await writeExclusiveOrMatch(path.join(targetDirectory, archiveName), source);
  }

  const baselinePath = path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
  const baselineBytes = await readRegular(baselinePath);
  assert.equal(hash(baselineBytes), STAGE5_FINAL19_SECURITY_BASELINE_SHA256);
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "final19-security-extension-baseline.json"),
    baselineBytes,
  );
  const matrixBytes = await readRegular(path.join(root, STAGE5_FINAL19_CORRECTION_MATRIX));
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "final19-correction-matrix.json"),
    matrixBytes,
  );
  const failureBytes = await readRegular(path.join(root, STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT));
  assert.equal(hash(failureBytes), STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256);
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "final19-preflight-failure-01.json"),
    failureBytes,
  );

  await writeExclusiveOrMatch(
    path.join(targetDirectory, "final20-correction-matrix.json"),
    await readRegular(path.join(root, STAGE5_FINAL20_CORRECTION_MATRIX)),
  );
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "ci-verify.log"),
    Buffer.from(STAGE5_FINAL20_CI_LOG_PLACEHOLDER),
  );
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "ci-verify-execution.json"),
    Buffer.from(STAGE5_FINAL20_CI_EXECUTION_PLACEHOLDER),
  );
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "readiness-preflight.json"),
    Buffer.from(
      `${JSON.stringify({ schemaVersion: 1, candidate: "FINAL-20", phase: "PRE_CI", result: "PENDING", ciVerifyInvoked: false, ciVerifyInvocations: 0, stage6Actions: 0 }, null, 2)}\n`,
    ),
  );

  const lineage = await verifyStage5Final20FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "finding-lineage.json"),
    Buffer.from(`${JSON.stringify(lineage, null, 2)}\n`),
  );
  const expected = [...STAGE5_FINAL20_EXPECTED_EVIDENCE_ARTIFACT_NAMES].toSorted();
  const current = (await readdir(targetDirectory)).toSorted();
  assert.deepEqual(
    current,
    expected.filter((name) => current.includes(name)),
  );
  return {
    result: "PREPARED_FOUNDATION",
    candidate: "FINAL-20",
    predecessorCandidate: "FINAL-19",
    predecessorFailureReceiptSha256: hash(failureBytes),
    predecessorEvidenceArtifacts: predecessorNames.length,
    expectedArtifactCount: expected.length,
    currentEvidenceFiles: current.length,
    missingUntilQualification: expected.filter((name) => !current.includes(name)),
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5Final20Evidence();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
