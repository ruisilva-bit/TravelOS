import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STAGE5_FINAL10_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL10_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION,
  STAGE5_FINAL10_EVIDENCE_DIRECTORY,
  STAGE5_FINAL10_EVIDENCE_INDEX,
  STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ALLOWED_PHASES = new Set(["PRE_CI", "FINAL"]);
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const sort = (values) => [...values].sort((left, right) => left.localeCompare(right));
const sameArray = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const serializeArtifacts = (artifacts) =>
  artifacts.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join("");
const artifactPath = (name) => `${STAGE5_FINAL10_EVIDENCE_DIRECTORY}/${name}`;

export const parseCiVerifyGateLabels = (verifySource) => {
  const match = verifySource.match(/const\s+gates\s*=\s*\[([\s\S]*?)\n\];/u);
  if (!match) throw new Error("Authoritative CI gate list is absent or has an unsupported shape");
  const labels = [...match[1].matchAll(/^\s*\[\s*"([^"]+)"\s*,\s*"[^"]+"\s*\]\s*,?\s*$/gmu)].map(
    (gate) => gate[1],
  );
  if (labels.length === 0 || new Set(labels).size !== labels.length) {
    throw new Error("Authoritative CI gate list is empty or contains duplicate labels");
  }
  return labels;
};

export const verifyStage5Final10CiExecution = async ({ root, phase }) => {
  const logPath = path.join(root, artifactPath("ci-verify.log"));
  const executionPath = path.join(root, artifactPath("ci-verify-execution.json"));
  const logBytes = await readFile(logPath);
  const log = logBytes.toString("utf8");
  const executionBytes = await readFile(executionPath);

  if (phase === "PRE_CI") {
    if (log !== STAGE5_FINAL10_CI_LOG_PLACEHOLDER) {
      throw new Error("PRE_CI index requires the exact non-evidence CI-log placeholder");
    }
    if (executionBytes.toString("utf8") !== STAGE5_FINAL10_CI_EXECUTION_PLACEHOLDER) {
      throw new Error("PRE_CI index requires the exact zero-invocation execution placeholder");
    }
    return {
      phase,
      invocationCount: 0,
      result: "NOT_RUN",
      logSha256: sha256(logBytes),
      executionSha256: sha256(executionBytes),
    };
  }

  let execution;
  try {
    execution = JSON.parse(executionBytes.toString("utf8"));
  } catch {
    throw new Error("Final CI execution evidence is not valid JSON");
  }
  const verifySource = await readFile(path.join(root, "tooling/ci/verify.mjs"), "utf8");
  const expectedGateLabels = parseCiVerifyGateLabels(verifySource);
  const gateHeadings = [...log.matchAll(/^=== TravelOS CI gate: ([^\r\n]+) ===$/gmu)].map(
    (heading) => heading[1],
  );
  const pinGateHeading = "=== TravelOS CI gate: verify:pins ===";
  const pinGateStart = log.indexOf(pinGateHeading);
  const pinGateEnd =
    pinGateStart < 0 ? -1 : log.indexOf("\n=== TravelOS CI gate:", pinGateStart + 1);
  const pinGateLog =
    pinGateStart < 0 ? "" : log.slice(pinGateStart, pinGateEnd < 0 ? undefined : pinGateEnd);
  const pinReport = pinGateLog.match(
    /"toolchain"\s*:\s*\{\s*"node"\s*:\s*"([^"]+)"\s*,\s*"corepack"\s*:\s*"([^"]+)"\s*,\s*"pnpm"\s*:\s*"([^"]+)"\s*\}/u,
  );
  const summaryMatches = [
    ...log.matchAll(
      /\{\s*"schemaVersion"\s*:\s*1\s*,\s*"result"\s*:\s*"PASS"\s*,\s*"completed"\s*:\s*\[[\s\S]*?\]\s*\}/gu,
    ),
  ];
  if (summaryMatches.length === 0) {
    throw new Error("Final CI log is missing the machine-readable PASS completion marker");
  }
  const finalSummaryMatch = summaryMatches.at(-1);
  if ((finalSummaryMatch.index ?? -1) < log.lastIndexOf("=== TravelOS CI gate:")) {
    throw new Error("Final CI completion marker precedes the last gate heading");
  }
  let summary;
  try {
    summary = JSON.parse(finalSummaryMatch[0]);
  } catch {
    throw new Error("Final CI completion marker is not valid JSON");
  }
  const startedAt = Date.parse(execution.startedAtUtc);
  const finishedAt = Date.parse(execution.finishedAtUtc);
  const timestampsAreCanonical =
    Number.isFinite(startedAt) &&
    Number.isFinite(finishedAt) &&
    new Date(startedAt).toISOString() === execution.startedAtUtc &&
    new Date(finishedAt).toISOString() === execution.finishedAtUtc &&
    finishedAt > startedAt;

  if (
    execution.schemaVersion !== 1 ||
    execution.candidate !== "FINAL-10" ||
    execution.phase !== "FINAL" ||
    execution.invocationCount !== 1 ||
    execution.result !== "PASS" ||
    execution.exitCode !== 0 ||
    execution.command !== "corepack pnpm ci:verify" ||
    execution.cwd !== root ||
    typeof execution.nodeExecutable !== "string" ||
    !path.isAbsolute(execution.nodeExecutable) ||
    execution.nodeVersion !== "v24.19.0" ||
    execution.corepackVersion !== "0.35.0" ||
    execution.pnpmVersion !== "11.21.0" ||
    !timestampsAreCanonical
  ) {
    throw new Error(
      "Final CI execution evidence is incomplete, non-passing, or uses another toolchain",
    );
  }
  if (
    pinReport === null ||
    pinReport[1] !== execution.nodeVersion.slice(1) ||
    pinReport[2] !== execution.corepackVersion ||
    pinReport[3] !== execution.pnpmVersion
  ) {
    throw new Error("Final CI log is missing the exact child-gate toolchain pin report");
  }
  if (
    summary.schemaVersion !== 1 ||
    summary.result !== "PASS" ||
    !sameArray(summary.completed ?? [], expectedGateLabels) ||
    !sameArray(gateHeadings, expectedGateLabels)
  ) {
    throw new Error(
      "Final CI log does not prove one complete ordered run of the current gate list",
    );
  }
  return {
    phase,
    result: "PASS",
    invocationCount: execution.invocationCount,
    exitCode: execution.exitCode,
    completedGates: summary.completed,
    nodeVersion: execution.nodeVersion,
    corepackVersion: execution.corepackVersion,
    pnpmVersion: execution.pnpmVersion,
    childToolchainPinReport: {
      nodeVersion: pinReport[1],
      corepackVersion: pinReport[2],
      pnpmVersion: pinReport[3],
    },
    logBytes: logBytes.length,
    logSha256: sha256(logBytes),
    executionBytes: executionBytes.length,
    executionSha256: sha256(executionBytes),
  };
};

