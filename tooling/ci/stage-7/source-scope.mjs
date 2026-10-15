import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const validationStatuses = new Set(["NOT_REACHED", "CREATED"]);
const freezeStatuses = new Set(["NOT_REACHED", "CREATED", "VERIFIED"]);
const scanStatuses = new Set(["NOT_REACHED", "PASS", "FAIL"]);
const canonicalCiStatuses = new Set(["NOT_RUN", "PASS", "FAIL"]);
const canonicalCiResultMarker = "=== TRAVELOS_STAGE7_CANONICAL_CI_RESULT ===\n";
export const STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH =
  "tooling/ci/stage-7/prior-candidate-dispositions.json";
const stage7PredecessorCommit = "6242e023953ccb8fe883bff97a0d62e64af8b66a";
const sourceScopeVerifierPaths = [
  STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH,
  "package.json",
  "tooling/ci/stage-7/scan-predecessor-security.mjs",
  "tooling/ci/stage-7/test-predecessor-security-scan.mjs",
  "tooling/ci/stage-7/source-scope.mjs",
  "tooling/ci/stage-7/test-source-scope.mjs",
  "tooling/ci/stage-7/verify-source-scope.mjs",
  "tooling/ci/stage-7/run-canonical-ci.mjs",
  "tooling/ci/stage-7/test-canonical-ci.mjs",
];
const evidenceRootFor = (generation) => `docs/evidence/phase-1-m1/stage-7/${generation}/`;
const isStage7EvidencePath = (generation, value, filename) =>
  typeof value === "string" &&
  value.startsWith(evidenceRootFor(generation)) &&
  value === `${evidenceRootFor(generation)}${filename}` &&
  !value.split("/").includes("..") &&
  !value.startsWith("/");

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assertRelativePath = (value, label) => {
  if (
    typeof value !== "string" ||
    value.startsWith("/") ||
    value.split("/").includes("..") ||
    path.posix.normalize(value) !== value
  ) {
    throw new Error(`${label} must be a normalized repository-relative path`);
  }
};

const readHashedJson = async ({ root, path: relativePath, sha256, label }) => {
  assertRelativePath(relativePath, `${label}.path`);
  if (!/^[a-f0-9]{64}$/u.test(sha256 ?? "")) {
    throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
  }
  const absolutePath = path.resolve(root, relativePath);
  const fileInfo = await lstat(absolutePath);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  const bytes = await readFile(absolutePath);
  if (sha256Of(bytes) !== sha256) {
    throw new Error(`${label} SHA-256 does not match the retained bytes`);
  }
  return JSON.parse(bytes.toString("utf8"));
};

