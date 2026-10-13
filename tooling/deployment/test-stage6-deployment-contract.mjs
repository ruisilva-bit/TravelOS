import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { verifyStage6DeploymentContract } from "./verify-stage6-deployment-contract.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const contractSourcePath = path.join(
  repositoryRoot,
  "deploy/contracts/deployment-contract.v1.json",
);
const contractBytes = await readFile(contractSourcePath);
const contract = JSON.parse(contractBytes.toString("utf8"));
const REQUIRED_MIGRATION = "0011_stage6_trip_publication.cjs";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const representativeUnits = {
  "travelos-admin-api.service": `[Unit]\nDescription=TravelOS Admin API\n[Service]\nUser=travelos-admin\nGroup=travelos-runtime\nWorkingDirectory=/opt/travelos/current/apps/admin-api\nExecStart=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/apps/admin-api/dist/main.js --manifest /etc/travelos/instances/development.json\nLoadCredentialEncrypted=admin-api-db:/etc/credstore.encrypted/travelos-admin-api-db\nLoadCredentialEncrypted=staff-auth-realm:/etc/credstore.encrypted/travelos-staff-auth-realm\n[Install]\nWantedBy=multi-user.target\n`,
  "travelos-portal-api.service": `[Unit]\nDescription=TravelOS Portal API\n[Service]\nUser=travelos-portal\nGroup=travelos-runtime\nWorkingDirectory=/opt/travelos/current/apps/portal-api\nExecStart=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/apps/portal-api/dist/main.js --manifest /etc/travelos/instances/development.json\nLoadCredentialEncrypted=portal-api-db:/etc/credstore.encrypted/travelos-portal-api-db\nLoadCredentialEncrypted=portal-auth-realm:/etc/credstore.encrypted/travelos-portal-auth-realm\n[Install]\nWantedBy=multi-user.target\n`,
  "travelos-worker.service": `[Unit]\nDescription=TravelOS Worker\n[Service]\nUser=travelos-worker\nGroup=travelos-runtime\nWorkingDirectory=/opt/travelos/current/apps/worker\nExecStart=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/apps/worker/dist/main.js --manifest /etc/travelos/instances/development.json\n[Install]\nWantedBy=multi-user.target\n`,
};

