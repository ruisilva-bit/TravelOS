import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ACCEPTED_STAGE6_CONTRACT_SHA256 =
  "d97709506b69d133f13cbd9c74c1f9a790477180cbcd124b7135c26bb0c75633";
const EXCLUDED_MANIFEST_FILES = new Set(["payload-manifest.json", "checksums.txt"]);
const SECRET_FILENAMES = [
  /^\.env(?:\..*)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.dockerconfigjson$/i,
  /^credentials?\.(?:json|ya?ml|toml)$/i,
  /^secrets?\.(?:json|ya?ml|toml)$/i,
  /^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i,
  /\.(?:pem|p12|pfx|jks|kdbx|key)$/i,
  /^travelos-[^/]*\.cred(?:ential)?$/i,
];
const SECRET_PATTERNS = [
  /-----BEGIN (?<keyType>(?:EC |OPENSSH |PGP |RSA )?PRIVATE\s+KEY)-----\r?\n[A-Za-z0-9+/=]{32,}(?:\r?\n[A-Za-z0-9+/=]+)*\r?\n-----END \k<keyType>-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/,
  /\b(?:authorization|proxy-authorization)\b\s*[:=]\s*["'`]?Bearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]{32,}/,
];
const CREDENTIAL_URL_PATTERN =
  /[a-z][a-z0-9+.-]*:\/\/(?<username>[^\s/:"'<>]+):(?<password>[^\s/@"'<>]+)@(?<host>[^\s/"'<>]+)/gi;
const SAFE_CREDENTIAL_URL_EXAMPLE_SHA256 = new Set([
  "a69bdc042c58e8d940e6a5f09ed93646e697af04869a65cf45e9244e950cfb06",
  "c2cba494f78d950f91ec21298bbf60a949dc379d4f873ffe3ee319c918a175e0",
  "f61c153d5abbe4381a1fba0d41be0babdd5de51c626ee7ff14cede14dedc33f1",
]);
const PLACEHOLDER_CREDENTIALS = new Set([
  "123",
  "abc",
  "bar",
  "changeme",
  "client",
  "dummy",
  "example",
  "foo",
  "name",
  "pass",
  "password",
  "postgres",
  "redacted",
  "secret",
  "test",
  "token",
  "user",
  "username",
  "value",
  "xyz",
]);
const isPlaceholderCredential = (value) => {
  let normalized = value.toLowerCase();
  try {
    normalized = decodeURIComponent(value).toLowerCase();
  } catch {
    // Treat malformed percent-encoding as a non-placeholder credential.
  }
  return (
    PLACEHOLDER_CREDENTIALS.has(normalized) ||
    /^<[^>]+>$/u.test(normalized) ||
    /^\$\{[^}]+\}$/u.test(normalized) ||
    /^[*#]{2,}$/u.test(normalized) ||
    /^(?:db|database)[-_]?(?:user|pass(?:word)?)$/u.test(normalized) ||
    /^(?:example|my|your)[-_]/u.test(normalized)
  );
};
const hasCredentialUrlSecret = (text, fileSha256) => {
  const matches = [...text.matchAll(CREDENTIAL_URL_PATTERN)];
  return (
    matches.length > 0 &&
    !SAFE_CREDENTIAL_URL_EXAMPLE_SHA256.has(fileSha256) &&
    matches.some(
      (match) =>
        !isPlaceholderCredential(match.groups.username) ||
        !isPlaceholderCredential(match.groups.password),
    )
  );
};
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const isContained = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);
const isSafeRelativePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.posix.isAbsolute(value) &&
  !value.includes("\\") &&
  path.posix.normalize(value) === value &&
  !value.split("/").some((part) => part === ".." || part === ".");
const hasAsciiControl = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};
const hashFile = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ sha256: hash.digest("hex"), bytes }));
  });

const readRegularArtifactFile = async (root, relativePath) => {
  assert.ok(isSafeRelativePath(relativePath), `Unsafe artifact path: ${relativePath}`);
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const metadata = await lstat(absolutePath);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `Expected regular artifact file: ${relativePath}`,
  );
  return readFile(absolutePath);
};

