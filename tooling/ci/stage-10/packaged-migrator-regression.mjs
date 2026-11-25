import assert from "node:assert/strict";
import path from "node:path";
import { readdir, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { regularBytes, sha256 } from "./io.mjs";
import { MIGRATION_HEAD } from "./constants.mjs";

// Trusted composition only: authenticate and qualify the artifact before import.
// Never expose this function as an arbitrary-payload execution CLI.
export async function qualifyPackagedMigrator({ payload, expectedManifest }) {
  assert.equal(expectedManifest.schemaVersion, 1);
  assert.equal(expectedManifest.algorithm, "sha256");
  assert.equal(expectedManifest.migrations.length, 16);
  assert.equal(expectedManifest.migrations.at(-1).file, `${MIGRATION_HEAD}.cjs`);
  const base = path.join(payload, "migrator");
  const pkg = JSON.parse(await regularBytes(path.join(base, "package.json")));
  assert.equal(pkg.name, "@travelos/migrator");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts.start, "node dist/packages/migrator/src/run-migrations.js");
  assert.match(pkg.dependencies["node-pg-migrate"], /^9\.0\.0(?:\(|$)/u);
  assert.match(pkg.dependencies.pg, /^8\.23\.0(?:\(|$)/u);
  const directory = path.join(base, "migrations");
  assert.deepEqual(
    JSON.parse(await regularBytes(path.join(directory, "checksums.json"))),
    expectedManifest,
  );
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [...expectedManifest.migrations.map((row) => row.file), "checksums.json"].sort(),
  );
  for (const row of expectedManifest.migrations) {
    assert.match(row.file, /^\d{4}_[a-z0-9_]+\.cjs$/u);
    assert.equal(sha256(await regularBytes(path.join(directory, row.file))), row.sha256);
  }
  const physical = await realpath(base);
  async function checkLinks(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(file);
        assert.ok(
          target === physical || target.startsWith(`${physical}${path.sep}`),
          "Escaped migrator package link",
        );
      } else if (entry.isDirectory()) await checkLinks(file);
    }
  }
  await checkLinks(base);
  const resolver = path.join(base, "dist/packages/migrator/src/resolve-migration-chain.js");
  const runner = path.join(base, "dist/tooling/database/migration-runner.js");
  await regularBytes(path.join(base, "dist/packages/migrator/src/run-migrations.js"));
  await regularBytes(resolver);
  await regularBytes(runner);
  const { resolveMigrationChainPaths } = await import(pathToFileURL(resolver).href);
  const { verifyMigrationChain } = await import(pathToFileURL(runner).href);
  // Resolution is relative to the packaged module, never the caller's cwd.
  const chain = resolveMigrationChainPaths(pathToFileURL(resolver).href);
  assert.equal(chain.directory, directory);
  assert.equal(chain.checksumManifestPath, path.join(directory, "checksums.json"));
  const verified = await verifyMigrationChain(chain);
  assert.equal(verified.result, "PASS");
  assert.deepEqual(verified.migrations, expectedManifest.migrations);
  return {
    result: "PASS",
    migrationCount: 16,
    head: MIGRATION_HEAD,
    linksContained: true,
    databaseMutation: false,
  };
}
