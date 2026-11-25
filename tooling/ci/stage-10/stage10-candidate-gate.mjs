import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { verifyInputs, corepackInvocation } from "./candidate.mjs";
import { buildPaths } from "./build-artifact.mjs";
import { inspectClaim } from "./one-shot.mjs";
import { screenFinalSource } from "./source-final-gate.mjs";
import { qualifyCleanInstall } from "./clean-install.mjs";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";
import { verifyInheritedBaseline } from "./predecessor-baseline-adapter.mjs";
import { _runBoundedProcess } from "./gate-process.mjs";
import { STATE, STAGE } from "./constants.mjs";
import {
  INHERITED_POSTGRES_GATES,
  isPostgresGate,
  postgresCoverage,
  validatePostgresCoverage,
} from "./postgres-successor-coverage.mjs";
import {
  digest,
  jsonBytes,
  parseCandidate,
  privateDirectory,
  regularBytes,
  sha256,
} from "./io.mjs";

const gates = new Set([
  ...INHERITED_POSTGRES_GATES,
  "stage10-clean-install",
  "stage10-source-security",
  "stage10-baseline",
  "stage10-build-receipt",
  "stage10-exact-artifact",
  "stage10-postgres-browser",
  "stage10-source-final",
]);
export function parseArguments(args) {
  assert.equal(args.length, 2, "Require exactly --candidate=genNN --gate=LABEL");
  const c = /^--candidate=(.+)$/u.exec(args[0]);
  const g = /^--gate=(.+)$/u.exec(args[1]);
  assert.ok(c && g, "Invalid arguments");
  parseCandidate(c[1]);
  assert.ok(gates.has(g[1]), "Unknown gate");
  return { candidate: c[1], gate: g[1] };
}

export function validateExecution(bytes, log, expected) {
  const execution = JSON.parse(bytes);
  assert.deepEqual(bytes, jsonBytes(execution), "Noncanonical execution receipt");
  assert.equal(execution.schemaVersion, 1);
  assert.equal(execution.stage, STAGE);
  assert.equal(execution.result, "PASS");
  assert.equal(execution.testExitCode, 0);
  assert.equal(execution.failure, null);
  assert.equal(execution.stage11Actions, 0);
  assert.equal(execution.postgresVersion, "18.6");
  assert.equal(execution.serverVersionNumber, 180006);
  assert.equal(execution.bindScope, "127.0.0.1 only");
  assert.equal(execution.dataChecksums, true);
  assert.equal(execution.globalPackageInstallation, false);
  assert.deepEqual(execution.artifactBinding, expected);
  assert.equal(execution.testLogSha256, sha256(log));
  assert.equal(execution.cleanup.clusterStartAttempted, true);
  assert.equal(execution.cleanup.clusterStopped, true);
  assert.equal(execution.cleanup.disposableRootsAbsent, true);
  const text = log.toString("utf8");
  assert.match(text, /^\s*Test Files\s+4 passed \(4\)\s*$/mu);
  assert.match(text, /^\s*Tests\s+95 passed \(95\)\s*$/mu);
  assert.doesNotMatch(text, /\b(?:skipped|todo)\b/iu);
  return execution;
}

