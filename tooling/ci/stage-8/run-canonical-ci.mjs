import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import { hashFile, inventory, jsonBytes, sha256, verifyArtifact } from "./artifact-integrity.mjs";
import { PREDECESSOR, sourceSnapshot } from "./source-snapshot.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const expectedToolchain = Object.freeze({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
const stage8PreflightChecks = Object.freeze([
  "functionality",
  "adversarial",
  "postgresql",
  "packaging",
  "dependenciesAndPaths",
  "systemd",
  "credentialAndPermissions",
  "runtimeRehearsal",
  "securityScanner",
  "inventoryProvenance",
]);
const resultMarker = "=== TRAVELOS_STAGE8_CANONICAL_CI_RESULT ===\n";

// Keep the gate list explicit, as in the accepted Stage 7 runner. The inherited
// ci:verify invokes the raw Stage 6 PostgreSQL harness, whose Stage 5-chain
// assertion is incompatible with successor migrations; Stage 8's disposable
// PostgreSQL suite adapts the Stage 6/7 regressions without editing their tests.
// The fixed Stage 4 source-scan allowlist runs in the predecessor checkout;
// Stage 8's dedicated scanner owns findings from the successor source tree.
export const STAGE8_CANONICAL_CI_GATES = Object.freeze([
  { label: "stage8-pinned-toolchain", script: "verify:pins" },
  { label: "protected-baseline:pre", script: "protected-baseline:check" },
  { label: "stage5-candidate-coherence:pre", script: "stage5:candidate-coherence:verify" },
  { label: "stage8-migration-checksums", script: "db:migrations:verify" },
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
  { label: "stage7-predecessor-regression", script: "test:stage8:stage7-predecessor" },
  { label: "stage8-systemd-contract", script: "test:stage8:systemd-contract" },
  { label: "stage8-artifact-tests", script: "test:stage8:artifact" },
  { label: "stage8-extracted-artifact-integrity", kind: "extracted-artifact" },
  { label: "stage8-postgresql-runtime-acceptance", script: "test:stage8:postgres" },
  { label: "test:rejected-technologies", script: "test:rejected-technologies" },
  { label: "verify:rejected-technologies", script: "verify:rejected-technologies" },
  { label: "evidence:stage4:verify", script: "evidence:stage4:verify" },
  { label: "test:smoke", script: "test:smoke" },
  { label: "security:scan:bundles", script: "security:scan:bundles" },
  { label: "stage8-source-security-scan", script: "stage8:security:scan" },
  { label: "stage5-candidate-coherence:post", script: "stage5:candidate-coherence:verify" },
  { label: "protected-baseline:post", script: "protected-baseline:check" },
]);

const assertCandidateId = (candidate) => {
  assert.match(candidate ?? "", /^gen[0-9]{2,}$/u, "Invalid Stage 8 candidate identifier");
};

export const stage8CandidatePathsFor = (candidate) => {
  assertCandidateId(candidate);
  const artifactRoot = `.hermes/state/stage8-${candidate}-artifact`;
  return {
    artifactRoot,
    archivePath: `${artifactRoot}.tar.gz`,
    extractedRoot: `.hermes/state/stage8-${candidate}-extracted`,
    buildReceiptPath: `${artifactRoot}-build.json`,
    preflightPath: `.hermes/state/stage8-${candidate}-preflight.json`,
  };
};

export const stage8CanonicalCiPathsFor = (candidate) => {
  assertCandidateId(candidate);
  const prefix = `.hermes/state/stage8-${candidate}-canonical-ci`;
  return {
    claimPath: `${prefix}-claim.json`,
    logPath: `${prefix}.log`,
    receiptPath: `${prefix}-receipt.json`,
  };
};

const resolveStatePath = (root, relativePath, label) => {
  assert.equal(typeof relativePath, "string", `${label} path is required`);
  assert.ok(
    relativePath.length > 0 && !path.posix.isAbsolute(relativePath),
    `${label} must be relative`,
  );
  assert.equal(path.posix.normalize(relativePath), relativePath, `${label} path is not canonical`);
  assert.ok(!relativePath.split("/").includes(".."), `${label} path traversal is forbidden`);
  assert.ok(relativePath.startsWith(".hermes/state/"), `${label} must remain in local state`);
  const absolutePath = path.resolve(root, relativePath);
  const stateRoot = path.resolve(root, ".hermes/state");
  const relativeToState = path.relative(stateRoot, absolutePath);
  assert.ok(
    relativeToState !== ".." && !relativeToState.startsWith(`..${path.sep}`),
    `${label} escaped local state`,
  );
  return absolutePath;
};

