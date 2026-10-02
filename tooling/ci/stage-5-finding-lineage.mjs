import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STAGE5_FINAL8_EVIDENCE_INDEX,
  STAGE5_FINAL8_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL8_FREEZE,
  STAGE5_FINAL8_FREEZE_SHA256,
  STAGE5_FINAL8_REJECTED_TAG,
  STAGE5_FINAL8_REJECTED_TAG_TARGET,
  STAGE5_FINAL9_CANDIDATE_FREEZE,
  STAGE5_FINAL9_CORRECTION_MATRIX,
  STAGE5_FINAL9_EVIDENCE_AGGREGATE_SHA256,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL9_FREEZE_AGGREGATE_SHA256,
  STAGE5_FINAL9_FREEZE_SHA256,
  STAGE5_FINAL9_INDEPENDENT_REVIEW,
  STAGE5_FINAL9_REJECTED_TAG,
  STAGE5_FINAL9_REJECTED_TAG_TARGET,
  STAGE5_FINAL10_CANDIDATE_FREEZE,
  STAGE5_FINAL10_CORRECTION_MATRIX,
  STAGE5_FINAL10_EVIDENCE_INDEX,
  STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS,
  STAGE5_FINAL10_EXPECTED_FINAL9_REVIEW_FINDING_IDS,
  STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT,
  STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT,
} from "./stage-5-candidate-contract.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FINAL9_BASE_FINDING_IDS = STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS.filter(
  (id) => !STAGE5_FINAL10_EXPECTED_FINAL9_REVIEW_FINDING_IDS.includes(id),
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serializeRows = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const assertRegularFile = async (absolutePath, description) => {
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`${description} must be a unique regular file: ${absolutePath}`);
  }
};

const readGitBlob = (root, revision, relativePath) =>
  execFileSync("git", ["show", `${revision}:${relativePath}`], { cwd: root });

const readGitTagTarget = (root, tag) =>
  execFileSync("git", ["rev-parse", `${tag}^{}`], { cwd: root, encoding: "utf8" }).trim();

const parseFreezeRows = (freezeBytes, freezePath) => {
  const text = freezeBytes.toString("utf8");
  const rowPattern = /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([a-f0-9]{64})`\s*\|$/gmu;
  const rows = [...text.matchAll(rowPattern)].map((match) => ({
    ordinal: Number.parseInt(match[1], 10),
    path: match[2],
    bytes: Number.parseInt(match[3], 10),
    sha256: match[4],
  }));
  const declaredRows = Number.parseInt(text.match(/\*\*Rows:\*\*\s*(\d+)/u)?.[1] ?? "", 10);
  const declaredAggregate = text.match(/\*\*Deterministic aggregate:\*\*\s*`([a-f0-9]{64})`/u)?.[1];
  if (
    !Number.isSafeInteger(declaredRows) ||
    rows.length !== declaredRows ||
    rows.some((row, index) => row.ordinal !== index + 1) ||
    new Set(rows.map((row) => row.path)).size !== rows.length ||
    declaredAggregate === undefined ||
    !SHA256_PATTERN.test(declaredAggregate)
  ) {
    throw new Error(`Rejected candidate freeze has malformed rows or aggregate: ${freezePath}`);
  }
  return { declaredAggregate, rows };
};

const parseJson = (bytes, description) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${description} is not valid JSON`);
  }
};

const assertExactFindingIds = (findings, expectedIds, description) => {
  const actualIds = findings.map((finding) => finding?.id);
  const uniqueIds = new Set(actualIds);
  if (
    !sameJson(actualIds, expectedIds) ||
    uniqueIds.size !== expectedIds.length ||
    actualIds.some((id) => typeof id !== "string")
  ) {
    throw new Error(`${description} must preserve the exact ordered, duplicate-free finding IDs`);
  }
};

const parseFinal9ReviewFindings = (reviewBytes) => {
  const text = reviewBytes.toString("utf8");
  return STAGE5_FINAL10_EXPECTED_FINAL9_REVIEW_FINDING_IDS.map((id) => {
    const pattern = new RegExp(
      `^### ${id} — (BLOCKER|HIGH|MEDIUM|LOW) — ([^\\n]+)\\n([\\s\\S]*?)(?=^### |$(?![\\s\\S]))`,
      "mu",
    );
    const match = text.match(pattern);
    if (match === null) {
      throw new Error(`FINAL-9 independent review omits or malforms ${id}`);
    }
    return {
      id,
      severity: match[1],
      title: match[2],
      excerpt: match[0].trim(),
    };
  });
};

