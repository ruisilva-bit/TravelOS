import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STAGE7_DEFAULT_GENERATION } from "../stage-7-successor-baseline.mjs";

const artifactVerifierPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "verify-artifact.mjs",
);
const artifactVerifier = await import(pathToFileURL(artifactVerifierPath).href).catch(() => null);
const artifactBuilder = await import(
  pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "build-artifact.mjs")).href
).catch(() => null);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generation = STAGE7_DEFAULT_GENERATION;
const baseContractBytes = await readFile(
  path.join(projectRoot, "deploy/contracts/deployment-contract.v1.json"),
);
const extensionBytes = await readFile(
  path.join(projectRoot, "deploy/contracts/stage-7-extension.v1.json"),
);
const verifierBytes = await readFile(artifactVerifierPath);
assert.equal(
  typeof artifactVerifier?.verifyStage7Artifact,
  "function",
  "Stage 7 must expose an artifact verifier before candidate qualification",
);
assert.equal(
  typeof artifactBuilder?.createStage7ReleaseMetadata,
  "function",
  "Stage 7 must expose deterministic release metadata construction",
);

const temporaryRoot = process.env.TMPDIR;
assert.ok(temporaryRoot, "Hermes scratch TMPDIR must be configured for artifact fixtures");
const fixtureRoot = await mkdtemp(path.join(temporaryRoot, "stage7-artifact-empty-"));
try {
  await mkdir(path.join(fixtureRoot, "release"));
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({
      artifactRoot: path.join(fixtureRoot, "release"),
      generation,
    }),
    /release\.json/u,
    "An empty candidate directory must fail closed on absent release metadata",
  );
  const cliRoot = path.join(fixtureRoot, "cli-release");
  await mkdir(cliRoot);
  const cli = spawnSync(
    process.execPath,
    [artifactVerifierPath, `--artifact-root=${cliRoot}`, `--generation=${generation}`],
    { encoding: "utf8" },
  );
  assert.equal(cli.status, 1, "Artifact verifier CLI must fail closed on incomplete payloads");
  assert.match(cli.stderr, /release\.json/u);

  const sourceCommit = "a".repeat(40);
  const runnerBytes = await readFile(
    path.join(projectRoot, "tooling/ci/stage-7/runtime-acceptance-runner.mjs"),
  );
  const runnerSha256 = createHash("sha256").update(runnerBytes).digest("hex");
  const operatorUnitBytes = await readFile(
    path.join(projectRoot, "deploy/systemd/travelos-stage7-runtime-acceptance.service"),
  );
  const operatorUnitSha256 = createHash("sha256").update(operatorUnitBytes).digest("hex");
  const baselineBytes = Buffer.from(
    `${JSON.stringify({
      schemaVersion: 1,
      sourceFiles: [
        {
          path: "tooling/ci/stage-7/runtime-acceptance-runner.mjs",
          bytes: runnerBytes.length,
          sha256: runnerSha256,
        },
        {
          path: "deploy/systemd/travelos-stage7-runtime-acceptance.service",
          bytes: operatorUnitBytes.length,
          sha256: operatorUnitSha256,
        },
      ],
    })}\n`,
  );
  const baselineSha256 = createHash("sha256").update(baselineBytes).digest("hex");
  const lockfileBytes = Buffer.from("lockfileVersion: '9.0'\n");
  const lockfileSha256 = createHash("sha256").update(lockfileBytes).digest("hex");
  const artifactRoot = path.join(fixtureRoot, "release");
  await mkdir(path.join(artifactRoot, "provenance"), { recursive: true });
  await writeFile(
    path.join(artifactRoot, "provenance", `stage7-successor-baseline-${generation}.json`),
    baselineBytes,
  );
  await writeFile(path.join(artifactRoot, "provenance", "pnpm-lock.yaml"), lockfileBytes);
  let release = {
    schemaVersion: 1,
    artifactId: `travelos-phase-1-m1-stage-7-${generation}-${sourceCommit.slice(0, 8)}`,
    source: {
      branch: "phase-1/stage-7",
      commit: sourceCommit,
      tree: "b".repeat(40),
      successorBaselineGeneration: generation,
      successorBaselineSha256: baselineSha256,
      lockfilePath: "provenance/pnpm-lock.yaml",
      lockfileSha256,
    },
  };
  const releasePath = path.join(fixtureRoot, "release", "release.json");
  await writeFile(releasePath, `${JSON.stringify(release)}\n`);
  await mkdir(path.join(artifactRoot, "deployment"), { recursive: true });
  await writeFile(
    path.join(artifactRoot, "deployment/deployment-contract.v1.json"),
    baseContractBytes,
  );
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({
      artifactRoot,
      generation,
    }),
    /stage-7-extension\.v1\.json/u,
    "A candidate package must carry its Stage 7 deployment extension",
  );

  const writeArtifactFile = async (relativePath, bytes) => {
    const filePath = path.join(artifactRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
  };
  const inventoryForFixture = async () => {
    const rows = [];
    const visit = async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
      for (const entry of entries) {
        const filePath = path.join(directory, entry.name);
        const relativePath = path.relative(artifactRoot, filePath).split(path.sep).join("/");
        if (["payload-manifest.json", "checksums.txt"].includes(relativePath)) continue;
        const metadata = await lstat(filePath);
        if (metadata.isDirectory()) await visit(filePath);
        else {
          assert.ok(
            metadata.isFile() && !metadata.isSymbolicLink(),
            `Unexpected fixture entry: ${relativePath}`,
          );
          const bytes = await readFile(filePath);
          rows.push({
            path: relativePath,
            type: "file",
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          });
        }
      }
    };
    await visit(artifactRoot);
    return rows;
  };
  const writePayloadManifests = async () => {
    const files = await inventoryForFixture();
    await writeArtifactFile(
      "payload-manifest.json",
      Buffer.from(
        `${JSON.stringify({ schemaVersion: 1, fileManifestExcludes: ["payload-manifest.json", "checksums.txt"], files }, null, 2)}\n`,
      ),
    );
    await writeArtifactFile(
      "checksums.txt",
      Buffer.from(files.map((row) => `${row.sha256}  ${row.path}\n`).join("")),
    );
  };
  await writeArtifactFile("deployment/deployment-contract.v1.json", baseContractBytes);
  await writeArtifactFile("deployment/stage-7-extension.v1.json", extensionBytes);
  await writeArtifactFile("deployment/verify-stage7-artifact.mjs", verifierBytes);
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({ artifactRoot, generation }),
    /operator\/stage7-runtime-acceptance\.mjs/u,
    "A candidate missing its declared runtime acceptance runner must fail preflight",
  );
  await writeArtifactFile("operator/stage7-runtime-acceptance.mjs", runnerBytes);
  await writeArtifactFile("operator/travelos-stage7-runtime-acceptance.service", operatorUnitBytes);
  const migrationBytes = await readFile(
    path.join(projectRoot, "migrations/0012_stage7_portal_trip_access.cjs"),
  );
  const migrationChecksumBytes = await readFile(
    path.join(projectRoot, "migrations/checksums.json"),
  );
  const nodeStubBytes = Buffer.from("#!/bin/sh\nprintf 'v24.19.0\\n'\n");
  await cp(path.join(projectRoot, "migrations"), path.join(artifactRoot, "migrations"), {
    recursive: true,
  });
  await mkdir(path.join(artifactRoot, "migrator"), { recursive: true });
  await cp(path.join(projectRoot, "migrations"), path.join(artifactRoot, "migrator/migrations"), {
    recursive: true,
  });
  for (const [relativePath, content] of [
    ["apps/admin-api/package.json", '{"name":"@travelos/admin-api"}\n'],
    ["apps/admin-api/dist/main.js", "process.stdout.write('admin\\n');\n"],
    ["apps/portal-api/package.json", '{"name":"@travelos/portal-api"}\n'],
    ["apps/portal-api/dist/main.js", "process.stdout.write('portal\\n');\n"],
    ["apps/worker/package.json", '{"name":"@travelos/worker"}\n'],
    ["apps/worker/dist/main.js", "process.stdout.write('worker\\n');\n"],
    ["admin-web/index.html", "<!doctype html><title>Admin</title>\n"],
    ["portal-web/index.html", "<!doctype html><title>Portal</title>\n"],
    ["migrator/package.json", '{"name":"@travelos/migrator"}\n'],
    ["migrator/dist/packages/migrator/src/run-migrations.js", "process.exit(0);\n"],
    ["migrator/dist/tooling/database/migration-runner.js", "process.exit(0);\n"],
    [
      "migrator/run-stage6-migrations.mjs",
      await readFile(path.join(projectRoot, "tooling/deployment/run-stage6-migrations.mjs")),
    ],
    [
      "instance-manifest/development.example.json",
      await readFile(path.join(projectRoot, "deploy/manifests/development.example.json")),
    ],
    ["runtime/node/bin/node", nodeStubBytes],
  ]) {
    await writeArtifactFile(relativePath, Buffer.from(content));
  }
  for (const [relativePath, content] of [
    [
      "apps/portal-api/node_modules/@travelos/config/package.json",
      JSON.stringify({
        name: "@travelos/config",
        type: "module",
        exports: { ".": { import: "./dist/index.js" } },
      }),
    ],
    [
      "apps/portal-api/node_modules/@travelos/config/dist/index.js",
      "export const loadDevelopmentInstanceManifest = () => {};\nexport const readSystemdCredentialText = () => {};\n",
    ],
    [
      "apps/portal-api/node_modules/@travelos/auth-adapters/package.json",
      JSON.stringify({
        name: "@travelos/auth-adapters",
        type: "module",
        exports: { "./portal": { import: "./dist/portal.js" } },
      }),
    ],
    [
      "apps/portal-api/node_modules/@travelos/auth-adapters/dist/portal.js",
      "export const createAuthRealmPostgresDatabase = () => ({});\n",
    ],
    [
      "apps/portal-api/node_modules/@travelos/auth-adapters/dist/realm.js",
      "export const createLocalOperatorPortalEnrollmentService = () => ({});\n",
    ],
  ]) {
    await writeArtifactFile(relativePath, Buffer.from(content));
  }
  await chmod(path.join(artifactRoot, "runtime/node/bin/node"), 0o755);
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  release = artifactBuilder.createStage7ReleaseMetadata({
    generation,
    branch: "phase-1/stage-7",
    commit: sourceCommit,
    tree: "b".repeat(40),
    successorBaselineSha256: baselineSha256,
    lockfileSha256,
    nodeBinarySha256: digest(nodeStubBytes),
    migrationSha256: digest(migrationBytes),
    migrationChecksumManifestSha256: digest(migrationChecksumBytes),
    deploymentContractSha256: digest(baseContractBytes),
    stage7DeploymentContractSha256: digest(extensionBytes),
    stage7VerifierSha256: digest(verifierBytes),
    runtimeAcceptanceSha256: runnerSha256,
    operatorUnitSha256,
  });
  await writeFile(releasePath, `${JSON.stringify(release)}\n`);
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({ artifactRoot, generation }),
    /payload-manifest\.json/u,
    "Candidate payload must be backed by a complete inventory and checksum manifest",
  );
  await writePayloadManifests();
  const accepted = await artifactVerifier.verifyStage7Artifact({
    artifactRoot,
    generation,
  });
  assert.equal(accepted.result, "PASS");
  assert.equal(accepted.artifactId, release.artifactId);
  const incompleteQualification = { ...release };
  delete incompleteQualification.qualification;
  await writeFile(releasePath, `${JSON.stringify(incompleteQualification)}\n`);
  await writePayloadManifests();
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({ artifactRoot, generation }),
    /qualification/u,
    "A release with no explicit one-shot CI qualification state must fail closed",
  );
  await writeFile(releasePath, `${JSON.stringify(release)}\n`);
  await writePayloadManifests();
  const acceptedStage6MigrationPath = "0011_stage6_trip_publication.cjs";
  const packagedStage6MigrationPath = path.join(
    artifactRoot,
    "migrator/migrations",
    acceptedStage6MigrationPath,
  );
  const acceptedStage6MigrationBytes = await readFile(packagedStage6MigrationPath);
  await writeFile(
    packagedStage6MigrationPath,
    Buffer.concat([acceptedStage6MigrationBytes, Buffer.from("\n-- tampered\n")]),
  );
  await writePayloadManifests();
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({ artifactRoot, generation }),
    /migration chain|checksum manifest|migration copy/iu,
    "The packaged migrator must not alter any immutable predecessor migration",
  );
  await writeFile(packagedStage6MigrationPath, acceptedStage6MigrationBytes);
  await writePayloadManifests();
  const secretPath = path.join(artifactRoot, "synthetic-token.txt");
  await writeFile(secretPath, `ghp_${"A".repeat(36)}\n`);
  await writePayloadManifests();
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({ artifactRoot, generation }),
    /Secret material detected/u,
    "Artifact verification must reject secret-like payloads without printing their contents",
  );
  await rm(secretPath);
  await writePayloadManifests();
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({
      artifactRoot: path.join(fixtureRoot, "release"),
      generation,
      expectedCommit: "b".repeat(40),
    }),
    /source commit mismatch/u,
    "Artifact metadata must bind to the verified source candidate commit",
  );
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({
      artifactRoot: path.join(fixtureRoot, "release"),
      generation,
      expectedTree: "c".repeat(40),
    }),
    /source tree mismatch/u,
    "Artifact metadata must bind to the verified source tree",
  );
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({
      artifactRoot: path.join(fixtureRoot, "release"),
      generation,
      expectedBaselineSha256: "d".repeat(64),
    }),
    /successor-baseline SHA-256 mismatch/u,
    "Artifact metadata must bind to the verified successor baseline bytes",
  );
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({
      artifactRoot: path.join(fixtureRoot, "release"),
      generation,
      expectedLockfileSha256: "d".repeat(64),
    }),
    /lockfile SHA-256 mismatch/u,
    "Artifact metadata must bind to the verified dependency lockfile",
  );

  await writeFile(
    releasePath,
    `${JSON.stringify({
      ...release,
      artifactId: `travelos-phase-1-m1-stage-6-gen07-${sourceCommit.slice(0, 8)}`,
    })}\n`,
  );
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({
      artifactRoot: path.join(fixtureRoot, "release"),
      generation,
    }),
    /artifact ID prefix/u,
    "A Stage 6 artifact identity must not qualify as a Stage 7 candidate",
  );

  await writeFile(releasePath, `${JSON.stringify(release)}\n`);
  const archivePath = path.join(fixtureRoot, "stage7-candidate.tar.gz");
  await writeFile(path.join(artifactRoot, "payload.txt"), "candidate payload\n");
  await writePayloadManifests();
  execFileSync("tar", [
    "--create",
    "--gzip",
    `--file=${archivePath}`,
    "--directory",
    artifactRoot,
    ".",
  ]);
  const archiveBytes = await readFile(archivePath);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  const archived = await artifactVerifier.verifyStage7Artifact({
    artifactRoot,
    archivePath,
    generation,
  });
  assert.equal(archived.artifactSha256, archiveSha256);
  assert.equal(archived.artifactBytes, archiveBytes.length);

  const mismatchedArchivePath = path.join(fixtureRoot, "stage7-mismatched.tar.gz");
  await writeFile(path.join(artifactRoot, "payload.txt"), "different payload\n");
  await writePayloadManifests();
  execFileSync("tar", [
    "--create",
    "--gzip",
    `--file=${mismatchedArchivePath}`,
    "--directory",
    artifactRoot,
    ".",
  ]);
  await writeFile(path.join(artifactRoot, "payload.txt"), "candidate payload\n");
  await writePayloadManifests();
  await assert.rejects(
    artifactVerifier.verifyStage7Artifact({
      artifactRoot,
      archivePath: mismatchedArchivePath,
      generation,
      temporaryRoot,
    }),
    /archive payload differs/u,
    "The immutable archive must match the verified release directory byte for byte",
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write('{"result":"PASS","cases":15,"positiveCases":2,"negativeControls":13}\n');