export const loadStage7PriorCandidateDispositions = async ({
  root = process.cwd(),
  candidateGeneration,
} = {}) => {
  const currentGenerationMatch = /^gen([0-9]{2,})$/u.exec(candidateGeneration ?? "");
  if (!currentGenerationMatch) throw new Error("candidateGeneration is invalid");
  const currentGenerationNumber = Number(currentGenerationMatch[1]);
  const historyPath = path.resolve(root, STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH);
  const historyInfo = await lstat(historyPath);
  if (!historyInfo.isFile() || historyInfo.isSymbolicLink()) {
    throw new Error("prior-candidate dispositions must be a regular file");
  }
  const historyBytes = await readFile(historyPath);
  const history = JSON.parse(historyBytes.toString("utf8"));
  if (
    !isRecord(history) ||
    history.schemaVersion !== 1 ||
    history.stage !== "PHASE_1_M1_STAGE_7" ||
    history.candidateGeneration !== candidateGeneration ||
    history.predecessorCommit !== stage7PredecessorCommit ||
    history.stage8Actions !== 0 ||
    !Array.isArray(history.priorCandidates)
  ) {
    throw new Error("prior-candidate dispositions have an invalid header");
  }
  if (history.priorCandidates.length !== currentGenerationNumber - 1) {
    throw new Error("prior-candidate dispositions must cover every earlier generation");
  }

  for (const [index, candidate] of history.priorCandidates.entries()) {
    if (!isRecord(candidate)) throw new Error(`prior candidate #${index + 1} is invalid`);
    const generationNumberMatch = /^gen([0-9]{2,})$/u.exec(candidate.generation ?? "");
    if (
      !generationNumberMatch ||
      Number(generationNumberMatch[1]) !== index + 1 ||
      !/^[a-f0-9]{40}$/u.test(candidate.candidateCommit ?? "") ||
      candidate.stage8Actions !== 0 ||
      !canonicalCiStatuses.has(candidate.canonicalCiStatus)
    ) {
      throw new Error(
        `${candidate.generation ?? `prior candidate #${index + 1}`} has invalid provenance`,
      );
    }

    const generation = candidate.generation.toUpperCase();
    const expectedBaselinePath = `docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_${generation}.json`;
    if (candidate.baseline?.path !== expectedBaselinePath) {
      throw new Error(`${candidate.generation} baseline path is not canonical`);
    }
    const baseline = await readHashedJson({
      root,
      ...candidate.baseline,
      label: `${candidate.generation} baseline`,
    });
    if (
      baseline.candidateGeneration !== candidate.generation ||
      baseline.candidateCommit !== candidate.candidateCommit ||
      baseline.stage8Actions !== 0
    ) {
      throw new Error(`${candidate.generation} baseline does not match its disposition`);
    }

    const expectedReceiptPaths = {
      stage6: `docs/reviews/phase-1-m1/stage-7/${generation}_STAGE6_PREDECESSOR_BASELINE_VERIFY.json`,
      stage7: `docs/reviews/phase-1-m1/stage-7/${generation}_STAGE7_PREDECESSOR_VERIFY.json`,
    };
    for (const receiptKind of ["stage6", "stage7"]) {
      const receiptRecord = candidate.predecessorReceipts?.[receiptKind];
      if (receiptRecord?.path !== expectedReceiptPaths[receiptKind]) {
        throw new Error(
          `${candidate.generation} ${receiptKind} predecessor receipt path is not canonical`,
        );
      }
      const receipt = await readHashedJson({
        root,
        ...receiptRecord,
        label: `${candidate.generation} ${receiptKind} predecessor receipt`,
      });
      if (receipt.result !== "PASS") {
        throw new Error(`${candidate.generation} ${receiptKind} predecessor receipt is not PASS`);
      }
      if (
        receiptKind === "stage7" &&
        (receipt.predecessorCommit !== stage7PredecessorCommit || receipt.stage8Actions !== 0)
      ) {
        throw new Error(`${candidate.generation} Stage 7 predecessor receipt has invalid scope`);
      }
    }

    if (
      typeof candidate.lastPassedGate !== "string" ||
      !candidate.lastPassedGate ||
      typeof candidate.disposition !== "string" ||
      !candidate.disposition ||
      !isRecord(candidate.artifact)
    ) {
      throw new Error(`${candidate.generation} disposition is incomplete`);
    }

    if (candidate.canonicalCiStatus === "NOT_RUN") {
      if (candidate.canonicalCiReceipt !== null) {
        throw new Error(`${candidate.generation} unrun canonical CI must have no receipt`);
      }
    } else {
      const evidenceDirectory = evidenceRootFor(candidate.generation);
      const expectedReceiptPath = `${evidenceDirectory}canonical-ci-execution.json`;
      const expectedLogPath = `${evidenceDirectory}canonical-ci.log`;
      const receiptReference = candidate.canonicalCiReceipt;
      if (
        !isRecord(receiptReference) ||
        Object.keys(receiptReference).toSorted().join(",") !== "path,sha256" ||
        receiptReference.path !== expectedReceiptPath
      ) {
        throw new Error(`${candidate.generation} canonical CI receipt reference is invalid`);
      }
      const ciReceipt = await readHashedJson({
        root,
        ...receiptReference,
        label: `${candidate.generation} canonical CI receipt`,
      });
      if (
        ciReceipt.stage !== "PHASE_1_M1_STAGE_7" ||
        ciReceipt.result !== candidate.canonicalCiStatus ||
        ciReceipt.candidateGeneration !== candidate.generation ||
        ciReceipt.candidateId !== `travelos-phase-1-m1-stage-7-${candidate.generation}` ||
        ciReceipt.candidateCommit !== candidate.candidateCommit ||
        ciReceipt.ciConsumed !== "YES" ||
        ciReceipt.invocationCount !== 1 ||
        ciReceipt.stage8Actions !== 0 ||
        ciReceipt.logPath !== expectedLogPath ||
        !Number.isSafeInteger(ciReceipt.logBytes) ||
        !/^[a-f0-9]{64}$/u.test(ciReceipt.logSha256 ?? "") ||
        !isRecord(ciReceipt.finalMarker)
      ) {
        throw new Error(
          `${candidate.generation} canonical CI receipt does not match its disposition`,
        );
      }
      const logAbsolutePath = path.resolve(root, expectedLogPath);
      const logInfo = await lstat(logAbsolutePath);
      if (!logInfo.isFile() || logInfo.isSymbolicLink()) {
        throw new Error(`${candidate.generation} canonical CI log must be a regular file`);
      }
      const logBytes = await readFile(logAbsolutePath);
      if (logBytes.length !== ciReceipt.logBytes || sha256Of(logBytes) !== ciReceipt.logSha256) {
        throw new Error(`${candidate.generation} canonical CI log hash or byte count differs`);
      }
      const logText = logBytes.toString("utf8");
      const resultMarkerIndex = logText.lastIndexOf(canonicalCiResultMarker);
      if (resultMarkerIndex < 0) {
        throw new Error(`${candidate.generation} canonical CI log lacks its final result marker`);
      }
      const finalMarker = JSON.parse(
        logText.slice(resultMarkerIndex + canonicalCiResultMarker.length).trim(),
      );
      if (
        finalMarker.result !== candidate.canonicalCiStatus ||
        finalMarker.candidateGeneration !== candidate.generation ||
        finalMarker.candidateCommit !== candidate.candidateCommit ||
        finalMarker.artifactSha256 !== ciReceipt.artifactSha256 ||
        finalMarker.completedGateCount !== ciReceipt.completedGateCount ||
        finalMarker.expectedGateCount !== ciReceipt.expectedGateCount ||
        finalMarker.failedGate !== ciReceipt.failedGate ||
        finalMarker.stage8Actions !== 0 ||
        JSON.stringify(finalMarker) !== JSON.stringify(ciReceipt.finalMarker)
      ) {
        throw new Error(
          `${candidate.generation} canonical CI log final marker differs from its receipt`,
        );
      }
    }

    const artifact = candidate.artifact;
    if (typeof artifact.result !== "string" || !artifact.result) {
      throw new Error(`${candidate.generation} artifact result is required`);
    }
    if (artifact.path === null) {
      if (artifact.sha256 !== null || artifact.bytes !== null) {
        throw new Error(`${candidate.generation} missing artifact path has artifact metadata`);
      }
      if (artifact.result === "PASS") {
        throw new Error(`${candidate.generation} passing artifact has no retained path`);
      }
    } else {
      assertRelativePath(artifact.path, `${candidate.generation} artifact.path`);
      if (
        !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "") ||
        !Number.isSafeInteger(artifact.bytes) ||
        artifact.bytes <= 0
      ) {
        throw new Error(`${candidate.generation} artifact provenance is invalid`);
      }
    }
    if (artifact.buildReceipt !== null && artifact.buildReceipt !== undefined) {
      if (
        !isRecord(artifact.buildReceipt) ||
        typeof artifact.buildReceipt.path !== "string" ||
        !/^[a-f0-9]{64}$/u.test(artifact.buildReceipt.sha256 ?? "")
      ) {
        throw new Error(`${candidate.generation} artifact build receipt reference is invalid`);
      }
      assertRelativePath(
        artifact.buildReceipt.path,
        `${candidate.generation} artifact.buildReceipt.path`,
      );
    }
  }

  return {
    historyPath: STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH,
    historySha256: sha256Of(historyBytes),
    priorCandidates: history.priorCandidates,
  };
};