export const verifyStage5Final8TaggedBytes = async ({ root = process.cwd() } = {}) => {
  const target = readGitTagTarget(root, STAGE5_FINAL8_REJECTED_TAG);
  if (target !== STAGE5_FINAL8_REJECTED_TAG_TARGET) {
    throw new Error("Rejected FINAL-8 tag does not resolve to its protected target");
  }
  const protectedFiles = [
    { path: STAGE5_FINAL8_FREEZE, sha256: STAGE5_FINAL8_FREEZE_SHA256 },
    { path: STAGE5_FINAL8_EVIDENCE_INDEX, sha256: STAGE5_FINAL8_EVIDENCE_INDEX_SHA256 },
  ];
  const files = [];
  for (const protectedFile of protectedFiles) {
    const currentBytes = await readFile(path.join(root, protectedFile.path));
    const taggedBytes = readGitBlob(root, STAGE5_FINAL8_REJECTED_TAG, protectedFile.path);
    if (
      sha256(currentBytes) !== protectedFile.sha256 ||
      sha256(taggedBytes) !== protectedFile.sha256 ||
      !currentBytes.equals(taggedBytes)
    ) {
      throw new Error(`Protected FINAL-8 bytes diverged: ${protectedFile.path}`);
    }
    files.push({
      path: protectedFile.path,
      bytes: currentBytes.length,
      sha256: protectedFile.sha256,
      matchesRejectedTag: true,
    });
  }
  return {
    result: "PASS",
    tag: STAGE5_FINAL8_REJECTED_TAG,
    target,
    files,
  };
};

export const verifyStage5Final9RejectedTaggedBytes = async ({ root = process.cwd() } = {}) => {
  const target = readGitTagTarget(root, STAGE5_FINAL9_REJECTED_TAG);
  if (target !== STAGE5_FINAL9_REJECTED_TAG_TARGET) {
    throw new Error("Rejected FINAL-9 tag does not resolve to its protected target");
  }
  const freezeBytes = readGitBlob(root, STAGE5_FINAL9_REJECTED_TAG, STAGE5_FINAL9_CANDIDATE_FREEZE);
  if (sha256(freezeBytes) !== STAGE5_FINAL9_FREEZE_SHA256) {
    throw new Error("Rejected FINAL-9 freeze document hash diverged");
  }
  const freeze = parseFreezeRows(freezeBytes, STAGE5_FINAL9_CANDIDATE_FREEZE);
  if (freeze.declaredAggregate !== STAGE5_FINAL9_FREEZE_AGGREGATE_SHA256) {
    throw new Error("Rejected FINAL-9 freeze aggregate does not match its protected declaration");
  }
  for (const row of freeze.rows) {
    const bytes = readGitBlob(root, STAGE5_FINAL9_REJECTED_TAG, row.path);
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) {
      throw new Error(`Rejected FINAL-9 tag does not reproduce frozen input: ${row.path}`);
    }
  }
  if (sha256(serializeRows(freeze.rows)) !== STAGE5_FINAL9_FREEZE_AGGREGATE_SHA256) {
    throw new Error("Rejected FINAL-9 freeze rows do not reproduce the protected aggregate");
  }

  const indexBytes = readGitBlob(root, STAGE5_FINAL9_REJECTED_TAG, STAGE5_FINAL9_EVIDENCE_INDEX);
  if (sha256(indexBytes) !== STAGE5_FINAL9_EVIDENCE_INDEX_SHA256) {
    throw new Error("Rejected FINAL-9 evidence index hash diverged");
  }
  const index = parseJson(indexBytes, "Rejected FINAL-9 evidence index");
  const artifacts = Array.isArray(index.artifacts) ? index.artifacts : [];
  const artifactPaths = artifacts.map((artifact) => artifact?.path);
  if (
    index.schemaVersion !== 1 ||
    index.result !== "PASS" ||
    index.candidate !== "FINAL-9" ||
    index.phase !== "FINAL" ||
    index.artifactCount !== 16 ||
    artifacts.length !== 16 ||
    new Set(artifactPaths).size !== artifacts.length ||
    artifacts.some(
      (artifact) =>
        typeof artifact?.path !== "string" ||
        !Number.isSafeInteger(artifact?.bytes) ||
        artifact.bytes < 0 ||
        !SHA256_PATTERN.test(artifact?.sha256 ?? ""),
    )
  ) {
    throw new Error("Rejected FINAL-9 evidence index metadata is invalid");
  }
  for (const artifact of artifacts) {
    const bytes = readGitBlob(root, STAGE5_FINAL9_REJECTED_TAG, artifact.path);
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(
        `Rejected FINAL-9 tag does not reproduce evidence artifact: ${artifact.path}`,
      );
    }
  }
  if (sha256(serializeRows(artifacts)) !== STAGE5_FINAL9_EVIDENCE_AGGREGATE_SHA256) {
    throw new Error("Rejected FINAL-9 evidence artifacts do not reproduce the protected aggregate");
  }
  return {
    result: "PASS",
    tag: STAGE5_FINAL9_REJECTED_TAG,
    target,
    freeze: {
      path: STAGE5_FINAL9_CANDIDATE_FREEZE,
      bytes: freezeBytes.length,
      sha256: STAGE5_FINAL9_FREEZE_SHA256,
      rows: freeze.rows.length,
      aggregateSha256: STAGE5_FINAL9_FREEZE_AGGREGATE_SHA256,
    },
    evidenceIndex: {
      path: STAGE5_FINAL9_EVIDENCE_INDEX,
      bytes: indexBytes.length,
      sha256: STAGE5_FINAL9_EVIDENCE_INDEX_SHA256,
      artifactCount: artifacts.length,
      aggregateSha256: STAGE5_FINAL9_EVIDENCE_AGGREGATE_SHA256,
    },
  };
};

