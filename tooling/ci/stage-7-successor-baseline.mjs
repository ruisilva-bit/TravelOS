import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const aggregateRows = (rows) =>
  sha256(
    rows.map(({ path: file, bytes, sha256: digest }) => `${file}\t${bytes}\t${digest}\n`).join(""),
  );
const safePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  value.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
  value.normalize("NFC") === value;
const exactKeys = (value, keys, label) =>
  assert.deepEqual(
    Object.keys(value ?? {}).sort(bytewise),
    [...keys].sort(bytewise),
    `${label} has unexpected or missing fields`,
  );
const uniqueSafePaths = (values, label, { prefixes = false } = {}) => {
  assert.ok(Array.isArray(values), `${label} must be an array`);
  const checked = values.map((value) => {
    const normalized =
      prefixes && typeof value === "string" && value.endsWith("/") ? value.slice(0, -1) : value;
    assert.ok(safePath(normalized), `Unsafe ${label} entry: ${value}`);
    if (prefixes) assert.ok(value.endsWith("/"), `${label} entries must end with /: ${value}`);
    return value;
  });
  assert.equal(new Set(checked).size, checked.length, `Duplicate ${label} entry`);
  return checked;
};
const gitText = (root, args) => {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trimEnd();
};
const gitBytes = (root, args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: null, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || "no output"}`);
  return Buffer.from(result.stdout);
};
const readRegular = async (root, relativePath) => {
  assert.ok(safePath(relativePath), `Unsafe repository path: ${relativePath}`);
  const filePath = path.resolve(root, relativePath);
  assert.ok(
    filePath.startsWith(`${path.resolve(root)}${path.sep}`),
    "Path escapes repository root",
  );
  const metadata = await lstat(filePath);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `Expected regular file: ${relativePath}`,
  );
  return readFile(filePath);
};
const porcelainPaths = (root) =>
  gitText(root, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
const worktreeRecords = (root) => {
  const records = [];
  let record = {};
  for (const line of gitText(root, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line === "") {
      if (record.path !== undefined) records.push(record);
      record = {};
    } else if (line.startsWith("worktree ")) {
      record.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      record.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      record.branch = line.slice("branch ".length);
    } else if (line === "detached") {
      record.detached = true;
    }
  }
  if (record.path !== undefined) records.push(record);
  return records;
};
const commonGitDir = (root) => path.resolve(root, gitText(root, ["rev-parse", "--git-common-dir"]));

export const STAGE7_BASE_COMMIT = "6242e023953ccb8fe883bff97a0d62e64af8b66a";
export const STAGE7_BASE_TAG = "travelos-phase-1-m1-stage-6-gen07-revision-04-go";
export const STAGE7_BASE_TAG_OBJECT = "8d951cbf739a69695ea98e2a31b5532ee0b0d951";
export const STAGE7_EXTENSION_PATH = "docs/implementation/M1_STAGE_7_PORTAL_ISOLATION.md";
export const STAGE7_AUTHORIZED_PATHS_PATH =
  "docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS.json";
export const STAGE7_DEFAULT_GENERATION = "gen06";
export const stage7BaselinePathFor = (generation) => {
  assert.match(generation, /^gen[0-9]{2,}$/, "Invalid Stage 7 candidate generation");
  return `docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_${generation.toUpperCase()}.json`;
};
export const STAGE7_BASELINE_PATH = stage7BaselinePathFor(STAGE7_DEFAULT_GENERATION);
export const stage7PredecessorReceiptPathFor = (generation) => {
  assert.match(generation, /^gen[0-9]{2,}$/, "Invalid Stage 7 candidate generation");
  return `docs/reviews/phase-1-m1/stage-7/${generation.toUpperCase()}_STAGE6_PREDECESSOR_BASELINE_VERIFY.json`;
};
export const stage7PredecessorReportPathFor = (generation) => {
  assert.match(generation, /^gen[0-9]{2,}$/, "Invalid Stage 7 candidate generation");
  return `docs/reviews/phase-1-m1/stage-7/${generation.toUpperCase()}_STAGE7_PREDECESSOR_VERIFY.json`;
};
export const STAGE7_PREDECESSOR_RECEIPT_PATH =
  stage7PredecessorReceiptPathFor(STAGE7_DEFAULT_GENERATION);

export const STAGE7_PREDECESSOR = Object.freeze({
  tag: STAGE7_BASE_TAG,
  commit: STAGE7_BASE_COMMIT,
  annotatedTagObject: STAGE7_BASE_TAG_OBJECT,
  stage6SourceBaseline: {
    path: "docs/reviews/phase-1-m1/STAGE_6_SUCCESSOR_BASELINE_GENERATION_07_REVISION_03.json",
    sha256: "bb8890cacb720d43360997ff0e5c5ac0c6fa945b3dc5f87fb298d80c6e4e1695",
    sourceCount: 61,
    sourceAggregateSha256: "a736add8226933ac9d2a78268357dd654d16322f722fe377cdb28bbd9a8cde6b",
  },
  stage6CandidateFreeze: {
    path: "docs/reviews/phase-1-m1/stage-6/GEN07_REVISION_04_CANDIDATE_FREEZE.json",
    sha256: "df844f6ac08adca1779bde325f9b1da9c134396c38ec8448cf13d718e4286ebc",
  },
  stage6IndependentReview: {
    path: "docs/reviews/phase-1-m1/stage-6/GEN07_REVISION_04_INDEPENDENT_REVIEW.json",
    sha256: "0c899b6696749075d8c5de7db66df6f92351896e10457cc5ba15f23a2db792b4",
  },
  stage6FinalDecision: {
    path: "docs/reviews/phase-1-m1/stage-6/GEN07_REVISION_04_FINAL_DECISION.json",
    sha256: "f7d51f7eac9ed194f3f1ada129d61bb6467f7cb02c9b4886d43f321bc55ed571",
  },
  stage6Verification: {
    result: "PASS",
    branch: "phase-1/stage-6",
    sourceCommit: STAGE7_BASE_COMMIT,
    stage6BaselinePath:
      "docs/reviews/phase-1-m1/STAGE_6_SUCCESSOR_BASELINE_GENERATION_07_REVISION_03.json",
    stage6BaselineSha256: "bb8890cacb720d43360997ff0e5c5ac0c6fa945b3dc5f87fb298d80c6e4e1695",
    sourceCount: 61,
    sourceAggregateSha256: "a736add8226933ac9d2a78268357dd654d16322f722fe377cdb28bbd9a8cde6b",
    predecessor: {
      result: "PASS",
      tag: "phase-1-stage-5-go",
      commit: "8dd62157d14e88400a9df1e97452a3807f3ed50e",
      phase0BaselineSha256: "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb",
      stage5BaselineSha256: "ff41985b197738faa9585af2b4686612d420a9c118801a801c8d38087f1d29b6",
      stage5ProtectedFileCount: 38,
      stage5AggregateSha256: "decc422c49ab17d44e700331b95ac3fdf0bee8d6058b244682ecdc6ab8940255",
      stage6Actions: 0,
    },
    stage6Actions: 1,
    stage7Actions: 0,
  },
});

export const STAGE7_EXTENSION = Object.freeze({
  schemaVersion: 1,
  stage: "PHASE_1_M1_STAGE_7",
  staffGrantPermission: {
    id: "trip.access.manage",
    registryVersion: 5,
    scope: "AGENCY",
    ownerTemplate: "agency-owner-v1",
  },
  tripAccessGrant: {
    scope: ["agencyId", "portalPrincipalId", "tripId"],
    capability: "trip.view_current",
    issuedAndRevokedActorAndTimestamp: true,
    optionalExpiry: true,
    optionalRelationshipLabelUxOnly: true,
    explicitOnly: true,
    identityOrCustomerInference: false,
    portalSelfGrant: false,
    revocationIncrementsPrincipalAuthorizationEpoch: true,
    portalSessionsCarryAndCheckEpoch: true,
    authorizationCache: false,
  },
  portal: {
    authenticationRealm: "PORTAL_ONLY",
    runtimeLoginRole: "travelos_portal_api",
    runtimeCapabilityRole: "travelos_portal_runtime",
    activePublicationOnly: true,
    contract: "PortalTripSnapshotV1",
    contractVersion: 1,
    mutableWorkspaceRead: false,
    mutableWorkspaceFallback: false,
    unknownFieldPassthrough: false,
    writeCapability: false,
  },
  migration: {
    file: "0012_stage7_portal_trip_access.cjs",
    sessionUser: "travelos_migrator",
    currentUser: "travelos_owner",
    betterAuthRuntimeMigrations: false,
  },
  stage7Actions: 1,
  stage8Actions: 0,
});

export const STAGE7_AUTHORIZED_PATHS = Object.freeze({
  schemaVersion: 1,
  stage: "PHASE_1_M1_STAGE_7",
  exactSourceFiles: [
    "docs/implementation/M1_STAGE_7_PORTAL_ISOLATION.md",
    "docs/superpowers/plans/2026-10-15-stage-7-portal-isolation.md",
    "deploy/contracts/stage-7-extension.v1.json",
    "migrations/0012_stage7_portal_trip_access.cjs",
    "migrations/checksums.json",
    "package.json",
    "packages/auth-adapters/package.json",
    "packages/auth-adapters/src/realm.ts",
    "packages/auth-adapters/src/portal.ts",
    "packages/backend-core/test/agency-organization/agency-bootstrap.test.ts",
    "packages/backend-core/src/index.ts",
    "packages/backend-core/src/staff-access/permission-registry.ts",
    "packages/contracts/src/admin/index.ts",
    "packages/contracts/src/admin/trips/index.ts",
    "packages/database/src/index.ts",
    "packages/portal-safe-core/src/index.ts",
    "packages/portal-safe-core/src/portal-access/index.ts",
    "packages/portal-safe-core/src/customer-presentation/index.ts",
    "apps/portal-api/src/trip-read-repository.ts",
    "apps/portal-api/src/trip-routes.ts",
    "tooling/architecture/check.mjs",
    "tooling/architecture/fixtures/stage-7/verify-portal-import-boundaries.mjs",
    "tooling/architecture/package-boundary-policy.mjs",
    "tooling/ci/stage-7-successor-baseline.mjs",
    "tooling/ci/test-stage-7-successor-baseline.mjs",
    "tooling/ci/verify-stage-7-predecessor.mjs",
    "tooling/ci/write-stage-7-predecessor-receipt.mjs",
    "tooling/ci/verify-stage-7-successor-baseline.mjs",
    "tooling/ci/write-stage-7-successor-baseline.mjs",
    "tooling/database/run-stage-7-disposable.mjs",
    "tooling/testing/vitest.stage-7.config.ts",
    "tests/integration/stage-7-postgresql.test.ts",
    "apps/admin-api/src/auth-bridge.ts",
    "apps/admin-api/src/main.ts",
    "apps/admin-api/src/m1-routes.ts",
    "apps/admin-api/src/m1-session-resolver.ts",
    "apps/admin-api/test/auth-bridge.test.ts",
    "apps/admin-api/test/composed-m1-body-parser.test.ts",
    "apps/admin-api/test/m1-session-resolver.test.ts",
    "apps/portal-api/package.json",
    "apps/portal-api/src/app.ts",
    "apps/portal-api/src/auth-bridge.ts",
    "apps/portal-api/src/host-validation.ts",
    "apps/portal-api/src/main.ts",
    "apps/portal-api/test/auth-bridge.test.ts",
    "apps/portal-api/test/host-routing-boundary.test.ts",
    "packages/portal-safe-core/package.json",
    "packages/portal-safe-core/tsconfig.build.json",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
  ],
  sourcePrefixes: [
    "apps/admin-api/test/portal-access/",
    "apps/portal-api/src/portal-access/",
    "apps/portal-api/test/portal-access/",
    "packages/auth-adapters/test/portal-session/",
    "packages/backend-core/src/modules/portal-access/",
    "packages/backend-core/test/portal-access/",
    "packages/contracts/src/admin/trips/portal-access/",
    "packages/contracts/test/portal-access/",
    "packages/database/src/portal-access/",
    "packages/portal-safe-core/src/customer-presentation/",
    "packages/portal-safe-core/src/portal-access/",
    "packages/portal-safe-core/test/customer-presentation/",
    "packages/portal-safe-core/test/portal-access/",
    "tooling/ci/stage-7/",
    "tooling/architecture/fixtures/stage-7/",
  ],
  evidencePrefixes: ["docs/evidence/phase-1-m1/stage-7/", "docs/reviews/phase-1-m1/stage-7/"],
  protectedPrefixes: ["docs/evidence/phase-1-m1/stage-6/", "docs/reviews/phase-1-m1/stage-6/"],
  protectedFiles: [
    "docs/implementation/M1_STAGE_6_SECURITY_EXTENSION.md",
    "docs/reviews/phase-1-m1/STAGE_6_SUCCESSOR_BASELINE_GENERATION_07_REVISION_03.json",
    "migrations/0011_stage6_trip_publication.cjs",
    "tooling/ci/stage-6-successor-baseline.mjs",
    "tooling/ci/test-stage-6-successor-baseline.mjs",
    "tooling/ci/verify-stage-6-successor-baseline.mjs",
  ],
});

const STAGE7_EXTENSION_MARKERS = [
  "6242e023953ccb8fe883bff97a0d62e64af8b66a",
  "travelos-phase-1-m1-stage-6-gen07-revision-04-go",
  "8d951cbf739a69695ea98e2a31b5532ee0b0d951",
  "TripAccessGrant",
  "trip.access.manage",
  "trip.view_current",
  "authorization epoch",
  "Grant revocation increments that Portal principal's authorization epoch",
  "Portal sessions carry and check the epoch",
  "PortalTripSnapshotV1",
  "0012_stage7_portal_trip_access.cjs",
  "travelos_portal_api",
  "travelos_portal_runtime",
  "travelos_migrator",
  "travelos_owner",
  "INTERNAL_ONLY",
  "No Better Auth runtime migrations",
  "Stage 7 actions = 1",
  "Stage 8 actions = 0",
];

const isAuthorizedSourcePath = (file) =>
  STAGE7_AUTHORIZED_PATHS.exactSourceFiles.includes(file) ||
  STAGE7_AUTHORIZED_PATHS.sourcePrefixes.some((prefix) => file.startsWith(prefix));

export const validateStage7SuccessorManifest = async ({
  manifest,
  readBytes,
  expectedSourcePaths,
  expectedCommit,
}) => {
  exactKeys(
    manifest,
    [
      "authorizedPathsDocument",
      "candidateId",
      "candidateCommit",
      "candidateGeneration",
      "extension",
      "extensionDocument",
      "predecessor",
      "predecessorReceiptDocument",
      "schemaVersion",
      "sourceAggregateSha256",
      "sourceCount",
      "sourceFiles",
      "stage",
      "stage7Actions",
      "stage8Actions",
    ],
    "Stage 7 successor baseline",
  );
  assert.equal(manifest.schemaVersion, 1, "Unsupported Stage 7 successor baseline schema");
  assert.match(manifest.candidateGeneration, /^gen[0-9]{2,}$/, "Invalid candidate generation");
  assert.equal(
    manifest.candidateId,
    `travelos-phase-1-m1-stage-7-${manifest.candidateGeneration}`,
    "Candidate ID does not match its generation",
  );
  assert.match(manifest.candidateCommit, /^[a-f0-9]{40}$/, "Invalid candidate commit");
  if (expectedCommit !== undefined) {
    assert.equal(
      manifest.candidateCommit,
      expectedCommit,
      "Stage 7 baseline is for another commit",
    );
  }
  assert.equal(manifest.stage, "PHASE_1_M1_STAGE_7");
  assert.equal(manifest.stage7Actions, 1, "Stage 7 actions must equal one");
  assert.equal(manifest.stage8Actions, 0, "Stage 8 actions must remain zero");
  assert.deepEqual(manifest.predecessor, STAGE7_PREDECESSOR, "Stage 7 predecessor binding differs");
  assert.deepEqual(manifest.extension, STAGE7_EXTENSION, "Unexpected Stage 7 semantic delta");
  assert.equal(typeof readBytes, "function", "Stage 7 byte reader is required");

  exactKeys(
    manifest.predecessorReceiptDocument,
    ["path", "sha256"],
    "Stage 7 predecessor verification receipt document",
  );
  const predecessorReceiptPath = stage7PredecessorReceiptPathFor(manifest.candidateGeneration);
  assert.equal(manifest.predecessorReceiptDocument.path, predecessorReceiptPath);
  assert.match(manifest.predecessorReceiptDocument.sha256, /^[a-f0-9]{64}$/);
  const predecessorReceiptBytes = Buffer.from(await readBytes(predecessorReceiptPath));
  assert.equal(
    sha256(predecessorReceiptBytes),
    manifest.predecessorReceiptDocument.sha256,
    "Stage 7 predecessor receipt hash mismatch",
  );
  validateStage7PredecessorReceipt(JSON.parse(predecessorReceiptBytes.toString("utf8")));

  exactKeys(manifest.extensionDocument, ["path", "sha256"], "Stage 7 extension document");
  assert.equal(manifest.extensionDocument.path, STAGE7_EXTENSION_PATH);
  assert.match(manifest.extensionDocument.sha256, /^[a-f0-9]{64}$/);
  const extensionBytes = Buffer.from(await readBytes(STAGE7_EXTENSION_PATH));
  assert.equal(
    sha256(extensionBytes),
    manifest.extensionDocument.sha256,
    "Stage 7 extension document hash mismatch",
  );
  const extensionText = extensionBytes.toString("utf8");
  for (const marker of STAGE7_EXTENSION_MARKERS) {
    assert.ok(extensionText.includes(marker), `Stage 7 extension is missing marker: ${marker}`);
  }

  exactKeys(
    manifest.authorizedPathsDocument,
    ["path", "sha256"],
    "Stage 7 authorized-path document",
  );
  assert.equal(manifest.authorizedPathsDocument.path, STAGE7_AUTHORIZED_PATHS_PATH);
  assert.match(manifest.authorizedPathsDocument.sha256, /^[a-f0-9]{64}$/);
  const authorizedPathsBytes = Buffer.from(await readBytes(STAGE7_AUTHORIZED_PATHS_PATH));
  assert.equal(
    sha256(authorizedPathsBytes),
    manifest.authorizedPathsDocument.sha256,
    "Stage 7 authorized-path document hash mismatch",
  );
  const authorizedPathsDocument = JSON.parse(authorizedPathsBytes.toString("utf8"));
  assert.deepEqual(
    authorizedPathsDocument,
    STAGE7_AUTHORIZED_PATHS,
    "Stage 7 authorized-path document differs from the code-owned allowlist",
  );
  uniqueSafePaths(STAGE7_AUTHORIZED_PATHS.exactSourceFiles, "Stage 7 exact source paths");
  uniqueSafePaths(STAGE7_AUTHORIZED_PATHS.sourcePrefixes, "Stage 7 source prefixes", {
    prefixes: true,
  });
  uniqueSafePaths(STAGE7_AUTHORIZED_PATHS.evidencePrefixes, "Stage 7 evidence prefixes", {
    prefixes: true,
  });
  uniqueSafePaths(STAGE7_AUTHORIZED_PATHS.protectedPrefixes, "Stage 7 protected prefixes", {
    prefixes: true,
  });
  uniqueSafePaths(STAGE7_AUTHORIZED_PATHS.protectedFiles, "Stage 7 protected files");

  assert.ok(Array.isArray(manifest.sourceFiles) && manifest.sourceFiles.length > 0);
  assert.ok(
    Number.isSafeInteger(manifest.sourceCount) &&
      manifest.sourceCount === manifest.sourceFiles.length,
    "Stage 7 source count mismatch",
  );
  const paths = manifest.sourceFiles.map((row) => row.path);
  assert.equal(new Set(paths).size, paths.length, "Duplicate Stage 7 source manifest path");
  assert.deepEqual(
    paths,
    [...paths].sort(bytewise),
    "Stage 7 source paths are not bytewise ordered",
  );
  if (expectedSourcePaths !== undefined) {
    const expected = uniqueSafePaths(expectedSourcePaths, "Expected Stage 7 source paths").sort(
      bytewise,
    );
    assert.deepEqual(paths, expected, "Manifest does not match the exact Stage 7 source delta");
  }
  for (const row of manifest.sourceFiles) {
    exactKeys(row, ["bytes", "path", "sha256"], "Stage 7 source manifest row");
    assert.ok(safePath(row.path), `Unsafe Stage 7 source manifest path: ${row.path}`);
    assert.ok(
      Number.isSafeInteger(row.bytes) && row.bytes >= 0,
      `Invalid source size: ${row.path}`,
    );
    assert.match(row.sha256, /^[a-f0-9]{64}$/, `Invalid source SHA-256: ${row.path}`);
    assert.ok(
      isAuthorizedSourcePath(row.path),
      `Stage 7 source path is not authorized: ${row.path}`,
    );
    const protectedByPrefix = STAGE7_AUTHORIZED_PATHS.protectedPrefixes.some((prefix) =>
      row.path.startsWith(prefix),
    );
    assert.equal(
      protectedByPrefix || STAGE7_AUTHORIZED_PATHS.protectedFiles.includes(row.path),
      false,
      `Protected predecessor path cannot enter Stage 7 sources: ${row.path}`,
    );
  }
  assert.ok(
    paths.includes(STAGE7_EXTENSION_PATH),
    "Stage 7 extension is outside the source manifest",
  );
  assert.equal(
    paths.includes(STAGE7_AUTHORIZED_PATHS_PATH),
    false,
    "Stage 7 authorized-path document is separately hashed, not a source row",
  );
  assert.match(manifest.sourceAggregateSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    manifest.sourceAggregateSha256,
    aggregateRows(manifest.sourceFiles),
    "Stage 7 source aggregate mismatch",
  );
  for (const row of manifest.sourceFiles) {
    const bytes = Buffer.from(await readBytes(row.path));
    assert.equal(bytes.length, row.bytes, `Stage 7 source byte count mismatch: ${row.path}`);
    assert.equal(sha256(bytes), row.sha256, `Stage 7 source hash mismatch: ${row.path}`);
  }
  return {
    sourceCount: paths.length,
    sourceAggregateSha256: manifest.sourceAggregateSha256,
  };
};

export const validateStage7PredecessorReceipt = (receipt) => {
  exactKeys(
    receipt,
    [
      "branch",
      "predecessor",
      "result",
      "schemaVersion",
      "sourceAggregateSha256",
      "sourceCommit",
      "sourceCount",
      "stage6Actions",
      "stage6BaselinePath",
      "stage6BaselineSha256",
      "stage7Actions",
    ],
    "Stage 6 predecessor verification receipt",
  );
  assert.deepEqual(
    receipt,
    {
      schemaVersion: 1,
      ...STAGE7_PREDECESSOR.stage6Verification,
    },
    "Stage 6 predecessor verification does not match the accepted Stage 6 baseline",
  );
  return {
    result: receipt.result,
    sourceCommit: receipt.sourceCommit,
    sourceCount: receipt.sourceCount,
    sourceAggregateSha256: receipt.sourceAggregateSha256,
  };
};

const isProtectedPath = (file) =>
  STAGE7_AUTHORIZED_PATHS.protectedFiles.includes(file) ||
  STAGE7_AUTHORIZED_PATHS.protectedPrefixes.some((prefix) => file.startsWith(prefix));
const isStage7EvidencePath = (file, generation) =>
  file === stage7BaselinePathFor(generation) ||
  /^docs\/reviews\/phase-1-m1\/STAGE_7_SUCCESSOR_BASELINE_GEN[0-9]{2,}\.json$/.test(file) ||
  STAGE7_AUTHORIZED_PATHS.evidencePrefixes.some((prefix) => file.startsWith(prefix));
const localStatePath = (file) => file === ".hermes/state" || file.startsWith(".hermes/state/");
const readCommittedFile = (root, commit, file) => gitBytes(root, ["show", `${commit}:${file}`]);

const stage7ChangedSourcePaths = (root, candidateCommit, generation) => {
  const rows = gitText(root, [
    "diff",
    "--name-status",
    "--no-renames",
    `${STAGE7_BASE_COMMIT}..${candidateCommit}`,
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split("\t");
      assert.ok(file && safePath(file), `Invalid Stage 7 diff path: ${line}`);
      assert.ok(
        ["A", "M"].includes(status),
        `Unexpected Stage 7 source change type ${status}: ${file}`,
      );
      assert.equal(
        isProtectedPath(file),
        false,
        `Stage 7 candidate modifies protected predecessor path: ${file}`,
      );
      return file;
    });
  const sourcePaths = rows.filter((file) => !isStage7EvidencePath(file, generation));
  for (const file of sourcePaths) {
    assert.ok(isAuthorizedSourcePath(file), `Stage 7 source path is not authorized: ${file}`);
  }
  return sourcePaths.sort(bytewise);
};

const sourceRowsAtCommit = (root, candidateCommit, generation) => {
  const sourcePaths = stage7ChangedSourcePaths(root, candidateCommit, generation);
  assert.ok(
    sourcePaths.includes(STAGE7_EXTENSION_PATH),
    "Stage 7 extension document is not committed",
  );
  return sourcePaths.map((file) => {
    const treeEntry = gitText(root, ["ls-tree", candidateCommit, "--", file]);
    const mode = treeEntry.split(" ", 1)[0];
    assert.ok(
      ["100644", "100755"].includes(mode),
      `Stage 7 source must be a regular blob: ${file}`,
    );
    const bytes = readCommittedFile(root, candidateCommit, file);
    return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
  });
};

export const verifyStage7Predecessor = async ({
  root = process.cwd(),
  generation = STAGE7_DEFAULT_GENERATION,
  requireReceipt = true,
} = {}) => {
  const workspace = path.resolve(root);
  stage7BaselinePathFor(generation);
  const stage7Branch = gitText(workspace, ["branch", "--show-current"]);
  assert.equal(stage7Branch, "phase-1/stage-7", `Unexpected Stage 7 branch: ${stage7Branch}`);
  gitText(workspace, ["merge-base", "--is-ancestor", STAGE7_BASE_COMMIT, "HEAD"]);
  assert.equal(gitText(workspace, ["cat-file", "-t", STAGE7_BASE_TAG]), "tag");
  assert.equal(gitText(workspace, ["rev-parse", STAGE7_BASE_TAG]), STAGE7_BASE_TAG_OBJECT);
  assert.equal(
    gitText(workspace, ["rev-parse", `${STAGE7_BASE_TAG}^{commit}`]),
    STAGE7_BASE_COMMIT,
  );

  const records = worktreeRecords(workspace);
  const detached = records.filter(
    (record) => record.detached && record.head === STAGE7_BASE_COMMIT,
  );
  const verifierWorktrees = records.filter(
    (record) =>
      record.branch === "refs/heads/phase-1/stage-6" && record.head === STAGE7_BASE_COMMIT,
  );
  assert.equal(detached.length, 1, "Exactly one detached Stage 6 predecessor worktree is required");
  assert.equal(
    verifierWorktrees.length,
    1,
    "Exactly one named Stage 6 worktree is required by the immutable Stage 6 verifier",
  );
  const detachedRoot = path.resolve(detached[0].path);
  const verifierRoot = path.resolve(verifierWorktrees[0].path);
  assert.equal(commonGitDir(workspace), commonGitDir(detachedRoot));
  assert.equal(commonGitDir(workspace), commonGitDir(verifierRoot));
  assert.equal(gitText(detachedRoot, ["rev-parse", "HEAD"]), STAGE7_BASE_COMMIT);
  assert.equal(gitText(detachedRoot, ["branch", "--show-current"]), "");
  assert.deepEqual(
    porcelainPaths(detachedRoot),
    [],
    "Detached Stage 6 predecessor worktree must be clean",
  );
  assert.equal(gitText(verifierRoot, ["rev-parse", "HEAD"]), STAGE7_BASE_COMMIT);
  const verifierBranch = gitText(verifierRoot, ["branch", "--show-current"]);
  assert.equal(verifierBranch, "phase-1/stage-6");
  const verifierStatus = porcelainPaths(verifierRoot).filter((file) => !localStatePath(file));
  assert.deepEqual(
    verifierStatus,
    [],
    "Named Stage 6 verifier worktree must be clean outside local state",
  );

  const stage6Module = pathToFileURL(
    path.join(verifierRoot, "tooling/ci/stage-6-successor-baseline.mjs"),
  );
  const { verifyStage6SuccessorBaseline } = await import(stage6Module.href);
  const stage6Verification = await verifyStage6SuccessorBaseline({ root: verifierRoot });
  validateStage7PredecessorReceipt(stage6Verification);
  const receiptPath = stage7PredecessorReceiptPathFor(generation);
  if (requireReceipt) {
    const receiptBytes = await readRegular(workspace, receiptPath);
    const canonicalReceiptBytes = Buffer.from(`${JSON.stringify(stage6Verification, null, 2)}\n`);
    assert.deepEqual(
      receiptBytes,
      canonicalReceiptBytes,
      "Recorded Stage 6 verifier receipt differs from live verification",
    );
  }
  return {
    schemaVersion: 1,
    result: "PASS",
    predecessorCommit: STAGE7_BASE_COMMIT,
    predecessorTag: STAGE7_BASE_TAG,
    predecessorTagObject: STAGE7_BASE_TAG_OBJECT,
    detachedWorktree: { head: STAGE7_BASE_COMMIT, branch: null, status: "CLEAN" },
    stage6VerifierWorktree: {
      head: STAGE7_BASE_COMMIT,
      branch: verifierBranch,
      status: "CLEAN_OUTSIDE_LOCAL_STATE",
    },
    stage6Verification,
    receiptPath,
    stage7Actions: 1,
    stage8Actions: 0,
  };
};

export const collectStage7SourceRows = ({
  root = process.cwd(),
  candidateCommit,
  generation = STAGE7_DEFAULT_GENERATION,
} = {}) => {
  const workspace = path.resolve(root);
  const commit = gitText(workspace, ["rev-parse", `${candidateCommit}^{commit}`]);
  assert.equal(commit, candidateCommit, "Candidate commit must be a full immutable commit SHA");
  gitText(workspace, ["merge-base", "--is-ancestor", STAGE7_BASE_COMMIT, commit]);
  return sourceRowsAtCommit(workspace, commit, generation);
};

export const createStage7SuccessorManifest = async ({
  root = process.cwd(),
  candidateCommit = "HEAD",
  generation = STAGE7_DEFAULT_GENERATION,
} = {}) => {
  const workspace = path.resolve(root);
  const baselinePath = stage7BaselinePathFor(generation);
  const commit = gitText(workspace, ["rev-parse", `${candidateCommit}^{commit}`]);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(gitText(workspace, ["branch", "--show-current"]), "phase-1/stage-7");
  gitText(workspace, ["merge-base", "--is-ancestor", STAGE7_BASE_COMMIT, commit]);
  gitText(workspace, ["merge-base", "--is-ancestor", commit, "HEAD"]);
  assertNoPostCandidateSourceDrift(workspace, commit, generation);
  const sourceFiles = collectStage7SourceRows({
    root: workspace,
    candidateCommit: commit,
    generation,
  });
  const extensionBytes = readCommittedFile(workspace, commit, STAGE7_EXTENSION_PATH);
  const authorizedPathsBytes = await readRegular(workspace, STAGE7_AUTHORIZED_PATHS_PATH);
  const predecessorReceiptPath = stage7PredecessorReceiptPathFor(generation);
  const predecessorReceiptBytes = await readRegular(workspace, predecessorReceiptPath);
  const manifest = {
    schemaVersion: 1,
    candidateGeneration: generation,
    candidateId: `travelos-phase-1-m1-stage-7-${generation}`,
    candidateCommit: commit,
    stage: "PHASE_1_M1_STAGE_7",
    stage7Actions: 1,
    stage8Actions: 0,
    predecessor: STAGE7_PREDECESSOR,
    predecessorReceiptDocument: {
      path: predecessorReceiptPath,
      sha256: sha256(predecessorReceiptBytes),
    },
    extension: STAGE7_EXTENSION,
    extensionDocument: { path: STAGE7_EXTENSION_PATH, sha256: sha256(extensionBytes) },
    authorizedPathsDocument: {
      path: STAGE7_AUTHORIZED_PATHS_PATH,
      sha256: sha256(authorizedPathsBytes),
    },
    sourceCount: sourceFiles.length,
    sourceFiles,
    sourceAggregateSha256: aggregateRows(sourceFiles),
  };
  const evidenceBytes = new Map([
    [STAGE7_AUTHORIZED_PATHS_PATH, authorizedPathsBytes],
    [predecessorReceiptPath, predecessorReceiptBytes],
  ]);
  await validateStage7SuccessorManifest({
    manifest,
    readBytes: (file) => evidenceBytes.get(file) ?? readCommittedFile(workspace, commit, file),
    expectedSourcePaths: sourceFiles.map(({ path: file }) => file),
    expectedCommit: commit,
  });
  assert.equal(baselinePath, stage7BaselinePathFor(manifest.candidateGeneration));
  return manifest;
};

const assertNoPostCandidateSourceDrift = (root, candidateCommit, generation) => {
  const committedAfter = gitText(root, ["diff", "--name-only", `${candidateCommit}..HEAD`])
    .split("\n")
    .filter(Boolean);
  for (const file of committedAfter) {
    assert.ok(
      isStage7EvidencePath(file, generation),
      `Source/evidence boundary changed after candidate commit: ${file}`,
    );
  }
  for (const file of porcelainPaths(root)) {
    if (localStatePath(file) || isStage7EvidencePath(file, generation)) continue;
    assert.fail(`Unexpected uncommitted path during Stage 7 baseline verification: ${file}`);
  }
};

export const verifyStage7SuccessorBaseline = async ({
  root = process.cwd(),
  generation = STAGE7_DEFAULT_GENERATION,
} = {}) => {
  const workspace = path.resolve(root);
  const predecessor = await verifyStage7Predecessor({ root: workspace, generation });
  const currentBranch = gitText(workspace, ["branch", "--show-current"]);
  const head = gitText(workspace, ["rev-parse", "HEAD"]);
  const baselinePath = stage7BaselinePathFor(generation);
  const manifestBytes = await readRegular(workspace, baselinePath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.candidateGeneration, generation);
  gitText(workspace, ["merge-base", "--is-ancestor", manifest.candidateCommit, head]);
  assertNoPostCandidateSourceDrift(workspace, manifest.candidateCommit, generation);
  const expectedSourceRows = collectStage7SourceRows({
    root: workspace,
    candidateCommit: manifest.candidateCommit,
    generation,
  });
  const evidenceBytes = new Map([
    [STAGE7_AUTHORIZED_PATHS_PATH, await readRegular(workspace, STAGE7_AUTHORIZED_PATHS_PATH)],
    [
      stage7PredecessorReceiptPathFor(generation),
      await readRegular(workspace, stage7PredecessorReceiptPathFor(generation)),
    ],
  ]);
  const verified = await validateStage7SuccessorManifest({
    manifest,
    readBytes: (file) =>
      evidenceBytes.get(file) ?? readCommittedFile(workspace, manifest.candidateCommit, file),
    expectedSourcePaths: expectedSourceRows.map(({ path: file }) => file),
    expectedCommit: manifest.candidateCommit,
  });
  return {
    schemaVersion: 1,
    result: "PASS",
    candidateGeneration: generation,
    candidateId: manifest.candidateId,
    candidateCommit: manifest.candidateCommit,
    currentBranch,
    currentHead: head,
    baselinePath,
    baselineSha256: sha256(manifestBytes),
    sourceCount: verified.sourceCount,
    sourceAggregateSha256: verified.sourceAggregateSha256,
    predecessorResult: predecessor.result,
    stage7Actions: 1,
    stage8Actions: 0,
  };
};
