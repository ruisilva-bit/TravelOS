import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL8_INDEPENDENT_REVIEW_ARTIFACT,
  STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256,
  STAGE5_FINAL9_INDEPENDENT_REVIEW,
  STAGE5_FINAL9_REJECTED_TAG,
  STAGE5_FINAL10_CANDIDATE_FREEZE,
  STAGE5_FINAL10_CANDIDATE_VALIDATION,
  STAGE5_FINAL10_EVIDENCE_DIRECTORY,
  STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT,
} from "./stage-5-candidate-contract.mjs";
import { writeStage5Final10EvidenceIndex } from "./stage-5-evidence-index.mjs";
import {
  verifyStage5Final10FindingLineage,
  verifyStage5Final8TaggedBytes,
  verifyStage5Final9RejectedTaggedBytes,
  writeStage5Final10CorrectionMatrix,
} from "./stage-5-finding-lineage.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(repositoryRoot, STAGE5_FINAL10_EVIDENCE_DIRECTORY);
const scratchRoot = process.env.TMPDIR ?? "/home/hermes/.hermes/cache/scratch";
const disposableReceiptNames = Object.freeze([
  "disposable-cleanup.json",
  "integration-test-execution.json",
  "integration-tests.log",
  "package-build.json",
  "postgresql-package-provenance.json",
  "postgresql-runtime.json",
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error instanceof Error ? result.error.message : ""),
  };
};

const requirePass = (label, result) => {
  if (result.exitCode !== 0) throw new Error(`${label} failed with exit ${result.exitCode}`);
  return result;
};

const writeNewFile = async (relativePath, content) => {
  const absolutePath = path.join(repositoryRoot, relativePath);
  await writeFile(absolutePath, content, { flag: "wx" });
  const persisted = await readFile(absolutePath);
  const expected = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  if (!persisted.equals(expected))
    throw new Error(`Evidence artifact did not persist byte-for-byte: ${relativePath}`);
  return { bytes: persisted.length, sha256: sha256(persisted) };
};

const copyVerified = async (sourceRelativePath, destinationRelativePath) => {
  const source = path.join(repositoryRoot, sourceRelativePath);
  const destination = path.join(repositoryRoot, destinationRelativePath);
  const sourceBytes = await readFile(source);
  await copyFile(source, destination, 0);
  const copiedBytes = await readFile(destination);
  if (!copiedBytes.equals(sourceBytes)) {
    throw new Error(`Evidence copy did not preserve source bytes: ${sourceRelativePath}`);
  }
  return { bytes: copiedBytes.length, sha256: sha256(copiedBytes) };
};

