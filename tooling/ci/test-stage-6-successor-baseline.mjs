import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL, pathToFileURL } from "node:url";
import {
  PHASE0_BASELINE_SHA256,
  STAGE5_AGGREGATE_SHA256,
  STAGE5_BASELINE_PATH,
  STAGE5_BASELINE_SHA256,
  STAGE5_PROTECTED_FILE_COUNT,
  STAGE6_BASELINE_PATH,
  STAGE6_BASE_COMMIT,
  STAGE6_BASE_TAG,
  STAGE6_EXTENSION,
  STAGE6_EXTENSION_PATH,
  validateStage6SuccessorManifest,
} from "./stage-6-successor-baseline.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const aggregate = (rows) =>
  sha256(rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join(""));
const extensionText = Buffer.from(
  "trip.preview trip.publish PortalTripSnapshotV1 0011_stage6_trip_publication.cjs migration-runner.js Stage 7 actions = 0\n",
);
const sourceText = Buffer.from("export const synthetic = true;\n");
const predecessor = {
  tag: STAGE6_BASE_TAG,
  commit: STAGE6_BASE_COMMIT,
  phase0BaselineSha256: PHASE0_BASELINE_SHA256,
  stage5BaselinePath: STAGE5_BASELINE_PATH,
  stage5BaselineSha256: STAGE5_BASELINE_SHA256,
  stage5ProtectedFileCount: STAGE5_PROTECTED_FILE_COUNT,
  stage5AggregateSha256: STAGE5_AGGREGATE_SHA256,
  stage6Actions: 0,
};
const makeFixture = () => {
  const bytesByPath = new Map([
    [STAGE6_EXTENSION_PATH, extensionText],
    ["src/synthetic.ts", sourceText],
  ]);
  const sourceFiles = [...bytesByPath.entries()]
    .map(([file, bytes]) => ({ path: file, bytes: bytes.length, sha256: sha256(bytes) }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const manifest = {
    schemaVersion: 1,
    baselineId: "phase-1-m1-stage-6-preview-publish-v1",
    stage: "PHASE_1_M1_STAGE_6",
    stage6Actions: 1,
    stage7Actions: 0,
    predecessor,
    extension: STAGE6_EXTENSION,
    extensionDocument: { path: STAGE6_EXTENSION_PATH, sha256: sha256(extensionText) },
    sourceFiles,
    sourceAggregateSha256: aggregate(sourceFiles),
  };
  return { manifest, bytesByPath };
};
const readFor = (bytesByPath) => async (file) => {
  const bytes = bytesByPath.get(file);
  assert.ok(bytes, `Unexpected fixture path: ${file}`);
  return bytes;
};

const valid = makeFixture();
assert.equal(
  (await validateStage6SuccessorManifest({ ...valid, readBytes: readFor(valid.bytesByPath) }))
    .sourceCount,
  2,
);

const wrongPredecessor = makeFixture();
wrongPredecessor.manifest.predecessor = { ...predecessor, commit: "0".repeat(40) };
await assert.rejects(
  validateStage6SuccessorManifest({
    ...wrongPredecessor,
    readBytes: readFor(wrongPredecessor.bytesByPath),
  }),
  /predecessor lineage/,
);

const changedExtension = makeFixture();
changedExtension.bytesByPath.set(STAGE6_EXTENSION_PATH, Buffer.from("altered extension\n"));
await assert.rejects(
  validateStage6SuccessorManifest({
    ...changedExtension,
    readBytes: readFor(changedExtension.bytesByPath),
  }),
  /extension document hash mismatch/,
);

const changedSource = makeFixture();
changedSource.bytesByPath.set("src/synthetic.ts", Buffer.from("changed source\n"));
await assert.rejects(
  validateStage6SuccessorManifest({
    ...changedSource,
    readBytes: readFor(changedSource.bytesByPath),
  }),
  /source byte count mismatch|source hash mismatch/,
);

const stage7Leak = makeFixture();
stage7Leak.manifest.stage7Actions = 1;
await assert.rejects(
  validateStage6SuccessorManifest({ ...stage7Leak, readBytes: readFor(stage7Leak.bytesByPath) }),
  /Stage 7 actions/,
);

const alteredAggregate = makeFixture();
alteredAggregate.manifest.sourceAggregateSha256 = "0".repeat(64);
await assert.rejects(
  validateStage6SuccessorManifest({
    ...alteredAggregate,
    readBytes: readFor(alteredAggregate.bytesByPath),
  }),
  /source aggregate mismatch/,
);

const duplicatePath = makeFixture();
duplicatePath.manifest.sourceFiles.push({ ...duplicatePath.manifest.sourceFiles[0] });
duplicatePath.manifest.sourceFiles.sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
);
await assert.rejects(
  validateStage6SuccessorManifest({
    ...duplicatePath,
    readBytes: readFor(duplicatePath.bytesByPath),
  }),
  /Duplicate Stage 6 source manifest path/,
);

const tamperedManifest = makeFixture();
tamperedManifest.manifest.sourceFiles[0].sha256 = "0".repeat(64);
await assert.rejects(
  validateStage6SuccessorManifest({
    ...tamperedManifest,
    readBytes: readFor(tamperedManifest.bytesByPath),
  }),
  /source aggregate mismatch/,
);

const repositoryRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const predecessorWorktree = await mkdtemp(
  path.join(process.env.TMPDIR || os.tmpdir(), "travelos-stage6-negative-"),
);
let predecessorWorktreeAdded = false;
try {
  const add = spawnSync(
    "git",
    ["worktree", "add", "--detach", predecessorWorktree, STAGE6_BASE_COMMIT],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(
    add.status,
    0,
    `Could not create protected-predecessor negative-control worktree: ${add.stderr}`,
  );
  predecessorWorktreeAdded = true;
  const statePath = path.join(repositoryRoot, ".hermes", "state");
  const stateStat = await lstat(statePath);
  assert.ok(stateStat.isDirectory() && !stateStat.isSymbolicLink());
  await mkdir(path.join(predecessorWorktree, ".hermes"), { recursive: true });
  await symlink(statePath, path.join(predecessorWorktree, ".hermes", "state"), "dir");
  const permissionsPath = path.join(predecessorWorktree, "docs/PERMISSIONS.md");
  const protectedBytes = await readFile(permissionsPath);
  await writeFile(
    permissionsPath,
    Buffer.concat([protectedBytes, Buffer.from("\n<!-- synthetic mutation probe -->\n")]),
  );
  const predecessorVerifierUrl = pathToFileURL(
    path.join(
      predecessorWorktree,
      "tooling/ci/verify-stage-5-current-security-extension-baseline.mjs",
    ),
  );
  const { verifyStage5CurrentSecurityExtensionBaseline } = await import(
    predecessorVerifierUrl.href
  );
  await assert.rejects(
    verifyStage5CurrentSecurityExtensionBaseline({ candidateRoot: predecessorWorktree }),
    /hash|mismatch|baseline/i,
  );
} finally {
  if (predecessorWorktreeAdded) {
    const remove = spawnSync("git", ["worktree", "remove", "--force", predecessorWorktree], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(
      remove.status,
      0,
      `Could not clean protected-predecessor negative-control worktree: ${remove.stderr}`,
    );
  }
}

process.stdout.write(
  `${JSON.stringify({ result: "PASS", assertions: 9, negativeControls: 8, baselinePath: STAGE6_BASELINE_PATH })}\n`,
);