export const evaluateStage7PriorEvidenceScope = ({ priorCandidates, sourcePaths } = {}) => {
  const violations = [];
  const requiredEvidencePaths = new Set();
  const candidateErrors = new Map();

  if (!Array.isArray(priorCandidates)) {
    return {
      result: "FAIL",
      candidateCount: 0,
      requiredEvidencePaths: [],
      missingPaths: [],
      freezeEligibleGenerations: [],
      violations: ["priorCandidates must be an array"],
    };
  }
  if (!Array.isArray(sourcePaths) || sourcePaths.some((entry) => typeof entry !== "string")) {
    return {
      result: "FAIL",
      candidateCount: priorCandidates.length,
      requiredEvidencePaths: [],
      missingPaths: [],
      freezeEligibleGenerations: [],
      violations: ["sourcePaths must be an array of strings"],
    };
  }

  const seenGenerations = new Set();
  for (const [index, candidate] of priorCandidates.entries()) {
    const generation = candidate?.generation;
    const label = typeof generation === "string" ? generation : `candidate#${index + 1}`;
    const candidateViolation = (message) => {
      const detail = `${label}: ${message}`;
      violations.push(detail);
      candidateErrors.set(label, true);
    };

    if (!/^gen[0-9]{2,}$/u.test(generation ?? "")) {
      candidateViolation("invalid generation identifier");
    } else if (seenGenerations.has(generation)) {
      candidateViolation("duplicate generation identifier");
    } else {
      seenGenerations.add(generation);
    }
    if (typeof candidate?.lastPassedGate !== "string" || !candidate.lastPassedGate) {
      candidateViolation("lastPassedGate is required");
    }
    if (typeof candidate?.disposition !== "string" || !candidate.disposition) {
      candidateViolation("disposition is required");
    }
    if (!canonicalCiStatuses.has(candidate?.canonicalCiStatus)) {
      candidateViolation("invalid canonical CI status");
    } else if (candidate.canonicalCiStatus === "NOT_RUN") {
      if (candidate.canonicalCiReceipt !== null) {
        candidateViolation("unrun canonical CI must have no receipt");
      }
    } else {
      const expectedReceiptPath = `${evidenceRootFor(generation)}canonical-ci-execution.json`;
      const expectedLogPath = `${evidenceRootFor(generation)}canonical-ci.log`;
      const receiptReference = candidate?.canonicalCiReceipt;
      if (
        !isRecord(receiptReference) ||
        Object.keys(receiptReference).toSorted().join(",") !== "path,sha256" ||
        receiptReference.path !== expectedReceiptPath ||
        !/^[a-f0-9]{64}$/u.test(receiptReference.sha256 ?? "")
      ) {
        candidateViolation("completed canonical CI requires its canonical receipt reference");
      } else {
        requiredEvidencePaths.add(expectedReceiptPath);
        requiredEvidencePaths.add(expectedLogPath);
      }
    }
    if (!validationStatuses.has(candidate?.validationStatus)) {
      candidateViolation("invalid validation status");
    }
    if (!freezeStatuses.has(candidate?.freezeStatus)) {
      candidateViolation("invalid freeze status");
    }
    if (!scanStatuses.has(candidate?.finalCandidateScan)) {
      candidateViolation("invalid final-candidate scan status");
    }

    const validationCreated = candidate?.validationStatus === "CREATED";
    const freezeCreated =
      candidate?.freezeStatus === "CREATED" || candidate?.freezeStatus === "VERIFIED";
    if (validationCreated) {
      if (
        !isStage7EvidencePath(generation, candidate.validationPath, "candidate-validation.json")
      ) {
        candidateViolation("created validation requires its canonical evidence path");
      } else {
        requiredEvidencePaths.add(candidate.validationPath);
      }
    } else if (candidate?.validationPath !== null) {
      candidateViolation("validation path must be null when validation was not reached");
    }

    if (freezeCreated) {
      if (!validationCreated) {
        candidateViolation("freeze requires a created validation document");
      }
      if (!isStage7EvidencePath(generation, candidate.freezePath, "candidate-freeze.json")) {
        candidateViolation("created freeze requires its canonical evidence path");
      } else {
        requiredEvidencePaths.add(candidate.freezePath);
      }
    } else if (candidate?.freezePath !== null) {
      candidateViolation("freeze path must be null when freeze was not reached");
    }

    if (
      candidate?.finalCandidateScan === "PASS" &&
      (!validationCreated || candidate?.freezeStatus !== "VERIFIED")
    ) {
      candidateViolation(
        "a passing final-candidate scan requires validation and a verified freeze",
      );
    }
    if (candidate?.finalCandidateScan === "FAIL" && (!validationCreated || !freezeCreated)) {
      candidateViolation("a final-candidate scan requires validation and freeze inputs");
    }
  }

  const sourcePathSet = new Set();
  for (const sourcePath of sourcePaths) {
    if (sourcePathSet.has(sourcePath)) {
      violations.push(`duplicate source path: ${sourcePath}`);
    }
    sourcePathSet.add(sourcePath);
  }
  const orderedRequiredPaths = [...requiredEvidencePaths].toSorted();
  const missingPaths = orderedRequiredPaths.filter(
    (requiredPath) => !sourcePathSet.has(requiredPath),
  );
  for (const missingPath of missingPaths)
    violations.push(`required evidence path is missing: ${missingPath}`);

  const freezeEligibleGenerations =
    violations.length === 0
      ? priorCandidates
          .filter(
            (candidate) =>
              candidate?.finalCandidateScan === "PASS" &&
              candidate?.freezeStatus === "VERIFIED" &&
              candidateErrors.get(candidate?.generation) !== true &&
              sourcePathSet.has(candidate?.validationPath) &&
              sourcePathSet.has(candidate?.freezePath),
          )
          .map(({ generation }) => generation)
          .toSorted()
      : [];

  return {
    result: violations.length === 0 ? "PASS" : "FAIL",
    candidateCount: priorCandidates.length,
    requiredEvidencePaths: orderedRequiredPaths,
    missingPaths,
    freezeEligibleGenerations,
    violations,
  };
};

