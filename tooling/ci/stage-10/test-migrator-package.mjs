import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { corepackInvocation, readToolchain } from "./candidate.mjs";
import { MIGRATION_HEAD } from "./constants.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporary = await mkdtemp("/home/hermes/.hermes/cache/scratch/stage10-migrator-");
const deployed = path.join(temporary, "migrator");
const contained = (base, file) => file === base || file.startsWith(`${base}${path.sep}`);
async function checkLinks(base, directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      assert.ok(contained(base, await realpath(file)), "Escaped package link");
    else if (entry.isDirectory()) await checkLinks(base, file);
  }
}
try {
  const pins = readToolchain(root);
  const invocation = corepackInvocation();
  const result = spawnSync(
    invocation.command,
    [
      ...invocation.prefix,
      "pnpm",
      "--config.inject-workspace-packages=true",
      "--filter",
      "@travelos/migrator",
      "deploy",
      "--prod",
      deployed,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        PATH: invocation.path,
        HOME: "/home/hermes",
        TMPDIR: "/home/hermes/.hermes/cache/scratch",
        COREPACK_ENABLE_NETWORK: "0",
        npm_config_offline: "true",
        LANG: "C.UTF-8",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  await cp(path.join(root, "migrations"), path.join(deployed, "migrations"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const manifest = JSON.parse(await readFile(path.join(deployed, "package.json"), "utf8"));
  assert.equal(manifest.name, "@travelos/migrator");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.scripts.start, "node dist/packages/migrator/src/run-migrations.js");
  const resolver = path.join(deployed, "dist/packages/migrator/src/resolve-migration-chain.js");
  const runner = path.join(deployed, "dist/tooling/database/migration-runner.js");
  for (const name of [
    resolver,
    runner,
    path.join(deployed, "dist/packages/migrator/src/run-migrations.js"),
  ])
    assert.ok((await lstat(name)).isFile());
  const { resolveMigrationChainPaths } = await import(pathToFileURL(resolver).href);
  const { verifyMigrationChain } = await import(pathToFileURL(runner).href);
  const previous = process.cwd();
  let chain;
  try {
    process.chdir(temporary);
    chain = resolveMigrationChainPaths(pathToFileURL(resolver).href);
  } finally {
    process.chdir(previous);
  }
  assert.equal(chain.directory, path.join(deployed, "migrations"));
  assert.equal(chain.checksumManifestPath, path.join(deployed, "migrations/checksums.json"));
  const verified = await verifyMigrationChain(chain);
  assert.equal(verified.result, "PASS");
  assert.equal(verified.migrations.length, 16);
  assert.equal(verified.migrations.at(-1)?.file, `${MIGRATION_HEAD}.cjs`);
  await checkLinks(await realpath(deployed), deployed);
  console.log(
    JSON.stringify({
      result: "PASS",
      scope: "ACTUAL_STANDALONE_MIGRATOR_PACKAGE_NOT_CANONICAL_ARTIFACT",
      pins,
      migrations: verified.migrations.length,
      head: MIGRATION_HEAD,
      callerCwdIndependent: true,
      linksContained: true,
      databaseMutation: false,
    }),
  );
} finally {
  assert.ok(temporary.startsWith("/home/hermes/.hermes/cache/scratch/stage10-migrator-"));
  await rm(temporary, { recursive: true, force: true });
}