const assertFinal10EvidenceDirectoryAbsent = async () => {
  try {
    await lstat(evidenceDirectory);
    throw new Error(
      "FINAL-10 evidence directory already exists; refusing to mix or replace candidate evidence",
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
};

const copyDisposableReceipts = async (scratchEvidenceDirectory) => {
  const entries = await readdir(scratchEvidenceDirectory, { withFileTypes: true });
  const actualNames = entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  const expectedNames = [...disposableReceiptNames].toSorted();
  if (
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error(
      `Disposable qualification emitted an unexpected evidence-directory shape: ${JSON.stringify({ actualNames, expectedNames })}`,
    );
  }
  for (const name of disposableReceiptNames) {
    const source = path.join(scratchEvidenceDirectory, name);
    const destination = path.join(evidenceDirectory, name);
    const sourceBytes = await readFile(source);
    await copyFile(source, destination, 0);
    const copiedBytes = await readFile(destination);
    if (!copiedBytes.equals(sourceBytes)) {
      throw new Error(`Disposable qualification receipt copy failed: ${name}`);
    }
  }
};

const writeAuthBridgeEvidence = async () => {
  const result = requirePass(
    "Host and auth routing tests",
    run("corepack", [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "--config",
      "tooling/testing/vitest.config.ts",
      "--reporter=verbose",
      "apps/admin-api/test/auth-bridge.test.ts",
      "apps/portal-api/test/auth-bridge.test.ts",
      "apps/portal-api/test/health-live.test.ts",
      "apps/portal-api/test/host-routing-boundary.test.ts",
    ]),
  );
  const combined = `${result.stdout}${result.stderr}`;
  await writeNewFile(`${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/auth-bridge-tests.log`, combined);
  await writeNewFile(
    `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/auth-bridge-tests.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: "FINAL-10",
        result: "PASS",
        command:
          "vitest run --config tooling/testing/vitest.config.ts --reporter=verbose apps/admin-api/test/auth-bridge.test.ts apps/portal-api/test/auth-bridge.test.ts apps/portal-api/test/health-live.test.ts apps/portal-api/test/host-routing-boundary.test.ts",
        exitCode: result.exitCode,
        stdoutSha256: sha256(Buffer.from(result.stdout, "utf8")),
        stderrSha256: sha256(Buffer.from(result.stderr, "utf8")),
        coverage: "Admin and Portal Host/auth routing boundaries, including Portal health route",
        redaction: "No passwords, tokens, or credential-bearing URLs emitted.",
      },
      null,
      2,
    )}\n`,
  );
};

const writeMigrationEvidence = async () => {
  const result = requirePass(
    "Migration checksum verification",
    run("corepack", ["pnpm", "exec", "tsx", "tooling/database/verify-migration-checksums.ts"]),
  );
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("Migration checksum verifier did not emit JSON");
  }
  if (parsed.result !== "PASS") throw new Error("Migration checksum verifier did not pass");
  await writeNewFile(
    `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/migration-checksums.json`,
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
};

const writeQualificationSummary = async () => {
  const derivedFrom = [];
  for (const name of disposableReceiptNames) {
    const relativePath = `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/${name}`;
    const bytes = await readFile(path.join(repositoryRoot, relativePath));
    if (name.endsWith(".json")) {
      const receipt = JSON.parse(bytes.toString("utf8"));
      if (receipt.result !== "PASS") {
        throw new Error(`Disposable qualification receipt did not pass: ${relativePath}`);
      }
    }
    derivedFrom.push({ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) });
  }
  await writeNewFile(
    `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/qualification-summary.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: "FINAL-10",
        result: "PASS",
        execution: null,
        derivedFrom,
        scope:
          "Disposable PostgreSQL 18.6 qualification, real adapter integration, package build, and verified cleanup",
        redaction: "No passwords, tokens, or credential-bearing URLs emitted.",
      },
      null,
      2,
    )}\n`,
  );
};

const writeSourceScopeEvidence = async () => {
  const result = requirePass(
    "FINAL-10 source-scope tests",
    run(process.execPath, ["tooling/ci/test-stage-5-source-scope.mjs"]),
  );
  await writeNewFile(
    `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/stage5-source-scope-test.log`,
    `${result.stdout}${result.stderr}`,
  );
};

const writeRejectedTagArtifact = async (protectedFinal9) => {
  await writeNewFile(
    STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: "FINAL-10",
        result: "PASS",
        predecessor: {
          tag: STAGE5_FINAL9_REJECTED_TAG,
          target: protectedFinal9.target,
          status: "REJECTED_PRESERVED",
          freeze: protectedFinal9.freeze,
          evidenceIndex: protectedFinal9.evidenceIndex,
        },
        redaction: "No credentials or sensitive values are represented.",
      },
      null,
      2,
    )}\n`,
  );
};

const verifyExpectedArtifactSetBeforeIndex = async () => {
  const entries = await readdir(evidenceDirectory, { withFileTypes: true });
  const actualNames = entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  const expectedNames = STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
    (name) => name !== "ci-verify.log" && name !== "ci-verify-execution.json",
  ).toSorted();
  if (
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error("FINAL-10 evidence preparation did not produce the exact artifact set");
  }
};

let createdEvidenceDirectory = false;
let scratchEvidenceDirectory = null;
try {
  if (
    await lstat(path.join(repositoryRoot, STAGE5_FINAL10_CANDIDATE_VALIDATION)).catch(() => null)
  ) {
    throw new Error(
      "FINAL-10 validation already exists; prepare evidence only before validation/freeze creation",
    );
  }
  if (await lstat(path.join(repositoryRoot, STAGE5_FINAL10_CANDIDATE_FREEZE)).catch(() => null)) {
    throw new Error(
      "FINAL-10 freeze already exists; prepare evidence only before validation/freeze creation",
    );
  }
  await assertFinal10EvidenceDirectoryAbsent();
  await mkdir(evidenceDirectory, { recursive: true });
  createdEvidenceDirectory = true;

  const protectedFinal8 = await verifyStage5Final8TaggedBytes({ root: repositoryRoot });
  const protectedFinal9 = await verifyStage5Final9RejectedTaggedBytes({ root: repositoryRoot });
  await writeStage5Final10CorrectionMatrix({ root: repositoryRoot });

  const final8Artifact = await copyVerified(
    STAGE5_FINAL8_INDEPENDENT_REVIEW_ARTIFACT,
    STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
  );
  if (final8Artifact.sha256 !== STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256) {
    throw new Error("FINAL-8 independent review artifact does not match its protected SHA-256");
  }
  await copyVerified(STAGE5_FINAL9_INDEPENDENT_REVIEW, STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT);
  await writeRejectedTagArtifact(protectedFinal9);

  const focusedOutput = `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/focused-test-execution.json`;
  const focusedLog = `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/focused-tests.log`;
  requirePass(
    "FINAL-10 focused test qualification",
    run(process.execPath, ["tooling/ci/run-stage-5-focused.mjs"], {
      ...process.env,
      TRAVELOS_STAGE5_FOCUSED_OUTPUT: path.join(repositoryRoot, focusedOutput),
      TRAVELOS_STAGE5_FOCUSED_LOG: path.join(repositoryRoot, focusedLog),
    }),
  );
  await writeAuthBridgeEvidence();
  await writeMigrationEvidence();

  await mkdir(scratchRoot, { recursive: true });
  scratchEvidenceDirectory = await mkdtemp(
    path.join(scratchRoot, "travelos-stage5-final10-qualification-"),
  );
  requirePass(
    "FINAL-10 disposable PostgreSQL qualification",
    run(process.execPath, ["tooling/database/run-stage-5-disposable.mjs"], {
      ...process.env,
      TRAVELOS_STAGE5_EVIDENCE_DIR: scratchEvidenceDirectory,
    }),
  );
  await copyDisposableReceipts(scratchEvidenceDirectory);
  await writeQualificationSummary();
  await writeSourceScopeEvidence();
  await verifyExpectedArtifactSetBeforeIndex();

  const preCiIndex = await writeStage5Final10EvidenceIndex({
    root: repositoryRoot,
    phase: "PRE_CI",
  });
  const findingLineage = await verifyStage5Final10FindingLineage({ root: repositoryRoot });
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        candidate: "FINAL-10",
        phase: "PRE_CI",
        protectedFinal8Tag: protectedFinal8.tag,
        protectedFinal9Tag: protectedFinal9.tag,
        focusedQualification: "PASS",
        disposablePostgresqlQualification: "PASS",
        evidenceArtifactCount: preCiIndex.artifactCount,
        evidenceIndexSha256: preCiIndex.indexSha256,
        findingCount: findingLineage.totalFindingCount,
        authorClosedCount: findingLineage.authorClosedCount,
        independentPendingCount: findingLineage.independentPendingCount,
        stage6Actions: findingLineage.stage6Actions,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (createdEvidenceDirectory) await rm(evidenceDirectory, { recursive: true, force: true });
  throw error;
} finally {
  if (scratchEvidenceDirectory !== null) {
    await rm(scratchEvidenceDirectory, { recursive: true, force: true });
  }
}