export const verifyStage7CandidateSourceScope = async ({
  root = process.cwd(),
  candidateGeneration,
  candidateCommit,
  baselinePath,
  baselineSha256,
} = {}) => {
  const generationMatch = /^gen[0-9]{2,}$/u.exec(candidateGeneration ?? "");
  if (!generationMatch) throw new Error("candidateGeneration is invalid");
  if (!/^[a-f0-9]{40}$/u.test(candidateCommit ?? "")) {
    throw new Error("candidateCommit is invalid");
  }
  const expectedBaselinePath = `docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_${candidateGeneration.toUpperCase()}.json`;
  if (baselinePath !== expectedBaselinePath) {
    throw new Error("candidate baseline path is not canonical");
  }
  const baseline = await readHashedJson({
    root,
    path: baselinePath,
    sha256: baselineSha256,
    label: `${candidateGeneration} candidate baseline`,
  });
  if (
    baseline.candidateGeneration !== candidateGeneration ||
    baseline.candidateCommit !== candidateCommit ||
    baseline.stage8Actions !== 0
  ) {
    throw new Error("candidate baseline does not match the verified candidate identity");
  }
  if (
    !Array.isArray(baseline.sourceFiles) ||
    baseline.sourceFiles.some((entry) => !isRecord(entry) || typeof entry.path !== "string")
  ) {
    throw new Error("candidate baseline sourceFiles must be an array of path records");
  }

  const sourcePaths = baseline.sourceFiles.map(({ path: sourcePath }) => sourcePath);
  const priorHistory = await loadStage7PriorCandidateDispositions({
    root,
    candidateGeneration,
  });
  const historicalEvidencePaths = new Set();
  for (const candidate of priorHistory.priorCandidates) {
    if (candidate.canonicalCiStatus !== "NOT_RUN") {
      historicalEvidencePaths.add(candidate.canonicalCiReceipt.path);
      historicalEvidencePaths.add(`${evidenceRootFor(candidate.generation)}canonical-ci.log`);
    }
    if (candidate.validationStatus === "CREATED") {
      historicalEvidencePaths.add(candidate.validationPath);
    }
    if (["CREATED", "VERIFIED"].includes(candidate.freezeStatus)) {
      historicalEvidencePaths.add(candidate.freezePath);
    }
  }
  const verifiedHistoricalEvidencePaths = [...historicalEvidencePaths].toSorted();
  for (const evidencePath of verifiedHistoricalEvidencePaths) {
    assertRelativePath(evidencePath, "prior evidence path");
    const evidenceAbsolutePath = path.resolve(root, evidencePath);
    const evidenceInfo = await lstat(evidenceAbsolutePath);
    if (!evidenceInfo.isFile() || evidenceInfo.isSymbolicLink()) {
      throw new Error(`prior evidence is not a regular file: ${evidencePath}`);
    }
    await readFile(evidenceAbsolutePath);
  }
  const evaluation = evaluateStage7PriorEvidenceScope({
    priorCandidates: priorHistory.priorCandidates,
    sourcePaths: [...sourcePaths, ...verifiedHistoricalEvidencePaths],
  });
  const missingVerifierPaths = sourceScopeVerifierPaths.filter(
    (requiredPath) => !sourcePaths.includes(requiredPath),
  );
  const violations = [...evaluation.violations];
  if (missingVerifierPaths.length > 0) {
    violations.push("candidate baseline does not bind the Stage 7 source-scope verifier");
  }

  return {
    ...evaluation,
    result: violations.length === 0 ? "PASS" : "FAIL",
    violations,
    candidateGeneration,
    candidateCommit,
    baselinePath,
    baselineSha256,
    historyPath: priorHistory.historyPath,
    historySha256: priorHistory.historySha256,
    missingVerifierPaths,
  };
};