const writeJson = async (root, relativePath, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return bytes;
};
const addFile = async (root, relativePath, bytes) => {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
};
const collectRows = async (root) => {
  const rows = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => bytewise(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      if (["payload-manifest.json", "checksums.txt"].includes(relativePath)) continue;
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else {
        const bytes = await readFile(absolutePath);
        rows.push({ path: relativePath, type: "file", bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  };
  await visit(root);
  return rows.sort((left, right) => bytewise(left.path, right.path));
};
const writeInventory = async (root) => {
  const files = await collectRows(root);
  await writeJson(root, "payload-manifest.json", {
    schemaVersion: 1,
    fileManifestExcludes: ["payload-manifest.json", "checksums.txt"],
    files,
  });
  const checksums = files.map((row) => `${row.sha256}  ${row.path}\n`).join("");
  await addFile(root, "checksums.txt", Buffer.from(checksums));
};
const createFixture = async ({ legacyLayout = false } = {}) => {
  const temporaryRoot = await mkdtemp(
    path.join(process.env.TMPDIR ?? os.tmpdir(), "travelos-stage6-contract-"),
  );
  const artifactRoot = path.join(temporaryRoot, "release");
  const unitDirectory = path.join(temporaryRoot, "units");
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(unitDirectory, { recursive: true });

  const adminApiPath = legacyLayout ? "admin-api" : contract.artifact.adminApiPath;
  const portalApiPath = legacyLayout ? "portal-api" : contract.artifact.portalApiPath;
  const workerPath = legacyLayout ? "worker" : contract.artifact.workerPath;
  const nodeBytes = Buffer.from("synthetic pinned Node binary bytes\n");
  const migrationBytes = Buffer.from("exports.up = async () => {};\n");
  const checksumManifest = {
    schemaVersion: 1,
    algorithm: "sha256",
    migrations: [{ file: "0011_stage6_trip_publication.cjs", sha256: sha256(migrationBytes) }],
  };
  const checksumBytes = Buffer.from(`${JSON.stringify(checksumManifest, null, 2)}\n`);
  const contractArtifactBytes = contractBytes;
  const lockfileBytes = Buffer.from("lockfileVersion: '9.0'\n");
  const baselineBytes = Buffer.from("synthetic Stage 6 successor baseline generation 06\n");
  const sourceCommit = "a".repeat(40);
  const migrationChecksumManifestSha256 = sha256(checksumBytes);
  const migrationFileSha256 = sha256(migrationBytes);

  const directories = [
    "runtime/node/bin",
    "admin-web",
    "portal-web",
    adminApiPath + "/dist",
    portalApiPath + "/dist",
    workerPath + "/dist",
    "migrator/dist/packages/migrator/src",
    "migrator/dist/tooling/database",
    "migrator/migrations",
    "migrations",
    "instance-manifest",
    "provenance",
    "deployment",
  ];
  for (const directory of directories)
    await mkdir(path.join(artifactRoot, directory), { recursive: true });
  await addFile(artifactRoot, contract.artifact.runtimeNodePath, nodeBytes);
  await addFile(artifactRoot, `${adminApiPath}/dist/main.js`, Buffer.from("admin api\n"));
  await addFile(artifactRoot, `${portalApiPath}/dist/main.js`, Buffer.from("portal api\n"));
  await addFile(artifactRoot, `${workerPath}/dist/main.js`, Buffer.from("worker\n"));
  await addFile(
    artifactRoot,
    contract.artifact.migrationRunnerEntrypoint,
    Buffer.from("migrator entrypoint\n"),
  );
  await addFile(
    artifactRoot,
    contract.artifact.canonicalMigrationRunner,
    Buffer.from("canonical migration runner\n"),
  );
  await addFile(artifactRoot, contract.artifact.requiredMigrationPath, migrationBytes);
  await addFile(artifactRoot, contract.artifact.migrationChecksumManifestPath, checksumBytes);
  await addFile(
    artifactRoot,
    "migrator/migrations/0011_stage6_trip_publication.cjs",
    migrationBytes,
  );
  await addFile(artifactRoot, "migrator/migrations/checksums.json", checksumBytes);
  await addFile(artifactRoot, "admin-web/index.html", Buffer.from("admin spa\n"));
  await addFile(artifactRoot, "portal-web/index.html", Buffer.from("portal spa\n"));
  await addFile(artifactRoot, "provenance/pnpm-lock.yaml", lockfileBytes);
  await addFile(artifactRoot, contract.artifact.successorBaselinePath, baselineBytes);
  await addFile(artifactRoot, "deployment/deployment-contract.v1.json", contractArtifactBytes);
  const verifierBytes = await readFile(
    fileURLToPath(new URL("./verify-stage6-deployment-contract.mjs", import.meta.url)),
  );
  await addFile(artifactRoot, contract.artifact.verifierPath, verifierBytes);
  const instanceManifest = await readFile(
    path.join(repositoryRoot, "deploy/manifests/development.example.json"),
  );
  await addFile(artifactRoot, contract.artifact.instanceManifestPath, instanceManifest);
  for (const [unit, contents] of Object.entries(representativeUnits)) {
    await addFile(unitDirectory, unit, Buffer.from(contents));
  }

  const deployables = [
    { name: "Admin SPA", path: contract.artifact.adminWebPath },
    { name: "Portal SPA", path: contract.artifact.portalWebPath },
    { name: "Admin API", path: adminApiPath, entrypoint: "dist/main.js" },
    { name: "Portal API", path: portalApiPath, entrypoint: "dist/main.js" },
    { name: "Worker", path: workerPath, entrypoint: "dist/main.js" },
    {
      name: "Canonical database migrator",
      path: contract.artifact.migratorPath,
      entrypoint: "dist/packages/migrator/src/run-migrations.js",
    },
    { name: "Database migrations", path: contract.artifact.migrationDirectory },
  ];
  await writeJson(artifactRoot, contract.artifact.releaseMetadataPath, {
    schemaVersion: 1,
    artifactId: `${contract.artifact.artifactIdPrefix}${sourceCommit.slice(0, 8)}`,
    designation: contract.artifact.designation,
    productionSigning: {
      status: contract.artifact.productionSigningStatus,
      authority: "NOT_PRODUCTION_AUTHORITATIVE",
    },
    source: {
      branch: contract.artifact.sourceBranch,
      commit: sourceCommit,
      tree: "b".repeat(40),
      successorBaselineGeneration: contract.artifact.sourceBaselineGeneration,
      successorBaselineSha256: sha256(baselineBytes),
      lockfilePath: "provenance/pnpm-lock.yaml",
      lockfileSha256: sha256(lockfileBytes),
    },
    toolchain: { node: "24.19.0", corepack: "0.0.0", pnpm: "11.21.0" },
    qualification: {
      canonicalCi: contract.artifact.canonicalCiStatusAtBuild,
      runCountForGeneration: 0,
    },
    database: {
      migrationHead: REQUIRED_MIGRATION,
      migrationFileSha256,
      migrationChecksumManifestPath: contract.artifact.migrationChecksumManifestPath,
      migrationChecksumManifestSha256,
      runnerEntrypoint: contract.artifact.migrationRunnerEntrypoint,
      canonicalRunner: contract.artifact.canonicalMigrationRunner,
      identityContract: {
        sessionUser: contract.migrator.sessionUser,
        roleSwitch: contract.migrator.roleSwitch,
        currentUser: contract.migrator.currentUser,
      },
    },
    deployables,
    runtime: {
      node: {
        version: "24.19.0",
        path: "runtime/node",
        binaryPath: contract.artifact.runtimeNodePath,
        binarySha256: sha256(nodeBytes),
      },
    },
    deploymentContract: {
      path: contract.artifact.contractPath,
      schemaVersion: 1,
      sha256: sha256(contractArtifactBytes),
    },
  });
  await writeInventory(artifactRoot);
  return { temporaryRoot, artifactRoot, unitDirectory };
};

const valid = await createFixture();
try {
  const result = await verifyStage6DeploymentContract(valid);
  assert.equal(result.result, "PASS");
  assert.equal(result.units.length, 3);
  assert.equal(result.migrationHead, REQUIRED_MIGRATION);
} finally {
  await rm(valid.temporaryRoot, { recursive: true, force: true });
}

const legacy = await createFixture({ legacyLayout: true });
try {
  await assert.rejects(verifyStage6DeploymentContract(legacy), /ENOENT|no such file|Missing/iu);
} finally {
  await rm(legacy.temporaryRoot, { recursive: true, force: true });
}

const wrongUnitPath = await createFixture();
try {
  const adminUnit = path.join(wrongUnitPath.unitDirectory, "travelos-admin-api.service");
  const original = await readFile(adminUnit, "utf8");
  await writeFile(
    adminUnit,
    original.replace(
      "/opt/travelos/current/apps/admin-api/dist/main.js",
      "/opt/travelos/current/admin-api/dist/main.js",
    ),
  );
  await assert.rejects(verifyStage6DeploymentContract(wrongUnitPath), /ExecStart does not match/u);
} finally {
  await rm(wrongUnitPath.temporaryRoot, { recursive: true, force: true });
}

const secretFile = await createFixture();
try {
  await addFile(secretFile.artifactRoot, "provenance/privateKey.pem", Buffer.from("synthetic"));
  await writeInventory(secretFile.artifactRoot);
  await assert.rejects(verifyStage6DeploymentContract(secretFile), /sensitive-filename/u);
} finally {
  await rm(secretFile.temporaryRoot, { recursive: true, force: true });
}

const secretContent = await createFixture();
try {
  const syntheticAccessKey = `AKIA${"1234567890ABCDEF"}`;
  await addFile(
    secretContent.artifactRoot,
    "provenance/payload.json",
    Buffer.from(JSON.stringify({ accessKey: syntheticAccessKey })),
  );
  await writeInventory(secretContent.artifactRoot);
  await assert.rejects(verifyStage6DeploymentContract(secretContent), /secret-material-signature/u);
} finally {
  await rm(secretContent.temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(
  `${JSON.stringify({ result: "PASS", assertions: 5, negativeFixtures: ["gen06-root-layout", "mismatched-unit-path", "secret-file", "secret-content"] })}\n`,
);
