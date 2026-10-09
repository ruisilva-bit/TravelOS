import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL10_INVOCATION_GUARD_PATH,
  STAGE5_FINAL10_INVOCATION_GUARD_SHA256,
  STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL11_EVIDENCE_DIRECTORY,
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL11_READINESS_PREFLIGHT_EVIDENCE,
  STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE,
} from "./stage-5-candidate-contract.mjs";
import {
  verifyStage5Final11EvidenceIndex,
  writeStage5Final11EvidenceIndex,
} from "./stage-5-evidence-index.mjs";
import { verifyStage5Final11FindingLineage } from "./stage-5-final11-finding-lineage.mjs";
import { verifyStage5Final10RejectedTaggedBytes } from "./stage-5-final11-finding-lineage.mjs";
import { verifyStage5SecurityExtensionBaseline } from "./verify-stage-5-security-extension-baseline.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(repositoryRoot, STAGE5_FINAL11_EVIDENCE_DIRECTORY);
const readinessPath = path.join(repositoryRoot, STAGE5_FINAL11_READINESS_PREFLIGHT_EVIDENCE);
const localStatePath = path.join(repositoryRoot, STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE);
const commandEnvironment = { ...process.env };
const EXPECTED_TOOLCHAIN = Object.freeze({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
const PRE_READINESS_ARTIFACTS = STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
  (name) => name !== "readiness-preflight.json",
).toSorted();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 60 * 1024 * 1024,
    env: commandEnvironment,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
};
const assertPinnedToolchain = () => {
  const node = process.version;
  const corepack = run("corepack", ["--version"]);
  const pnpm = run("corepack", ["pnpm", "--version"]);
  if (
    node !== EXPECTED_TOOLCHAIN.node ||
    corepack.exitCode !== 0 ||
    corepack.stdout.trim() !== EXPECTED_TOOLCHAIN.corepack ||
    pnpm.exitCode !== 0 ||
    pnpm.stdout.trim() !== EXPECTED_TOOLCHAIN.pnpm
  ) {
    throw new Error(
      `FINAL-11 readiness requires exact pins ${EXPECTED_TOOLCHAIN.node}/${EXPECTED_TOOLCHAIN.corepack}/${EXPECTED_TOOLCHAIN.pnpm}`,
    );
  }
  return {
    node,
    corepack: corepack.stdout.trim(),
    pnpm: pnpm.stdout.trim(),
    processExecPath: process.execPath,
  };
};
const assertRegularFile = async (absolutePath, label) => {
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`${label} must be a unique regular file`);
  }
  return readFile(absolutePath);
};
const assertExactPreparedEvidenceNames = async () => {
  const metadata = await lstat(evidenceDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("FINAL-11 evidence directory must be a regular directory");
  }
  const entries = await readdir(evidenceDirectory, { withFileTypes: true });
  const unsafe = entries
    .filter((entry) => !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name);
  const actualNames = entries.map((entry) => entry.name).toSorted();
  if (
    unsafe.length > 0 ||
    actualNames.length !== PRE_READINESS_ARTIFACTS.length ||
    PRE_READINESS_ARTIFACTS.some((name, index) => name !== actualNames[index])
  ) {
    throw new Error(
      `FINAL-11 preflight evidence set is not exact: ${JSON.stringify({ unsafe, expected: PRE_READINESS_ARTIFACTS, actualNames })}`,
    );
  }
};
const assertArtifactResults = async () => {
  const readJson = async (name) =>
    JSON.parse(
      (await assertRegularFile(path.join(evidenceDirectory, name), name)).toString("utf8"),
    );
  const [
    baseline,
    focused,
    auth,
    integration,
    cleanup,
    runtime,
    migration,
    build,
    summary,
    baselineGeneration,
  ] = await Promise.all([
    readJson("security-extension-baseline.json"),
    readJson("focused-test-execution.json"),
    readJson("auth-bridge-tests.json"),
    readJson("integration-test-execution.json"),
    readJson("disposable-cleanup.json"),
    readJson("postgresql-runtime.json"),
    readJson("migration-checksums.json"),
    readJson("package-build.json"),
    readJson("qualification-summary.json"),
    readJson("baseline-generation.json"),
  ]);
  const sourceScopeLog = (
    await assertRegularFile(
      path.join(evidenceDirectory, "stage5-source-scope-test.log"),
      "Stage 5 source-scope test log",
    )
  ).toString("utf8");
  const focusedLog = await assertRegularFile(
    path.join(evidenceDirectory, "focused-tests.log"),
    "focused test log",
  );
  const authLog = await assertRegularFile(
    path.join(evidenceDirectory, "auth-bridge-tests.log"),
    "auth bridge test log",
  );
  const integrationLog = await assertRegularFile(
    path.join(evidenceDirectory, "integration-tests.log"),
    "PostgreSQL integration test log",
  );
  const postgresqlPackage = await readJson("postgresql-package-provenance.json");
  const expectedPasses = [
    ["extension baseline", baseline.result === "PASS" && baseline.verification?.result === "PASS"],
    [
      "focused tests",
      focused.result === "PASS" && focused.exitCode === 0 && focused.candidate === "FINAL-11",
    ],
    ["auth bridge tests", auth.result === "PASS" && auth.exitCode === 0],
    ["PostgreSQL integration", integration.result === "PASS" && integration.exitCode === 0],
    ["PostgreSQL cleanup", cleanup.result === "PASS" && cleanup.disposableRootAbsent === true],
    [
      "PostgreSQL runtime",
      runtime.serverVersionNumber === 180006 && runtime.bindScope === "loopback-only",
    ],
    ["PostgreSQL package", postgresqlPackage.result === "PASS"],
    ["migration checksums", migration.result === "PASS" && migration.exitCode === 0],
    ["package build/smoke", build.result === "PASS"],
    ["qualification summary", summary.result === "PASS" && summary.stage6Actions === 0],
    [
      "baseline generation",
      baselineGeneration.result === "PASS" && baselineGeneration.candidate === "FINAL-11",
    ],
    ["source-scope tests", /"result"\s*:\s*"PASS"/u.test(sourceScopeLog)],
    ["focused test output", focusedLog.length > 0],
    ["auth bridge output", authLog.length > 0],
    ["PostgreSQL integration output", integrationLog.length > 0],
  ];
  const failed = expectedPasses.filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(
      `FINAL-11 preflight found non-passing qualification receipts: ${failed.join(", ")}`,
    );
  }
  const toolchain = assertPinnedToolchain();
  if (
    focused.toolchain?.node !== toolchain.node ||
    focused.toolchain?.corepack !== toolchain.corepack ||
    focused.toolchain?.pnpm !== toolchain.pnpm ||
    summary.toolchain?.node !== toolchain.node ||
    summary.toolchain?.corepack !== toolchain.corepack ||
    summary.toolchain?.pnpm !== toolchain.pnpm
  ) {
    throw new Error("FINAL-11 focused/summary receipts do not use the exact current toolchain");
  }
  const migrationLog = migration.output;
  if (typeof migrationLog !== "string" || !/PASS|verified|checksum/iu.test(migrationLog)) {
    throw new Error("FINAL-11 migration receipt omits its checksum-verification output");
  }
  const receiptManifest = [];
  for (const name of PRE_READINESS_ARTIFACTS) {
    const bytes = await readFile(path.join(evidenceDirectory, name));
    receiptManifest.push({
      path: `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/${name}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return {
    toolchain,
    checks: expectedPasses.map(([name]) => ({ name, result: "PASS" })),
    qualification: {
      focusedFiles: focused.files,
      focusedTests: focused.tests,
      postgresServerVersionNumber: runtime.serverVersionNumber,
      postgresTestSummary:
        integrationLog.toString("utf8").match(/Test Files\s+[^\r\n]+/u)?.[0] ?? "present",
      cleanup: cleanup.result,
      sourceScopeOutputSha256: sha256(Buffer.from(sourceScopeLog)),
      sourceScopeOutputBytes: Buffer.byteLength(sourceScopeLog),
    },
    artifacts: receiptManifest,
  };
};
const assertHistoricalState = async () => {
  const final10 = await verifyStage5Final10RejectedTaggedBytes({ root: repositoryRoot });
  if (
    final10.result !== "PASS" ||
    final10.status !== "REJECTED" ||
    final10.invocationCount !== 1 ||
    final10.exitCode !== 1 ||
    final10.stage6Actions !== 0 ||
    final10.localOnlyInvocationGuard.sha256 !== STAGE5_FINAL10_INVOCATION_GUARD_SHA256
  ) {
    throw new Error("FINAL-10 rejection, single invocation guard, or Stage 6=0 proof changed");
  }
  const trackedGuard = execFileSync(
    "git",
    ["ls-files", "--", STAGE5_FINAL10_INVOCATION_GUARD_PATH],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  ).trim();
  if (trackedGuard !== "")
    throw new Error("The FINAL-10 local-only invocation guard must remain untracked");
  const final10Runner = (
    await assertRegularFile(
      path.join(repositoryRoot, "tooling/ci/run-stage-5-final10-authoritative-ci.mjs"),
      "Historical FINAL-10 runner protection stub",
    )
  ).toString("utf8");
  if (!final10Runner.includes("FINAL-10 runner is disabled")) {
    throw new Error("The current FINAL-10 entrypoint can still execute the consumed candidate");
  }
  const baseline = await verifyStage5SecurityExtensionBaseline({ root: repositoryRoot });
  if (baseline.result !== "PASS")
    throw new Error("FINAL-11 security-extension baseline is not verified");
  return { final10, baseline };
};
const performReadinessPreflight = async () => {
  const toolchain = assertPinnedToolchain();
  const pins = run("corepack", ["pnpm", "run", "verify:pins"]);
  if (pins.exitCode !== 0) {
    throw new Error(`FINAL-11 exact-pin verification failed: ${pins.stderr.slice(0, 4_000)}`);
  }
  await assertExactPreparedEvidenceNames();
  const historical = await assertHistoricalState();
  const qualification = await assertArtifactResults();
  const readiness = {
    schemaVersion: 1,
    result: "PASS",
    stage: "PHASE_1_M1_STAGE_5",
    candidate: "FINAL-11",
    phase: "PRE_CI_READINESS",
    invocationCount: 0,
    ciVerifyInvoked: false,
    toolchain,
    exactPins: {
      result: "PASS",
      command: "corepack pnpm run verify:pins",
      stdoutSha256: sha256(Buffer.from(pins.stdout)),
      stderrSha256: sha256(Buffer.from(pins.stderr)),
    },
    final10RejectedPredecessor: {
      tag: historical.final10.tag,
      target: historical.final10.target,
      status: historical.final10.status,
      failedGate: historical.final10.failedGate,
      invocationCount: historical.final10.invocationCount,
      result: historical.final10.result,
      guardSha256: historical.final10.localOnlyInvocationGuard.sha256,
    },
    securityExtensionBaseline: {
      result: historical.baseline.result,
      baselineSha256: historical.baseline.baselineSha256,
      aggregateSha256: historical.baseline.aggregateSha256,
      protectedFileCount: historical.baseline.protectedFileCount,
    },
    qualification: {
      result: "PASS",
      ...qualification.qualification,
      checks: qualification.checks,
      artifacts: qualification.artifacts,
    },
    preIndexChecksOnly: true,
    postIndexSourceScan: "REQUIRED_BEFORE_CI_AND_RECORDED_IN_LOCAL_READINESS_STATE",
    stage6Actions: 0,
  };
  await writeFile(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`, { flag: "wx" });
  const preCiIndex = await writeStage5Final11EvidenceIndex({
    root: repositoryRoot,
    phase: "PRE_CI",
  });
  const lineage = await verifyStage5Final11FindingLineage({ root: repositoryRoot });
  const evidenceIndex = await verifyStage5Final11EvidenceIndex({
    root: repositoryRoot,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  const sourceScan = run(process.execPath, [
    "tooling/ci/scan-source-secrets.mjs",
    "--stage5-final",
  ]);
  if (sourceScan.exitCode !== 0) {
    throw new Error(
      `FINAL-11 post-index sensitive-data scan failed: ${sourceScan.stderr.slice(0, 5_000)}`,
    );
  }
  let sourceScanReport;
  try {
    sourceScanReport = JSON.parse(sourceScan.stdout);
  } catch {
    throw new Error("FINAL-11 post-index scan output is not valid JSON");
  }
  const scanProvenance = sourceScanReport.stage5FinalScanProvenance;
  if (
    sourceScanReport.result !== "PASS" ||
    sourceScanReport.findings?.length !== 0 ||
    scanProvenance?.phase !== "FINAL_EVIDENCE" ||
    scanProvenance?.inputsMatchFailClosedCollector !== true ||
    scanProvenance?.evidenceIndexVerified !== true ||
    scanProvenance?.evidenceIndexPhase !== "PRE_CI" ||
    scanProvenance?.protectedFinal10RejectedTagBytesVerified !== true ||
    scanProvenance?.historicalFindingLineage?.result !== "PASS" ||
    scanProvenance?.historicalFindingLineage?.stage6Actions !== 0
  ) {
    throw new Error("FINAL-11 post-index sensitive-data scan/provenance did not pass cleanly");
  }
  const readinessBytes = await assertRegularFile(readinessPath, "FINAL-11 readiness report");
  const indexBytes = await assertRegularFile(
    path.join(repositoryRoot, STAGE5_FINAL11_EVIDENCE_INDEX),
    "FINAL-11 PRE_CI evidence index",
  );
  const localState = {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-11",
    phase: "PRE_CI",
    invocationCount: 0,
    ciVerifyInvoked: false,
    readinessEvidence: {
      path: STAGE5_FINAL11_READINESS_PREFLIGHT_EVIDENCE,
      bytes: readinessBytes.length,
      sha256: sha256(readinessBytes),
    },
    preCiEvidenceIndex: {
      path: STAGE5_FINAL11_EVIDENCE_INDEX,
      bytes: indexBytes.length,
      sha256: sha256(indexBytes),
      declaredAggregateSha256: preCiIndex.declaredAggregateSha256,
      recomputedAggregateSha256: preCiIndex.recomputedAggregateSha256,
    },
    postIndexSourceScan: {
      result: sourceScanReport.result,
      command: `${process.execPath} tooling/ci/scan-source-secrets.mjs --stage5-final`,
      outputBytes: Buffer.byteLength(sourceScan.stdout) + Buffer.byteLength(sourceScan.stderr),
      stdoutSha256: sha256(Buffer.from(sourceScan.stdout)),
      stderrSha256: sha256(Buffer.from(sourceScan.stderr)),
      filesScanned: sourceScanReport.filesScanned,
      findingCount: sourceScanReport.findings.length,
      scopeAggregateSha256: sourceScanReport.stage5FinalScanProvenance.scopeAggregateSha256,
      evidenceIndexSha256: evidenceIndex.indexSha256,
      lineageResult: lineage.result,
      stage6Actions: 0,
    },
    final10GuardSha256: historical.final10.localOnlyInvocationGuard.sha256,
    packageSha256: sha256(await readFile(path.join(repositoryRoot, "package.json"))),
    baselineSha256: historical.baseline.baselineSha256,
    toolchain,
  };
  await mkdir(path.dirname(localStatePath), { recursive: true });
  await writeFile(localStatePath, `${JSON.stringify(localState, null, 2)}\n`, { flag: "wx" });
  return {
    result: "PASS",
    candidate: "FINAL-11",
    phase: "PRE_CI",
    artifactCount: evidenceIndex.artifactCount,
    evidenceIndexSha256: evidenceIndex.indexSha256,
    evidenceAggregateSha256: evidenceIndex.recomputedAggregateSha256,
    final10Lineage: lineage.protectedFinal10,
    sourceScan: localState.postIndexSourceScan,
    ciVerifyInvocations: 0,
    stage6Actions: 0,
  };
};
const verifyReadinessState = async ({ root = repositoryRoot } = {}) => {
  const evidencePath = path.join(root, STAGE5_FINAL11_READINESS_PREFLIGHT_EVIDENCE);
  const localPath = path.join(root, STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE);
  const readinessBytes = await assertRegularFile(evidencePath, "FINAL-11 readiness report");
  const localStateBytes = await assertRegularFile(localPath, "FINAL-11 local readiness state");
  const readiness = JSON.parse(readinessBytes.toString("utf8"));
  const localState = JSON.parse(localStateBytes.toString("utf8"));
  const toolchain = assertPinnedToolchain();
  if (
    readiness.candidate !== "FINAL-11" ||
    readiness.result !== "PASS" ||
    readiness.ciVerifyInvoked !== false ||
    readiness.invocationCount !== 0 ||
    localState.candidate !== "FINAL-11" ||
    localState.result !== "PASS" ||
    localState.ciVerifyInvoked !== false ||
    localState.invocationCount !== 0 ||
    localState.readinessEvidence?.sha256 !== sha256(readinessBytes) ||
    localState.toolchain?.node !== toolchain.node ||
    localState.toolchain?.corepack !== toolchain.corepack ||
    localState.toolchain?.pnpm !== toolchain.pnpm
  ) {
    throw new Error("FINAL-11 readiness record is stale, consumed, or uses an unpinned toolchain");
  }
  if (await pathExists(STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD, root)) {
    throw new Error("FINAL-11 once-only CI guard already exists");
  }
  const evidenceIndex = await verifyStage5Final11EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  const indexBytes = await assertRegularFile(
    path.join(root, STAGE5_FINAL11_EVIDENCE_INDEX),
    "PRE_CI index",
  );
  if (
    localState.preCiEvidenceIndex?.sha256 !== sha256(indexBytes) ||
    localState.preCiEvidenceIndex?.recomputedAggregateSha256 !==
      evidenceIndex.recomputedAggregateSha256 ||
    localState.postIndexSourceScan?.result !== "PASS" ||
    localState.postIndexSourceScan?.findingCount !== 0 ||
    localState.postIndexSourceScan?.stage6Actions !== 0 ||
    localState.postIndexSourceScan?.evidenceIndexSha256 !== evidenceIndex.indexSha256
  ) {
    throw new Error("FINAL-11 PRE_CI index or post-index scan no longer matches readiness state");
  }
  const historical = await verifyStage5Final10RejectedTaggedBytes({ root });
  if (
    historical.localOnlyInvocationGuard.sha256 !== localState.final10GuardSha256 ||
    historical.localOnlyInvocationGuard.sha256 !== STAGE5_FINAL10_INVOCATION_GUARD_SHA256
  ) {
    throw new Error("FINAL-10 local-only guard changed after readiness");
  }
  const baseline = await verifyStage5SecurityExtensionBaseline({ root });
  const packageHash = sha256(await readFile(path.join(root, "package.json")));
  if (
    baseline.result !== "PASS" ||
    baseline.baselineSha256 !== localState.baselineSha256 ||
    packageHash !== localState.packageSha256
  ) {
    throw new Error(
      "FINAL-11 protected package or security-extension baseline changed after readiness",
    );
  }
  const stateTracked = execFileSync(
    "git",
    ["ls-files", "--", STAGE5_FINAL11_READINESS_PREFLIGHT_LOCAL_STATE],
    {
      cwd: root,
      encoding: "utf8",
    },
  ).trim();
  if (stateTracked !== "")
    throw new Error("FINAL-11 readiness state must remain local-only and untracked");
  return {
    result: "PASS",
    candidate: "FINAL-11",
    phase: "PRE_CI",
    evidenceIndexSha256: evidenceIndex.indexSha256,
    evidenceAggregateSha256: evidenceIndex.recomputedAggregateSha256,
    readinessSha256: sha256(readinessBytes),
    sourceScanSha256: localState.postIndexSourceScan.stdoutSha256,
    toolchain,
    ciVerifyInvocations: 0,
    stage6Actions: 0,
  };
};
const pathExists = async (relativePath, root = repositoryRoot) => {
  try {
    await lstat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

export { verifyReadinessState as verifyStage5Final11ReadinessPreflight };

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const report = process.argv.includes("--write")
    ? await performReadinessPreflight()
    : await verifyReadinessState();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
