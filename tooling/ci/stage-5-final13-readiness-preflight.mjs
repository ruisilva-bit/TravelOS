import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL13_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
  STAGE5_FINAL13_EVIDENCE_INDEX,
  STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL13_READINESS_PREFLIGHT_EVIDENCE,
  STAGE5_FINAL13_READINESS_PREFLIGHT_LOCAL_STATE,
} from "./stage-5-candidate-contract.mjs";
import {
  verifyStage5Final13EvidenceIndex,
  writeStage5Final13EvidenceIndex,
} from "./stage-5-final13-evidence-index.mjs";
import { verifyStage5Final13FindingLineage } from "./stage-5-final13-finding-lineage.mjs";
import { verifyStage5SecurityExtensionBaseline } from "./verify-stage-5-security-extension-baseline.mjs";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDir = path.join(root, STAGE5_FINAL13_EVIDENCE_DIRECTORY);
const reportPath = path.join(root, STAGE5_FINAL13_READINESS_PREFLIGHT_EVIDENCE);
const localPath = path.join(root, STAGE5_FINAL13_READINESS_PREFLIGHT_LOCAL_STATE);
const expectedToolchain = { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const exists = async (p) => {
  try {
    await lstat(p);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
    env: { ...process.env },
  });
  return {
    exitCode: r.status ?? 127,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? (r.error ? String(r.error) : ""),
  };
};
const toolchain = () => {
  const c = run("corepack", ["--version"]);
  const p = run("corepack", ["pnpm", "--version"]);
  const t = {
    node: process.version,
    corepack: c.stdout.trim(),
    pnpm: p.stdout.trim(),
    nodeExecutable: process.execPath,
  };
  assert.deepEqual(
    { node: t.node, corepack: t.corepack, pnpm: t.pnpm },
    expectedToolchain,
    "FINAL-13 requires exact pinned toolchain",
  );
  assert.equal(c.exitCode, 0);
  assert.equal(p.exitCode, 0);
  return t;
};
const runPnpm = (args) => run("corepack", ["pnpm", ...args]);
const requirePass = (label, args) => {
  const r = runPnpm(args);
  assert.equal(r.exitCode, 0, `${label} failed (${r.exitCode})\n${r.stdout}\n${r.stderr}`);
  return {
    label,
    result: "PASS",
    command: `corepack pnpm ${args.join(" ")}`,
    stdoutSha256: sha256(Buffer.from(r.stdout)),
    stderrSha256: sha256(Buffer.from(r.stderr)),
  };
};
const write = async (p, value) => {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, value);
};
const formatCheck = () => {
  const startedAtUtc = new Date().toISOString();
  const r = runPnpm(["run", "format:check"]);
  const finishedAtUtc = new Date().toISOString();
  return { r, startedAtUtc, finishedAtUtc, log: Buffer.from(`${r.stdout}${r.stderr}`) };
};
const lintCheck = () => {
  const startedAtUtc = new Date().toISOString();
  const r = runPnpm(["run", "lint"]);
  const finishedAtUtc = new Date().toISOString();
  return { r, startedAtUtc, finishedAtUtc, log: Buffer.from(`${r.stdout}${r.stderr}`) };
};
const persistFormat = async (result, pins) => {
  const f = {
    schemaVersion: 1,
    candidate: "FINAL-13",
    phase: "PRE_CI",
    command: "corepack pnpm run format:check",
    result: result.r.exitCode === 0 ? "PASS" : "FAIL",
    exitCode: result.r.exitCode,
    startedAtUtc: result.startedAtUtc,
    finishedAtUtc: result.finishedAtUtc,
    toolchain: pins,
    logBytes: result.log.length,
    logSha256: sha256(result.log),
    stage6Actions: 0,
  };
  await write(path.join(evidenceDir, "format-check.log"), result.log);
  await write(path.join(evidenceDir, "format-check.json"), `${JSON.stringify(f, null, 2)}\n`);
  return f;
};
const persistLint = async (result, pins) => {
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-13",
    phase: "PRE_CI",
    command: "corepack pnpm run lint",
    result: result.r.exitCode === 0 ? "PASS" : "FAIL",
    exitCode: result.r.exitCode,
    startedAtUtc: result.startedAtUtc,
    finishedAtUtc: result.finishedAtUtc,
    toolchain: pins,
    logBytes: result.log.length,
    logSha256: sha256(result.log),
    stage6Actions: 0,
  };
  await write(path.join(evidenceDir, "lint-check.log"), result.log);
  await write(path.join(evidenceDir, "lint-check.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
};
const sourceScan = () => {
  const r = runPnpm(["run", "security:scan:source"]);
  assert.equal(r.exitCode, 0, `source scan failed (${r.exitCode})\n${r.stdout}\n${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.result, "PASS");
  assert.equal(parsed.findings.length, 0);
  const provenance = parsed.stage5FinalScanProvenance;
  assert.equal(provenance.phase, "FINAL_EVIDENCE");
  assert.equal(provenance.inputsMatchFailClosedCollector, true);
  assert.equal(provenance.evidenceIndexVerified, true);
  assert.equal(provenance.evidenceIndexPhase, "CI_FAILED");
  assert.equal(provenance.protectedFinal10RejectedTagBytesVerified, true);
  assert.equal(provenance.historicalFindingLineage.result, "PASS");
  assert.equal(provenance.historicalFindingLineage.stage6Actions, 0);
  return { r, parsed };
};
const checkGuardAbsent = async () =>
  assert.equal(
    await exists(path.join(root, STAGE5_FINAL13_CI_VERIFY_INVOCATION_GUARD)),
    false,
    "FINAL-13 once-only CI authorization already consumed",
  );
export const verifyStage5Final13ReadinessPreflight = async ({ root: givenRoot = root } = {}) => {
  assert.equal(givenRoot, root);
  await checkGuardAbsent();
  const pins = toolchain();
  const existingNames = (await readdir(evidenceDir)).toSorted();
  if (existingNames.includes("EVIDENCE_INDEX.json")) {
    const existingIndex = await verifyStage5Final13EvidenceIndex({
      root,
      allowedPhases: ["PRE_CI"],
      requiredPhase: "PRE_CI",
    });
    assert.equal(
      existingIndex.result,
      "PASS",
      "existing preflight index is not valid PRE_CI evidence",
    );
  }
  const notYet = [
    "EVIDENCE_INDEX.json",
    "format-check.json",
    "format-check.log",
    "lint-check.json",
    "lint-check.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ].toSorted();
  const initialNames = existingNames.filter((name) => !notYet.includes(name));
  assert.deepEqual(
    initialNames,
    STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter((n) => !notYet.includes(n)).toSorted(),
    "FINAL-13 evidence preparation must be exact before preflight",
  );
  const pending = {
    schemaVersion: 1,
    candidate: "FINAL-13",
    phase: "PRE_CI",
    result: "PENDING",
    ciVerifyInvoked: false,
    invocationCount: 0,
    stage6Actions: 0,
  };
  await write(path.join(evidenceDir, "format-check.log"), "PENDING: format:check has not run.\n");
  await write(path.join(evidenceDir, "format-check.json"), `${JSON.stringify(pending, null, 2)}\n`);
  await write(path.join(evidenceDir, "lint-check.log"), "PENDING: lint has not run.\n");
  await write(path.join(evidenceDir, "lint-check.json"), `${JSON.stringify(pending, null, 2)}\n`);
  await write(reportPath, `${JSON.stringify(pending, null, 2)}\n`);
  await writeStage5Final13EvidenceIndex({ root, phase: "PRE_CI" });
  const firstFormat = formatCheck();
  const formatReceipt = await persistFormat(firstFormat, pins);
  assert.equal(
    firstFormat.r.exitCode,
    0,
    `FINAL-13 format:check failed\n${firstFormat.r.stdout}\n${firstFormat.r.stderr}`,
  );
  await writeStage5Final13EvidenceIndex({ root, phase: "PRE_CI" });
  const firstLint = lintCheck();
  const lintReceipt = await persistLint(firstLint, pins);
  assert.equal(
    firstLint.r.exitCode,
    0,
    `FINAL-13 lint failed\n${firstLint.r.stdout}\n${firstLint.r.stderr}`,
  );
  await writeStage5Final13EvidenceIndex({ root, phase: "PRE_CI" });
  const baseline = await verifyStage5SecurityExtensionBaseline({ root });
  assert.equal(baseline.result, "PASS");
  const lineage = await verifyStage5Final13FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  const gates = [
    requirePass("baseline verifier", ["run", "stage5:security-extension:verify"]),
    requirePass("baseline regression tests", ["run", "test:stage5-security-extension-baseline"]),
    requirePass("source-scope regression tests", ["run", "test:stage5-source-scope"]),
  ];
  sourceScan();
  const matrix = JSON.parse(
    await readFile(path.join(root, STAGE5_FINAL13_CORRECTION_MATRIX), "utf8"),
  );
  assert.equal(matrix.candidate, "FINAL-13");
  assert.equal(matrix.summary.totalFindingCount, 48);
  assert.equal(matrix.summary.priorGenerationFailureCount, 3);
  assert.equal(matrix.stage6Actions, 0);
  const report = {
    schemaVersion: 1,
    candidate: "FINAL-13",
    phase: "PRE_CI",
    result: "PASS",
    ciVerifyInvoked: false,
    invocationCount: 0,
    checks: [
      { name: "toolchain", result: "PASS" },
      { name: "full format:check", result: "PASS" },
      { name: "full lint", result: "PASS" },
      ...gates.map((g) => ({ name: g.label, result: g.result })),
      { name: "post-index sensitive-data scan", result: "PASS" },
    ],
    formatCheck: {
      command: formatReceipt.command,
      result: formatReceipt.result,
      exitCode: formatReceipt.exitCode,
      logSha256: formatReceipt.logSha256,
    },
    lintCheck: {
      command: lintReceipt.command,
      result: lintReceipt.result,
      exitCode: lintReceipt.exitCode,
      logSha256: lintReceipt.logSha256,
    },
    baselineSha256: baseline.phase1.baselineSha256,
    packageSha256: sha256(await readFile(path.join(root, "package.json"))),
    runnerSha256: sha256(
      await readFile(path.join(root, "tooling/ci/run-stage-5-final13-authoritative-ci.mjs")),
    ),
    final12RejectedCiLogSha256: lineage.ciLog.sha256,
    final12RejectedIndexSha256: lineage.evidenceIndex.sha256,
    stage6Actions: 0,
  };
  await write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeStage5Final13EvidenceIndex({ root, phase: "PRE_CI" });
  const finalFormat = formatCheck();
  assert.equal(
    finalFormat.r.exitCode,
    0,
    `FINAL-13 post-index format check failed\n${finalFormat.r.stdout}\n${finalFormat.r.stderr}`,
  );
  const finalScan = sourceScan();
  const finalIndex = await verifyStage5Final13EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(finalScan.parsed.stage5FinalScanProvenance.evidenceIndexVerified, true);
  const scanManifest = new Map(
    finalScan.parsed.stage5FinalScanProvenance.scopeFileManifest.map((e) => [e.path, e]),
  );
  const index = JSON.parse(await readFile(path.join(root, STAGE5_FINAL13_EVIDENCE_INDEX), "utf8"));
  for (const item of index.artifacts) {
    const seen = scanManifest.get(item.path);
    assert.equal(
      seen?.bytes,
      item.bytes,
      `sensitive-data scan lacks indexed FINAL-13 artifact ${item.path}`,
    );
    assert.equal(seen?.sha256, item.sha256, `sensitive-data scan hash mismatch ${item.path}`);
  }
  const packageBytes = await readFile(path.join(root, "package.json"));
  const baselineBytes = await readFile(
    path.join(root, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
  );
  const runnerBytes = await readFile(
    path.join(root, "tooling/ci/run-stage-5-final13-authoritative-ci.mjs"),
  );
  const readinessBytes = await readFile(reportPath);
  const indexBytes = await readFile(path.join(root, STAGE5_FINAL13_EVIDENCE_INDEX));
  const state = {
    schemaVersion: 1,
    candidate: "FINAL-13",
    phase: "PRE_CI",
    result: "PASS",
    ciVerifyInvoked: false,
    invocationCount: 0,
    readinessEvidence: {
      path: STAGE5_FINAL13_READINESS_PREFLIGHT_EVIDENCE,
      bytes: readinessBytes.length,
      sha256: sha256(readinessBytes),
    },
    preCiEvidenceIndex: {
      path: STAGE5_FINAL13_EVIDENCE_INDEX,
      bytes: indexBytes.length,
      sha256: finalIndex.indexSha256,
      aggregateSha256: finalIndex.aggregateSha256,
    },
    postIndexSourceScan: {
      result: finalScan.parsed.result,
      stdoutSha256: sha256(Buffer.from(finalScan.r.stdout)),
      stderrSha256: sha256(Buffer.from(finalScan.r.stderr)),
      filesScanned: finalScan.parsed.filesScanned,
      findingCount: finalScan.parsed.findings.length,
      scopeAggregateSha256: finalScan.parsed.stage5FinalScanProvenance.scopeAggregateSha256,
      evidenceIndexSha256: finalIndex.indexSha256,
    },
    inputs: {
      packageSha256: sha256(packageBytes),
      baselineSha256: sha256(baselineBytes),
      runnerSha256: sha256(runnerBytes),
    },
    toolchain: pins,
    gates,
    formatReceipt,
    stage6Actions: 0,
  };
  await mkdir(path.dirname(localPath), { recursive: true });
  await write(localPath, `${JSON.stringify(state, null, 2)}\n`);
  const tracked = execFileSync(
    "git",
    ["ls-files", "--", STAGE5_FINAL13_READINESS_PREFLIGHT_LOCAL_STATE],
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(tracked, "");
  return {
    result: "PASS",
    candidate: "FINAL-13",
    phase: "PRE_CI",
    evidenceIndexSha256: finalIndex.indexSha256,
    evidenceAggregateSha256: finalIndex.aggregateSha256,
    sourceScanFindingCount: 0,
    ciVerifyInvocations: 0,
    stage6Actions: 0,
  };
};
export const verifyStage5Final13Readiness = async ({ root: givenRoot = root } = {}) => {
  assert.equal(givenRoot, root);
  await checkGuardAbsent();
  const pins = toolchain();
  const readinessBytes = await readFile(reportPath);
  const stateBytes = await readFile(localPath);
  const readiness = JSON.parse(readinessBytes.toString("utf8"));
  const state = JSON.parse(stateBytes.toString("utf8"));
  assert.equal(readiness.candidate, "FINAL-13");
  assert.equal(readiness.result, "PASS");
  assert.equal(readiness.ciVerifyInvoked, false);
  assert.equal(readiness.invocationCount, 0);
  assert.equal(state.candidate, "FINAL-13");
  assert.equal(state.result, "PASS");
  assert.equal(state.readinessEvidence.sha256, sha256(readinessBytes));
  assert.equal(state.toolchain.node, pins.node);
  assert.equal(state.toolchain.corepack, pins.corepack);
  assert.equal(state.toolchain.pnpm, pins.pnpm);
  assert.equal(state.stage6Actions, 0);
  const index = await verifyStage5Final13EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  const baseline = await verifyStage5SecurityExtensionBaseline({ root });
  assert.equal(baseline.phase1.baselineSha256, state.inputs.baselineSha256);
  assert.equal(sha256(await readFile(path.join(root, "package.json"))), state.inputs.packageSha256);
  assert.equal(
    sha256(await readFile(path.join(root, "tooling/ci/run-stage-5-final13-authoritative-ci.mjs"))),
    state.inputs.runnerSha256,
  );
  assert.equal(state.preCiEvidenceIndex.sha256, index.indexSha256);
  assert.equal(state.preCiEvidenceIndex.aggregateSha256, index.aggregateSha256);
  assert.equal(state.postIndexSourceScan.result, "PASS");
  assert.equal(state.postIndexSourceScan.findingCount, 0);
  assert.equal(state.postIndexSourceScan.evidenceIndexSha256, index.indexSha256);
  assert.equal(state.stage6Actions, 0);
  const format = runPnpm(["run", "format:check"]);
  assert.equal(
    format.exitCode,
    0,
    `FINAL-13 final format verification failed\n${format.stdout}\n${format.stderr}`,
  );
  const lint = runPnpm(["run", "lint"]);
  assert.equal(
    lint.exitCode,
    0,
    `FINAL-13 final lint verification failed\n${lint.stdout}\n${lint.stderr}`,
  );
  return {
    result: "PASS",
    candidate: "FINAL-13",
    phase: "PRE_CI",
    evidenceIndexSha256: index.indexSha256,
    lintResult: "PASS",
    toolchain: pins,
    ciVerifyInvocations: 0,
    stage6Actions: 0,
  };
};
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const out = process.argv.includes("--write")
    ? await verifyStage5Final13ReadinessPreflight()
    : await verifyStage5Final13Readiness();
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