const verifyPackagedContract = async ({ root, release, generation }) => {
  const basePath = "deployment/deployment-contract.v1.json";
  const extensionPath = "deployment/stage-7-extension.v1.json";
  const verifierPath = "deployment/verify-stage7-artifact.mjs";
  const baseBytes = await readRegularArtifactFile(root, basePath);
  const extensionBytes = await readRegularArtifactFile(root, extensionPath);
  const verifierBytes = await readRegularArtifactFile(root, verifierPath);
  assert.equal(
    sha256(baseBytes),
    ACCEPTED_STAGE6_CONTRACT_SHA256,
    "Packaged predecessor contract differs from accepted bytes",
  );
  assert.deepEqual(
    verifierBytes,
    await readFile(fileURLToPath(import.meta.url)),
    "Packaged Stage 7 verifier differs from the verifier being executed",
  );

  const expectedMetadata = [
    [release.deploymentContract, basePath, baseBytes, "predecessor deployment contract", 1],
    [
      release.stage7DeploymentContract,
      extensionPath,
      extensionBytes,
      "Stage 7 deployment extension",
      1,
    ],
    [release.stage7Verifier, verifierPath, verifierBytes, "Stage 7 artifact verifier", undefined],
  ];
  for (const [metadata, expectedPath, bytes, label, schemaVersion] of expectedMetadata) {
    assert.equal(metadata?.path, expectedPath, `Unexpected ${label} path`);
    if (schemaVersion !== undefined) {
      assert.equal(metadata?.schemaVersion, schemaVersion, `Unsupported ${label} metadata schema`);
    }
    assert.equal(metadata?.sha256, sha256(bytes), `${label} SHA-256 mismatch`);
  }

  const base = JSON.parse(baseBytes.toString("utf8"));
  const extension = JSON.parse(extensionBytes.toString("utf8"));
  assert.equal(
    extension?.candidate?.generation,
    generation,
    "Packaged Stage 7 extension generation mismatch",
  );
  assert.equal(
    extension?.candidate?.sourceBranch,
    "phase-1/stage-7",
    "Packaged Stage 7 branch mismatch",
  );
  assert.equal(extension?.extends?.path, "deploy/contracts/deployment-contract.v1.json");
  assert.equal(
    extension?.extends?.sha256,
    sha256(baseBytes),
    "Packaged predecessor contract hash mismatch",
  );
  assert.equal(extension?.artifact?.designation, "DEVELOPMENT_CANDIDATE_UNQUALIFIED");
  assert.equal(extension?.artifact?.stage7ExtensionPath, extensionPath);
  assert.equal(extension?.artifact?.stage7VerifierPath, verifierPath);
  assert.equal(
    extension?.artifact?.successorBaselinePath,
    `provenance/stage7-successor-baseline-${generation}.json`,
  );
  assert.equal(extension?.artifact?.archiveFormat, "tar.gz");
  assert.equal(extension?.artifact?.compileOnCT200, false);
  assert.equal(extension?.artifact?.baseRuntimeContractUnchanged, true);
  assert.equal(extension?.database?.host, "127.0.0.1");
  assert.equal(extension?.database?.tlsPolicy, "DISABLED_LOOPBACK_ONLY");
  assert.equal(extension?.database?.betterAuthRuntimeMigrations, false);
  assert.equal(extension?.stage8Actions, 0, "Stage 8 actions must remain zero");
  assert.equal(base?.artifact?.currentSymlink, extension?.artifact?.currentSymlink);
  assert.equal(base?.artifact?.releaseRoot, extension?.artifact?.releaseRoot);
  return { base, extension };
};

const assertExactKeys = (value, expected, label) =>
  assert.deepEqual(
    Object.keys(value ?? {}).sort(bytewise),
    [...expected].sort(bytewise),
    `${label} has unexpected or missing fields`,
  );

