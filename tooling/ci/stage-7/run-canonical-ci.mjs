import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { captureStage5WorkingTreeSnapshot } from "../stage-5-working-tree-snapshot.mjs";
import {
  STAGE7_AUTHORIZED_PATHS,
  STAGE7_DEFAULT_GENERATION,
  stage7BaselinePathFor,
  verifyStage7SuccessorBaseline,
} from "../stage-7-successor-baseline.mjs";
import { verifyStage7DeploymentContract } from "./verify-deployment-contract.mjs";
import { verifyStage7Artifact } from "./verify-artifact.mjs";
import { verifyStage7CandidateSourceScope } from "./source-scope.mjs";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expectedToolchain = Object.freeze({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
const resultMarker = "=== TRAVELOS_STAGE7_CANONICAL_CI_RESULT ===\n";

export const STAGE7_CANONICAL_CI_GATES = Object.freeze([
  { label: "protected-baseline:pre", script: "protected-baseline:check" },
  { label: "stage5-candidate-coherence:pre", script: "stage5:candidate-coherence:verify" },
  {
    label: "stage7-predecessor:pre",
    script: "stage7:predecessor:verify",
    args: (generation) => [`--generation=${generation}`],
  },
  {
    label: "stage7-successor-baseline:pre",
    script: "stage7:successor-baseline:verify",
    args: (generation) => [`--generation=${generation}`],
  },
  {
    label: "stage7-source-scope:pre",
    script: "stage7:source-scope:verify",
    args: (generation) => [`--generation=${generation}`],
  },
  {
    label: "stage6-predecessor:security-scan",
    script: "stage7:predecessor:security-scan",
    args: (generation) => [`--generation=${generation}`],
  },
  { label: "verify:pins", script: "verify:pins" },
  { label: "db:migrations:verify", script: "db:migrations:verify" },
  { label: "auth:schema:verify", script: "auth:schema:verify" },
  { label: "test:lifecycle-policy", script: "test:lifecycle-policy" },
  { label: "format:check", script: "format:check" },
  { label: "lint", script: "lint" },
  { label: "build", script: "build" },
  { label: "typecheck", script: "typecheck" },
  { label: "architecture:check", script: "architecture:check" },
  { label: "test:unit", script: "test:unit" },
  { label: "config:schema:check", script: "config:schema:check" },
  { label: "stage3:corrections:verify", script: "stage3:corrections:verify" },
  { label: "test:freeze-inputs", script: "test:freeze-inputs" },
  { label: "test:security-scanner", script: "test:security-scanner" },
  { label: "test:stage6-successor-baseline", script: "test:stage6:successor-baseline" },
  { label: "test:stage6-deployment-contract", script: "test:stage6:deployment-contract" },
  { label: "test:stage6-migrator-bootstrap", script: "test:stage6:migrator-bootstrap" },
  { label: "test:stage7:successor-baseline", script: "test:stage7:successor-baseline" },
  { label: "test:stage7:source-scope", script: "test:stage7:source-scope" },
  {
    label: "test:stage7:predecessor-security-scan",
    script: "test:stage7:predecessor-security-scan",
  },
  { label: "test:stage7:canonical-ci", script: "test:stage7:canonical-ci" },
  { label: "test:stage7:artifact", script: "test:stage7:artifact" },
  { label: "test:stage7:deployment-contract", script: "test:stage7:deployment-contract" },
  { label: "test:stage7:migrator-package", script: "test:stage7:migrator-package" },
  {
    label: "stage7-deployment-contract",
    script: "stage7:deployment-contract:verify",
    args: (generation) => [`--generation=${generation}`],
  },
  { label: "test:stage7:postgres", script: "test:stage7:postgres" },
  { label: "test:rejected-technologies", script: "test:rejected-technologies" },
  { label: "verify:rejected-technologies", script: "verify:rejected-technologies" },
  { label: "evidence:stage4:verify", script: "evidence:stage4:verify" },
  { label: "security:scan:stage4", script: "security:scan:stage4" },
  { label: "test:smoke", script: "test:smoke" },
  { label: "security:scan:bundles", script: "security:scan:bundles" },
  {
    label: "stage7-successor-baseline:post",
    script: "stage7:successor-baseline:verify",
    args: (generation) => [`--generation=${generation}`],
  },
  {
    label: "stage7-source-scope:post",
    script: "stage7:source-scope:verify",
    args: (generation) => [`--generation=${generation}`],
  },
  { label: "stage5-candidate-coherence:post", script: "stage5:candidate-coherence:verify" },
  { label: "protected-baseline:post", script: "protected-baseline:check" },
]);

export const stage7CanonicalCiPathsFor = (generation = STAGE7_DEFAULT_GENERATION) => {
  assert.match(generation, /^gen[0-9]{2,}$/u, "Invalid Stage 7 generation");
  const evidenceDirectory = `docs/evidence/phase-1-m1/stage-7/${generation}`;
  const statePrefix = `.hermes/state/stage7-${generation}-canonical-ci`;
  return {
    guardPath: `${statePrefix}-guard.json`,
    claimPath: `${statePrefix}-claim.json`,
    logPath: `${evidenceDirectory}/canonical-ci.log`,
    receiptPath: `${evidenceDirectory}/canonical-ci-execution.json`,
  };
};

export const listStage7LocalStatePaths = (rootPath) =>
  execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: rootPath,
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => relativePath.startsWith(".hermes/state/"))
    .toSorted();

export const captureStage7CandidateSnapshot = ({ root: rootPath, generation, localStatePaths }) => {
  assert.ok(Array.isArray(localStatePaths), "Fixed local-state path set is required");
  for (const relativePath of localStatePaths) {
    assert.ok(
      relativePath.startsWith(".hermes/state/") && !relativePath.split("/").includes(".."),
      `Invalid local-state snapshot exclusion: ${relativePath}`,
    );
  }
  const statePaths = stage7CanonicalCiPathsFor(generation);
  const excludedPaths = [
    ...new Set([...localStatePaths, statePaths.guardPath, statePaths.claimPath]),
  ].toSorted();
  return captureStage5WorkingTreeSnapshot({ root: rootPath, excludedPaths });
};

const isAllowedCandidateEvidence = (relativePath, generation) =>
  relativePath === stage7BaselinePathFor(generation) ||
  /^docs\/reviews\/phase-1-m1\/STAGE_7_SUCCESSOR_BASELINE_GEN[0-9]{2,}\.json$/u.test(
    relativePath,
  ) ||
  STAGE7_AUTHORIZED_PATHS.evidencePrefixes.some((prefix) => relativePath.startsWith(prefix));

const assertSnapshot = (snapshot, candidate, generation) => {
  assert.equal(
    snapshot.commit,
    candidate.candidateCommit,
    "Candidate HEAD differs from the artifact",
  );
  assert.equal(
    snapshot.trackedDiffFromHeadBytes,
    0,
    "Tracked candidate files changed after commit",
  );
  for (const file of snapshot.untrackedFiles) {
    assert.ok(
      isAllowedCandidateEvidence(file.path, generation),
      `Unexpected untracked path before canonical CI: ${file.path}`,
    );
  }
};

const assertCandidate = (candidate, generation) => {
  assert.equal(candidate?.result, "PASS", "Candidate preflight must pass before one-shot CI");
  assert.equal(candidate.candidateGeneration, generation);
  assert.match(candidate.candidateCommit ?? "", /^[a-f0-9]{40}$/u);
  assert.match(candidate.artifactSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(candidate.stage8Actions, 0, "Stage 8 actions must remain zero");
  assert.equal(
    candidate.priorEvidenceScope?.result,
    "PASS",
    "Prior-evidence source-scope verification must pass before CI",
  );
  assert.equal(candidate.priorEvidenceScope.candidateGeneration, generation);
  assert.equal(candidate.priorEvidenceScope.candidateCommit, candidate.candidateCommit);
  assert.equal(candidate.priorEvidenceScope.baselineSha256, candidate.baselineSha256);
  assert.match(candidate.priorEvidenceScope.historySha256 ?? "", /^[a-f0-9]{64}$/u);
};

const assertAbsent = async (rootPath, relativePath) => {
  try {
    await lstat(path.join(rootPath, relativePath));
    throw new Error(`One-shot Stage 7 CI state already exists: ${relativePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

const writeExclusive = async (rootPath, relativePath, bytes) => {
  const absolutePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes, { flag: "wx", mode: 0o644 });
};

const readPinnedToolchain = (rootPath) => {
  const version = (args) => {
    const result = spawnSync("corepack", args, {
      cwd: rootPath,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, `Unable to verify toolchain: corepack ${args.join(" ")}`);
    return result.stdout.trim();
  };
  const actual = {
    node: process.version,
    corepack: version(["--version"]),
    pnpm: version(["pnpm", "--version"]),
  };
  assert.deepEqual(actual, expectedToolchain, "Canonical CI requires the pinned toolchain");
  return { ...actual, nodeExecutable: process.execPath };
};

export const verifyCandidateFromRepository = async ({
  root: workspace,
  generation,
  verifyBaseline = verifyStage7SuccessorBaseline,
  verifySourceScope = verifyStage7CandidateSourceScope,
  verifyDeployment = verifyStage7DeploymentContract,
  verifyArtifact = verifyStage7Artifact,
} = {}) => {
  const baseline = await verifyBaseline({ root: workspace, generation });
  assert.equal(baseline.result, "PASS");
  assert.equal(baseline.currentBranch, "phase-1/stage-7");
  assert.equal(baseline.currentHead, baseline.candidateCommit);
  const priorEvidenceScope = await verifySourceScope({
    root: workspace,
    candidateGeneration: generation,
    candidateCommit: baseline.candidateCommit,
    baselinePath: baseline.baselinePath,
    baselineSha256: baseline.baselineSha256,
  });
  assert.equal(
    priorEvidenceScope.result,
    "PASS",
    "Prior-evidence source-scope verification must pass before CI",
  );
  assert.equal(priorEvidenceScope.candidateGeneration, generation);
  assert.equal(priorEvidenceScope.candidateCommit, baseline.candidateCommit);
  assert.equal(priorEvidenceScope.baselineSha256, baseline.baselineSha256);
  const deployment = await verifyDeployment({
    root: workspace,
    generation,
    expectedCommit: baseline.candidateCommit,
  });
  assert.equal(deployment.result, "PASS");
  assert.equal(deployment.candidateCommit, baseline.candidateCommit);
  const artifactRoot = path.join(workspace, `.hermes/state/stage7-${generation}-artifact`);
  const archivePath = `${artifactRoot}.tar.gz`;
  const expectedTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: workspace,
    encoding: "utf8",
  }).trim();
  const lockfileSha256 = hash(await readFile(path.join(workspace, "pnpm-lock.yaml")));
  const artifact = await verifyArtifact({
    artifactRoot,
    archivePath,
    generation,
    expectedCommit: baseline.candidateCommit,
    expectedTree,
    expectedBaselineSha256: baseline.baselineSha256,
    expectedLockfileSha256: lockfileSha256,
  });
  assert.equal(
    artifact.result,
    "PASS",
    "Immutable Stage 7 artifact verification must pass before CI",
  );
  assert.match(
    artifact.artifactSha256 ?? "",
    /^[a-f0-9]{64}$/u,
    "Verified artifact SHA-256 is required",
  );
  return {
    result: "PASS",
    candidateGeneration: generation,
    candidateId: baseline.candidateId,
    candidateCommit: baseline.candidateCommit,
    baselinePath: baseline.baselinePath,
    baselineSha256: baseline.baselineSha256,
    artifactSha256: artifact.artifactSha256,
    deploymentContractSha256: deployment.contractSha256,
    priorEvidenceScope,
    stage8Actions: baseline.stage8Actions,
  };
};

const captureSnapshot = ({ root: workspace, generation, localStatePaths }) =>
  captureStage7CandidateSnapshot({
    root: workspace,
    generation,
    localStatePaths,
  });

export const stage7GateArgumentsFor = (gate, generation) => [
  "pnpm",
  "run",
  gate.script,
  ...(gate.args?.(generation) ?? []),
];

const runGate = ({ root: workspace, generation, gate }) => {
  const args = stage7GateArgumentsFor(gate, generation);
  const result = spawnSync("corepack", args, {
    cwd: workspace,
    env: { ...process.env, CI: "true", NODE_ENV: "development" },
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    command: ["corepack", ...args].join(" "),
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    output: `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}${result.error ? `\n[spawn-error] ${result.error.message}` : ""}`,
  };
};

const candidateStateFor = (candidate, snapshot, toolchain) => ({
  candidate,
  snapshot,
  toolchain,
  gates: STAGE7_CANONICAL_CI_GATES.map(({ label, script, args }) => ({
    label,
    script,
    args: args?.(candidate.candidateGeneration) ?? [],
  })),
});

const extractFinalMarker = (log) => {
  const markerIndex = log.lastIndexOf(resultMarker);
  assert.ok(markerIndex >= 0, "Persisted CI log lacks the final Stage 7 result marker");
  const serialized = log.slice(markerIndex + resultMarker.length).trim();
  const marker = JSON.parse(serialized);
  assert.equal(marker.stage, "PHASE_1_M1_STAGE_7");
  return marker;
};

export const runStage7CanonicalCi = async ({
  root: workspace = root,
  generation = STAGE7_DEFAULT_GENERATION,
  verifyCandidate = verifyCandidateFromRepository,
  captureSnapshot: capture = captureSnapshot,
  listLocalStatePaths = listStage7LocalStatePaths,
  toolchain = readPinnedToolchain,
  runGate: executeGate = runGate,
  now = () => new Date().toISOString(),
  onGate = ({ label, result }) => {
    process.stdout.write(`\n=== TravelOS Stage 7 CI gate: ${label} (${result}) ===\n`);
  },
} = {}) => {
  const candidateRoot = path.resolve(workspace);
  const paths = stage7CanonicalCiPathsFor(generation);
  for (const output of [paths.guardPath, paths.claimPath, paths.logPath, paths.receiptPath]) {
    await assertAbsent(candidateRoot, output);
  }

  const candidate = await verifyCandidate({ root: candidateRoot, generation });
  assertCandidate(candidate, generation);
  const pins = await toolchain(candidateRoot);
  assert.deepEqual(
    { node: pins.node, corepack: pins.corepack, pnpm: pins.pnpm },
    expectedToolchain,
    "Canonical CI requires the pinned toolchain before arming",
  );
  const localStatePaths = await listLocalStatePaths(candidateRoot);
  const snapshot = await capture({ root: candidateRoot, generation, localStatePaths });
  assertSnapshot(snapshot, candidate, generation);
  const candidateState = candidateStateFor(candidate, snapshot, pins);
  const candidateStateSha256 = hash(Buffer.from(JSON.stringify(candidateState)));
  const guard = {
    schemaVersion: 1,
    state: "ARMED",
    stage: "PHASE_1_M1_STAGE_7",
    candidateGeneration: generation,
    candidateId: candidate.candidateId,
    candidateCommit: candidate.candidateCommit,
    artifactSha256: candidate.artifactSha256,
    deploymentContractSha256: candidate.deploymentContractSha256,
    candidateStateSha256,
    candidateState,
    ciConsumed: "NO",
    invocationCount: 0,
    stage8Actions: 0,
  };
  const guardBytes = Buffer.from(`${JSON.stringify(guard, null, 2)}\n`);
  await writeExclusive(candidateRoot, paths.guardPath, guardBytes);
  assert.deepEqual(
    await readFile(path.join(candidateRoot, paths.guardPath)),
    guardBytes,
    "One-shot CI guard read-back differs",
  );

  const candidateAfterArm = await verifyCandidate({ root: candidateRoot, generation });
  assertCandidate(candidateAfterArm, generation);
  const pinsAfterArm = await toolchain(candidateRoot);
  const snapshotAfterArm = await capture({ root: candidateRoot, generation, localStatePaths });
  const stateAfterArm = candidateStateFor(candidateAfterArm, snapshotAfterArm, pinsAfterArm);
  assert.deepEqual(
    stateAfterArm,
    candidateState,
    "Candidate state changed while arming one-shot CI",
  );
  assert.equal(hash(Buffer.from(JSON.stringify(stateAfterArm))), candidateStateSha256);

  const claim = {
    schemaVersion: 1,
    state: "RUNNING",
    candidateGeneration: generation,
    candidateCommit: candidate.candidateCommit,
    candidateStateSha256,
    invocationCount: 1,
    startedAtUtc: now(),
    stage8Actions: 0,
  };
  await writeExclusive(
    candidateRoot,
    paths.claimPath,
    Buffer.from(`${JSON.stringify(claim, null, 2)}\n`),
  );

  const gateResults = [];
  const logPath = path.join(candidateRoot, paths.logPath);
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(
    logPath,
    `TravelOS Stage 7 canonical CI\nCandidate: ${candidate.candidateId}\nCommit: ${candidate.candidateCommit}\nArtifact SHA-256: ${candidate.artifactSha256}\n\n`,
    { flag: "wx", mode: 0o644 },
  );
  let failedGate = null;
  for (const gate of STAGE7_CANONICAL_CI_GATES) {
    let result;
    try {
      result = await executeGate({ root: candidateRoot, generation, gate });
    } catch (error) {
      result = { exitCode: 1, output: `[runner-error] ${error.message}` };
    }
    const output = String(result.output ?? "");
    const entry = {
      label: gate.label,
      script: gate.script,
      command: result.command ?? `corepack pnpm run ${gate.script}`,
      result: result.exitCode === 0 ? "PASS" : "FAIL",
      exitCode: result.exitCode ?? 1,
      signal: result.signal ?? null,
      outputBytes: Buffer.byteLength(output),
      outputSha256: hash(Buffer.from(output)),
    };
    gateResults.push(entry);
    await writeFile(logPath, `\n=== TravelOS Stage 7 CI gate: ${gate.label} ===\n${output}\n`, {
      flag: "a",
    });
    onGate({ label: gate.label, result: entry.result });
    if (entry.result !== "PASS") {
      failedGate = gate.label;
      break;
    }
  }

  const result = failedGate === null ? "PASS" : "FAIL";
  const completedAtUtc = now();
  const marker = {
    schemaVersion: 1,
    stage: "PHASE_1_M1_STAGE_7",
    result,
    candidateGeneration: generation,
    candidateId: candidate.candidateId,
    candidateCommit: candidate.candidateCommit,
    artifactSha256: candidate.artifactSha256,
    completedGateCount: gateResults.length,
    expectedGateCount: STAGE7_CANONICAL_CI_GATES.length,
    failedGate,
    stage8Actions: 0,
  };
  await writeFile(logPath, `\n${resultMarker}${JSON.stringify(marker, null, 2)}\n`, { flag: "a" });
  const persistedLog = await readFile(logPath, "utf8");
  const persistedMarker = extractFinalMarker(persistedLog);
  assert.deepEqual(
    persistedMarker,
    marker,
    "Persisted CI result marker differs from execution result",
  );
  const logBytes = Buffer.from(persistedLog);
  const receipt = {
    schemaVersion: 1,
    stage: "PHASE_1_M1_STAGE_7",
    result,
    candidateGeneration: generation,
    candidateId: candidate.candidateId,
    candidateCommit: candidate.candidateCommit,
    artifactSha256: candidate.artifactSha256,
    baselinePath: candidate.baselinePath,
    baselineSha256: candidate.baselineSha256,
    deploymentContractSha256: candidate.deploymentContractSha256,
    ciConsumed: "YES",
    invocationCount: 1,
    startedAtUtc: claim.startedAtUtc,
    completedAtUtc,
    expectedGateCount: STAGE7_CANONICAL_CI_GATES.length,
    completedGateCount: gateResults.length,
    failedGate,
    gates: gateResults,
    guardPath: paths.guardPath,
    guardSha256: hash(guardBytes),
    candidateStateSha256,
    logPath: paths.logPath,
    logBytes: logBytes.length,
    logSha256: hash(logBytes),
    finalMarker: persistedMarker,
    stage8Actions: 0,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await writeExclusive(candidateRoot, paths.receiptPath, receiptBytes);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(candidateRoot, paths.receiptPath), "utf8")),
    receipt,
    "Persisted canonical CI receipt differs from execution result",
  );
  const finalClaim = {
    ...claim,
    state: "CONSUMED",
    result,
    completedAtUtc,
    logSha256: receipt.logSha256,
  };
  await writeFile(
    path.join(candidateRoot, paths.claimPath),
    `${JSON.stringify(finalClaim, null, 2)}\n`,
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(candidateRoot, paths.claimPath), "utf8")),
    finalClaim,
    "Persisted one-shot CI claim differs from execution result",
  );
  return { ...receipt, paths };
};

const parseGeneration = () => {
  const argumentsAfterScript = process.argv.slice(2);
  const generationArguments = argumentsAfterScript.filter((argument) =>
    argument.startsWith("--generation="),
  );
  const unexpected = argumentsAfterScript.filter(
    (argument) => !argument.startsWith("--generation="),
  );
  assert.equal(unexpected.length, 0, `Unexpected arguments: ${unexpected.join(" ")}`);
  assert.ok(generationArguments.length <= 1, "Pass at most one --generation argument");
  return generationArguments[0]?.split("=", 2)[1] ?? STAGE7_DEFAULT_GENERATION;
};

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directEntry) {
  try {
    const receipt = await runStage7CanonicalCi({ generation: parseGeneration() });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.result !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