export async function runCandidateGate({ root, candidate, gate }) {
  parseCandidate(candidate);
  assert.ok(gates.has(gate), "Unknown gate");
  root = path.resolve(root);
  const predecessorArchive = path.join(root, ".hermes/state/stage9-gen11-artifact.tar.gz");
  const inputsPath = path.join(root, STATE, "candidates", candidate, "inputs.json");
  const inputs = await verifyInputs({ root, candidate, predecessorArchive });
  const paths = buildPaths(root, candidate);
  const receiptBytes = await regularBytes(paths.receipt);
  const receipt = JSON.parse(receiptBytes);
  assert.deepEqual(receiptBytes, jsonBytes(receipt), "Noncanonical build receipt");
  const checksBytes = await regularBytes(paths.qualification);
  const checks = JSON.parse(checksBytes);
  const build = await inspectClaim(paths.ledger, inputs.inputDigest);
  assert.equal(build.state, "PASSED_CONSUMED", "Build claim not passed");
  assert.equal(build.claim.record.operation, "PRODUCTION_BUILD_ONCE");
  assert.equal(build.claim.record.candidate, candidate);
  assert.equal(build.outcome.receipt.buildReceiptSha256, digest(receipt));
  assert.equal(build.outcome.receipt.packageChecksSha256, sha256(checksBytes));
  assert.equal(checks.result, "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED");
  assert.equal(sha256(await regularBytes(process.execPath)), inputs.runtimeNodeSha256);
  await qualifyExtractedArtifact({
    payload: paths.extracted,
    archive: paths.archive,
    receipt,
    expectedReceiptSha256: build.outcome.receipt.buildReceiptSha256,
    inputs,
    expectedNodeSha256: inputs.runtimeNodeSha256,
  });
  if (gate === "stage10-baseline") await verifyInheritedBaseline(root);
  if (gate === "stage10-source-final" || gate === "stage10-source-security") {
    const screening = await screenFinalSource({ root, source: inputs.source });
    if (screening.result !== "PASS") {
      process.stdout.write(`${JSON.stringify(screening)}\n`);
      throw new Error("Final source/binary screening has unresolved findings or coverage");
    }
  }
  if (gate === "stage10-clean-install") {
    const parent = path.join(root, STATE, "ci-evidence", candidate);
    await privateDirectory(parent);
    await qualifyCleanInstall({
      root,
      source: inputs.source,
      outputDirectory: path.join(parent, "clean-install"),
    });
    assert.deepEqual(
      await verifyInputs({ root, candidate, predecessorArchive }),
      inputs,
      "Candidate drift during clean installation",
    );
  }
  if (isPostgresGate(gate)) {
    const release = JSON.parse(await regularBytes(path.join(paths.extracted, "release.json")));
    assert.equal(release.candidate, candidate);
    const inputsBytes = await regularBytes(inputsPath);
    const expected = {
      artifactId: release.artifactId,
      candidate,
      inputDigest: inputs.inputDigest,
      archiveSha256: receipt.archiveSha256,
      receiptSha256: sha256(receiptBytes),
      inputsSha256: sha256(inputsBytes),
      browserAcceptance: true,
    };
    const parent = path.join(root, STATE, "ci-evidence", candidate);
    await privateDirectory(parent);
    const evidence = path.join(parent, "postgres-browser");
    const coverage = await postgresCoverage(root);
    let fresh = true;
    try {
      await mkdir(evidence, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      fresh = false;
    }
    // All five labels require the same complete superset. Reuse only the exact
    // successful bound receipt/log; an incomplete or failed directory is never
    // retried, repaired or mistaken for a completed run.
    if (fresh) {
      const invocation = corepackInvocation();
      const result = await _runBoundedProcess({
        label: gate,
        root,
        outputDirectory: evidence,
        command: process.execPath,
        args: [path.join(root, "tooling/database/run-stage-10-postgres-disposable.mjs")],
        environment: {
          PATH: invocation.path,
          HOME: "/home/hermes",
          TMPDIR: process.env.TMPDIR,
          PWD: root,
          TZ: "UTC",
          LANG: "C.UTF-8",
          CI: "true",
          TRAVELOS_STAGE10_EXTRACTED_ROOT: paths.extracted,
          TRAVELOS_STAGE10_ARCHIVE: paths.archive,
          TRAVELOS_STAGE10_RECEIPT: paths.receipt,
          TRAVELOS_STAGE10_INPUTS: inputsPath,
          TRAVELOS_STAGE10_RECEIPT_SHA256: expected.receiptSha256,
          TRAVELOS_STAGE10_INPUTS_SHA256: expected.inputsSha256,
          TRAVELOS_STAGE10_NODE_SHA256: inputs.runtimeNodeSha256,
          TRAVELOS_STAGE10_PREDECESSOR_ARCHIVE: predecessorArchive,
          TRAVELOS_STAGE10_EVIDENCE_DIR: evidence,
        },
        timeout: 60 * 60 * 1000,
        outputLimit: 64 * 1024 * 1024,
      });
      assert.equal(result.status, "PASS", "PostgreSQL/browser process failed");
    }
    const log = await regularBytes(path.join(evidence, "integration-tests.log"));
    const execution = validateExecution(
      await regularBytes(path.join(evidence, "execution.json")),
      log,
      expected,
    );
    validatePostgresCoverage(
      execution.assertionCoverage,
      coverage,
      log,
      execution.assertionResults,
    );
    assert.deepEqual(
      await verifyInputs({ root, candidate, predecessorArchive }),
      inputs,
      "Inputs changed during PostgreSQL/browser",
    );
  }
  // Every route, including baseline/receipt/exact-artifact, must reject drift
  // during its work. Requalify the archive first, then check frozen inputs last
  // so the qualification probes themselves cannot leave unnoticed source drift.
  await qualifyExtractedArtifact({
    payload: paths.extracted,
    archive: paths.archive,
    receipt,
    expectedReceiptSha256: build.outcome.receipt.buildReceiptSha256,
    inputs,
    expectedNodeSha256: inputs.runtimeNodeSha256,
  });
  assert.deepEqual(
    await verifyInputs({ root, candidate, predecessorArchive }),
    inputs,
    "Inputs changed during candidate gate",
  );
  return {
    result: "PASS",
    gate,
    candidate,
    scope: "LOCAL_CHECK_ONLY_NOT_CANONICAL_CI_OR_INDEPENDENT_AUTHORITY",
    trust: "PENDING",
    privacy: "PENDING",
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
    process.stdout.write(`${JSON.stringify(await runCandidateGate({ root, ...args }))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
