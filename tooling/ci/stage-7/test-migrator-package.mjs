import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import {
  STAGE7_DEFAULT_GENERATION,
  stage7ExtensionPathFor,
} from "../stage-7-successor-baseline.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const temporaryRoot = process.env.TMPDIR;
assert.ok(
  temporaryRoot,
  "Hermes scratch TMPDIR must be configured for Stage 7 migrator qualification",
);
const fixtureRoot = await mkdtemp(path.join(temporaryRoot, "travelos-stage7-migrator-package-"));
const deployTarget = path.join(fixtureRoot, "migrator");
const inside = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const assertContainedSymlinks = async (root, directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink()) {
      const target = await realpath(file);
      assert.ok(inside(root, target), `Migrator package symlink escaped deployment root: ${file}`);
    } else if (metadata.isDirectory()) {
      await assertContainedSymlinks(root, file);
    }
  }
};

try {
  const deploy = spawnSync(
    "pnpm",
    [
      "--config.inject-workspace-packages=true",
      "--filter",
      "@travelos/migrator",
      "deploy",
      "--prod",
      deployTarget,
    ],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  assert.equal(
    deploy.status,
    0,
    `Could not deploy the Stage 7 migrator package: ${deploy.stderr || deploy.stdout}`,
  );

  await cp(path.join(repositoryRoot, "migrations"), path.join(deployTarget, "migrations"), {
    recursive: true,
    errorOnExist: true,
  });
  const packageJson = JSON.parse(await readFile(path.join(deployTarget, "package.json"), "utf8"));
  assert.equal(packageJson.name, "@travelos/migrator");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.scripts.start, "node dist/packages/migrator/src/run-migrations.js");
  assert.match(packageJson.dependencies["node-pg-migrate"], /^9\.0\.0(?:\(|$)/u);
  assert.match(packageJson.dependencies.pg, /^8\.23\.0(?:\(|$)/u);

  const entrypoint = path.join(deployTarget, "dist/packages/migrator/src/run-migrations.js");
  const resolverPath = path.join(
    deployTarget,
    "dist/packages/migrator/src/resolve-migration-chain.js",
  );
  const canonicalRunner = path.join(deployTarget, "dist/tooling/database/migration-runner.js");
  for (const file of [entrypoint, resolverPath, canonicalRunner]) {
    assert.ok((await lstat(file)).isFile(), `Missing packaged migration runner file: ${file}`);
  }

  const { resolveMigrationChainPaths } = await import(pathToFileURL(resolverPath).href);
  const originalCwd = process.cwd();
  let chain;
  try {
    process.chdir(fixtureRoot);
    chain = resolveMigrationChainPaths(pathToFileURL(resolverPath).href);
  } finally {
    process.chdir(originalCwd);
  }
  assert.equal(chain.directory, path.join(deployTarget, "migrations"));
  assert.equal(chain.checksumManifestPath, path.join(deployTarget, "migrations/checksums.json"));
  const { verifyMigrationChain } = await import(pathToFileURL(canonicalRunner).href);
  const verified = await verifyMigrationChain(chain);
  assert.equal(verified.result, "PASS");
  const stage7Extension = JSON.parse(
    await readFile(
      path.join(repositoryRoot, stage7ExtensionPathFor(STAGE7_DEFAULT_GENERATION)),
      "utf8",
    ),
  );
  const requiredMigration = stage7Extension.database.requiredMigration;
  const packagedChecksumManifest = JSON.parse(await readFile(chain.checksumManifestPath, "utf8"));
  const requiredMigrationHash =
    stage7Extension.database.requiredMigrationSha256 ??
    packagedChecksumManifest.migrations.find((migration) => migration.file === requiredMigration)
      ?.sha256;
  assert.equal(verified.migrations.at(-1)?.file, requiredMigration);
  assert.match(requiredMigrationHash ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(verified.migrations.at(-1)?.sha256, requiredMigrationHash);

  const deploymentRoot = await realpath(deployTarget);
  await assertContainedSymlinks(deploymentRoot, deploymentRoot);
  process.stdout.write(
    `${JSON.stringify({
      result: "PASS",
      package: packageJson.name,
      entrypoint: "dist/packages/migrator/src/run-migrations.js",
      canonicalRunner: "dist/tooling/database/migration-runner.js",
      migrationDirectory: "migrations",
      migrationCount: verified.migrations.length,
      finalMigration: verified.migrations.at(-1)?.file,
      finalMigrationSha256: verified.migrations.at(-1)?.sha256,
      callerCwdIndependent: true,
      deploymentSymlinksContained: true,
    })}\n`,
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