const verifyReleaseMetadataAndLayout = async ({ root, release, generation, contracts }) => {
  const { base, extension } = contracts;
  assertExactKeys(
    release,
    [
      "schemaVersion",
      "artifactId",
      "designation",
      "productionSigning",
      "source",
      "toolchain",
      "qualification",
      "database",
      "deployables",
      "runtime",
      "deploymentContract",
      "stage7DeploymentContract",
      "stage7Verifier",
    ],
    "Stage 7 release metadata",
  );
  assert.equal(release.designation, "DEVELOPMENT_CANDIDATE_UNQUALIFIED");
  assert.deepEqual(release.productionSigning, { status: "NOT_PRODUCTION_SIGNED" });
  assert.deepEqual(release.qualification, {
    canonicalCi: "PENDING_ONE_AUTHORIZED_RUN",
    runCountForGeneration: 0,
  });
  assert.deepEqual(release.toolchain, { node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
  assertExactKeys(
    release.source,
    [
      "branch",
      "commit",
      "tree",
      "successorBaselineGeneration",
      "successorBaselineSha256",
      "lockfilePath",
      "lockfileSha256",
    ],
    "Stage 7 source provenance",
  );
  assert.equal(release.source.successorBaselineGeneration, generation);
  assert.equal(release.source.lockfilePath, "provenance/pnpm-lock.yaml");
  assertExactKeys(
    release.database,
    [
      "migrationHead",
      "migrationFileSha256",
      "migrationChecksumManifestPath",
      "migrationChecksumManifestSha256",
      "runnerEntrypoint",
      "canonicalRunner",
      "deploymentEntrypoint",
      "identityContract",
    ],
    "Stage 7 migration provenance",
  );
  assert.equal(release.database.migrationHead, extension.database.requiredMigration);
  assert.equal(release.database.migrationFileSha256, extension.database.requiredMigrationSha256);
  assert.equal(
    release.database.migrationChecksumManifestPath,
    extension.database.checksumManifestPath,
  );
  assert.equal(
    release.database.migrationChecksumManifestSha256,
    extension.database.checksumManifestSha256,
  );
  assert.equal(release.database.runnerEntrypoint, base.artifact.migrationRunnerEntrypoint);
  assert.equal(release.database.canonicalRunner, base.artifact.canonicalMigrationRunner);
  assert.equal(release.database.deploymentEntrypoint, base.migrator.deploymentEntrypoint);
  assert.deepEqual(release.database.identityContract, {
    sessionUser: base.migrator.sessionUser,
    roleSwitch: base.migrator.roleSwitch,
    currentUser: base.migrator.currentUser,
  });

  const expectedDeployables = [
    { name: "Admin SPA", path: base.artifact.adminWebPath },
    { name: "Portal SPA", path: base.artifact.portalWebPath },
    { name: "Admin API", path: base.artifact.adminApiPath },
    { name: "Portal API", path: base.artifact.portalApiPath },
    { name: "Worker", path: base.artifact.workerPath },
    { name: "Canonical database migrator", path: base.artifact.migratorPath },
    { name: "Database migrations", path: base.artifact.migrationDirectory },
  ];
  assert.deepEqual(
    release.deployables,
    expectedDeployables,
    "Stage 7 deployable inventory differs from the base contract",
  );
  assertExactKeys(release.runtime, ["node"], "Stage 7 runtime metadata");
  assertExactKeys(
    release.runtime.node,
    ["version", "path", "binaryPath", "binarySha256"],
    "Bundled Node metadata",
  );
  assert.equal(release.runtime.node.version, release.toolchain.node);
  assert.equal(release.runtime.node.binaryPath, base.artifact.runtimeNodePath);
  assert.equal(
    release.runtime.node.path,
    path.posix.dirname(path.posix.dirname(release.runtime.node.binaryPath)),
  );
  assert.match(
    release.runtime.node.binarySha256 ?? "",
    /^[a-f0-9]{64}$/u,
    "Invalid bundled Node SHA-256",
  );

  const requiredFiles = [
    `${base.artifact.adminWebPath}/index.html`,
    `${base.artifact.portalWebPath}/index.html`,
    `${base.artifact.adminApiPath}/package.json`,
    `${base.artifact.adminApiPath}/dist/main.js`,
    `${base.artifact.portalApiPath}/package.json`,
    `${base.artifact.portalApiPath}/dist/main.js`,
    `${base.artifact.workerPath}/package.json`,
    `${base.artifact.workerPath}/dist/main.js`,
    `${base.artifact.migratorPath}/package.json`,
    release.database.runnerEntrypoint,
    release.database.canonicalRunner,
    release.database.deploymentEntrypoint,
    base.artifact.instanceManifestPath,
    base.artifact.migrationChecksumManifestPath,
    base.artifact.requiredMigrationPath,
    `migrations/${extension.database.requiredMigration}`,
    `${base.artifact.migratorMigrationDirectory}/${extension.database.requiredMigration}`,
    `${base.artifact.migratorMigrationDirectory}/checksums.json`,
  ];
  const requiredContents = new Map();
  for (const relativePath of requiredFiles) {
    requiredContents.set(relativePath, await readRegularArtifactFile(root, relativePath));
  }
  for (const [relativePath, expectedName] of [
    [`${base.artifact.adminApiPath}/package.json`, "@travelos/admin-api"],
    [`${base.artifact.portalApiPath}/package.json`, "@travelos/portal-api"],
    [`${base.artifact.workerPath}/package.json`, "@travelos/worker"],
    [`${base.artifact.migratorPath}/package.json`, "@travelos/migrator"],
  ]) {
    assert.equal(
      JSON.parse(requiredContents.get(relativePath).toString("utf8")).name,
      expectedName,
    );
  }
  const migrationBytes = requiredContents.get(`migrations/${extension.database.requiredMigration}`);
  assert.equal(
    sha256(migrationBytes),
    release.database.migrationFileSha256,
    "Packaged migration hash mismatch",
  );
  const migratorMigrationBytes = requiredContents.get(
    `${base.artifact.migratorMigrationDirectory}/${extension.database.requiredMigration}`,
  );
  assert.deepEqual(
    migratorMigrationBytes,
    migrationBytes,
    "Migrator migration copy differs from canonical migration",
  );
  const checksumBytes = requiredContents.get(base.artifact.migrationChecksumManifestPath);
  assert.equal(
    sha256(checksumBytes),
    release.database.migrationChecksumManifestSha256,
    "Migration checksum manifest hash mismatch",
  );
  const checksumManifest = JSON.parse(checksumBytes.toString("utf8"));
  assertExactKeys(
    checksumManifest,
    ["schemaVersion", "algorithm", "migrations"],
    "Migration checksum manifest",
  );
  assert.equal(checksumManifest.schemaVersion, 1, "Unsupported migration checksum manifest schema");
  assert.equal(checksumManifest.algorithm, "sha256", "Unsupported migration checksum algorithm");
  assert.ok(Array.isArray(checksumManifest.migrations) && checksumManifest.migrations.length > 0);
  const migrationNames = checksumManifest.migrations.map((row) => row.file);
  assert.deepEqual(
    migrationNames,
    [...migrationNames].sort(bytewise),
    "Migration chain is not in canonical order",
  );
  assert.equal(
    new Set(migrationNames).size,
    migrationNames.length,
    "Migration checksum manifest contains duplicate files",
  );
  for (const [index, row] of checksumManifest.migrations.entries()) {
    assertExactKeys(row, ["file", "sha256"], `Migration checksum row ${index + 1}`);
    assert.match(row.file ?? "", /^[0-9]{4}_[a-z0-9_]+\.cjs$/u, "Invalid migration chain filename");
    assert.equal(
      Number(row.file.slice(0, 4)),
      index + 1,
      "Migration chain has a sequence gap or unexpected number",
    );
    assert.match(row.sha256 ?? "", /^[a-f0-9]{64}$/u, "Invalid migration checksum row");
  }
  const priorStage6Migration = path.posix.basename(base.artifact.requiredMigrationPath);
  assert.equal(
    migrationNames.at(-2),
    priorStage6Migration,
    "Stage 7 migration chain does not extend the accepted Stage 6 head",
  );
  assert.equal(
    migrationNames.at(-1),
    extension.database.requiredMigration,
    "Stage 7 migration chain head mismatch",
  );
  assert.equal(release.database.migrationHead, migrationNames.at(-1));
  assert.equal(
    requiredContents
      .get(`${base.artifact.migratorMigrationDirectory}/checksums.json`)
      .toString("utf8"),
    checksumBytes.toString("utf8"),
    "Migrator checksum manifest differs from canonical manifest",
  );
  for (const directory of [
    base.artifact.migrationDirectory,
    base.artifact.migratorMigrationDirectory,
  ]) {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    assert.ok(
      entries.every((entry) => entry.isFile()),
      `Migration directory contains a non-file entry: ${directory}`,
    );
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(bytewise),
      [...migrationNames, "checksums.json"].sort(bytewise),
      `Migration directory contains missing or unexpected files: ${directory}`,
    );
  }
  for (const row of checksumManifest.migrations) {
    const canonicalMigration = await readRegularArtifactFile(
      root,
      `${base.artifact.migrationDirectory}/${row.file}`,
    );
    const packagedMigration = await readRegularArtifactFile(
      root,
      `${base.artifact.migratorMigrationDirectory}/${row.file}`,
    );
    assert.equal(
      sha256(canonicalMigration),
      row.sha256,
      `Canonical migration checksum mismatch: ${row.file}`,
    );
    assert.deepEqual(
      packagedMigration,
      canonicalMigration,
      `Migrator migration copy differs from canonical chain: ${row.file}`,
    );
  }
  const headRow = checksumManifest.migrations.at(-1);
  assert.equal(
    headRow.sha256,
    release.database.migrationFileSha256,
    "Migration checksum manifest head hash mismatch",
  );

  const nodePath = path.join(root, release.runtime.node.binaryPath);
  const nodeMetadata = await lstat(nodePath);
  assert.ok((nodeMetadata.mode & 0o111) !== 0, "Bundled Node runtime must be executable");
  const nodeHash = await hashFile(nodePath);
  assert.equal(
    nodeHash.sha256,
    release.runtime.node.binarySha256,
    "Bundled Node runtime hash mismatch",
  );
  const nodeVersion = spawnSync(nodePath, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    env: { PATH: "/usr/bin:/bin" },
  });
  assert.equal(
    nodeVersion.status,
    0,
    `Bundled Node runtime failed: ${nodeVersion.stderr || nodeVersion.error?.message || ""}`,
  );
  assert.equal(
    nodeVersion.stdout.trim(),
    `v${release.runtime.node.version}`,
    "Bundled Node runtime version mismatch",
  );
};

