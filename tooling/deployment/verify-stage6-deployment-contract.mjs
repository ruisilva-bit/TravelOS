import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_ROOT = "/opt/travelos/current";
const REQUIRED_MIGRATION = "0011_stage6_trip_publication.cjs";
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
// Exact pinned upstream documentation/test bytes contain example URLs, not runtime credentials.
// Any byte change invalidates this narrow exception and returns the file to normal scanning.
const SAFE_CREDENTIAL_URL_EXAMPLE_SHA256 = new Set([
  "a69bdc042c58e8d940e6a5f09ed93646e697af04869a65cf45e9244e950cfb06",
  "c2cba494f78d950f91ec21298bbf60a949dc379d4f873ffe3ee319c918a175e0",
  "f61c153d5abbe4381a1fba0d41be0babdd5de51c626ee7ff14cede14dedc33f1",
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
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const isSafeRelativePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.posix.isAbsolute(value) &&
  !value.includes("\\") &&
  path.posix.normalize(value) === value &&
  !value.split("/").includes("..") &&
  !value.split("/").includes(".");
const exactKeys = (value, expected, label) =>
  assert.deepEqual(
    Object.keys(value ?? {}).sort(bytewise),
    [...expected].sort(bytewise),
    `${label} has unexpected or missing fields`,
  );
const requireFile = async (root, relativePath) => {
  assert.ok(isSafeRelativePath(relativePath), `Unsafe artifact path: ${relativePath}`);
  const filePath = path.join(root, ...relativePath.split("/"));
  const metadata = await lstat(filePath);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `Expected regular file: ${relativePath}`,
  );
  const resolved = await realpath(filePath);
  assert.ok(isContained(root, resolved), `Artifact file escaped root: ${relativePath}`);
  return readFile(filePath);
};
const isContained = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

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
        const target = await readlinkTarget(filePath);
        const resolvedTarget = await realpath(filePath);
        assert.ok(
          isContained(root, resolvedTarget),
          `Symlink escapes artifact root: ${relativePath}`,
        );
        rows.push({
          path: relativePath,
          type: "symlink",
          target,
          targetSha256: sha256(Buffer.from(target, "utf8")),
        });
      } else if (metadata.isDirectory()) {
        await visit(filePath);
      } else if (metadata.isFile()) {
        const bytes = await readFile(filePath);
        rows.push({ path: relativePath, type: "file", bytes: bytes.length, sha256: sha256(bytes) });
      } else {
        throw new Error(`Unsupported filesystem object in artifact: ${relativePath}`);
      }
    }
  };
  await visit(root);
  return rows.sort((left, right) => bytewise(left.path, right.path));
};
const readlinkTarget = (filePath) => readlink(filePath);

