import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import {
  hashFile,
  inventory,
  jsonBytes,
  sha256,
  verifyArtifact as verifyStage9Artifact,
} from "./artifact-integrity.mjs";
import {
  NODE_VERSION,
  PNPM_VERSION,
  STAGE8_ACCEPTED_ARTIFACT_ID,
  STAGE8_ACCEPTED_ARTIFACT_SHA256,
  STAGE8_MIGRATION_HEAD,
  STAGE9_MIGRATION_HEAD,
  STAGE9_PREDECESSOR,
  STAGE9_STAGE,
} from "./constants.mjs";
import { sourceSnapshot } from "./source-snapshot.mjs";
import { verifyArtifact as verifyStage8Artifact } from "../stage-8/artifact-integrity.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const expectedToolchain = Object.freeze({
  node: `v${NODE_VERSION}`,
  corepack: "0.35.0",
  pnpm: PNPM_VERSION,
});
const stage9PreflightChecks = Object.freeze([
  "functionality",
  "adversarial",
  "postgresql",
  "packaging",
  "dependenciesAndPaths",
  "deploymentContract",
  "credentialAndPermissions",
  "runtimeRehearsal",
  "securityScanner",
  "inventoryProvenance",
]);
const resultMarker = "=== TRAVELOS_STAGE9_CANONICAL_CI_RESULT ===\n";

// Keep the gates explicit. Stage 9's disposable adapter reuses the Stage 8
// database harness without changing its accepted runner or test contracts.
export const STAGE9_CANONICAL_CI_GATES = Object.freeze([
  { label: "stage9-pinned-toolchain", script: "verify:pins" },
  { label: "protected-baseline:pre", script: "protected-baseline:check" },
  { label: "stage9-successor-baseline-tests", script: "test:stage9:successor-baseline" },
  { label: "stage5-candidate-coherence:pre", script: "stage5:candidate-coherence:verify" },
  { label: "stage9-clean-install", kind: "clean-install" },
  { label: "stage9-migration-checksums", script: "db:migrations:verify" },
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
  { label: "stage9-deployment-contract", script: "stage9:deployment-contract:verify" },
  { label: "stage9-artifact-tests", script: "test:stage9:artifact" },
  { label: "stage9-extracted-artifact-integrity", kind: "extracted-artifact" },
  { label: "stage9-postgresql-browser-acceptance", script: "test:stage9:postgres" },
  { label: "test:rejected-technologies", script: "test:rejected-technologies" },
  { label: "verify:rejected-technologies", script: "verify:rejected-technologies" },
  { label: "evidence:stage4:verify", script: "evidence:stage4:verify" },
  { label: "test:smoke", script: "test:smoke" },
  { label: "security:scan:bundles", script: "security:scan:bundles" },
  { label: "stage9-source-security-scan", kind: "source-security-scan" },
  { label: "stage5-candidate-coherence:post", script: "stage5:candidate-coherence:verify" },
  { label: "protected-baseline:post", script: "protected-baseline:check" },
]);

const assertCandidateId = (candidate) => {
  assert.match(candidate ?? "", /^gen[0-9]{2,}$/u, "Invalid Stage 9 candidate identifier");
};

export const stage9CandidatePathsFor = (candidate) => {
  assertCandidateId(candidate);
  const artifactRoot = `.hermes/state/stage9-${candidate}-artifact`;
  return {
    artifactRoot,
    archivePath: `${artifactRoot}.tar.gz`,
    extractedRoot: `.hermes/state/stage9-${candidate}-extracted`,
    buildReceiptPath: `${artifactRoot}-build.json`,
    preflightPath: `.hermes/state/stage9-${candidate}-preflight.json`,
  };
};

export const stage9CanonicalCiPathsFor = (candidate) => {
  assertCandidateId(candidate);
  const prefix = `.hermes/state/stage9-${candidate}-canonical-ci`;
  return {
    claimPath: `${prefix}-claim.json`,
    logPath: `${prefix}.log`,
    receiptPath: `${prefix}-receipt.json`,
    postgresEvidenceDirectory: `${prefix}-postgresql`,
    browserEvidenceDirectory: `${prefix}-browser`,
  };
};