const verifyPayloadChecksums = async (root, payloadRows) => {
  const manifestBytes = await readRegularArtifactFile(root, "payload-manifest.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.schemaVersion, 1, "Unsupported payload manifest schema");
  assert.deepEqual(
    manifest.fileManifestExcludes,
    ["payload-manifest.json", "checksums.txt"],
    "Unexpected payload manifest self-exclusions",
  );
  assert.deepEqual(
    manifest.files,
    payloadRows,
    "Artifact inventory differs from payload-manifest.json",
  );
  const checksumBytes = await readRegularArtifactFile(root, "checksums.txt");
  const expectedChecksums = payloadRows
    .filter((row) => row.type === "file")
    .map((row) => `${row.sha256}  ${row.path}\n`)
    .join("");
  assert.equal(
    checksumBytes.toString("utf8"),
    expectedChecksums,
    "Artifact checksums.txt is incomplete or incorrect",
  );
  return {
    result: "PASS",
    entries: payloadRows.length,
    files: payloadRows.filter((row) => row.type === "file").length,
    symlinks: payloadRows.filter((row) => row.type === "symlink").length,
  };
};

const verifyNoSecretMaterial = async (root, rows) => {
  const findings = [];
  for (const row of rows) {
    const basename = path.posix.basename(row.path);
    if (SECRET_FILENAMES.some((pattern) => pattern.test(basename))) {
      findings.push({ path: row.path, rule: "sensitive-filename" });
      continue;
    }
    if (row.type !== "file") continue;
    let carry = "";
    let containsSecret = false;
    const stream = createReadStream(path.join(root, ...row.path.split("/")));
    for await (const chunk of stream) {
      const text = carry + chunk.toString("latin1");
      if (
        SECRET_PATTERNS.some((pattern) => pattern.test(text)) ||
        hasCredentialUrlSecret(text, row.sha256)
      ) {
        containsSecret = true;
        break;
      }
      carry = text.slice(-8192);
    }
    if (containsSecret) {
      findings.push({ path: row.path, rule: "secret-material-signature" });
    }
  }
  assert.deepEqual(
    findings,
    [],
    `Secret material detected in artifact: ${JSON.stringify(findings)}`,
  );
  return { result: "PASS", scannedFiles: rows.filter((row) => row.type === "file").length };
};

const inventoryArtifact = async (root) => {
  const rows = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => bytewise(left.name, right.name));
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, filePath).split(path.sep).join("/");
      if (EXCLUDED_MANIFEST_FILES.has(relativePath)) continue;
      const metadata = await lstat(filePath);
      if (metadata.isSymbolicLink()) {
        const target = await readlink(filePath);
        const resolvedTarget = await realpath(filePath);
        assert.ok(
          isContained(root, resolvedTarget),
          `Symlink escapes artifact root: ${relativePath}`,
        );
        rows.push({
          path: relativePath,
          type: "symlink",
          target,
          targetSha256: sha256(Buffer.from(target)),
        });
      } else if (metadata.isDirectory()) {
        await visit(filePath);
      } else if (metadata.isFile()) {
        const digest = await hashFile(filePath);
        rows.push({ path: relativePath, type: "file", bytes: digest.bytes, sha256: digest.sha256 });
      } else {
        throw new Error(`Unsupported filesystem object in artifact: ${relativePath}`);
      }
    }
  };
  await visit(root);
  return rows.sort((left, right) => bytewise(left.path, right.path));
};

