import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STAGE6_BASE_COMMIT = "8dd62157d14e88400a9df1e97452a3807f3ed50e";
export const STAGE6_BASE_TAG = "phase-1-stage-5-go";
export const STAGE6_BASELINE_PATH = "docs/reviews/phase-1-m1/STAGE_6_SUCCESSOR_BASELINE.json";
export const STAGE6_EXTENSION_PATH = "docs/implementation/M1_STAGE_6_SECURITY_EXTENSION.md";
export const STAGE5_BASELINE_PATH =
  "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json";
export const PHASE0_BASELINE_SHA256 =
  "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb";
export const STAGE5_BASELINE_SHA256 =
  "ff41985b197738faa9585af2b4686612d420a9c118801a801c8d38087f1d29b6";
export const STAGE5_AGGREGATE_SHA256 =
  "decc422c49ab17d44e700331b95ac3fdf0bee8d6058b244682ecdc6ab8940255";
export const STAGE5_PROTECTED_FILE_COUNT = 38;
export const STAGE6_EXTENSION = Object.freeze({
  permissionIds: ["trip.preview", "trip.publish"],
  permissionRegistryVersion: 4,
  portalAccessGranted: false,
  snapshotSchema: "PortalTripSnapshotV1",
  snapshotSchemaVersion: "v1",
  sharedPreviewPublishAssembler: true,
  internalOnlyCanBeExposed: false,
  portalApiBehaviorAdded: false,
  stage7Actions: 0,
  migration: "0011_stage6_trip_publication.cjs",
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const safePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  path.posix.normalize(value) === value &&
  !value.split("/").includes("..") &&
  !value.split("/").includes(".");
const aggregateRows = (rows) =>
  sha256(
    rows.map(({ path: file, bytes, sha256: digest }) => `${file}\t${bytes}\t${digest}\n`).join(""),
  );
const outputPath = (file) =>
  file === STAGE6_BASELINE_PATH ||
  file.startsWith("docs/evidence/phase-1-m1/stage-6/") ||
  file.startsWith("docs/reviews/phase-1-m1/stage-6/");
const stage7Path = (file) =>
  file.startsWith("apps/portal-api/") ||
  file.startsWith("packages/backend-core/src/modules/portal-access/") ||
  (file.startsWith("migrations/") && /portal[_-]?(?:access|grant|document)/i.test(file));
const historicalStage5Evidence = (file) =>
  file.startsWith("docs/evidence/phase-1-m1/stage-5-") ||
  file.startsWith("docs/reviews/phase-1-m1/STAGE_5_") ||
  file === "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md";

export const validateStage6SuccessorManifest = async ({ manifest, readBytes }) => {
  assert.deepEqual(
    Object.keys(manifest ?? {}).sort(),
    [
      "baselineId",
      "extension",
      "extensionDocument",
      "predecessor",
      "schemaVersion",
      "sourceAggregateSha256",
      "sourceFiles",
      "stage",
      "stage6Actions",
      "stage7Actions",
    ].sort(),
    "Stage 6 successor baseline has unexpected or missing fields",
  );
  assert.equal(manifest?.schemaVersion, 1, "Unsupported Stage 6 successor baseline schema");
  assert.equal(manifest?.baselineId, "phase-1-m1-stage-6-preview-publish-v1");
  assert.equal(manifest?.stage, "PHASE_1_M1_STAGE_6");
  assert.equal(manifest?.stage6Actions, 1);
  assert.equal(manifest?.stage7Actions, 0, "Stage 7 actions must remain zero");
  assert.deepEqual(manifest?.extension, STAGE6_EXTENSION, "Unexpected Stage 6 semantic delta");
  assert.deepEqual(Object.keys(manifest.extensionDocument ?? {}).sort(), ["path", "sha256"]);
  assert.deepEqual(
    manifest?.predecessor,
    {
      tag: STAGE6_BASE_TAG,
      commit: STAGE6_BASE_COMMIT,
      phase0BaselineSha256: PHASE0_BASELINE_SHA256,
      stage5BaselinePath: STAGE5_BASELINE_PATH,
      stage5BaselineSha256: STAGE5_BASELINE_SHA256,
      stage5ProtectedFileCount: STAGE5_PROTECTED_FILE_COUNT,
      stage5AggregateSha256: STAGE5_AGGREGATE_SHA256,
      stage6Actions: 0,
    },
    "Stage 6 predecessor lineage differs from the verified Stage 5 GO baseline",
  );

  const extensionPath = manifest?.extensionDocument?.path;
  assert.equal(extensionPath, STAGE6_EXTENSION_PATH);
  assert.match(manifest.extensionDocument.sha256, /^[a-f0-9]{64}$/);
  const extensionBytes = await readBytes(extensionPath);
  assert.equal(
    sha256(extensionBytes),
    manifest.extensionDocument.sha256,
    "Stage 6 extension document hash mismatch",
  );
  const extensionText = extensionBytes.toString("utf8");
  for (const marker of [
    "trip.preview",
    "trip.publish",
    "PortalTripSnapshotV1",
    "0011_stage6_trip_publication.cjs",
    "Stage 7 actions = 0",
  ]) {
    assert.ok(
      extensionText.includes(marker),
      `Stage 6 extension document is missing marker: ${marker}`,
    );
  }

  assert.ok(Array.isArray(manifest.sourceFiles) && manifest.sourceFiles.length > 0);
  const paths = manifest.sourceFiles.map((row) => row.path);
  assert.equal(new Set(paths).size, paths.length, "Duplicate Stage 6 source manifest path");
  assert.deepEqual(
    paths,
    [...paths].sort(bytewise),
    "Stage 6 source manifest paths are not bytewise ordered",
  );
  for (const row of manifest.sourceFiles) {
    assert.deepEqual(Object.keys(row).sort(), ["bytes", "path", "sha256"]);
    assert.ok(safePath(row.path), `Unsafe Stage 6 manifest path: ${row.path}`);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0, `Invalid byte count: ${row.path}`);
    assert.match(row.sha256, /^[a-f0-9]{64}$/, `Invalid SHA-256: ${row.path}`);
    assert.ok(
      !outputPath(row.path),
      `Generated evidence cannot be a frozen source row: ${row.path}`,
    );
  }
  assert.equal(
    manifest.sourceAggregateSha256,
    aggregateRows(manifest.sourceFiles),
    "Stage 6 source aggregate mismatch",
  );
  for (const row of manifest.sourceFiles) {
    const bytes = await readBytes(row.path);
    assert.equal(bytes.length, row.bytes, `Stage 6 source byte count mismatch: ${row.path}`);
    assert.equal(sha256(bytes), row.sha256, `Stage 6 source hash mismatch: ${row.path}`);
  }
  assert.ok(
    paths.includes(STAGE6_EXTENSION_PATH),
    "Stage 6 extension document is outside the source manifest",
  );
  return { sourceCount: paths.length, sourceAggregateSha256: manifest.sourceAggregateSha256 };
};

const git = (root, args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
const readRegular = async (root, relativePath) => {
  assert.ok(safePath(relativePath), `Unsafe candidate path: ${relativePath}`);
  const file = path.join(root, ...relativePath.split("/"));
  const metadata = await lstat(file);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `Candidate input must be a regular file: ${relativePath}`,
  );
  return readFile(file);
};

const verifyStage5Predecessor = async (root) => {
  const tagCommit = git(root, ["rev-parse", `${STAGE6_BASE_TAG}^{}`]);
  assert.equal(
    tagCommit,
    STAGE6_BASE_COMMIT,
    "Stage 5 GO tag no longer targets the accepted commit",
  );
  assert.equal(git(root, ["rev-parse", STAGE6_BASE_COMMIT]), STAGE6_BASE_COMMIT);

  const tempRoot = await mkdtemp(
    path.join(process.env.TMPDIR || os.tmpdir(), "travelos-stage6-stage5-"),
  );
  let worktreeAdded = false;
  try {
    const add = spawnSync("git", ["worktree", "add", "--detach", tempRoot, STAGE6_BASE_COMMIT], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(
      add.status,
      0,
      `Could not create exact Stage 5 predecessor worktree: ${add.stderr || add.stdout}`,
    );
    worktreeAdded = true;
    const statePath = path.join(root, ".hermes", "state");
    const stateStat = await lstat(statePath);
    assert.ok(
      stateStat.isDirectory() && !stateStat.isSymbolicLink(),
      "Verified local predecessor receipts are unavailable",
    );
    await mkdir(path.join(tempRoot, ".hermes"), { recursive: true });
    await symlink(statePath, path.join(tempRoot, ".hermes", "state"), "dir");
    const moduleUrl = pathToFileURL(
      path.join(tempRoot, "tooling/ci/verify-stage-5-current-security-extension-baseline.mjs"),
    );
    const { verifyStage5CurrentSecurityExtensionBaseline } = await import(moduleUrl.href);
    const result = await verifyStage5CurrentSecurityExtensionBaseline({ candidateRoot: tempRoot });
    assert.equal(result.result, "PASS");
    assert.equal(result.phase0.manifest.sha256, PHASE0_BASELINE_SHA256);
    assert.equal(result.phase1.baselineSha256, STAGE5_BASELINE_SHA256);
    assert.equal(result.phase1.protectedFileCount, STAGE5_PROTECTED_FILE_COUNT);
    assert.equal(result.phase1.aggregateSha256, STAGE5_AGGREGATE_SHA256);
    assert.equal(result.phase1.extension.stage6Actions, 0);
    return {
      result: "PASS",
      tag: STAGE6_BASE_TAG,
      commit: STAGE6_BASE_COMMIT,
      phase0BaselineSha256: result.phase0.manifest.sha256,
      stage5BaselineSha256: result.phase1.baselineSha256,
      stage5ProtectedFileCount: result.phase1.protectedFileCount,
      stage5AggregateSha256: result.phase1.aggregateSha256,
      stage6Actions: result.phase1.extension.stage6Actions,
    };
  } finally {
    if (worktreeAdded) {
      const remove = spawnSync("git", ["worktree", "remove", "--force", tempRoot], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(
        remove.status,
        0,
        `Could not clean Stage 5 verification worktree: ${remove.stderr || remove.stdout}`,
      );
    }
  }
};

export const verifyStage6SuccessorBaseline = async ({ root = process.cwd() } = {}) => {
  const workspace = path.resolve(root);
  const currentBranch = git(workspace, ["branch", "--show-current"]);
  assert.ok(
    ["phase-1/stage-6", "phase-1/stage-6-closed"].includes(currentBranch),
    `Unexpected Stage 6 branch: ${currentBranch}`,
  );
  const head = git(workspace, ["rev-parse", "HEAD"]);
  git(workspace, ["merge-base", "--is-ancestor", STAGE6_BASE_COMMIT, head]);
  const status = git(workspace, ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .filter(
      (line) => !line.slice(3).startsWith(".hermes/state/") && line.slice(3) !== ".hermes/state",
    );
  assert.deepEqual(
    status,
    [],
    "Stage 6 candidate worktree must be clean outside local .hermes/state receipts",
  );

  const changed = git(workspace, ["diff", "--name-only", `${STAGE6_BASE_COMMIT}..HEAD`])
    .split("\n")
    .filter(Boolean)
    .sort(bytewise);
  assert.ok(
    !changed.some(historicalStage5Evidence),
    "Stage 6 candidate rewrites immutable Stage 5 evidence",
  );
  assert.ok(
    !changed.some(stage7Path),
    "Stage 6 candidate includes Stage 7 Portal behavior or grants",
  );
  const manifestBytes = await readRegular(workspace, STAGE6_BASELINE_PATH);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const verified = await validateStage6SuccessorManifest({
    manifest,
    readBytes: (relativePath) => readRegular(workspace, relativePath),
  });
  const expectedDelta = changed.filter(
    (file) => !outputPath(file) && file !== STAGE6_BASELINE_PATH,
  );
  assert.deepEqual(
    expectedDelta,
    manifest.sourceFiles.map((row) => row.path),
    "Stage 6 successor source manifest does not enumerate the exact implementation delta",
  );
  const predecessor = await verifyStage5Predecessor(workspace);
  return {
    schemaVersion: 1,
    result: "PASS",
    branch: currentBranch,
    sourceCommit: head,
    stage6BaselinePath: STAGE6_BASELINE_PATH,
    stage6BaselineSha256: sha256(manifestBytes),
    sourceCount: verified.sourceCount,
    sourceAggregateSha256: verified.sourceAggregateSha256,
    predecessor,
    stage6Actions: 1,
    stage7Actions: 0,
  };
};

export const collectStage6SourceRows = async ({ root = process.cwd() } = {}) => {
  const workspace = path.resolve(root);
  const changed = git(workspace, ["diff", "--name-only", `${STAGE6_BASE_COMMIT}..HEAD`])
    .split("\n")
    .filter(Boolean)
    .sort(bytewise);
  assert.ok(
    changed.includes(STAGE6_EXTENSION_PATH),
    "Stage 6 security extension document is not committed",
  );
  assert.ok(
    !changed.some(historicalStage5Evidence),
    "Stage 6 source delta rewrites immutable Stage 5 evidence",
  );
  assert.ok(!changed.some(stage7Path), "Stage 6 source delta contains Stage 7 behavior");
  const candidates = changed.filter((file) => !outputPath(file));
  assert.ok(!candidates.includes(STAGE6_BASELINE_PATH));
  const rows = [];
  for (const file of candidates) {
    const bytes = await readRegular(workspace, file);
    rows.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return rows.sort((left, right) => bytewise(left.path, right.path));
};

export const createStage6SuccessorManifest = async ({ root = process.cwd() } = {}) => {
  const workspace = path.resolve(root);
  const rows = await collectStage6SourceRows({ root: workspace });
  const extensionBytes = await readRegular(workspace, STAGE6_EXTENSION_PATH);
  return {
    schemaVersion: 1,
    baselineId: "phase-1-m1-stage-6-preview-publish-v1",
    stage: "PHASE_1_M1_STAGE_6",
    stage6Actions: 1,
    stage7Actions: 0,
    predecessor: {
      tag: STAGE6_BASE_TAG,
      commit: STAGE6_BASE_COMMIT,
      phase0BaselineSha256: PHASE0_BASELINE_SHA256,
      stage5BaselinePath: STAGE5_BASELINE_PATH,
      stage5BaselineSha256: STAGE5_BASELINE_SHA256,
      stage5ProtectedFileCount: STAGE5_PROTECTED_FILE_COUNT,
      stage5AggregateSha256: STAGE5_AGGREGATE_SHA256,
      stage6Actions: 0,
    },
    extension: STAGE6_EXTENSION,
    extensionDocument: { path: STAGE6_EXTENSION_PATH, sha256: sha256(extensionBytes) },
    sourceFiles: rows,
    sourceAggregateSha256: aggregateRows(rows),
  };
};

export const stage6OutputPath = outputPath;
