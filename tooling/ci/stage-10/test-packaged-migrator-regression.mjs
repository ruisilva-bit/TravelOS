import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { qualifyPackagedMigrator } from "./packaged-migrator-regression.mjs";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = await mkdtemp("/home/hermes/.hermes/cache/scratch/stage10-migrator-negative-");
const manifest = JSON.parse(await readFile(path.join(root, "migrations/checksums.json")));
try {
  await cp(path.join(root, "migrations"), path.join(fixture, "migrator/migrations"), {
    recursive: true,
  });
  const pkg = {
    name: "@travelos/migrator",
    type: "module",
    scripts: { start: "node dist/packages/migrator/src/run-migrations.js" },
    dependencies: { pg: "8.23.0", "node-pg-migrate": "9.0.0" },
  };
  const pkgPath = path.join(fixture, "migrator/package.json");
  await writeFile(pkgPath, JSON.stringify(pkg));
  for (const mutate of [
    (m) => {
      m.migrations.pop();
    },
    (m) => {
      m.migrations[0].sha256 = "0".repeat(64);
    },
    (m) => {
      m.migrations.at(-1).file = "0016_wrong.cjs";
    },
  ]) {
    const changed = globalThis.structuredClone(manifest);
    mutate(changed);
    await assert.rejects(qualifyPackagedMigrator({ payload: fixture, expectedManifest: changed }));
  }
  await writeFile(
    pkgPath,
    JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, pg: "8.24.0" } }),
  );
  await assert.rejects(qualifyPackagedMigrator({ payload: fixture, expectedManifest: manifest }));
  await writeFile(pkgPath, JSON.stringify(pkg));
  await writeFile(
    path.join(fixture, "migrator/migrations", manifest.migrations[0].file),
    "changed\n",
  );
  await assert.rejects(qualifyPackagedMigrator({ payload: fixture, expectedManifest: manifest }));
  await cp(
    path.join(root, "migrations", manifest.migrations[0].file),
    path.join(fixture, "migrator/migrations", manifest.migrations[0].file),
  );
  await writeFile(path.join(fixture, "external-target.txt"), "synthetic external target\n");
  await symlink("../external-target.txt", path.join(fixture, "migrator/escape"));
  await assert.rejects(
    qualifyPackagedMigrator({ payload: fixture, expectedManifest: manifest }),
    /Escaped migrator package link/,
  );
  console.log(
    "PASS: six inverse packaged-migrator probes including escaping symlink; no positive artifact result inferred",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
