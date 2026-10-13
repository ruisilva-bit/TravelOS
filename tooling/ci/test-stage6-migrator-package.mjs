import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const requestedDeployTarget = process.env["TRAVELOS_STAGE6_MIGRATOR_TARGET"];
const ownsTemporaryRoot = requestedDeployTarget === undefined;
const temporaryRoot = ownsTemporaryRoot
  ? await mkdtemp(path.join(os.tmpdir(), "travelos-stage6-migrator-package-"))
  : path.dirname(path.resolve(requestedDeployTarget));
const deployTarget = ownsTemporaryRoot
  ? path.join(temporaryRoot, "migrator")
  : path.resolve(requestedDeployTarget);
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);

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
    `Could not deploy the standalone migrator package: ${deploy.stderr || deploy.stdout}`,
  );

  await cp(path.join(repositoryRoot, "migrations"), path.join(deployTarget, "migrations"), {
    recursive: true,
    errorOnExist: true,
  });

  const packageJson = JSON.parse(await readFile(path.join(deployTarget, "package.json"), "utf8"));
  assert.equal(packageJson.name, "@travelos/migrator");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.scripts.start, "node dist/packages/migrator/src/run-migrations.js");
  assert.match(packageJson.dependencies["node-pg-migrate"], /^9\.0\.0(?:\(|$)/);
  assert.match(packageJson.dependencies.pg, /^8\.23\.0(?:\(|$)/);

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
    process.chdir(temporaryRoot);
    chain = resolveMigrationChainPaths(pathToFileURL(resolverPath).href);
  } finally {
    process.chdir(originalCwd);
  }
  assert.equal(chain.directory, path.join(deployTarget, "migrations"));
  assert.equal(chain.checksumManifestPath, path.join(deployTarget, "migrations/checksums.json"));
  const { verifyMigrationChain } = await import(pathToFileURL(canonicalRunner).href);
  const verified = await verifyMigrationChain(chain);
  assert.equal(verified.result, "PASS");
  assert.equal(verified.migrations.at(-1)?.file, "0011_stage6_trip_publication.cjs");

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
      callerCwdIndependent: true,
      runtimeDependencies: packageJson.dependencies,
      deploymentSymlinksContained: true,
    })}\n`,
  );
} finally {
  if (ownsTemporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}
