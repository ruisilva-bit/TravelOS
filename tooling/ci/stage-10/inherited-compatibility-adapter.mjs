import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyInputs } from "./candidate.mjs";
import { verifyInheritedBaseline } from "./predecessor-baseline-adapter.mjs";
import { buildPaths } from "./build-artifact.mjs";
import { inspectClaim } from "./one-shot.mjs";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";
import { qualifyPackagedMigrator } from "./packaged-migrator-regression.mjs";
import { runStage8ArtifactRegression } from "./stage8-artifact-regression.mjs";
import { verifyCurrentSourceScope } from "./source-scope.mjs";
import { verifySuccessorBaseline, verifyAcceptedStage6Baseline } from "./successor-baseline.mjs";
import { runStage6FixtureRegression } from "./stage6-fixture-regression.mjs";
import { runBaselineInverseRegression } from "./baseline-inverse-regression.mjs";
import { runStage7ContractRegression } from "./stage7-contract-regression.mjs";
import { verifyStage9ContractReference } from "./stage9-contract-regression.mjs";
import { runStage6ContractRegression } from "./stage6-contract-regression.mjs";
import { runStage7ArtifactRegression } from "./stage7-artifact-regression.mjs";
import { runStage9ArtifactRegression } from "./stage9-artifact-regression.mjs";
import { MIGRATION_HEAD, PREDECESSOR, STATE } from "./constants.mjs";
import {
  digest,
  jsonBytes,
  parseCandidate,
  privateDirectory,
  regularBytes,
  sha256,
} from "./io.mjs";

// A preflight, not a replacement for any historical assertion. The dispatch
// deliberately fails until each label's remaining assertions are implemented.
export const UNRESOLVED = Object.freeze({});
export const isStage6ContractGate = (gate) =>
  ["stage6-contract", "stage6-contract-tests"].includes(gate);

export function validateMigrationManifests(current, accepted) {
  for (const manifest of [current, accepted]) {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.algorithm, "sha256");
    assert.ok(Array.isArray(manifest.migrations));
    assert.equal(manifest.migrations.length, 16, "Expected complete accepted 16-migration chain");
    const seen = new Set();
    manifest.migrations.forEach((row, i) => {
      assert.deepEqual(Object.keys(row).sort(), ["file", "sha256"]);
      assert.match(
        row.file,
        new RegExp(`^${String(i + 1).padStart(4, "0")}_[a-z0-9_]+\\.cjs$`, "u"),
      );
      assert.match(row.sha256, /^[a-f0-9]{64}$/u);
      assert.ok(!seen.has(row.file));
      seen.add(row.file);
    });
    assert.equal(manifest.migrations.at(-1).file, `${MIGRATION_HEAD}.cjs`);
  }
  assert.deepEqual(current, accepted, "Migration chain differs from accepted predecessor");
}

export async function verifyMigrationChain(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(
    git("rev-parse", `${PREDECESSOR.tag}^{commit}`).toString().trim(),
    PREDECESSOR.commit,
  );
  const accepted = JSON.parse(git("show", `${PREDECESSOR.commit}:migrations/checksums.json`));
  const current = JSON.parse(await regularBytes(path.join(root, "migrations/checksums.json")));
  validateMigrationManifests(current, accepted);
  const files = (await readdir(path.join(root, "migrations")))
    .filter((name) => /^\d{4}_.*\.cjs$/u.test(name))
    .sort();
  assert.deepEqual(
    files,
    current.migrations.map((row) => row.file),
    "Migration file set mismatch",
  );
  for (const row of current.migrations) {
    const bytes = await regularBytes(path.join(root, "migrations", row.file));
    assert.equal(sha256(bytes), row.sha256, `Migration checksum mismatch: ${row.file}`);
    assert.deepEqual(
      bytes,
      git("show", `${PREDECESSOR.commit}:migrations/${row.file}`),
      `Predecessor migration changed: ${row.file}`,
    );
  }
  return { count: files.length, head: MIGRATION_HEAD, predecessor: PREDECESSOR.commit };
}