const resolveStatePath = (root, relativePath, label) => {
  assert.equal(typeof relativePath, "string", `${label} path is required`);
  assert.ok(!path.isAbsolute(relativePath), `${label} path must be relative to the worktree`);
  const workspace = path.resolve(root);
  const absolutePath = path.resolve(workspace, relativePath);
  const stateRoot = path.join(workspace, ".hermes", "state");
  const relativeToState = path.relative(stateRoot, absolutePath);
  assert.ok(
    relativeToState !== ".." &&
      !relativeToState.startsWith(`..${path.sep}`) &&
      relativeToState !== "",
    `${label} must be inside local .hermes/state`,
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
    "Stage 9 canonical CI requires the exact pinned toolchain",
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

const verifyArchiveContents = (archivePath, artifactRoot, root, label) => {
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
    `${label} archive does not match its artifact tree (tar exit ${result.status ?? 1})`,
  );
  assert.deepEqual(unexpected, [], `${label} archive has content, path, or extraction errors`);
  return { result: "PASS", metadataDifferenceCount: metadataOnly.length };
};

const verifyPreflightEvidence = async (root, preflight) => {
  assert.deepEqual(
    Object.keys(preflight.checks ?? {}).toSorted(),
    [...stage9PreflightChecks].toSorted(),
    "Stage 9 preflight must contain exactly the required qualification checks",
  );
  for (const name of stage9PreflightChecks) {
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
  assert.equal(preflight.checks.securityScanner.findingCount, 0);
  assert.equal(preflight.checks.securityScanner.unallowlistedFindingCount, 0);
};

const verifyStage8Predecessor = async ({ root, artifactRoot, archivePath }) => {
  assert.ok(path.isAbsolute(artifactRoot), "Stage 8 predecessor artifact root must be absolute");
  assert.ok(path.isAbsolute(archivePath), "Stage 8 predecessor archive path must be absolute");
  const resolvedArtifactRoot = path.resolve(artifactRoot);
  const resolvedArchivePath = path.resolve(archivePath);
  await readDirectory(resolvedArtifactRoot, "Stage 8 predecessor artifact root");
  await readRegularFile(resolvedArchivePath, "Stage 8 predecessor archive");
  const archive = await hashFile(resolvedArchivePath);
  assert.equal(archive.sha256, STAGE8_ACCEPTED_ARTIFACT_SHA256);
  const artifact = await verifyStage8Artifact(resolvedArtifactRoot);
  assert.equal(artifact.result, "PASS");
  assert.equal(artifact.artifactId, STAGE8_ACCEPTED_ARTIFACT_ID);
  const archiveComparison = verifyArchiveContents(
    resolvedArchivePath,
    resolvedArtifactRoot,
    root,
    "Stage 8 predecessor",
  );
  return {
    artifactRoot: resolvedArtifactRoot,
    archivePath: resolvedArchivePath,
    artifactId: artifact.artifactId,
    artifactSha256: archive.sha256,
    sourceSnapshotSha256: artifact.sourceSnapshotSha256,
    migrationHead: STAGE8_MIGRATION_HEAD,
    archiveComparison,
  };
};

export const verifyStage9CandidateInputs = async ({
  root = repositoryRoot,
  candidate = "gen01",
  paths = stage9CandidatePathsFor(candidate),
  stage8ArtifactRoot = process.env.TRAVELOS_STAGE8_ARTIFACT_ROOT,
  stage8ArchivePath = process.env.TRAVELOS_STAGE8_ARTIFACT_ARCHIVE,
} = {}) => {
  const workspace = path.resolve(root);
  assertCandidateId(candidate);
  assert.deepEqual(
    paths,
    stage9CandidatePathsFor(candidate),
    "Stage 9 candidate paths must be canonical",
  );
  const artifactRoot = resolveStatePath(workspace, paths.artifactRoot, "Artifact root");
  const archivePath = resolveStatePath(workspace, paths.archivePath, "Artifact archive");
  const extractedRoot = resolveStatePath(workspace, paths.extractedRoot, "Extracted artifact");
  const buildReceiptPath = resolveStatePath(workspace, paths.buildReceiptPath, "Build receipt");
  const preflightPath = resolveStatePath(workspace, paths.preflightPath, "Preflight receipt");
  await readDirectory(artifactRoot, "Artifact root");
  await readDirectory(extractedRoot, "Extracted artifact");

  const buildBytes = await readRegularFile(buildReceiptPath, "Artifact build receipt");
  const buildReceipt = JSON.parse(buildBytes.toString("utf8"));
  await readRegularFile(archivePath, "Artifact archive");
  const archive = await hashFile(archivePath);
  assert.equal(buildReceipt.result, "PASS");
  assert.equal(path.resolve(workspace, buildReceipt.archive), archivePath);
  assert.equal(buildReceipt.sha256, archive.sha256, "Artifact archive hash mismatch");
  assert.equal(buildReceipt.compilationHost, "LOCAL_WORKTREE");
  assert.equal(buildReceipt.compileOnCt200, false);
  assert.equal(buildReceipt.stage10Actions, 0);

  const artifact = await verifyStage9Artifact(artifactRoot);
  const extracted = await verifyStage9Artifact(extractedRoot);
  assert.deepEqual(extracted, artifact, "Extracted artifact integrity differs from the build");
  assert.deepEqual(await inventory(extractedRoot), await inventory(artifactRoot));
  const archiveComparison = verifyArchiveContents(
    archivePath,
    artifactRoot,
    workspace,
    "Stage 9 candidate",
  );
  const release = JSON.parse(
    (
      await readRegularFile(path.join(artifactRoot, "release.json"), "Artifact release manifest")
    ).toString("utf8"),
  );
  assert.equal(release.candidate, candidate);
  assert.equal(release.source.predecessor, STAGE9_PREDECESSOR);
  assert.equal(release.source.predecessorArtifactId, STAGE8_ACCEPTED_ARTIFACT_ID);
  assert.equal(release.source.predecessorArtifactSha256, STAGE8_ACCEPTED_ARTIFACT_SHA256);
  assert.equal(release.migrationHead, STAGE9_MIGRATION_HEAD);
  assert.equal(release.stage10Actions, 0);
  assert.equal(buildReceipt.sourceSnapshotSha256, release.source.snapshotSha256);
  assert.equal(buildReceipt.artifactId, artifact.artifactId);
  assert.equal(buildReceipt.migrationHead, STAGE9_MIGRATION_HEAD);

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
  assert.deepEqual(
    packagedSnapshot,
    currentSnapshot.bytes,
    "Packaged source differs from current source",
  );

  const predecessor = await verifyStage8Predecessor({
    root: workspace,
    artifactRoot: stage8ArtifactRoot,
    archivePath: stage8ArchivePath,
  });
  const buildReceiptSha256 = sha256(buildBytes);
  const preflightBytes = await readRegularFile(preflightPath, "Preflight receipt");
  const preflight = JSON.parse(preflightBytes.toString("utf8"));
  assert.equal(preflight.result, "PASS");
  assert.equal(preflight.stage, STAGE9_STAGE);
  assert.equal(preflight.candidate, candidate);
  assert.equal(preflight.predecessor, STAGE9_PREDECESSOR);
  assert.equal(preflight.sourceSnapshotSha256, currentSnapshot.sha256);
  assert.equal(preflight.artifactSha256, archive.sha256);
  assert.equal(preflight.buildReceiptSha256, buildReceiptSha256);
  assert.equal(preflight.migrationHead, STAGE9_MIGRATION_HEAD);
  assert.equal(preflight.predecessorArtifactId, predecessor.artifactId);
  assert.equal(preflight.predecessorArtifactSha256, predecessor.artifactSha256);
  assert.equal(preflight.stage10Actions, 0);
  assert.equal(preflight.caddyConfigurationChanges, false);
  assert.equal(preflight.caddyRestartCount, 0);
  assert.equal(preflight.workerRestarts, 0);
  assertPinnedToolchain(preflight.toolchain);
  await verifyPreflightEvidence(workspace, preflight);

  return {
    result: "PASS",
    stage: STAGE9_STAGE,
    candidate,
    predecessor: STAGE9_PREDECESSOR,
    sourceSnapshotSha256: currentSnapshot.sha256,
    artifactSha256: archive.sha256,
    artifactId: artifact.artifactId,
    preflightSha256: sha256(preflightBytes),
    buildReceiptSha256,
    migrationHead: artifact.migrationHead,
    toolchain: preflight.toolchain,
    artifactRoot: paths.artifactRoot,
    archivePath: paths.archivePath,
    extractedRoot: paths.extractedRoot,
    preflightPath: paths.preflightPath,
    predecessorArtifactId: predecessor.artifactId,
    predecessorArtifactSha256: predecessor.artifactSha256,
    predecessorArtifactRoot: predecessor.artifactRoot,
    predecessorArchivePath: predecessor.archivePath,
    archiveComparison,
    predecessorArchiveComparison: predecessor.archiveComparison,
    stage10Actions: 0,
  };
};

const assertCandidateRecord = (candidate, candidateRecord, toolchainRecord) => {
  assert.equal(
    candidateRecord?.result,
    "PASS",
    "Stage 9 candidate preflight must pass before canonical CI",
  );
  assert.equal(candidateRecord.stage, STAGE9_STAGE);
  assert.equal(candidateRecord.candidate, candidate);
  assert.equal(candidateRecord.predecessor, STAGE9_PREDECESSOR);
  for (const field of [
    "sourceSnapshotSha256",
    "artifactSha256",
    "preflightSha256",
    "buildReceiptSha256",
    "predecessorArtifactSha256",
  ])
    assert.match(candidateRecord[field] ?? "", /^[a-f0-9]{64}$/u, `${field} is required`);
  assert.equal(
    candidateRecord.artifactId,
    `travelos-stage9-${candidate}-${candidateRecord.sourceSnapshotSha256.slice(0, 8)}`,
  );
  assert.equal(candidateRecord.predecessorArtifactId, STAGE8_ACCEPTED_ARTIFACT_ID);
  assert.equal(candidateRecord.predecessorArtifactSha256, STAGE8_ACCEPTED_ARTIFACT_SHA256);
  assert.equal(candidateRecord.migrationHead, STAGE9_MIGRATION_HEAD);
  assert.equal(candidateRecord.stage10Actions, 0);
  assertPinnedToolchain(candidateRecord.toolchain);
  assertPinnedToolchain(toolchainRecord);
  assert.deepEqual(
    {
      node: candidateRecord.toolchain.node,
      corepack: candidateRecord.toolchain.corepack,
      pnpm: candidateRecord.toolchain.pnpm,
    },
    { node: toolchainRecord.node, corepack: toolchainRecord.corepack, pnpm: toolchainRecord.pnpm },
    "Candidate and canonical runner toolchains differ",
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
    throw new Error(`One-shot Stage 9 CI state already exists: ${relativePath}`);
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
      // Ignore unrelated brace-delimited text from package-manager wrappers.
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

export const stage9CanonicalCiEnvironmentFor = ({
  root,
  candidateRecord,
  gate,
  environment = process.env,
}) => ({
  ...environment,
  CI: "true",
  NODE_ENV: gate.script === "build" ? "production" : "development",
  TRAVELOS_STAGE9_CANDIDATE: candidateRecord.candidate,
  TRAVELOS_STAGE9_ARTIFACT_ROOT: path.resolve(root, candidateRecord.extractedRoot),
  TRAVELOS_STAGE9_BROWSER_ACCEPTANCE: "1",
  TRAVELOS_STAGE8_ARTIFACT_ROOT: candidateRecord.predecessorArtifactRoot,
  TRAVELOS_STAGE8_ARTIFACT_ARCHIVE: candidateRecord.predecessorArchivePath,
  TRAVELOS_STAGE9_EVIDENCE_DIR: path.resolve(
    root,
    stage9CanonicalCiPathsFor(candidateRecord.candidate).postgresEvidenceDirectory,
  ),
  TRAVELOS_STAGE7_EVIDENCE_DIR: path.resolve(
    root,
    stage9CanonicalCiPathsFor(candidateRecord.candidate).browserEvidenceDirectory,
  ),
});

const executeGate = ({ root, candidateRecord, gate }) => {
  const env = stage9CanonicalCiEnvironmentFor({ root, candidateRecord, gate });
  if (gate.kind === "clean-install") {
    const args = ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"];
    const result = spawnSync("corepack", args, {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
    return {
      command: ["corepack", ...args].join(" "),
      exitCode: result.status ?? 1,
      signal: result.signal ?? null,
      output: `${result.stdout ?? ""}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}${result.error ? `\n[spawn-error] ${result.error.message}` : ""}`,
    };
  }
  if (gate.kind === "extracted-artifact") {
    const runtime = path.join(env.TRAVELOS_STAGE9_ARTIFACT_ROOT, "runtime/node/bin/node");
    const verifier = path.join(env.TRAVELOS_STAGE9_ARTIFACT_ROOT, "deployment/verify-artifact.mjs");
    const result = spawnSync(
      runtime,
      [verifier, `--artifact-root=${env.TRAVELOS_STAGE9_ARTIFACT_ROOT}`],
      {
        cwd: root,
        env,
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
  if (gate.kind === "source-security-scan") {
    const script = path.join(root, "tooling/ci/stage-9/source-security-scan.mjs");
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
    let exitCode = result.status ?? 1;
    const output = `${result.stdout ?? ""}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}${result.error ? `\n[spawn-error] ${result.error.message}` : ""}`;
    try {
      const report = JSON.parse(result.stdout.trim());
      if (
        report.result !== "PASS" ||
        report.stage !== STAGE9_STAGE ||
        report.findingCount !== 0 ||
        report.findings?.length !== 0 ||
        report.stage10Actions !== 0
      )
        exitCode = 1;
    } catch {
      exitCode = 1;
    }
    return {
      command: `${process.execPath} ${script}`,
      exitCode,
      signal: result.signal ?? null,
      output,
    };
  }

  assert.equal(typeof gate.script, "string", `Unknown Stage 9 canonical gate: ${gate.label}`);
  const args = ["pnpm", "--silent", "run", gate.script];
  const result = spawnSync("corepack", args, {
    cwd: root,
    env,
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
      JSON.stringify({ candidateRecord, toolchainRecord, gates: STAGE9_CANONICAL_CI_GATES }),
    ),
  );

export const consumeStage9CanonicalCi = async ({
  root,
  candidate,
  candidateRecord,
  toolchainRecord,
  captureSnapshot = sourceSnapshot,
  runGate = executeGate,
  now = () => new Date().toISOString(),
  onGate = ({ label, result }) =>
    process.stdout.write(`\n=== TravelOS Stage 9 CI: ${label} (${result}) ===\n`),
} = {}) => {
  const workspace = path.resolve(root ?? repositoryRoot);
  assertCandidateId(candidate);
  assertCandidateRecord(candidate, candidateRecord, toolchainRecord);
  const paths = stage9CanonicalCiPathsFor(candidate);
  for (const output of [paths.claimPath, paths.logPath, paths.receiptPath])
    await assertAbsent(workspace, output);
  for (const output of [paths.postgresEvidenceDirectory, paths.browserEvidenceDirectory])
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
    stage: STAGE9_STAGE,
    candidate,
    candidateStateSha256: stateSha256,
    sourceSnapshotSha256: candidateRecord.sourceSnapshotSha256,
    artifactSha256: candidateRecord.artifactSha256,
    invocationCount: 1,
    startedAtUtc: now(),
    stage10Actions: 0,
  };
  await writeExclusive(workspace, paths.claimPath, Buffer.from(jsonBytes(claim)));
  const logPath = path.join(workspace, paths.logPath);
  const header = `TravelOS Stage 9 canonical CI\nCandidate: ${candidate}\nSource snapshot SHA-256: ${candidateRecord.sourceSnapshotSha256}\nArtifact SHA-256: ${candidateRecord.artifactSha256}\nStage 8 predecessor artifact: ${candidateRecord.predecessorArtifactId}\n\n`;
  await writeExclusive(workspace, paths.logPath, Buffer.from(header));

  const gates = [];
  let failedGate = null;
  let failureCode = null;
  for (const gate of STAGE9_CANONICAL_CI_GATES) {
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
    if (gateResult === "PASS" && gate.label === "stage9-pinned-toolchain") {
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
      kind: gate.kind ?? null,
      command: result.command ?? `corepack pnpm --silent run ${gate.script ?? gate.kind}`,
      result: gateResult,
      exitCode: result.exitCode ?? 1,
      signal: result.signal ?? null,
      failureCode: gateFailureCode,
      outputBytes: Buffer.byteLength(output),
      outputSha256: sha256(Buffer.from(output)),
    };
    gates.push(entry);
    await writeFile(logPath, `\n=== TravelOS Stage 9 CI gate: ${gate.label} ===\n${output}\n`, {
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
    failedGate === null && gates.length === STAGE9_CANONICAL_CI_GATES.length ? "PASS" : "FAIL";
  const completedAtUtc = now();
  const marker = {
    schemaVersion: 1,
    stage: STAGE9_STAGE,
    result,
    candidate,
    sourceSnapshotSha256: candidateRecord.sourceSnapshotSha256,
    artifactSha256: candidateRecord.artifactSha256,
    completedGateCount: gates.length,
    expectedGateCount: STAGE9_CANONICAL_CI_GATES.length,
    failedGate,
    failureCode,
    stage10Actions: 0,
  };
  await writeFile(logPath, `\n${resultMarker}${jsonBytes(marker)}`, { flag: "a" });
  const persistedLog = await readRegularFile(logPath, "Canonical CI log");
  const logHash = sha256(persistedLog);
  const receipt = {
    schemaVersion: 1,
    stage: STAGE9_STAGE,
    result,
    candidate,
    candidateStateSha256: stateSha256,
    sourceSnapshotSha256: candidateRecord.sourceSnapshotSha256,
    artifactSha256: candidateRecord.artifactSha256,
    artifactId: candidateRecord.artifactId,
    predecessorArtifactId: candidateRecord.predecessorArtifactId,
    predecessorArtifactSha256: candidateRecord.predecessorArtifactSha256,
    preflightSha256: candidateRecord.preflightSha256,
    buildReceiptSha256: candidateRecord.buildReceiptSha256,
    migrationHead: candidateRecord.migrationHead,
    toolchain: toolchainRecord,
    invocationCount: 1,
    startedAtUtc: claim.startedAtUtc,
    completedAtUtc,
    expectedGateCount: STAGE9_CANONICAL_CI_GATES.length,
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
    stage10Actions: 0,
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

export const runStage9CanonicalCi = async ({
  root = repositoryRoot,
  candidate = "gen01",
  paths = stage9CandidatePathsFor(candidate),
  stage8ArtifactRoot = process.env.TRAVELOS_STAGE8_ARTIFACT_ROOT,
  stage8ArchivePath = process.env.TRAVELOS_STAGE8_ARTIFACT_ARCHIVE,
  verifyCandidate = verifyStage9CandidateInputs,
  toolchain = readPinnedToolchain,
  runGate = executeGate,
  captureSnapshot = sourceSnapshot,
  now,
  onGate,
} = {}) => {
  const workspace = path.resolve(root);
  assertCandidateId(candidate);
  const candidateRecord = await verifyCandidate({
    root: workspace,
    candidate,
    paths,
    stage8ArtifactRoot,
    stage8ArchivePath,
  });
  const toolchainRecord = await toolchain(workspace);
  assertPinnedToolchain(toolchainRecord);
  assertCandidateRecord(candidate, candidateRecord, toolchainRecord);
  return consumeStage9CanonicalCi({
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
    const match = /^--([a-z][a-z0-9-]*)=(.+)$/u.exec(argument);
    assert.ok(match, `Unexpected Stage 9 canonical CI argument: ${argument}`);
    const [, name, value] = match;
    assert.ok(!values.has(name), `Duplicate Stage 9 canonical CI argument: --${name}`);
    assert.ok(
      [
        "candidate",
        "artifact-root",
        "archive",
        "extracted-root",
        "build-receipt",
        "preflight",
        "stage8-artifact-root",
        "stage8-archive",
      ].includes(name),
      `Unknown Stage 9 canonical CI argument: --${name}`,
    );
    values.set(name, value);
  }
  const candidate = values.get("candidate") ?? "gen01";
  const defaults = stage9CandidatePathsFor(candidate);
  return {
    candidate,
    paths: {
      artifactRoot: values.get("artifact-root") ?? defaults.artifactRoot,
      archivePath: values.get("archive") ?? defaults.archivePath,
      extractedRoot: values.get("extracted-root") ?? defaults.extractedRoot,
      buildReceiptPath: values.get("build-receipt") ?? defaults.buildReceiptPath,
      preflightPath: values.get("preflight") ?? defaults.preflightPath,
    },
    stage8ArtifactRoot: values.get("stage8-artifact-root"),
    stage8ArchivePath: values.get("stage8-archive"),
  };
};

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directEntry) {
  try {
    const receipt = await runStage9CanonicalCi(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.result !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