const readFinal9ReviewInputs = async (root) => {
  const matrixBytes = readGitBlob(
    root,
    STAGE5_FINAL9_REJECTED_TAG,
    STAGE5_FINAL9_CORRECTION_MATRIX,
  );
  const matrix = parseJson(matrixBytes, "Rejected FINAL-9 correction matrix");
  const findings = Array.isArray(matrix.findings) ? matrix.findings : [];
  if (
    matrix.schemaVersion !== 1 ||
    matrix.result !== "PASS" ||
    matrix.candidate !== "FINAL-9" ||
    matrix.stage6Actions !== 0 ||
    matrix.summary?.totalFindingCount !== FINAL9_BASE_FINDING_IDS.length ||
    matrix.summary?.authorClosedCount !== 0 ||
    matrix.summary?.independentPendingCount !== FINAL9_BASE_FINDING_IDS.length
  ) {
    throw new Error("Rejected FINAL-9 correction matrix has invalid lineage metadata");
  }
  assertExactFindingIds(findings, FINAL9_BASE_FINDING_IDS, "Rejected FINAL-9 correction matrix");

  const reviewPath = path.join(root, STAGE5_FINAL9_INDEPENDENT_REVIEW);
  await assertRegularFile(reviewPath, "FINAL-9 independent review record");
  const reviewBytes = await readFile(reviewPath);
  return { matrix, matrixBytes, reviewBytes };
};