export async function runInheritedCompatibility({ root, candidate, gate }) {
  const contractGate = ["stage7-contract", "stage7-contract-tests"].includes(gate);
  const baselineGate = [
    "stage6-baseline",
    "stage6-baseline-tests",
    "stage7-baseline",
    "stage7-predecessor",
    "stage7-baseline-tests",
  ].includes(gate);
  assert.ok(
    gate === "stage9-artifact" ||
      gate === "stage7-artifact" ||
      isStage6ContractGate(gate) ||
      gate === "stage9-contract" ||
      contractGate ||
      baselineGate ||
      gate === "stage6-migrator" ||
      gate === "stage6-bootstrap" ||
      gate === "stage7-migrator" ||
      gate === "stage8-artifact" ||
      gate === "stage7-source-scope" ||
      Object.hasOwn(UNRESOLVED, gate),
    "Unknown inherited compatibility label",
  );
  parseCandidate(candidate);
  root = path.resolve(root);
  const archive = path.join(root, ".hermes/state/stage9-gen11-artifact.tar.gz");
  const inputs = await verifyInputs({ root, candidate, predecessorArchive: archive });
  await verifyInheritedBaseline(root);
  await verifyMigrationChain(root);
  const paths = buildPaths(root, candidate);
  const receiptBytes = await regularBytes(paths.receipt);
  const receipt = JSON.parse(receiptBytes);
  assert.deepEqual(receiptBytes, jsonBytes(receipt), "Noncanonical build receipt");
  const checksBytes = await regularBytes(paths.qualification);
  const checks = JSON.parse(checksBytes);
  const claim = await inspectClaim(paths.ledger, inputs.inputDigest);
  assert.equal(claim.state, "PASSED_CONSUMED");
  assert.equal(claim.claim.record.operation, "PRODUCTION_BUILD_ONCE");
  assert.equal(claim.claim.record.candidate, candidate);
  assert.equal(claim.outcome.receipt.buildReceiptSha256, digest(receipt));
  assert.equal(claim.outcome.receipt.packageChecksSha256, sha256(checksBytes));
  assert.equal(checks.result, "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED");
  assert.equal(sha256(await regularBytes(process.execPath)), inputs.runtimeNodeSha256);
  await qualifyExtractedArtifact({
    payload: paths.extracted,
    archive: paths.archive,
    receipt,
    expectedReceiptSha256: claim.outcome.receipt.buildReceiptSha256,
    inputs,
    expectedNodeSha256: inputs.runtimeNodeSha256,
  });
  const result = await (async () => {
    if (["stage6-migrator", "stage6-bootstrap", "stage7-migrator"].includes(gate)) {
      const expectedManifest = JSON.parse(
        await regularBytes(path.join(root, "migrations/checksums.json")),
      );
      const result = await qualifyPackagedMigrator({ payload: paths.extracted, expectedManifest });
      if (gate === "stage6-bootstrap") {
        const parent = path.join(root, STATE, "ci-evidence", candidate);
        await privateDirectory(parent);
        result.historicalFixtures = await runStage6FixtureRegression({
          root,
          gate,
          outputDirectory: path.join(parent, gate),
        });
      }
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during migrator regression",
      );
      return {
        ...result,
        candidate,
        gate,
        scope: "CANDIDATE_BOUND_PACKAGED_MIGRATOR_NOT_CANONICAL_CI",
      };
    }
    if (gate === "stage8-artifact") {
      const result = await runStage8ArtifactRegression({
        root,
        payload: paths.extracted,
        archive: paths.archive,
        receipt,
        expectedReceiptSha256: claim.outcome.receipt.buildReceiptSha256,
        inputs,
        expectedNodeSha256: inputs.runtimeNodeSha256,
      });
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during artifact regression",
      );
      return {
        ...result,
        candidate,
        gate,
        scope: "CANDIDATE_BOUND_STAGE8_SUCCESSOR_REGRESSION_NOT_CANONICAL_CI",
      };
    }
    if (gate === "stage7-source-scope") {
      const report = await verifyCurrentSourceScope({ root, source: inputs.source });
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during source-scope verification",
      );
      return {
        ...report,
        candidate,
        gate,
        scope: "CANDIDATE_BOUND_SUCCESSOR_SOURCE_SCOPE_NOT_CANONICAL_CI_OR_PRIVACY_ACCEPTANCE",
      };
    }
    if (baselineGate) {
      const report = await verifySuccessorBaseline({ root, source: inputs.source });
      if (gate.startsWith("stage6-"))
        report.acceptedStage6History = await verifyAcceptedStage6Baseline({ root });
      if (gate === "stage6-baseline-tests") {
        const parent = path.join(root, STATE, "ci-evidence", candidate);
        await privateDirectory(parent);
        report.historicalFixtures = await runStage6FixtureRegression({
          root,
          gate,
          outputDirectory: path.join(parent, gate),
        });
      }
      if (gate === "stage7-baseline-tests") {
        const parent = path.join(root, STATE, "ci-evidence", candidate);
        await privateDirectory(parent);
        report.inverseRegression = await runBaselineInverseRegression({
          root,
          outputDirectory: path.join(parent, "successor-baseline-inverses"),
        });
      }
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during successor baseline verification",
      );
      return { ...report, candidate, gate };
    }
    if (contractGate) {
      const result = await runStage7ContractRegression({
        root,
        payload: paths.extracted,
        archive: paths.archive,
        receipt,
        expectedReceiptSha256: claim.outcome.receipt.buildReceiptSha256,
        inputs,
        expectedNodeSha256: inputs.runtimeNodeSha256,
      });
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during contract regression",
      );
      return {
        ...result,
        candidate,
        gate,
        scope:
          "CANDIDATE_BOUND_STAGE7_CONTRACT_PREFIX_AND_CURRENT_STAGE10_ARTIFACT_NOT_CANONICAL_CI",
      };
    }
    if (gate === "stage9-contract") {
      const result = await verifyStage9ContractReference({ root });
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during Stage 9 contract regression",
      );
      return { ...result, candidate, gate };
    }
    if (isStage6ContractGate(gate)) {
      const parent = path.join(root, STATE, "ci-evidence", candidate);
      await privateDirectory(parent);
      const result = await runStage6ContractRegression({
        root,
        payload: paths.extracted,
        archive: paths.archive,
        receipt,
        expectedReceiptSha256: claim.outcome.receipt.buildReceiptSha256,
        inputs,
        expectedNodeSha256: inputs.runtimeNodeSha256,
        outputDirectory: path.join(parent, "stage6-contract-reference"),
      });
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during Stage 6 contract regression",
      );
      return { ...result, candidate, gate };
    }
    if (gate === "stage7-artifact") {
      const result = await runStage7ArtifactRegression({
        root,
        payload: paths.extracted,
        archive: paths.archive,
        receipt,
        expectedReceiptSha256: claim.outcome.receipt.buildReceiptSha256,
        inputs,
        expectedNodeSha256: inputs.runtimeNodeSha256,
      });
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during Stage 7 artifact regression",
      );
      return { ...result, candidate, gate };
    }
    if (gate === "stage9-artifact") {
      const result = await runStage9ArtifactRegression({
        root,
        payload: paths.extracted,
        archive: paths.archive,
        receipt,
        expectedReceiptSha256: claim.outcome.receipt.buildReceiptSha256,
        inputs,
        expectedNodeSha256: inputs.runtimeNodeSha256,
      });
      assert.deepEqual(
        await verifyInputs({ root, candidate, predecessorArchive: archive }),
        inputs,
        "Candidate drift during Stage 9 artifact regression",
      );
      return { ...result, candidate, gate };
    }
    // No unmatched label may turn into a passing gate.
    throw new Error(`UNRESOLVED ${gate}: ${UNRESOLVED[gate]}`);
  })();
  // All inherited routes rebind the exact archive/tree after work, then check
  // source last: package probes must not hide input mutation either.
  await qualifyExtractedArtifact({
    payload: paths.extracted,
    archive: paths.archive,
    receipt,
    expectedReceiptSha256: claim.outcome.receipt.buildReceiptSha256,
    inputs,
    expectedNodeSha256: inputs.runtimeNodeSha256,
  });
  assert.deepEqual(
    await verifyInputs({ root, candidate, predecessorArchive: archive }),
    inputs,
    "Inputs changed during inherited gate",
  );
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.equal(process.argv.length, 4, "Require --candidate=genNN --gate=LABEL");
    const c = /^--candidate=(.+)$/u.exec(process.argv[2]);
    const g = /^--gate=(.+)$/u.exec(process.argv[3]);
    assert.ok(c && g, "Invalid arguments");
    const result = await runInheritedCompatibility({
      root: process.cwd(),
      candidate: c[1],
      gate: g[1],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
