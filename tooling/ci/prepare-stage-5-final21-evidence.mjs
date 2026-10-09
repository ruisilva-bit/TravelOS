import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_EVIDENCE_DIRECTORY,
  STAGE5_FINAL20_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT,
  STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL21_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL21_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL21_CORRECTION_MATRIX,
  STAGE5_FINAL21_EVIDENCE_DIRECTORY,
  STAGE5_FINAL21_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL21_PREDECESSOR_EVIDENCE_NAMES,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final21FindingLineage } from "./stage-5-final21-finding-lineage.mjs";
import { verifyStage5Final20EvidenceIndex } from "./stage-5-final20-evidence-index.mjs";
import { STAGE5_SECURITY_EXTENSION_BASELINE_PATH } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceDirectory = path.join(root, STAGE5_FINAL20_EVIDENCE_DIRECTORY);
const targetDirectory = path.join(root, STAGE5_FINAL21_EVIDENCE_DIRECTORY);
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
    assert.deepEqual(existing, bytes, `Refusing divergent FINAL-21 evidence reuse: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};

export const prepareStage5Final21Evidence = async () => {
  const predecessorNames = [...STAGE5_FINAL20_EXPECTED_EVIDENCE_ARTIFACT_NAMES]
    .filter((name) => name !== "migration-checksums.json")
    .toSorted();
  const actualNames = (await readdir(sourceDirectory)).toSorted();
  const predecessorIndex = await verifyStage5Final20EvidenceIndex({
    root,
    allowedPhases: ["FINAL"],
    requiredPhase: "FINAL",
  });
  assert.equal(predecessorIndex.result, "PASS");
  assert.deepEqual(
    actualNames,
    [...predecessorNames, "EVIDENCE_INDEX.json", "migration-checksums.json"].toSorted(),
    "FINAL-20 rejected evidence directory has unexplained drift",
  );
  assert.equal(STAGE5_FINAL21_PREDECESSOR_EVIDENCE_NAMES.length, predecessorNames.length + 3);
  await mkdir(targetDirectory, { recursive: true });

  for (const name of predecessorNames) {
    const source = await readRegular(path.join(sourceDirectory, name));
    const archiveName = `final20-${name}`;
    assert(STAGE5_FINAL21_PREDECESSOR_EVIDENCE_NAMES.includes(archiveName));
    await writeExclusiveOrMatch(path.join(targetDirectory, archiveName), source);
  }

  const priorPostgresql = JSON.parse(
    (
      await readRegular(path.join(targetDirectory, "final20-postgresql-qualification.json"))
    ).toString("utf8"),
  );
  assert.equal(priorPostgresql.candidate, "FINAL-20");
  assert.equal(priorPostgresql.result, "PASS");
  assert.equal(priorPostgresql.qualificationExecution?.result, "PASS");
  assert.equal(priorPostgresql.disposableCleanup?.result, "PASS");
  const currentMigrationChecksums = await readRegular(path.join(root, "migrations/checksums.json"));
  const currentIntegrationTest = await readRegular(
    path.join(root, "tests/integration/stage-5-postgresql.test.ts"),
  );
  assert.equal(
    hash(currentMigrationChecksums),
    priorPostgresql.qualificationExecution.migrationChecksumsSha256,
    "FINAL-21 migrations differ from the qualified FINAL-20 migrations",
  );
  assert.equal(
    hash(currentIntegrationTest),
    priorPostgresql.qualificationExecution.integrationTestSha256,
    "FINAL-21 PostgreSQL integration test bytes differ from the qualified FINAL-20 test",
  );
  const reusedPostgresqlQualification = {
    schemaVersion: 1,
    candidate: "FINAL-21",
    result: "PASS",
    qualificationMode: "REUSED_UNCHANGED_DATABASE_AND_INTEGRATION_TEST_BYTES",
    sourceCandidate: "FINAL-20",
    sourceEvidence: {
      path: `${STAGE5_FINAL21_EVIDENCE_DIRECTORY}/final20-postgresql-qualification.json`,
      sha256: hash(
        await readRegular(path.join(targetDirectory, "final20-postgresql-qualification.json")),
      ),
      execution: null,
    },
    sourceQualification: priorPostgresql,
    invariance: {
      migrationChecksumsSha256: hash(currentMigrationChecksums),
      integrationTestSha256: hash(currentIntegrationTest),
      businessDomainSourceChanged: false,
    },
    disposableCleanup: priorPostgresql.disposableCleanup,
    stage6Actions: 0,
  };
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "postgresql-qualification.json"),
    Buffer.from(`${JSON.stringify(reusedPostgresqlQualification, null, 2)}\n`),
  );

  const baselinePath = path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
  const baselineBytes = await readRegular(baselinePath);
  assert.equal(hash(baselineBytes), STAGE5_FINAL20_SECURITY_BASELINE_SHA256);
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "final20-security-extension-baseline.json"),
    baselineBytes,
  );
  const matrixBytes = await readRegular(path.join(root, STAGE5_FINAL20_CORRECTION_MATRIX));
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "final20-correction-matrix.json"),
    matrixBytes,
  );
  const failureBytes = await readRegular(
    path.join(root, STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT),
  );
  assert.equal(hash(failureBytes), STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT_SHA256);
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "final20-final-candidate-scan-failure-01.json"),
    failureBytes,
  );

  await writeExclusiveOrMatch(
    path.join(targetDirectory, "final21-correction-matrix.json"),
    await readRegular(path.join(root, STAGE5_FINAL21_CORRECTION_MATRIX)),
  );
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "ci-verify.log"),
    Buffer.from(STAGE5_FINAL21_CI_LOG_PLACEHOLDER),
  );
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "ci-verify-execution.json"),
    Buffer.from(STAGE5_FINAL21_CI_EXECUTION_PLACEHOLDER),
  );
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "readiness-preflight.json"),
    Buffer.from(
      `${JSON.stringify({ schemaVersion: 1, candidate: "FINAL-21", phase: "PRE_CI", result: "PENDING", ciVerifyInvoked: false, ciVerifyInvocations: 0, stage6Actions: 0 }, null, 2)}\n`,
    ),
  );

  const lineage = await verifyStage5Final21FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  await writeExclusiveOrMatch(
    path.join(targetDirectory, "finding-lineage.json"),
    Buffer.from(`${JSON.stringify(lineage, null, 2)}\n`),
  );
  const expected = [...STAGE5_FINAL21_EXPECTED_EVIDENCE_ARTIFACT_NAMES].toSorted();
  const current = (await readdir(targetDirectory)).toSorted();
  assert.deepEqual(
    current,
    expected.filter((name) => current.includes(name)),
  );
  return {
    result: "PREPARED_FOUNDATION",
    candidate: "FINAL-21",
    predecessorCandidate: "FINAL-20",
    predecessorFailureReceiptSha256: hash(failureBytes),
    predecessorEvidenceArtifacts: predecessorNames.length,
    expectedArtifactCount: expected.length,
    currentEvidenceFiles: current.length,
    missingUntilQualification: expected.filter((name) => !current.includes(name)),
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5Final21Evidence();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