const verifyNoSecretMaterial = async (root, rows) => {
  const findings = [];
  for (const row of rows) {
    const basename = path.posix.basename(row.path);
    if (SECRET_FILENAMES.some((pattern) => pattern.test(basename))) {
      findings.push({ path: row.path, rule: "sensitive-filename" });
      continue;
    }
    if (row.type !== "file") continue;
    const bytes = await readFile(path.join(root, ...row.path.split("/")));
    const text = bytes.toString("utf8");
    if (
      SECRET_PATTERNS.some((pattern) => pattern.test(text)) ||
      hasCredentialUrlSecret(text, row.sha256)
    ) {
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

const parseUnit = async (unitDirectory, service) => {
  const unitPath = path.join(unitDirectory, service.unit);
  const metadata = await lstat(unitPath);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `Missing regular systemd unit: ${service.unit}`,
  );
  const dropInDirectory = `${unitPath}.d`;
  try {
    const dropIns = await readdir(dropInDirectory);
    assert.equal(
      dropIns.length,
      0,
      `Systemd drop-ins are unsupported and must be reviewed: ${service.unit}`,
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const directives = new Map();
  let inService = false;
  const text = await readFile(unitPath, "utf8");
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      inService = line === "[Service]";
      continue;
    }
    if (!inService) continue;
    const separator = line.indexOf("=");
    assert.ok(separator > 0, `Unsupported systemd unit syntax in ${service.unit}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    const values = directives.get(key) ?? [];
    values.push(value);
    directives.set(key, values);
  }
  const single = (key) => {
    const values = directives.get(key) ?? [];
    assert.equal(values.length, 1, `${service.unit} must declare exactly one ${key}`);
    return values[0];
  };
  const execStart = single("ExecStart");
  assert.ok(!/["'`\\;]/u.test(execStart), `Unsupported ExecStart syntax in ${service.unit}`);
  const execTokens = execStart.split(/\s+/u).filter(Boolean);
  const credentials = [];
  for (const kind of ["LoadCredential", "LoadCredentialEncrypted"]) {
    for (const value of directives.get(kind) ?? []) {
      const separator = value.indexOf(":");
      assert.ok(
        separator > 0 && separator < value.length - 1,
        `Invalid ${kind} reference in ${service.unit}`,
      );
      credentials.push({
        kind,
        name: value.slice(0, separator),
        source: value.slice(separator + 1),
      });
    }
  }
  credentials.sort((left, right) => bytewise(left.name, right.name));
  return {
    user: single("User"),
    group: single("Group"),
    workingDirectory: single("WorkingDirectory"),
    execTokens,
    credentials,
    execDirectives: [...directives.entries()]
      .filter(([key]) => key.startsWith("Exec"))
      .flatMap(([, values]) => values),
  };
};

const verifyContractShape = (contract) => {
  exactKeys(
    contract,
    ["schemaVersion", "contractId", "artifact", "database", "migrator", "services", "provenance"],
    "Deployment contract",
  );
  assert.equal(contract.schemaVersion, 1, "Unsupported deployment contract schema version");
  assert.equal(
    contract.contractId,
    "travelos-stage6-ct-runtime-v1",
    "Unexpected deployment contract ID",
  );
  exactKeys(
    contract.artifact,
    [
      "generation",
      "artifactIdPrefix",
      "sourceBranch",
      "sourceBaselineGeneration",
      "designation",
      "productionSigningStatus",
      "canonicalCiStatusAtBuild",
      "releaseMetadataPath",
      "sourceContractPath",
      "contractPath",
      "verifierPath",
      "payloadManifestPath",
      "checksumsPath",
      "successorBaselinePath",
      "currentSymlink",
      "releaseRoot",
      "runtimeNodePath",
      "adminWebPath",
      "portalWebPath",
      "adminApiPath",
      "portalApiPath",
      "workerPath",
      "migratorPath",
      "migrationDirectory",
      "migratorMigrationDirectory",
      "migrationChecksumManifestPath",
      "requiredMigrationPath",
      "migrationRunnerEntrypoint",
      "canonicalMigrationRunner",
      "instanceManifestPath",
    ],
    "Deployment contract artifact",
  );
  assert.equal(contract.artifact.generation, 7);
  assert.equal(contract.artifact.sourceBranch, "phase-1/stage-6");
  assert.equal(contract.artifact.sourceBaselineGeneration, 7);
  assert.equal(contract.artifact.currentSymlink, CURRENT_ROOT);
  assert.equal(contract.artifact.releaseRoot, "/opt/travelos/releases");
  assert.equal(contract.artifact.artifactIdPrefix, "travelos-phase-1-m1-stage-6-gen07-");
  assert.equal(contract.artifact.designation, "DEVELOPMENT_CANDIDATE_UNQUALIFIED");
  assert.equal(contract.artifact.productionSigningStatus, "NOT_PRODUCTION_SIGNED");
  assert.equal(contract.artifact.canonicalCiStatusAtBuild, "PENDING_ONE_AUTHORIZED_RUN");
  assert.equal(
    contract.artifact.sourceContractPath,
    "deploy/contracts/deployment-contract.v1.json",
  );
  assert.equal(contract.artifact.contractPath, "deployment/deployment-contract.v1.json");
  assert.equal(contract.artifact.verifierPath, "deployment/verify-stage6-deployment-contract.mjs");
  assert.equal(contract.artifact.payloadManifestPath, "payload-manifest.json");
  assert.equal(contract.artifact.checksumsPath, "checksums.txt");
  assert.equal(
    contract.artifact.successorBaselinePath,
    "provenance/stage6-successor-baseline-generation-07-revision-02.json",
  );
  assert.equal(contract.artifact.migratorMigrationDirectory, "migrator/migrations");
  assert.equal(
    contract.artifact.migrationRunnerEntrypoint,
    "migrator/dist/packages/migrator/src/run-migrations.js",
  );
  assert.equal(
    contract.artifact.canonicalMigrationRunner,
    "migrator/dist/tooling/database/migration-runner.js",
  );
  assert.equal(
    contract.artifact.instanceManifestPath,
    "instance-manifest/development.example.json",
  );
  assert.deepEqual(
    [
      contract.artifact.runtimeNodePath,
      contract.artifact.adminWebPath,
      contract.artifact.portalWebPath,
      contract.artifact.adminApiPath,
      contract.artifact.portalApiPath,
      contract.artifact.workerPath,
      contract.artifact.migratorPath,
      contract.artifact.migrationDirectory,
      contract.artifact.requiredMigrationPath,
      contract.artifact.migrationChecksumManifestPath,
    ],
    [
      "runtime/node/bin/node",
      "admin-web",
      "portal-web",
      "apps/admin-api",
      "apps/portal-api",
      "apps/worker",
      "migrator",
      "migrations",
      "migrations/0011_stage6_trip_publication.cjs",
      "migrations/checksums.json",
    ],
    "Artifact paths differ from the authorized generation-07 layout",
  );
  for (const key of [
    "releaseMetadataPath",
    "contractPath",
    "verifierPath",
    "payloadManifestPath",
    "checksumsPath",
    "successorBaselinePath",
    "runtimeNodePath",
    "adminWebPath",
    "portalWebPath",
    "adminApiPath",
    "portalApiPath",
    "workerPath",
    "migratorPath",
    "migrationDirectory",
    "migratorMigrationDirectory",
    "migrationChecksumManifestPath",
    "requiredMigrationPath",
    "migrationRunnerEntrypoint",
    "canonicalMigrationRunner",
    "instanceManifestPath",
  ]) {
    assert.ok(isSafeRelativePath(contract.artifact[key]), `Unsafe contract path: ${key}`);
  }
  exactKeys(
    contract.database,
    ["host", "port", "name", "tlsPolicy", "runtimeIdentities"],
    "Deployment contract database",
  );
  exactKeys(
    contract.database.runtimeIdentities,
    ["adminApi", "portalApi", "worker"],
    "Database runtime identities",
  );
  for (const [name, identity] of Object.entries(contract.database.runtimeIdentities)) {
    exactKeys(
      identity,
      [
        "roleName",
        "connectionExpected",
        "systemdCredentialName",
        ...(name === "worker" ? ["manifestCredentialReference"] : []),
      ],
      `Database identity ${name}`,
    );
  }
  assert.deepEqual(
    contract.database,
    {
      host: "127.0.0.1",
      port: 5432,
      name: "travelos_development",
      tlsPolicy: "DISABLED_LOOPBACK_ONLY",
      runtimeIdentities: {
        adminApi: {
          roleName: "travelos_admin_api",
          connectionExpected: true,
          systemdCredentialName: "admin-api-db",
        },
        portalApi: {
          roleName: "travelos_portal_api",
          connectionExpected: true,
          systemdCredentialName: "portal-api-db",
        },
        worker: {
          roleName: "travelos_worker",
          connectionExpected: false,
          systemdCredentialName: null,
          manifestCredentialReference: "systemd-credential:worker-db",
        },
      },
    },
    "Database identity or loopback contract changed",
  );
  exactKeys(
    contract.migrator,
    ["executor", "credentialName", "credentialSource", "sessionUser", "roleSwitch", "currentUser"],
    "Migrator contract",
  );
  assert.deepEqual(
    contract.migrator,
    {
      executor: "travelos-migrator-exec",
      credentialName: "migrator-db",
      credentialSource: "/etc/credstore.encrypted/travelos-migrator-db",
      sessionUser: "travelos_migrator",
      roleSwitch: "SET ROLE travelos_owner",
      currentUser: "travelos_owner",
    },
    "Canonical migration identity or credential reference changed",
  );
  assert.equal(contract.services.length, 3, "Exactly three runtime service units are required");
  for (const service of contract.services) {
    exactKeys(
      service,
      [
        "unit",
        "user",
        "group",
        "workingDirectory",
        "execStart",
        "credentials",
        "databaseRole",
        "listener",
      ],
      `Service contract ${service.unit}`,
    );
  }
  assert.deepEqual(
    contract.services.map((service) => ({
      unit: service.unit,
      user: service.user,
      group: service.group,
      databaseRole: service.databaseRole,
    })),
    [
      {
        unit: "travelos-admin-api.service",
        user: "travelos-admin",
        group: "travelos-runtime",
        databaseRole: "travelos_admin_api",
      },
      {
        unit: "travelos-portal-api.service",
        user: "travelos-portal",
        group: "travelos-runtime",
        databaseRole: "travelos_portal_api",
      },
      {
        unit: "travelos-worker.service",
        user: "travelos-worker",
        group: "travelos-runtime",
        databaseRole: "travelos_worker",
      },
    ],
    "Runtime service identities differ from the installed Stage 5 contract",
  );
  assert.deepEqual(
    contract.services.map((service) => service.listener),
    [
      { host: "127.0.0.1", port: 3101, healthMethod: "GET", healthPath: "/health/live" },
      { host: "127.0.0.1", port: 3102, healthMethod: "GET", healthPath: "/health/live" },
      null,
    ],
    "Runtime ports or health endpoints differ from the accepted contract",
  );
  exactKeys(
    contract.provenance,
    [
      "requiredReleaseFields",
      "requiredSourceFields",
      "externalCiReceiptRequired",
      "archiveSha256RequiredInExternalReceipt",
    ],
    "Provenance contract",
  );
  assert.deepEqual(
    contract.provenance.requiredReleaseFields,
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
    ],
    "Release provenance field requirements changed",
  );
  assert.deepEqual(
    contract.provenance.requiredSourceFields,
    [
      "branch",
      "commit",
      "tree",
      "successorBaselineGeneration",
      "successorBaselineSha256",
      "lockfilePath",
      "lockfileSha256",
    ],
    "Source provenance field requirements changed",
  );
  assert.equal(contract.provenance.externalCiReceiptRequired, true);
  assert.equal(contract.provenance.archiveSha256RequiredInExternalReceipt, true);
};

const verifyReleaseMetadata = async (root, contract, contractBytes) => {
  const artifact = contract.artifact;
  const releaseBytes = await requireFile(root, artifact.releaseMetadataPath);
  const release = JSON.parse(releaseBytes.toString("utf8"));
  for (const field of contract.provenance.requiredReleaseFields) {
    assert.ok(Object.hasOwn(release, field), `Release metadata is missing ${field}`);
  }
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.designation, artifact.designation);
  assert.equal(release.productionSigning?.status, artifact.productionSigningStatus);
  assert.match(release.artifactId, new RegExp(`^${artifact.artifactIdPrefix}[a-f0-9]{8}$`));
  assert.ok(
    release.artifactId.endsWith(release.source?.commit?.slice(0, 8)),
    "Artifact ID is not bound to the source commit",
  );
  for (const field of contract.provenance.requiredSourceFields) {
    assert.ok(
      Object.hasOwn(release.source ?? {}, field),
      `Release source provenance is missing ${field}`,
    );
  }
  assert.equal(release.source.branch, artifact.sourceBranch);
  assert.match(release.source.commit, /^[a-f0-9]{40}$/u);
  assert.match(release.source.tree, /^[a-f0-9]{40}$/u);
  assert.equal(release.source.successorBaselineGeneration, artifact.sourceBaselineGeneration);
  assert.match(release.source.successorBaselineSha256, /^[a-f0-9]{64}$/u);
  assert.equal(release.source.lockfilePath, "provenance/pnpm-lock.yaml");
  assert.equal(release.qualification?.canonicalCi, artifact.canonicalCiStatusAtBuild);
  assert.equal(
    release.qualification?.runCountForGeneration,
    0,
    "Build metadata must predate the one-shot CI run",
  );
  assert.equal(release.runtime?.node?.version, "24.19.0");
  assert.equal(release.toolchain?.node, "24.19.0");
  assert.equal(release.toolchain?.pnpm, "11.21.0");
  assert.equal(release.runtime.node.path, "runtime/node");
  assert.equal(release.runtime.node.binaryPath, artifact.runtimeNodePath);
  const nodeBytes = await requireFile(root, artifact.runtimeNodePath);
  assert.equal(
    sha256(nodeBytes),
    release.runtime.node.binarySha256,
    "Bundled Node binary provenance mismatch",
  );

  const lockfileBytes = await requireFile(root, release.source.lockfilePath);
  assert.equal(
    sha256(lockfileBytes),
    release.source.lockfileSha256,
    "Lockfile provenance mismatch",
  );
  const baselineBytes = await requireFile(root, artifact.successorBaselinePath);
  assert.equal(
    sha256(baselineBytes),
    release.source.successorBaselineSha256,
    "Successor-baseline provenance mismatch",
  );
  const contractMetadata = release.deploymentContract;
  exactKeys(
    contractMetadata,
    ["path", "schemaVersion", "sha256"],
    "Release deployment contract binding",
  );
  assert.equal(contractMetadata.path, artifact.contractPath);
  assert.equal(contractMetadata.schemaVersion, 1);
  assert.equal(
    contractMetadata.sha256,
    sha256(contractBytes),
    "Release metadata does not bind the deployment contract",
  );

  const migrationBytes = await requireFile(root, artifact.requiredMigrationPath);
  assert.equal(
    sha256(migrationBytes),
    release.database?.migrationFileSha256,
    "Migration file provenance mismatch",
  );
  const checksumBytes = await requireFile(root, artifact.migrationChecksumManifestPath);
  assert.equal(
    sha256(checksumBytes),
    release.database?.migrationChecksumManifestSha256,
    "Migration checksum-manifest provenance mismatch",
  );
  assert.equal(
    release.database?.migrationChecksumManifestPath,
    artifact.migrationChecksumManifestPath,
  );
  assert.equal(release.database?.migrationHead, REQUIRED_MIGRATION);
  assert.equal(release.database?.runnerEntrypoint, artifact.migrationRunnerEntrypoint);
  assert.equal(release.database?.canonicalRunner, artifact.canonicalMigrationRunner);
  assert.equal(release.database?.identityContract?.sessionUser, contract.migrator.sessionUser);
  assert.equal(release.database?.identityContract?.roleSwitch, contract.migrator.roleSwitch);
  assert.equal(release.database?.identityContract?.currentUser, contract.migrator.currentUser);

  const checksums = JSON.parse(checksumBytes.toString("utf8"));
  assert.equal(checksums.schemaVersion, 1);
  assert.equal(checksums.algorithm, "sha256");
  assert.ok(Array.isArray(checksums.migrations));
  const migrationRow = checksums.migrations.find((row) => row.file === REQUIRED_MIGRATION);
  assert.ok(migrationRow, `Migration checksum manifest is missing ${REQUIRED_MIGRATION}`);
  assert.equal(
    migrationRow.sha256,
    sha256(migrationBytes),
    "Migration 0011 checksum does not match its bytes",
  );
  const nestedChecksum = await requireFile(
    root,
    `${artifact.migratorMigrationDirectory}/checksums.json`,
  );
  assert.deepEqual(
    nestedChecksum,
    checksumBytes,
    "Packaged migrator migration manifest differs from canonical chain",
  );
  const nestedMigration = await requireFile(
    root,
    `${artifact.migratorMigrationDirectory}/${REQUIRED_MIGRATION}`,
  );
  assert.deepEqual(
    nestedMigration,
    migrationBytes,
    "Packaged migrator migration differs from canonical chain",
  );

  const expectedDeployables = [
    ["Admin SPA", artifact.adminWebPath],
    ["Portal SPA", artifact.portalWebPath],
    ["Admin API", artifact.adminApiPath],
    ["Portal API", artifact.portalApiPath],
    ["Worker", artifact.workerPath],
    ["Canonical database migrator", artifact.migratorPath],
    ["Database migrations", artifact.migrationDirectory],
  ];
  for (const [name, expectedPath] of expectedDeployables) {
    const matches = release.deployables.filter((row) => row.name === name);
    assert.equal(matches.length, 1, `Release metadata must declare exactly one ${name} deployable`);
    assert.equal(
      matches[0].path,
      expectedPath,
      `${name} deployable path violates the deployment contract`,
    );
  }
  return {
    artifactId: release.artifactId,
    sourceCommit: release.source.commit,
    migrationHead: release.database.migrationHead,
  };
};