const readRegularFile = async (filePath, label) => {
  const metadata = await lstat(filePath);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `${label} must be a regular file`);
  return readFile(filePath);
};

const readDirectory = async (directory, label) => {
  const metadata = await lstat(directory);
  assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), `${label} must be a directory`);
};

const assertPinnedToolchain = (toolchain) => {
  assert.deepEqual(
    { node: toolchain?.node, corepack: toolchain?.corepack, pnpm: toolchain?.pnpm },
    expectedToolchain,
    "Stage 8 canonical CI requires the exact pinned toolchain",
  );
};

const readPinnedToolchain = (root) => {
  const readVersion = (args) => {
    const result = spawnSync("corepack", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, `Unable to verify toolchain: corepack ${args.join(" ")}`);
    return result.stdout.trim();
  };
  const toolchain = {
    node: process.version,
    corepack: readVersion(["--version"]),
    pnpm: readVersion(["pnpm", "--version"]),
  };
  assertPinnedToolchain(toolchain);
  return { ...toolchain, nodeExecutable: process.execPath };
};

const verifyArchiveContents = (archivePath, artifactRoot, root) => {
  const result = spawnSync(
    "tar",
    ["--compare", "--gzip", `--file=${archivePath}`, "--directory", artifactRoot],
    { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const lines = output.split("\n").filter(Boolean);
  const metadataOnly = lines.filter((line) => /: (?:Uid|Gid|Mod time) differs$/u.test(line));
  const unexpected = lines.filter((line) => !/: (?:Uid|Gid|Mod time) differs$/u.test(line));
  const expectedMetadataOnlyExit =
    result.status === 1 && lines.length > 0 && unexpected.length === 0;
  assert.ok(
    result.status === 0 || expectedMetadataOnlyExit,
    `Candidate archive does not match its artifact tree (tar exit ${result.status ?? 1})`,
  );
  assert.deepEqual(unexpected, [], "Candidate archive has content, path, or extraction errors");
  return { result: "PASS", metadataDifferenceCount: metadataOnly.length };
};

const verifyPreflightEvidence = async (root, preflight) => {
  assert.deepEqual(
    Object.keys(preflight.checks ?? {}).toSorted(),
    [...stage8PreflightChecks].toSorted(),
    "Stage 8 preflight must contain exactly the required qualification checks",
  );
  for (const name of stage8PreflightChecks) {
    const check = preflight.checks[name];
    assert.equal(check.result, "PASS", `Preflight check did not pass: ${name}`);
    assert.ok(
      Array.isArray(check.evidence) && check.evidence.length > 0,
      `${name} evidence is required`,
    );
    for (const evidence of check.evidence) {
      assert.match(evidence.sha256 ?? "", /^[a-f0-9]{64}$/u, `${name} evidence hash is required`);
      const evidencePath = resolveStatePath(root, evidence.path, `${name} evidence`);
      const bytes = await readRegularFile(evidencePath, `${name} evidence`);
      assert.equal(sha256(bytes), evidence.sha256, `${name} evidence changed: ${evidence.path}`);
    }
  }
  assert.equal(
    preflight.checks.securityScanner.findingCount,
    0,
    "Unallowlisted scanner findings remain",
  );
  assert.equal(preflight.checks.securityScanner.unallowlistedFindingCount, 0);
};

export const verifyStage8CandidateInputs = async ({
  root = repositoryRoot,
  candidate = "gen01",
  paths = stage8CandidatePathsFor(candidate),
} = {}) => {
  const workspace = path.resolve(root);
  assertCandidateId(candidate);
  const artifactRoot = resolveStatePath(workspace, paths.artifactRoot, "Artifact root");
  const archivePath = resolveStatePath(workspace, paths.archivePath, "Artifact archive");
  const extractedRoot = resolveStatePath(workspace, paths.extractedRoot, "Extracted artifact");
  const buildReceiptPath = resolveStatePath(workspace, paths.buildReceiptPath, "Build receipt");
  const preflightPath = resolveStatePath(workspace, paths.preflightPath, "Preflight receipt");
  assert.equal(paths.buildReceiptPath, `${paths.artifactRoot}-build.json`);
  assert.equal(paths.archivePath, `${paths.artifactRoot}.tar.gz`);
  await readDirectory(artifactRoot, "Artifact root");
  await readDirectory(extractedRoot, "Extracted artifact");

  const buildBytes = await readRegularFile(buildReceiptPath, "Artifact build receipt");
  const buildReceipt = JSON.parse(buildBytes.toString("utf8"));
  const archiveBytes = await readRegularFile(archivePath, "Artifact archive");
  const archiveHash = sha256(archiveBytes);
  assert.equal(buildReceipt.result, "PASS");
  assert.equal(buildReceipt.archive, archivePath, "Build receipt archive path mismatch");
  assert.equal(buildReceipt.sha256, archiveHash, "Artifact archive hash mismatch");
  assert.equal((await hashFile(archivePath)).sha256, archiveHash);
  const artifact = await verifyArtifact(artifactRoot);
  const extracted = await verifyArtifact(extractedRoot);
  assert.deepEqual(
    extracted,
    artifact,
    "Extracted artifact integrity differs from the built artifact",
  );
  assert.deepEqual(await inventory(extractedRoot), await inventory(artifactRoot));
  const archiveComparison = verifyArchiveContents(archivePath, artifactRoot, workspace);

  const release = JSON.parse(
    (
      await readRegularFile(path.join(artifactRoot, "release.json"), "Artifact release manifest")
    ).toString("utf8"),
  );
  assert.equal(release.candidate, candidate);
  assert.equal(release.source.predecessor, PREDECESSOR);
  assert.equal(release.source.snapshotSha256, buildReceipt.sourceSnapshotSha256);
  assert.equal(release.migrationHead, "0014_stage8_worker_activity");
  assert.equal(release.stage9Actions, 0);
  const currentSnapshot = await sourceSnapshot(workspace);
  assert.equal(
    currentSnapshot.sha256,
    release.source.snapshotSha256,
    "Candidate source snapshot drift",
  );
  const packagedSnapshot = await readRegularFile(
    path.join(extractedRoot, "provenance/source-snapshot.json"),
    "Packaged source snapshot",
  );
  assert.equal(packagedSnapshot.toString("utf8"), currentSnapshot.bytes);

  const preflightBytes = await readRegularFile(preflightPath, "Preflight receipt");
  const preflight = JSON.parse(preflightBytes.toString("utf8"));
  assert.equal(preflight.result, "PASS");
  assert.equal(preflight.stage, "PHASE_1_M1_STAGE_8");
  assert.equal(preflight.candidate, candidate);
  assert.equal(preflight.predecessor, PREDECESSOR);
  assert.equal(preflight.sourceSnapshotSha256, currentSnapshot.sha256);
  assert.equal(preflight.artifactSha256, archiveHash);
  assert.equal(preflight.buildReceiptSha256, sha256(buildBytes));
  assert.equal(preflight.migrationHead, "0014_stage8_worker_activity");
  assert.equal(preflight.stage9Actions, 0);
  assertPinnedToolchain(preflight.toolchain);
  await verifyPreflightEvidence(workspace, preflight);

  const record = {
    result: "PASS",
    stage: "PHASE_1_M1_STAGE_8",
    candidate,
    predecessor: PREDECESSOR,
    sourceSnapshotSha256: currentSnapshot.sha256,
    artifactSha256: archiveHash,
    artifactId: artifact.artifactId,
    preflightSha256: sha256(preflightBytes),
    buildReceiptSha256: sha256(buildBytes),
    migrationHead: artifact.migrationHead,
    toolchain: preflight.toolchain,
    artifactRoot: paths.artifactRoot,
    archivePath: paths.archivePath,
    extractedRoot: paths.extractedRoot,
    preflightPath: paths.preflightPath,
    archiveComparison,
    stage9Actions: 0,
  };
  return record;
};

const assertCandidateRecord = (candidate, candidateRecord, toolchainRecord) => {
  assert.equal(candidateRecord?.result, "PASS", "Stage 8 preflight must pass before one-shot CI");
  assert.equal(candidateRecord.stage, "PHASE_1_M1_STAGE_8");
  assert.equal(candidateRecord.candidate, candidate);
  assert.equal(candidateRecord.predecessor, PREDECESSOR);
  assert.match(candidateRecord.sourceSnapshotSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(candidateRecord.artifactSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(candidateRecord.preflightSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(candidateRecord.buildReceiptSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(candidateRecord.migrationHead, "0014_stage8_worker_activity");
  assert.equal(candidateRecord.stage9Actions, 0);
  assertPinnedToolchain(candidateRecord.toolchain);
  assertPinnedToolchain(toolchainRecord);
  assert.deepEqual(
    {
      node: candidateRecord.toolchain.node,
      corepack: candidateRecord.toolchain.corepack,
      pnpm: candidateRecord.toolchain.pnpm,
    },
    { node: toolchainRecord.node, corepack: toolchainRecord.corepack, pnpm: toolchainRecord.pnpm },
    "Preflight and canonical runner toolchains differ",
  );
};

const snapshotDigest = async (captureSnapshot, root) => {
  const snapshot = await captureSnapshot(root);
  const digest = snapshot.sha256 ?? snapshot.sourceSnapshotSha256;
  assert.match(digest ?? "", /^[a-f0-9]{64}$/u, "Source snapshot digest is required");
  return digest;
};

const assertAbsent = async (root, relativePath) => {
  try {
    await lstat(path.join(root, relativePath));
    throw new Error(`One-shot Stage 8 CI state already exists: ${relativePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

const writeExclusive = async (root, relativePath, bytes) => {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
};

const replaceAtomically = async (root, relativePath, bytes) => {
  const filePath = path.join(root, relativePath);
  const temporaryPath = `${filePath}.next-${process.pid}`;
  await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
  await rename(temporaryPath, filePath);
};

const extractToolchainReport = (output) => {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let report;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character !== "}" || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    try {
      const parsed = JSON.parse(output.slice(start, index + 1));
      if (parsed?.result === "PASS" && parsed.toolchain) report = parsed;
    } catch {
      // Ignore unrelated brace-delimited text from command wrappers.
    }
    start = -1;
  }
  assert.ok(report, "Pinned-toolchain child report is missing");
  assert.equal(report.result, "PASS", "Pinned-toolchain child verification failed");
  const nodeVersion = String(report.toolchain?.node ?? "");
  assertPinnedToolchain({
    node: nodeVersion.startsWith("v") ? nodeVersion : `v${nodeVersion}`,
    corepack: report.toolchain?.corepack,
    pnpm: report.toolchain?.pnpm,
  });
  return report.toolchain;
};

const executeGate = ({ root, candidateRecord, gate }) => {
  if (gate.kind === "extracted-artifact") {
    const runtime = path.join(root, candidateRecord.extractedRoot, "runtime/node/bin/node");
    const verifier = path.join(
      root,
      candidateRecord.extractedRoot,
      "deployment/verify-artifact.mjs",
    );
    const result = spawnSync(
      runtime,
      [verifier, `--artifact-root=${path.dirname(path.dirname(verifier))}`],
      {
        cwd: root,
        env: { ...process.env, CI: "true", NODE_ENV: "development" },
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
      },
    );
    return {
      command: `${runtime} ${verifier} --artifact-root=${candidateRecord.extractedRoot}`,
      exitCode: result.status ?? 1,
      signal: result.signal ?? null,
      output: `${result.stdout ?? ""}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}${result.error ? `\n[spawn-error] ${result.error.message}` : ""}`,
    };
  }
  const args = ["pnpm", "--silent", "run", gate.script];
  const result = spawnSync("corepack", args, {
    cwd: root,
    env: {
      ...process.env,
      CI: "true",
      NODE_ENV: "development",
      TRAVELOS_STAGE8_ARTIFACT_ROOT: path.resolve(root, candidateRecord.extractedRoot),
    },
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    command: ["corepack", ...args].join(" "),
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    output: `${result.stdout ?? ""}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}${result.error ? `\n[spawn-error] ${result.error.message}` : ""}`,
  };
};

const candidateStateSha256 = (candidateRecord, toolchainRecord) =>
  sha256(
    Buffer.from(
      JSON.stringify({ candidateRecord, toolchainRecord, gates: STAGE8_CANONICAL_CI_GATES }),
    ),
  );

export const consumeStage8CanonicalCi = async ({
  root,
  candidate,
  candidateRecord,
  toolchainRecord,
  captureSnapshot = sourceSnapshot,
  runGate = executeGate,
  now = () => new Date().toISOString(),
  onGate = ({ label, result }) =>
    process.stdout.write(`\n=== TravelOS Stage 8 CI: ${label} (${result}) ===\n`),
} = {}) => {
  const workspace = path.resolve(root ?? repositoryRoot);
  assertCandidateId(candidate);
  assertCandidateRecord(candidate, candidateRecord, toolchainRecord);
  const paths = stage8CanonicalCiPathsFor(candidate);
  for (const output of [paths.claimPath, paths.logPath, paths.receiptPath])
    await assertAbsent(workspace, output);
  const initialSnapshotSha256 = await snapshotDigest(captureSnapshot, workspace);
  assert.equal(
    initialSnapshotSha256,
    candidateRecord.sourceSnapshotSha256,
    "Candidate source changed before canonical CI",
  );

  const stateSha256 = candidateStateSha256(candidateRecord, toolchainRecord);
  const claim = {
    schemaVersion: 1,
    state: "RUNNING",
    stage: "PHASE_1_M1_STAGE_8",
    candidate,
    candidateStateSha256: stateSha256,
    sourceSnapshotSha256: candidateRecord.sourceSnapshotSha256,
    artifactSha256: candidateRecord.artifactSha256,
    invocationCount: 1,
    startedAtUtc: now(),
    stage9Actions: 0,
  };
  await writeExclusive(workspace, paths.claimPath, Buffer.from(jsonBytes(claim)));
  const logPath = path.join(workspace, paths.logPath);
  const header = `TravelOS Stage 8 canonical CI\nCandidate: ${candidate}\nSource snapshot SHA-256: ${candidateRecord.sourceSnapshotSha256}\nArtifact SHA-256: ${candidateRecord.artifactSha256}\n\n`;
  await writeExclusive(workspace, paths.logPath, Buffer.from(header));

  const gates = [];
  let failedGate = null;
  let failureCode = null;
  for (const gate of STAGE8_CANONICAL_CI_GATES) {
    const beforeSnapshot = await snapshotDigest(captureSnapshot, workspace);
    if (beforeSnapshot !== candidateRecord.sourceSnapshotSha256) {
      failedGate = `${gate.label}:source-before`;
      failureCode = "CANDIDATE_SOURCE_DRIFT";
      break;
    }

    let result;
    try {
      result = await runGate({ root: workspace, candidateRecord, gate });
    } catch {
      result = { exitCode: 1, output: "Canonical CI gate runner threw an exception" };
    }
    const output = String(result.output ?? "");
    let gateResult = result.exitCode === 0 ? "PASS" : "FAIL";
    let gateFailureCode = gateResult === "PASS" ? null : "GATE_EXIT_NONZERO";
    if (gateResult === "PASS" && gate.label === "stage8-pinned-toolchain") {
      try {
        extractToolchainReport(output);
      } catch {
        gateResult = "FAIL";
        gateFailureCode = "PINNED_TOOLCHAIN_CHILD_REPORT_INVALID";
      }
    }
    const entry = {
      label: gate.label,
      script: gate.script ?? null,
      command: result.command ?? `corepack pnpm --silent run ${gate.script ?? gate.kind}`,
      result: gateResult,
      exitCode: result.exitCode ?? 1,
      signal: result.signal ?? null,
      failureCode: gateFailureCode,
      outputBytes: Buffer.byteLength(output),
      outputSha256: sha256(Buffer.from(output)),
    };
    gates.push(entry);
    await writeFile(logPath, `\n=== TravelOS Stage 8 CI gate: ${gate.label} ===\n${output}\n`, {
      flag: "a",
    });
    onGate({ label: gate.label, result: gateResult });

    const afterSnapshot = await snapshotDigest(captureSnapshot, workspace);
    if (afterSnapshot !== candidateRecord.sourceSnapshotSha256) {
      entry.result = "FAIL";
      entry.failureCode = "CANDIDATE_SOURCE_DRIFT";
      failedGate = `${gate.label}:source-after`;
      failureCode = "CANDIDATE_SOURCE_DRIFT";
      break;
    }
    if (gateResult !== "PASS") {
      failedGate = gate.label;
      failureCode = gateFailureCode;
      break;
    }
  }

  const result =
    failedGate === null && gates.length === STAGE8_CANONICAL_CI_GATES.length ? "PASS" : "FAIL";
  const completedAtUtc = now();
  const marker = {
    schemaVersion: 1,
    stage: "PHASE_1_M1_STAGE_8",
    result,
    candidate,
    sourceSnapshotSha256: candidateRecord.sourceSnapshotSha256,
    artifactSha256: candidateRecord.artifactSha256,
    completedGateCount: gates.length,
    expectedGateCount: STAGE8_CANONICAL_CI_GATES.length,
    failedGate,
    failureCode,
    stage9Actions: 0,
  };
  await writeFile(logPath, `\n${resultMarker}${jsonBytes(marker)}`, { flag: "a" });
  const persistedLog = await readRegularFile(logPath, "Canonical CI log");
  const logHash = sha256(persistedLog);
  const receipt = {
    schemaVersion: 1,
    stage: "PHASE_1_M1_STAGE_8",
    result,
    candidate,
    candidateStateSha256: stateSha256,
    sourceSnapshotSha256: candidateRecord.sourceSnapshotSha256,
    artifactSha256: candidateRecord.artifactSha256,
    artifactId: candidateRecord.artifactId ?? null,
    preflightSha256: candidateRecord.preflightSha256,
    buildReceiptSha256: candidateRecord.buildReceiptSha256,
    migrationHead: candidateRecord.migrationHead,
    toolchain: toolchainRecord,
    invocationCount: 1,
    startedAtUtc: claim.startedAtUtc,
    completedAtUtc,
    expectedGateCount: STAGE8_CANONICAL_CI_GATES.length,
    completedGateCount: gates.length,
    failedGate,
    failureCode,
    gates,
    paths,
    claimPath: paths.claimPath,
    logPath: paths.logPath,
    logBytes: persistedLog.length,
    logSha256: logHash,
    finalMarker: marker,
    stage9Actions: 0,
  };
  await writeExclusive(workspace, paths.receiptPath, Buffer.from(jsonBytes(receipt)));
  assert.deepEqual(
    JSON.parse(
      (
        await readRegularFile(path.join(workspace, paths.receiptPath), "Canonical CI receipt")
      ).toString("utf8"),
    ),
    receipt,
  );
  const consumedClaim = {
    ...claim,
    state: "CONSUMED",
    result,
    completedAtUtc,
    failedGate,
    receiptPath: paths.receiptPath,
    receiptSha256: sha256(Buffer.from(jsonBytes(receipt))),
    logSha256: logHash,
  };
  await replaceAtomically(workspace, paths.claimPath, Buffer.from(jsonBytes(consumedClaim)));
  assert.deepEqual(
    JSON.parse(
      (await readRegularFile(path.join(workspace, paths.claimPath), "Canonical CI claim")).toString(
        "utf8",
      ),
    ),
    consumedClaim,
  );
  return receipt;
};

export const runStage8CanonicalCi = async ({
  root = repositoryRoot,
  candidate = "gen01",
  paths = stage8CandidatePathsFor(candidate),
  verifyCandidate = verifyStage8CandidateInputs,
  toolchain = readPinnedToolchain,
  runGate = executeGate,
  captureSnapshot = sourceSnapshot,
  now,
  onGate,
} = {}) => {
  const workspace = path.resolve(root);
  const candidateRecord = await verifyCandidate({ root: workspace, candidate, paths });
  const toolchainRecord = await toolchain(workspace);
  assertPinnedToolchain(toolchainRecord);
  assert.deepEqual(
    {
      node: candidateRecord.toolchain.node,
      corepack: candidateRecord.toolchain.corepack,
      pnpm: candidateRecord.toolchain.pnpm,
    },
    { node: toolchainRecord.node, corepack: toolchainRecord.corepack, pnpm: toolchainRecord.pnpm },
    "Preflight toolchain differs from the canonical CI process",
  );
  return consumeStage8CanonicalCi({
    root: workspace,
    candidate,
    candidateRecord,
    toolchainRecord,
    captureSnapshot,
    runGate,
    ...(now ? { now } : {}),
    ...(onGate ? { onGate } : {}),
  });
};

const parseArguments = (args) => {
  const values = new Map();
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    assert.ok(match, `Unexpected Stage 8 canonical CI argument: ${argument}`);
    const [, name, value] = match;
    assert.ok(!values.has(name), `Duplicate Stage 8 canonical CI argument: --${name}`);
    assert.ok(
      [
        "candidate",
        "artifact-root",
        "archive",
        "extracted-root",
        "build-receipt",
        "preflight",
      ].includes(name),
      `Unknown Stage 8 canonical CI argument: --${name}`,
    );
    values.set(name, value);
  }
  const candidate = values.get("candidate") ?? "gen01";
  const defaults = stage8CandidatePathsFor(candidate);
  return {
    candidate,
    paths: {
      artifactRoot: values.get("artifact-root") ?? defaults.artifactRoot,
      archivePath: values.get("archive") ?? defaults.archivePath,
      extractedRoot: values.get("extracted-root") ?? defaults.extractedRoot,
      buildReceiptPath: values.get("build-receipt") ?? defaults.buildReceiptPath,
      preflightPath: values.get("preflight") ?? defaults.preflightPath,
    },
  };
};

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directEntry) {
  try {
    const receipt = await runStage8CanonicalCi(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.result !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