export const verifyStage5Final10EvidenceIndex = async ({
  root = process.cwd(),
  allowedPhases = ["PRE_CI", "FINAL"],
  requiredPhase,
} = {}) => {
  const evidenceDirectory = path.join(root, STAGE5_FINAL10_EVIDENCE_DIRECTORY);
  const evidenceDirectoryMetadata = await lstat(evidenceDirectory);
  if (!evidenceDirectoryMetadata.isDirectory() || evidenceDirectoryMetadata.isSymbolicLink()) {
    throw new Error("FINAL-10 evidence root must be a regular directory");
  }
  const directoryEntries = await readdir(evidenceDirectory, { withFileTypes: true });
  const invalidDirectoryEntries = directoryEntries
    .filter((entry) => !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  const actualNames = directoryEntries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  const expectedNames = sort([
    ...STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
    "EVIDENCE_INDEX.json",
  ]);
  const missing = expectedNames.filter((name) => !actualNames.includes(name));
  const unexpected = actualNames.filter((name) => !expectedNames.includes(name));
  if (
    invalidDirectoryEntries.length > 0 ||
    missing.length > 0 ||
    unexpected.length > 0 ||
    actualNames.length !== expectedNames.length
  ) {
    throw new Error(
      `FINAL-10 evidence directory is not exact: ${JSON.stringify({ missing, unexpected, invalidDirectoryEntries })}`,
    );
  }

  const indexPath = path.join(root, STAGE5_FINAL10_EVIDENCE_INDEX);
  const indexBytes = await readFile(indexPath);
  let index;
  try {
    index = JSON.parse(indexBytes.toString("utf8"));
  } catch {
    throw new Error("FINAL-10 evidence index is not valid JSON");
  }
  if (!ALLOWED_PHASES.has(index.phase) || !allowedPhases.includes(index.phase)) {
    throw new Error(`FINAL-10 evidence index phase is not allowed: ${index.phase}`);
  }
  if (requiredPhase !== undefined && index.phase !== requiredPhase) {
    throw new Error(`FINAL-10 evidence index must be ${requiredPhase}, received ${index.phase}`);
  }

  const indexedArtifacts = Array.isArray(index.artifacts) ? index.artifacts : [];
  const expectedPaths =
    STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(artifactPath).toSorted();
  const indexedPaths = indexedArtifacts.map((artifact) => artifact?.path);
  const duplicatePaths = indexedPaths.filter(
    (filePath, position) => indexedPaths.indexOf(filePath) !== position,
  );
  if (
    index.schemaVersion !== 1 ||
    index.result !== "PASS" ||
    index.stage !== "PHASE_1_M1_STAGE_5" ||
    index.candidate !== "FINAL-10" ||
    index.artifactCount !== expectedPaths.length ||
    indexedArtifacts.length !== expectedPaths.length ||
    !sameArray(indexedPaths, expectedPaths) ||
    duplicatePaths.length > 0 ||
    index.aggregateSerialization !== STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION
  ) {
    throw new Error("FINAL-10 evidence index metadata or expected artifact path set is invalid");
  }

  const sizeMismatches = [];
  const hashMismatches = [];
  for (const artifact of indexedArtifacts) {
    if (
      typeof artifact.path !== "string" ||
      path.isAbsolute(artifact.path) ||
      artifact.path.split("/").some((segment) => segment === "" || segment === "..") ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 ||
      !SHA256_PATTERN.test(artifact.sha256)
    ) {
      throw new Error(
        `FINAL-10 evidence index has an invalid artifact row: ${String(artifact.path)}`,
      );
    }
    const artifactBytes = await readFile(path.join(root, artifact.path));
    if (artifactBytes.length !== artifact.bytes) sizeMismatches.push(artifact.path);
    if (sha256(artifactBytes) !== artifact.sha256) hashMismatches.push(artifact.path);
  }
  const recomputedAggregateSha256 = sha256(serializeArtifacts(indexedArtifacts));
  if (
    sizeMismatches.length > 0 ||
    hashMismatches.length > 0 ||
    recomputedAggregateSha256 !== index.aggregateSha256
  ) {
    throw new Error(
      `FINAL-10 evidence byte/aggregate verification failed: ${JSON.stringify({ sizeMismatches, hashMismatches, declaredAggregateSha256: index.aggregateSha256, recomputedAggregateSha256 })}`,
    );
  }

  const ciExecution = await verifyStage5Final10CiExecution({ root, phase: index.phase });
  return {
    schemaVersion: 1,
    result: "PASS",
    phase: index.phase,
    indexPath: STAGE5_FINAL10_EVIDENCE_INDEX,
    indexBytes: indexBytes.length,
    indexSha256: sha256(indexBytes),
    artifactCount: indexedArtifacts.length,
    artifactBytesManifest: indexedArtifacts,
    matched: indexedArtifacts.length,
    missing,
    unexpected,
    invalidDirectoryEntries,
    sizeMismatches,
    hashMismatches,
    aggregateSerialization: STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION,
    declaredAggregateSha256: index.aggregateSha256,
    recomputedAggregateSha256,
    ciExecution,
  };
};

export const writeStage5Final10EvidenceIndex = async ({ root = process.cwd(), phase } = {}) => {
  if (!ALLOWED_PHASES.has(phase))
    throw new Error(`Invalid FINAL-10 evidence-index phase: ${phase}`);
  const evidenceDirectory = path.join(root, STAGE5_FINAL10_EVIDENCE_DIRECTORY);
  const evidenceDirectoryMetadata = await lstat(evidenceDirectory);
  if (!evidenceDirectoryMetadata.isDirectory() || evidenceDirectoryMetadata.isSymbolicLink()) {
    throw new Error("FINAL-10 evidence root must be a regular directory");
  }
  if (phase === "PRE_CI") {
    const ciLogPath = path.join(evidenceDirectory, "ci-verify.log");
    const ciExecutionPath = path.join(evidenceDirectory, "ci-verify-execution.json");
    let existingLog;
    try {
      existingLog = await readFile(ciLogPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(ciLogPath, STAGE5_FINAL10_CI_LOG_PLACEHOLDER, { flag: "wx" });
      existingLog = STAGE5_FINAL10_CI_LOG_PLACEHOLDER;
    }
    let existingExecution;
    try {
      existingExecution = await readFile(ciExecutionPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(ciExecutionPath, STAGE5_FINAL10_CI_EXECUTION_PLACEHOLDER, { flag: "wx" });
      existingExecution = STAGE5_FINAL10_CI_EXECUTION_PLACEHOLDER;
    }
    if (
      existingLog !== STAGE5_FINAL10_CI_LOG_PLACEHOLDER ||
      existingExecution !== STAGE5_FINAL10_CI_EXECUTION_PLACEHOLDER
    ) {
      throw new Error("PRE_CI cannot replace existing authoritative CI execution evidence");
    }
  }
  await verifyStage5Final10CiExecution({ root, phase });

  const artifacts = [];
  for (const name of STAGE5_FINAL10_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
    const relativePath = artifactPath(name);
    const absolutePath = path.join(root, relativePath);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`FINAL-10 evidence artifact is not a regular file: ${relativePath}`);
    }
    const bytes = await readFile(absolutePath);
    artifacts.push({ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) });
  }
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  const index = {
    schemaVersion: 1,
    result: "PASS",
    stage: "PHASE_1_M1_STAGE_5",
    candidate: "FINAL-10",
    phase,
    artifactCount: artifacts.length,
    aggregateSerialization: STAGE5_FINAL10_EVIDENCE_AGGREGATE_SERIALIZATION,
    aggregateSha256: sha256(serializeArtifacts(artifacts)),
    artifacts,
  };
  const indexPath = path.join(root, STAGE5_FINAL10_EVIDENCE_INDEX);
  try {
    const indexMetadata = await lstat(indexPath);
    if (!indexMetadata.isFile() || indexMetadata.isSymbolicLink() || indexMetadata.nlink !== 1) {
      throw new Error("FINAL-10 evidence index output must be a unique regular file");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return verifyStage5Final10EvidenceIndex({ root, allowedPhases: [phase], requiredPhase: phase });
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const phase = process.argv[2] ?? "PRE_CI";
  const report = await writeStage5Final10EvidenceIndex({ phase });
  console.log(JSON.stringify(report, null, 2));
}
