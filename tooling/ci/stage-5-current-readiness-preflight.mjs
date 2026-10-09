import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";
import activeManifest from "./stage-5-current-candidate.json" with { type: "json" };
import { STAGE5_SECURITY_EXTENSION_BASELINE_PATH } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readinessPath = activeManifest.readinessReceipt;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const command = "corepack pnpm ci:verify";
const gates = [
  ["protected-baseline", "corepack", ["pnpm", "run", "protected-baseline:check"]],
  ["candidate-coherence", "corepack", ["pnpm", "run", "stage5:candidate-coherence:verify"]],
  [
    "stage5-security-extension-pre",
    "corepack",
    ["pnpm", "run", "stage5:security-extension:verify"],
  ],
  [
    "baseline-verification-regression",
    "corepack",
    ["pnpm", "run", "test:stage5-security-extension-baseline"],
  ],
  ["pinned-toolchain", "corepack", ["pnpm", "run", "verify:pins"]],
  ["migration-checksums", "corepack", ["pnpm", "run", "db:migrations:verify"]],
  ["auth-schema", "corepack", ["pnpm", "run", "auth:schema:verify"]],
  ["lifecycle-policy", "corepack", ["pnpm", "run", "test:lifecycle-policy"]],
  ["security-scanner-regressions", "corepack", ["pnpm", "run", "test:security-scanner"]],
  ["architecture", "corepack", ["pnpm", "run", "architecture:check"]],
  ["typecheck", "corepack", ["pnpm", "run", "typecheck"]],
  ["lint", "corepack", ["pnpm", "run", "lint"]],
  ["format", "corepack", ["pnpm", "run", "format:check"]],
  ["focused-tests", "receipt", []],
  [
    "source-scope-pre-index",
    "corepack",
    ["pnpm", "run", "test:stage5-source-scope", "--", "--pre-index"],
  ],
  ["postgresql-qualification", "receipt", []],
  ["git-diff-check", "git", ["diff", "--check"]],
];
const toolchain = () => {
  const corepack = spawnSync("corepack", ["--version"], { cwd: root, encoding: "utf8" });
  const pnpm = spawnSync("corepack", ["pnpm", "--version"], { cwd: root, encoding: "utf8" });
  assert.equal(corepack.status, 0, "Unable to read Corepack version");
  assert.equal(pnpm.status, 0, "Unable to read pnpm version");
  const actual = {
    node: process.version,
    corepack: corepack.stdout.trim(),
    pnpm: pnpm.stdout.trim(),
  };
  assert.deepEqual(actual, { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
  return { ...actual, nodeExecutable: process.execPath };
};
const runGate = ([name, executable, args], workspace) => {
  const result = spawnSync(executable, args, {
    cwd: workspace,
    env: { ...process.env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = Buffer.from(result.stdout ?? "");
  const stderr = Buffer.from(result.stderr ?? "");
  return {
    name,
    command: [executable, ...args].join(" "),
    result: result.status === 0 && !result.error ? "PASS" : "FAIL",
    exitCode: result.status ?? 1,
    outputBytes: stdout.length + stderr.length,
    outputSha256: hash(Buffer.concat([stdout, stderr])),
    error: result.error?.message ?? null,
  };
};
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const verifyQualificationReceipt = async (workspace, manifest, name) => {
  const directory = path.join(workspace, manifest.evidenceDirectory);
  const receiptName =
    name === "focused-tests" ? "focused-test-execution.json" : "postgresql-qualification.json";
  const receiptBytes = await readRegular(path.join(directory, receiptName));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(receipt.candidate, manifest.candidate);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.stage6Actions, 0);
  let logBytes;
  if (name === "focused-tests") {
    logBytes = await readRegular(path.join(directory, "focused-tests.log"));
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.files, 14);
    assert.equal(receipt.tests, 65);
    assert.equal(receipt.combinedLogSha256, hash(logBytes));
    for (const [relativePath, sourceHash] of Object.entries(receipt.sourceHashes)) {
      assert.equal(
        hash(await readRegular(path.join(workspace, relativePath))),
        sourceHash,
        `Focused test input drift: ${relativePath}`,
      );
    }
  } else {
    logBytes = await readRegular(path.join(directory, "postgresql-integration-tests.log"));
    const execution = JSON.parse(
      await readRegular(path.join(directory, "postgresql-qualification-execution.json")),
    );
    const cleanup = JSON.parse(
      await readRegular(path.join(directory, "postgresql-disposable-cleanup.json")),
    );
    assert.equal(execution.candidate, manifest.candidate);
    assert.equal(execution.result, "PASS");
    assert.equal(execution.exitCode, 0);
    assert.equal(execution.integrationTestsPassed, 29);
    assert.equal(execution.integrationLogSha256, hash(logBytes));
    assert.equal(
      execution.packageJsonSha256,
      hash(await readRegular(path.join(workspace, "package.json"))),
    );
    assert.equal(
      execution.integrationTestSha256,
      hash(await readRegular(path.join(workspace, execution.integrationTestPath))),
    );
    assert.equal(
      execution.migrationChecksumsSha256,
      hash(await readRegular(path.join(workspace, "migrations/checksums.json"))),
    );
    assert.equal(cleanup.result, "PASS");
    assert.equal(cleanup.disposableRootAbsent, true);
    assert.equal(cleanup.ct200Actions, 0);
  }
  return {
    name,
    command: `verify indexed ${receiptName} and source-bound execution log`,
    result: "PASS",
    exitCode: 0,
    outputBytes: receiptBytes.length + logBytes.length,
    outputSha256: hash(Buffer.concat([receiptBytes, logBytes])),
    error: null,
  };
};
const writeExclusiveOrMatch = async (file, bytes) => {
  try {
    assert.deepEqual(
      await readRegular(file),
      bytes,
      `Refusing divergent readiness receipt reuse: ${file}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};
const migrationHead = async (workspace) => {
  const manifest = JSON.parse(
    await readFile(path.join(workspace, "migrations/checksums.json"), "utf8"),
  );
  const head = manifest.migrations.at(-1);
  assert(head?.file && /^[a-f0-9]{64}$/u.test(head.sha256));
  return {
    file: head.file,
    sha256: head.sha256,
    manifestSha256: hash(await readFile(path.join(workspace, "migrations/checksums.json"))),
  };
};

export const runStage5CurrentReadinessPreflight = async ({
  candidateRoot = root,
  write = false,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const pins = toolchain();
  const results = [];
  for (const gate of gates) {
    const result =
      gate[1] === "receipt"
        ? await verifyQualificationReceipt(workspace, manifest, gate[0])
        : runGate(gate, workspace);
    results.push(result);
    if (result.result !== "PASS") break;
  }
  const baselineBytes = await readRegular(
    path.join(workspace, STAGE5_SECURITY_EXTENSION_BASELINE_PATH),
  );
  const baselineReceiptPath = path.join(
    workspace,
    manifest.evidenceDirectory,
    "security-extension-baseline-generation.json",
  );
  const baselineReceiptBytes = await readRegular(baselineReceiptPath);
  const report = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    result:
      results.length === gates.length && results.every(({ result }) => result === "PASS")
        ? "PASS"
        : "FAIL",
    ciConsumed: "NO",
    ciVerifyCommand: command,
    gitHead: spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: workspace,
      encoding: "utf8",
    }).stdout.trim(),
    toolchain: pins,
    packageJsonSha256: hash(await readFile(path.join(workspace, "package.json"))),
    candidateManifestSha256: hash(await readFile(path.join(workspace, manifest.paths.manifest))),
    runnerSha256: hash(await readFile(path.join(workspace, manifest.paths.runner))),
    verifierSha256: hash(await readFile(path.join(workspace, manifest.paths.baselineVerifier))),
    baselineSha256: hash(baselineBytes),
    baselineReceiptSha256: hash(baselineReceiptBytes),
    migrationHead: await migrationHead(workspace),
    gateCount: results.length,
    gates: results,
    stage6Actions: manifest.stage6Actions,
  };
  if (report.result !== "PASS") {
    return { ...report, readinessPath, persisted: false };
  }
  if (write) {
    const output = path.join(workspace, readinessPath);
    await mkdir(path.dirname(output), { recursive: true });
    await writeExclusiveOrMatch(output, Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
  }
  return {
    ...report,
    readinessPath,
    readinessSha256: hash(Buffer.from(`${JSON.stringify(report, null, 2)}\n`)),
    persisted: write,
  };
};

export const verifyStage5CurrentReadiness = async ({ candidateRoot = root } = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const bytes = await readRegular(path.join(workspace, readinessPath));
  const report = JSON.parse(bytes.toString("utf8"));
  assert.equal(report.result, "PASS");
  assert.equal(report.candidate, manifest.candidate);
  assert.equal(report.predecessor, manifest.predecessor);
  assert.equal(report.ciConsumed, "NO");
  assert.equal(report.ciVerifyCommand, command);
  assert.equal(report.stage6Actions, manifest.stage6Actions);
  assert.equal(
    report.gitHead,
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).stdout.trim(),
  );
  assert.deepEqual(report.toolchain, toolchain());
  assert.equal(
    report.packageJsonSha256,
    hash(await readFile(path.join(workspace, "package.json"))),
  );
  assert.equal(
    report.candidateManifestSha256,
    hash(await readFile(path.join(workspace, manifest.paths.manifest))),
  );
  assert.equal(
    report.runnerSha256,
    hash(await readFile(path.join(workspace, manifest.paths.runner))),
  );
  assert.equal(
    report.verifierSha256,
    hash(await readFile(path.join(workspace, manifest.paths.baselineVerifier))),
  );
  assert.equal(
    report.baselineSha256,
    hash(await readRegular(path.join(workspace, STAGE5_SECURITY_EXTENSION_BASELINE_PATH))),
  );
  assert.equal(
    report.baselineReceiptSha256,
    hash(
      await readRegular(
        path.join(
          workspace,
          manifest.evidenceDirectory,
          "security-extension-baseline-generation.json",
        ),
      ),
    ),
  );
  assert.deepEqual(report.migrationHead, await migrationHead(workspace));
  assert.equal(report.gateCount, gates.length);
  assert(report.gates.every(({ result }) => result === "PASS"));
  return {
    result: "PASS",
    candidate: manifest.candidate,
    readinessSha256: hash(bytes),
    readinessPath,
    report,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runStage5CurrentReadinessPreflight({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.result !== "PASS") process.exitCode = 1;
}
