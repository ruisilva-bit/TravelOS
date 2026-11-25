import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { corepackInvocation } from "./candidate.mjs";
import { deploymentContract } from "./deployment-contract.mjs";
import { verifyInheritedBaseline } from "./predecessor-baseline-adapter.mjs";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";

const stage7 = "a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec";
const stage9 = "f65a64d9c3aabd446ca95a605faed92630a72963";
const gitBytes = (root, commit, file) =>
  execFileSync("git", ["show", `${commit}:${file}`], {
    cwd: root,
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });

export async function historicalPrefix(root, currentBytes) {
  const manifest = JSON.parse(currentBytes);
  assert.equal(manifest.migrations.length, 16, "Current migration chain must have 16 entries");
  const prefix = Buffer.from(
    `${JSON.stringify({ schemaVersion: manifest.schemaVersion, algorithm: manifest.algorithm, migrations: manifest.migrations.slice(0, 13) }, null, 2)}\n`,
  );
  assert.deepEqual(
    prefix,
    gitBytes(root, stage7, "migrations/checksums.json"),
    "Historical migration prefix differs from accepted Stage 7 bytes",
  );
  return prefix;
}

// Trusted composition only; bindings are supplied by the caller, never a CLI.
export async function runStage7ContractRegression({
  root,
  payload,
  archive,
  receipt,
  expectedReceiptSha256,
  inputs,
  expectedNodeSha256,
}) {
  root = path.resolve(root);
  const invocation = corepackInvocation();
  await qualifyExtractedArtifact({
    payload,
    archive,
    receipt,
    expectedReceiptSha256,
    inputs,
    expectedNodeSha256,
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(payload, "deployment/stage10-contract.json"), "utf8")),
    deploymentContract(),
  );
  await verifyInheritedBaseline(root);
  const current = await readFile(path.join(root, "migrations/checksums.json"));
  assert.deepEqual(
    current,
    gitBytes(root, stage9, "migrations/checksums.json"),
    "Current migration manifest differs from accepted Stage 9",
  );
  assert.deepEqual(
    current,
    await readFile(path.join(payload, "migrations/checksums.json")),
    "Artifact migration manifest differs from current source",
  );
  const prefix = await historicalPrefix(root, current);
  const relative = "tooling/ci/stage-7/test-deployment-contract.mjs";
  const sourcePath = path.join(root, relative);
  const source = await readFile(sourcePath);
  assert.deepEqual(
    source,
    gitBytes(root, stage9, relative),
    "Historical test differs from accepted Stage 9",
  );
  let generated = source.toString("utf8");
  assert.equal(generated.split("\n").length - 1, 359, "Historical test line count mismatch");
  const replaceOnce = (old, replacement) => {
    assert.equal(generated.split(old).length, 2, `Historical source anchor mismatch: ${old}`);
    generated = generated.replace(old, replacement);
  };
  replaceOnce(
    "const successorChecksumManifestBytes = checksumManifestBytes;",
    `const successorChecksumManifestBytes = Buffer.from(${JSON.stringify(prefix.toString("base64"))}, "base64");`,
  );
  replaceOnce(
    '"../stage-7-successor-baseline.mjs"',
    JSON.stringify(
      pathToFileURL(path.join(root, "tooling/ci/stage-7-successor-baseline.mjs")).href,
    ),
  );
  replaceOnce(
    '"./verify-deployment-contract.mjs"',
    JSON.stringify(
      pathToFileURL(path.join(root, "tooling/ci/stage-7/verify-deployment-contract.mjs")).href,
    ),
  );
  const metaCount = (generated.match(/import\.meta\.url/g) || []).length;
  assert.equal(metaCount, 8, "Historical import.meta.url count mismatch");
  generated = generated.replaceAll(
    "import.meta.url",
    JSON.stringify(pathToFileURL(sourcePath).href),
  );
  const temporary = await mkdtemp(path.join(os.tmpdir(), "stage10-stage7-contract-"));
  try {
    const entry = path.join(temporary, "test.mjs");
    await writeFile(entry, generated, { mode: 0o600 });
    const env = {
      PATH: invocation.path,
      HOME: process.env.HOME,
      TMPDIR: os.tmpdir(),
      LANG: "C.UTF-8",
    };
    const child = spawnSync(invocation.command, [entry], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const evidence = `status=${child.status} signal=${child.signal} error=${child.error?.message ?? "none"}\nstdout:\n${child.stdout ?? ""}\nstderr:\n${child.stderr ?? ""}`;
    assert.equal(child.error, undefined, evidence);
    assert.equal(child.status, 0, evidence);
    const report = JSON.parse(child.stdout);
    assert.deepEqual(
      report,
      { result: "PASS", cases: 12, positiveCases: 3, negativeControls: 9 },
      evidence,
    );
    return {
      result: "PASS",
      report,
      scope: "QUALIFIED_ARTIFACT_AND_HISTORICAL_REFERENCE_NOT_CANONICAL_CI",
      stdout: child.stdout,
      stderr: child.stderr,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