const verifyInstanceManifest = async (root, contract) => {
  const manifestBytes = await requireFile(root, contract.artifact.instanceManifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.environment, "DEVELOPMENT");
  assert.equal(manifest.database?.host, contract.database.host);
  assert.equal(manifest.database?.port, contract.database.port);
  assert.equal(manifest.database?.name, contract.database.name);
  assert.equal(manifest.database?.tlsPolicy, contract.database.tlsPolicy);
  const roles = manifest.database?.runtimeRoles;
  for (const key of ["adminApi", "portalApi", "worker"]) {
    assert.equal(roles?.[key]?.roleName, contract.database.runtimeIdentities[key].roleName);
  }
  for (const key of ["adminApi", "portalApi", "worker"]) {
    const reference = roles?.[key]?.credentialReference;
    const expectedName = contract.database.runtimeIdentities[key].systemdCredentialName;
    if (expectedName === null) {
      assert.equal(reference, contract.database.runtimeIdentities[key].manifestCredentialReference);
    } else {
      assert.equal(reference, `systemd-credential:${expectedName}`);
    }
  }
  const adminListener = manifest.runtime?.listeners?.adminApi;
  const portalListener = manifest.runtime?.listeners?.portalApi;
  const adminContract = contract.services.find(
    (service) => service.unit === "travelos-admin-api.service",
  );
  const portalContract = contract.services.find(
    (service) => service.unit === "travelos-portal-api.service",
  );
  assert.deepEqual(adminListener, {
    host: adminContract.listener.host,
    port: adminContract.listener.port,
  });
  assert.deepEqual(portalListener, {
    host: portalContract.listener.host,
    port: portalContract.listener.port,
  });
  return {
    result: "PASS",
    database: contract.database.name,
    runtimeRoles: Object.fromEntries(
      Object.entries(roles).map(([key, value]) => [key, value.roleName]),
    ),
  };
};