export const buildStage5Final10CorrectionMatrix = ({
  final9Matrix,
  final9MatrixBytes,
  final9ReviewBytes,
}) => {
  const final9Findings = Array.isArray(final9Matrix?.findings) ? final9Matrix.findings : [];
  assertExactFindingIds(
    final9Findings,
    FINAL9_BASE_FINDING_IDS,
    "FINAL-10 predecessor finding input",
  );
  const reviewFindings = parseFinal9ReviewFindings(final9ReviewBytes);
  const carriedFindings = final9Findings.map((finding) => ({
    id: finding.id,
    sourceType: "REJECTED_FINAL_9_CARRY_FORWARD",
    final9Disposition: finding.final9Disposition,
    final9IndependentStatus: finding.final9IndependentStatus,
    final10Disposition: "PENDING_REMEDIATION_REQUALIFICATION",
    final10IndependentStatus: "PENDING_FINAL10_REVIEW",
    sourceRecord: finding.sourceRecord,
  }));
  const final9ReviewFindingRows = reviewFindings.map((finding) => ({
    id: finding.id,
    sourceType: "FINAL_9_INDEPENDENT_REVIEW_FINDING",
    final10Disposition: "PENDING_REMEDIATION_REQUALIFICATION",
    final10IndependentStatus: "PENDING_FINAL10_REVIEW",
    sourceRecord: {
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      sourcePath: STAGE5_FINAL9_INDEPENDENT_REVIEW,
      bytes: final9ReviewBytes.length,
      sha256: sha256(final9ReviewBytes),
      excerpt: finding.excerpt,
    },
  }));
  const findings = [...carriedFindings, ...final9ReviewFindingRows];
  assertExactFindingIds(
    findings,
    STAGE5_FINAL10_EXPECTED_ALL_FINDING_IDS,
    "FINAL-10 correction matrix",
  );
  return {
    schemaVersion: 1,
    result: "PASS",
    stage: "PHASE_1_M1_STAGE_5",
    candidate: "FINAL-10",
    predecessor: {
      rejectedFinal9Tag: STAGE5_FINAL9_REJECTED_TAG,
      target: STAGE5_FINAL9_REJECTED_TAG_TARGET,
      freeze: {
        path: STAGE5_FINAL9_CANDIDATE_FREEZE,
        sha256: STAGE5_FINAL9_FREEZE_SHA256,
        aggregateSha256: STAGE5_FINAL9_FREEZE_AGGREGATE_SHA256,
      },
      evidenceIndex: {
        path: STAGE5_FINAL9_EVIDENCE_INDEX,
        sha256: STAGE5_FINAL9_EVIDENCE_INDEX_SHA256,
        aggregateSha256: STAGE5_FINAL9_EVIDENCE_AGGREGATE_SHA256,
      },
      correctionMatrix: {
        path: STAGE5_FINAL9_CORRECTION_MATRIX,
        bytes: final9MatrixBytes.length,
        sha256: sha256(final9MatrixBytes),
      },
      independentReview: {
        path: STAGE5_FINAL9_INDEPENDENT_REVIEW,
        bytes: final9ReviewBytes.length,
        sha256: sha256(final9ReviewBytes),
      },
    },
    stage6Actions: 0,
    statusPolicy: {
      authorMayCloseFindings: false,
      final10IndependentReviewRequired: true,
      authorDisposition: "PENDING_REMEDIATION_REQUALIFICATION",
      independentDisposition: "PENDING_FINAL10_REVIEW",
    },
    summary: {
      carriedFinal9FindingCount: FINAL9_BASE_FINDING_IDS.length,
      final9IndependentReviewFindingCount: reviewFindings.length,
      totalFindingCount: findings.length,
      authorClosedCount: 0,
      independentPendingCount: findings.length,
    },
    findings,
  };
};