const verifyArchiveMatchesDirectory = async ({ archivePath, expectedRows, temporaryRoot }) => {
  const listing = execFileSync("tar", ["--list", "--gzip", `--file=${archivePath}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const members = listing.split("\n").filter(Boolean);
  const normalizedMembers = members.map((member) => {
    const relative = member.replace(/^\.\/+/, "").replace(/\/+$/u, "");
    assert.ok(
      relative === "" || (isSafeRelativePath(relative) && !hasAsciiControl(relative)),
      `Unsafe path in candidate archive: ${member}`,
    );
    return relative;
  });
  assert.equal(
    new Set(normalizedMembers).size,
    normalizedMembers.length,
    "Duplicate archive members",
  );

  const scratchRoot = await mkdtemp(path.join(temporaryRoot, "stage7-archive-verify-"));
  try {
    const extractedRoot = path.join(scratchRoot, "release");
    await mkdir(extractedRoot);
    execFileSync(
      "tar",
      [
        "--extract",
        "--gzip",
        `--file=${archivePath}`,
        "--directory",
        extractedRoot,
        "--no-same-owner",
        "--no-same-permissions",
      ],
      { stdio: "ignore" },
    );
    const archivedRows = await inventoryArtifact(extractedRoot);
    assert.deepEqual(
      archivedRows,
      expectedRows,
      "Candidate archive payload differs from its release directory",
    );
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
};

export const verifyStage7Artifact = async ({
  artifactRoot,
  archivePath,
  generation,
  expectedCommit,
  expectedTree,
  expectedBaselineSha256,
  expectedLockfileSha256,
  temporaryRoot = process.env.TMPDIR ?? os.tmpdir(),
}) => {
  assert.match(generation, /^gen[0-9]{2,}$/u, "Invalid Stage 7 generation");
  const root = path.resolve(artifactRoot);
  const rootMetadata = await lstat(root);
  assert.ok(
    rootMetadata.isDirectory() && !rootMetadata.isSymbolicLink(),
    "Artifact root must be a directory",
  );
  const payloadRows = await inventoryArtifact(root);

  const releasePath = path.join(root, "release.json");
  const releaseMetadata = await lstat(releasePath);
  assert.ok(
    releaseMetadata.isFile() && !releaseMetadata.isSymbolicLink(),
    "Artifact release.json must be a regular file",
  );
  const releaseBytes = await readFile(releasePath);
  const release = JSON.parse(releaseBytes.toString("utf8"));
  assert.equal(release.schemaVersion, 1, "Unsupported Stage 7 release metadata schema");
  const artifactIdPrefix = `travelos-phase-1-m1-stage-7-${generation}-`;
  assert.match(
    release.artifactId,
    new RegExp(`^${artifactIdPrefix}[a-f0-9]{8}$`, "u"),
    "Stage 7 artifact ID prefix or format mismatch",
  );
  assert.equal(release.source?.branch, "phase-1/stage-7", "Stage 7 source branch mismatch");
  assert.match(release.source?.commit ?? "", /^[a-f0-9]{40}$/u, "Invalid Stage 7 source commit");
  if (expectedCommit !== undefined) {
    assert.equal(release.source.commit, expectedCommit, "Stage 7 artifact source commit mismatch");
  }
  assert.match(release.source?.tree ?? "", /^[a-f0-9]{40}$/u, "Invalid Stage 7 source tree");
  if (expectedTree !== undefined) {
    assert.equal(release.source.tree, expectedTree, "Stage 7 artifact source tree mismatch");
  }
  assert.equal(
    release.source?.successorBaselineGeneration,
    generation,
    "Stage 7 artifact successor-baseline generation mismatch",
  );
  assert.match(
    release.source?.successorBaselineSha256 ?? "",
    /^[a-f0-9]{64}$/u,
    "Invalid Stage 7 successor-baseline SHA-256",
  );
  if (expectedBaselineSha256 !== undefined) {
    assert.equal(
      release.source.successorBaselineSha256,
      expectedBaselineSha256,
      "Stage 7 artifact successor-baseline SHA-256 mismatch",
    );
  }
  const baselinePath = path.join(
    root,
    "provenance",
    `stage7-successor-baseline-${generation}.json`,
  );
  const baselineBytes = await readFile(baselinePath);
  assert.equal(
    sha256(baselineBytes),
    release.source.successorBaselineSha256,
    "Packaged Stage 7 successor-baseline bytes mismatch",
  );
  assert.equal(
    release.source?.lockfilePath,
    "provenance/pnpm-lock.yaml",
    "Unexpected packaged lockfile path",
  );
  assert.match(release.source?.lockfileSha256 ?? "", /^[a-f0-9]{64}$/u, "Invalid lockfile SHA-256");
  if (expectedLockfileSha256 !== undefined) {
    assert.equal(
      release.source.lockfileSha256,
      expectedLockfileSha256,
      "Stage 7 artifact lockfile SHA-256 mismatch",
    );
  }
  const lockfileBytes = await readFile(path.join(root, "provenance", "pnpm-lock.yaml"));
  assert.equal(
    sha256(lockfileBytes),
    release.source.lockfileSha256,
    "Packaged lockfile bytes mismatch",
  );
  const contracts = await verifyPackagedContract({ root, release, generation });
  await verifyReleaseMetadataAndLayout({ root, release, generation, contracts });
  const payload = await verifyPayloadChecksums(root, payloadRows);
  const secrets = await verifyNoSecretMaterial(root, payloadRows);
  assert.ok(
    release.artifactId.endsWith(release.source.commit.slice(0, 8)),
    "Artifact ID must end with the source commit prefix",
  );

  let archive = { sha256: null, bytes: null };
  if (archivePath !== undefined) {
    const archiveMetadata = await lstat(archivePath);
    assert.ok(
      archiveMetadata.isFile() && !archiveMetadata.isSymbolicLink(),
      "Candidate archive must be a regular file",
    );
    await verifyArchiveMatchesDirectory({
      archivePath,
      expectedRows: payloadRows,
      temporaryRoot,
    });
    archive = await hashFile(archivePath);
  }

  return {
    result: "PASS",
    generation,
    releaseMetadataSha256: sha256(releaseBytes),
    artifactId: release.artifactId,
    artifactSha256: archive.sha256,
    artifactBytes: archive.bytes,
    payloadEntries: payload.entries,
    payloadFiles: payload.files,
    payloadSymlinks: payload.symlinks,
    sensitiveDataScan: secrets,
  };
};

const parseArguments = (argumentsList) => {
  const options = { generation: "gen01" };
  const seen = new Set();
  for (const argument of argumentsList) {
    const separator = argument.indexOf("=");
    assert.ok(argument.startsWith("--") && separator > 2, `Unsupported argument: ${argument}`);
    const name = argument.slice(2, separator);
    assert.ok(!seen.has(name), `Duplicate argument: --${name}`);
    seen.add(name);
    const value = argument.slice(separator + 1);
    if (name === "artifact-root") options.artifactRoot = value;
    else if (name === "archive") options.archivePath = value;
    else if (name === "generation") options.generation = value;
    else if (name === "expected-commit") options.expectedCommit = value;
    else if (name === "expected-tree") options.expectedTree = value;
    else if (name === "temporary-root") options.temporaryRoot = value;
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  assert.ok(options.artifactRoot, "Missing required --artifact-root");
  return options;
};

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directEntry) {
  try {
    const result = await verifyStage7Artifact(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ result: "FAIL", error: error.message })}\n`);
    process.exitCode = 1;
  }
}