const verifySystemdUnits = async (unitDirectory, root, contract) => {
  const unitRoot = await realpath(unitDirectory);
  const names = contract.services.map((service) => service.unit).sort(bytewise);
  assert.deepEqual(names, [
    "travelos-admin-api.service",
    "travelos-portal-api.service",
    "travelos-worker.service",
  ]);
  const verified = [];
  for (const service of contract.services) {
    const unit = await parseUnit(unitRoot, service);
    assert.equal(unit.user, service.user, `Wrong OS user in ${service.unit}`);
    assert.equal(unit.group, service.group, `Wrong OS group in ${service.unit}`);
    assert.equal(
      unit.workingDirectory,
      service.workingDirectory,
      `Wrong working directory in ${service.unit}`,
    );
    assert.deepEqual(
      unit.execTokens,
      service.execStart,
      `ExecStart does not match deployment contract: ${service.unit}`,
    );
    const expectedCredentials = [...service.credentials].sort((left, right) =>
      bytewise(left.name, right.name),
    );
    assert.deepEqual(
      unit.credentials,
      expectedCredentials,
      `Systemd credential references mismatch: ${service.unit}`,
    );
    assert.equal(
      service.databaseRole,
      contract.database.runtimeIdentities[
        service.unit.includes("admin")
          ? "adminApi"
          : service.unit.includes("portal")
            ? "portalApi"
            : "worker"
      ].roleName,
    );
    for (const directive of unit.execDirectives) {
      for (const match of directive.matchAll(/\/opt\/travelos\/current\/([^\s"'`\\;]+)/gu)) {
        const relativePath = match[1];
        assert.ok(
          isSafeRelativePath(relativePath),
          `Unsafe runtime path in ${service.unit}: ${relativePath}`,
        );
        const filePath = path.join(root, ...relativePath.split("/"));
        await lstat(filePath).then(
          (metadata) =>
            assert.ok(
              metadata.isFile() || metadata.isDirectory(),
              `Unit points to missing artifact path: ${relativePath}`,
            ),
          () => assert.fail(`Unit points to missing artifact path: ${relativePath}`),
        );
      }
    }
    verified.push({
      unit: service.unit,
      user: unit.user,
      group: unit.group,
      systemdReferenceNames: unit.credentials.map((row) => row.name),
    });
  }
  return { result: "PASS", units: verified };
};

const verifyPayloadChecksums = async (root, contract, inventory) => {
  const manifestBytes = await requireFile(root, contract.artifact.payloadManifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.fileManifestExcludes, [...EXCLUDED_MANIFEST_FILES]);
  assert.deepEqual(
    manifest.files,
    inventory,
    "Artifact inventory differs from payload-manifest.json",
  );
  const checksumBytes = await requireFile(root, contract.artifact.checksumsPath);
  const expected = inventory
    .filter((row) => row.type === "file")
    .map((row) => `${row.sha256}  ${row.path}\n`)
    .join("");
  assert.equal(
    checksumBytes.toString("utf8"),
    expected,
    "Artifact checksums.txt is incomplete or incorrect",
  );
  return {
    result: "PASS",
    entries: inventory.length,
    files: inventory.filter((row) => row.type === "file").length,
    symlinks: inventory.filter((row) => row.type === "symlink").length,
  };
};

export const verifyStage6DeploymentContract = async ({ artifactRoot, unitDirectory }) => {
  assert.ok(
    typeof artifactRoot === "string" && artifactRoot.length > 0,
    "--artifact-root is required",
  );
  assert.ok(
    typeof unitDirectory === "string" && unitDirectory.length > 0,
    "--unit-dir is required",
  );
  const root = await realpath(artifactRoot);
  const rootMetadata = await lstat(root);
  assert.ok(rootMetadata.isDirectory(), "Artifact root must be a directory");
  const contractPath = path.join(root, "deployment/deployment-contract.v1.json");
  const contractBytes = await readFile(contractPath);
  const contract = JSON.parse(contractBytes.toString("utf8"));
  verifyContractShape(contract);
  assert.equal(contract.artifact.contractPath, "deployment/deployment-contract.v1.json");
  assert.equal(contract.artifact.verifierPath, "deployment/verify-stage6-deployment-contract.mjs");

  const inventory = await inventoryArtifact(root);
  for (const relativePath of [
    contract.artifact.runtimeNodePath,
    `${contract.artifact.adminApiPath}/dist/main.js`,
    `${contract.artifact.portalApiPath}/dist/main.js`,
    `${contract.artifact.workerPath}/dist/main.js`,
    `${contract.artifact.migratorPath}/${contract.artifact.migrationRunnerEntrypoint.slice(contract.artifact.migratorPath.length + 1)}`,
    `${contract.artifact.migratorPath}/${contract.artifact.canonicalMigrationRunner.slice(contract.artifact.migratorPath.length + 1)}`,
    contract.artifact.migrationChecksumManifestPath,
    contract.artifact.requiredMigrationPath,
    contract.artifact.contractPath,
    contract.artifact.verifierPath,
  ]) {
    await requireFile(root, relativePath);
  }
  for (const relativePath of [
    contract.artifact.adminWebPath,
    contract.artifact.portalWebPath,
    contract.artifact.adminApiPath,
    contract.artifact.portalApiPath,
    contract.artifact.workerPath,
    contract.artifact.migratorPath,
    contract.artifact.migrationDirectory,
  ]) {
    const metadata = await lstat(path.join(root, relativePath));
    assert.ok(metadata.isDirectory(), `Missing artifact directory: ${relativePath}`);
  }

  const release = await verifyReleaseMetadata(root, contract, contractBytes);
  const manifest = await verifyInstanceManifest(root, contract);
  const unitVerification = await verifySystemdUnits(unitDirectory, root, contract);
  const payload = await verifyPayloadChecksums(root, contract, inventory);
  const secrets = await verifyNoSecretMaterial(root, inventory);
  return {
    schemaVersion: 1,
    result: "PASS",
    artifactId: release.artifactId,
    sourceCommit: release.sourceCommit,
    currentSymlink: contract.artifact.currentSymlink,
    migrationHead: release.migrationHead,
    units: unitVerification.units,
    manifest,
    payload,
    secrets,
  };
};

const parseArguments = (argumentsList) => {
  const result = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!["--artifact-root", "--unit-dir"].includes(argument)) {
      throw new Error(`Unsupported argument: ${argument}`);
    }
    const key = argument === "--artifact-root" ? "artifactRoot" : "unitDirectory";
    assert.ok(!Object.hasOwn(result, key), `Duplicate argument: ${argument}`);
    const value = argumentsList[index + 1];
    assert.ok(value && !value.startsWith("--"), `Missing value for ${argument}`);
    result[key] = path.resolve(value);
    index += 1;
  }
  return result;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyStage6DeploymentContract(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ result: "FAIL", error: error instanceof Error ? error.message : "verification failed" })}\n`,
    );
    process.exitCode = 1;
  }
}