export const verifyStage5Final10FindingLineageData = async ({ root = process.cwd() } = {}) => {
  const protectedFinal8 = await verifyStage5Final8TaggedBytes({ root });
  const protectedFinal9 = await verifyStage5Final9RejectedTaggedBytes({ root });
  const {
    matrix: final9Matrix,
    matrixBytes: final9MatrixBytes,
    reviewBytes: final9ReviewBytes,
  } = await readFinal9ReviewInputs(root);
  const expectedMatrix = buildStage5Final10CorrectionMatrix({
    final9Matrix,
    final9MatrixBytes,
    final9ReviewBytes,
  });
  const matrixPath = path.join(root, STAGE5_FINAL10_CORRECTION_MATRIX);
  await assertRegularFile(matrixPath, "FINAL-10 correction matrix");
  const actualMatrix = parseJson(await readFile(matrixPath), "FINAL-10 correction matrix");
  if (!sameJson(actualMatrix, expectedMatrix)) {
    throw new Error(
      "FINAL-10 correction matrix omits, changes, closes, or misattributes carried findings",
    );
  }

  const evidenceIndexPath = path.join(root, STAGE5_FINAL10_EVIDENCE_INDEX);
  await assertRegularFile(evidenceIndexPath, "FINAL-10 evidence index");
  const evidenceIndex = parseJson(await readFile(evidenceIndexPath), "FINAL-10 evidence index");
  const indexedPaths = new Set(
    Array.isArray(evidenceIndex.artifacts)
      ? evidenceIndex.artifacts.map((artifact) => artifact?.path)
      : [],
  );
  const requiredArtifacts = [
    STAGE5_FINAL10_FINAL8_REVIEW_ARTIFACT,
    STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT,
    STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT,
  ];
  if (requiredArtifacts.some((artifactPath) => !indexedPaths.has(artifactPath))) {
    throw new Error("FINAL-10 evidence index omits a required predecessor-lineage artifact");
  }
  const final9ArtifactBytes = await readFile(
    path.join(root, STAGE5_FINAL10_FINAL9_REVIEW_ARTIFACT),
  );
  if (!final9ArtifactBytes.equals(final9ReviewBytes)) {
    throw new Error(
      "FINAL-10 evidence does not preserve the reviewed FINAL-9 independent-review bytes",
    );
  }
  const rejectedTagArtifactPath = path.join(root, STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT);
  await assertRegularFile(rejectedTagArtifactPath, "FINAL-10 rejected FINAL-9 tag artifact");
  const rejectedTagArtifactBytes = await readFile(rejectedTagArtifactPath);
  const rejectedTagArtifact = parseJson(
    rejectedTagArtifactBytes,
    "FINAL-10 rejected FINAL-9 tag artifact",
  );
  if (
    rejectedTagArtifact.schemaVersion !== 1 ||
    rejectedTagArtifact.candidate !== "FINAL-10" ||
    rejectedTagArtifact.result !== "PASS" ||
    rejectedTagArtifact.predecessor?.tag !== STAGE5_FINAL9_REJECTED_TAG ||
    rejectedTagArtifact.predecessor?.target !== protectedFinal9.target ||
    rejectedTagArtifact.predecessor?.status !== "REJECTED_PRESERVED" ||
    rejectedTagArtifact.predecessor?.freeze?.sha256 !== protectedFinal9.freeze.sha256 ||
    rejectedTagArtifact.predecessor?.evidenceIndex?.sha256 !== protectedFinal9.evidenceIndex.sha256
  ) {
    throw new Error("FINAL-10 evidence does not bind the rejected FINAL-9 predecessor tag");
  }

  return {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-10",
    totalFindingCount: expectedMatrix.summary.totalFindingCount,
    authorClosedCount: 0,
    independentPendingCount: expectedMatrix.summary.independentPendingCount,
    stage6Actions: 0,
    correctionMatrix: {
      path: STAGE5_FINAL10_CORRECTION_MATRIX,
      bytes: (await readFile(matrixPath)).length,
      sha256: sha256(await readFile(matrixPath)),
    },
    sourceReview: {
      path: STAGE5_FINAL9_INDEPENDENT_REVIEW,
      bytes: final9ReviewBytes.length,
      sha256: sha256(final9ReviewBytes),
    },
    rejectedFinal9TagArtifact: {
      path: STAGE5_FINAL10_FINAL9_REJECTED_TAG_ARTIFACT,
      bytes: rejectedTagArtifactBytes.length,
      sha256: sha256(rejectedTagArtifactBytes),
    },
    protectedFinal8,
    protectedFinal9,
  };
};

export const verifyStage5Final10FindingLineage = async ({ root = process.cwd() } = {}) =>
  verifyStage5Final10FindingLineageData({ root });

export const writeStage5Final10CorrectionMatrix = async ({ root = process.cwd() } = {}) => {
  const freezePath = path.join(root, STAGE5_FINAL10_CANDIDATE_FREEZE);
  try {
    await lstat(freezePath);
    throw new Error("FINAL-10 freeze exists; do not rewrite its correction matrix");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await verifyStage5Final8TaggedBytes({ root });
  await verifyStage5Final9RejectedTaggedBytes({ root });
  const {
    matrix: final9Matrix,
    matrixBytes: final9MatrixBytes,
    reviewBytes: final9ReviewBytes,
  } = await readFinal9ReviewInputs(root);
  const matrix = buildStage5Final10CorrectionMatrix({
    final9Matrix,
    final9MatrixBytes,
    final9ReviewBytes,
  });
  const matrixPath = path.join(root, STAGE5_FINAL10_CORRECTION_MATRIX);
  const expectedBytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`, "utf8");
  try {
    const existingBytes = await readFile(matrixPath);
    if (!existingBytes.equals(expectedBytes)) {
      throw new Error("FINAL-10 correction matrix already exists with non-reproducible bytes");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(matrixPath, expectedBytes, { flag: "wx" });
  }
  return {
    result: "PASS",
    matrixPath: STAGE5_FINAL10_CORRECTION_MATRIX,
    totalFindingCount: matrix.summary.totalFindingCount,
    authorClosedCount: 0,
    independentPendingCount: matrix.summary.independentPendingCount,
    stage6Actions: 0,
  };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const report = process.argv.includes("--write")
    ? await writeStage5Final10CorrectionMatrix()
    : await verifyStage5Final10FindingLineage();
  console.log(JSON.stringify(report, null, 2));
}
