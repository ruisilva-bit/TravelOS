import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  assertStage5CandidateManifest,
  verifyStage5CandidateCoherence,
} from "./stage-5-candidate-coherence.mjs";
import { verifyStage5CurrentEvidenceIndex } from "./stage-5-current-evidence-index.mjs";
import { verifyStage5CurrentReadiness } from "./stage-5-current-readiness-preflight.mjs";
import { prepareStage5CurrentEvidence } from "./prepare-stage-5-current-evidence.mjs";
import { captureStage5WorkingTreeSnapshot } from "./stage-5-working-tree-snapshot.mjs";
import { STAGE5_SECURITY_EXTENSION_BASELINE_PATH } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const command = "corepack pnpm ci:verify";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const toolchain = () => {
  const corepack = execFileSync("corepack", ["--version"], { cwd: root, encoding: "utf8" }).trim();
  const pnpm = execFileSync("corepack", ["pnpm", "--version"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const actual = { node: process.version, corepack, pnpm };
  assert.deepEqual(actual, { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
  return { ...actual, nodeExecutable: process.execPath };
};

export const generateStage5CurrentInvocationGuard = async ({ candidateRoot = root } = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const guardPath = path.join(workspace, manifest.invocationGuard);
  const claimPath = `${guardPath}.claim`;
  for (const target of [guardPath, claimPath]) {
    try {
      await lstat(target);
      throw new Error(`Refusing to reuse an existing one-shot CI guard or claim: ${target}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const readiness = await verifyStage5CurrentReadiness({ candidateRoot: workspace });
  const preparedEvidence = await prepareStage5CurrentEvidence({
    candidateRoot: workspace,
    write: false,
  });
  assert.equal(preparedEvidence.result, "PASS");
  const evidenceIndex = await verifyStage5CurrentEvidenceIndex({ candidateRoot: workspace });
  assert.equal(evidenceIndex.phase, "PRE_CI");
  const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
  const scanPath = path.join(evidenceDirectory, "source-security-scan-pre-ci.json");
  const scanBytes = await readRegular(scanPath);
  const scan = JSON.parse(scanBytes.toString("utf8"));
  assert.equal(scan.candidate, manifest.candidate);
  assert.equal(scan.phase, "PRE_CI");
  assert.equal(scan.result, "PASS");
  assert.equal(scan.findingCount, 0);
  const workingTreeSnapshot = await captureStage5WorkingTreeSnapshot({
    root: workspace,
    excludedPaths: [manifest.invocationGuard, `${manifest.invocationGuard}.claim`],
  });
  const baselineBytes = await readRegular(
    path.join(workspace, STAGE5_SECURITY_EXTENSION_BASELINE_PATH),
  );
  const manifestBytes = await readRegular(path.join(workspace, manifest.paths.manifest));
  const pins = toolchain();
  const candidateState = {
    gitHead: git(["rev-parse", "HEAD"]),
    workingTreeSnapshot,
    packageJsonSha256: hash(await readRegular(path.join(workspace, "package.json"))),
    activeRunnerSha256: hash(await readRegular(path.join(workspace, manifest.paths.runner))),
    verifierSha256: hash(await readRegular(path.join(workspace, manifest.paths.baselineVerifier))),
    candidateManifestSha256: hash(manifestBytes),
    baselineSha256: hash(baselineBytes),
    evidenceIndexSha256: evidenceIndex.indexSha256,
    evidenceIndexAggregateSha256: evidenceIndex.aggregateSha256,
    sourceScanSha256: hash(scanBytes),
    migrationHead: readiness.report.migrationHead,
    toolchain: pins,
    command,
    ciConsumed: "NO",
    invocationCount: 0,
    stage6Actions: manifest.stage6Actions,
  };
  const guard = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    state: "PREPARING",
    ...candidateState,
    candidateStateSha256: hash(Buffer.from(JSON.stringify(candidateState))),
    readinessPath: readiness.readinessPath,
    readinessSha256: readiness.readinessSha256,
    readinessResult: "PASS",
    generatedAtUtc: new Date().toISOString(),
  };
  await mkdir(path.dirname(guardPath), { recursive: true });
  await writeFile(guardPath, `${JSON.stringify(guard, null, 2)}\n`, { flag: "wx" });
  const coherenceRecheck = await verifyStage5CandidateCoherence({ root: workspace });
  assert.equal(coherenceRecheck.result, "PASS");
  guard.state = "ARMED";
  guard.coherenceRecheck = {
    result: coherenceRecheck.result,
    candidate: coherenceRecheck.candidate,
    staleReferences: coherenceRecheck.staleReferences,
  };
  await writeFile(guardPath, `${JSON.stringify(guard, null, 2)}\n`, { flag: "w" });
  const verifiedBytes = await readRegular(guardPath);
  const verified = JSON.parse(verifiedBytes.toString("utf8"));
  assert.equal(verified.state, "ARMED");
  assert.equal(verified.candidate, manifest.candidate);
  assert.equal(verified.ciConsumed, "NO");
  assert.equal(verified.invocationCount, 0);
  assert.equal(verified.command, command);
  assert.equal(verified.coherenceRecheck.result, "PASS");
  assert.equal(verified.candidateStateSha256, hash(Buffer.from(JSON.stringify(candidateState))));
  return {
    result: "PASS",
    candidate: manifest.candidate,
    guardPath: path.relative(workspace, guardPath),
    guardSha256: hash(verifiedBytes),
    gitHead: verified.gitHead,
    packageJsonSha256: verified.packageJsonSha256,
    activeRunnerSha256: verified.activeRunnerSha256,
    verifierSha256: verified.verifierSha256,
    baselineSha256: verified.baselineSha256,
    evidenceIndexSha256: verified.evidenceIndexSha256,
    migrationHead: verified.migrationHead,
    toolchain: verified.toolchain,
    command: verified.command,
    ciConsumed: verified.ciConsumed,
    coherenceRecheck: verified.coherenceRecheck.result,
    stage6Actions: verified.stage6Actions,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateStage5CurrentInvocationGuard();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
