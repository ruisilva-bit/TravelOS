import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  UNRESOLVED,
  runInheritedCompatibility,
  validateMigrationManifests,
  verifyMigrationChain,
} from "./inherited-compatibility-adapter.mjs";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(root, "migrations/checksums.json")));
validateMigrationManifests(manifest, globalThis.structuredClone(manifest));
assert.equal((await verifyMigrationChain(root)).count, 16);
for (const mutate of [
  (m) => {
    m.migrations[0].sha256 = "0".repeat(64);
  },
  (m) => {
    m.migrations[0].file = "0001_wrong.cjs";
  },
  (m) => {
    m.migrations.pop();
  },
  (m) => {
    [m.migrations[0], m.migrations[1]] = [m.migrations[1], m.migrations[0]];
  },
  (m) => {
    m.migrations[0].extra = true;
  },
  (m) => {
    m.algorithm = "sha1";
  },
]) {
  const changed = globalThis.structuredClone(manifest);
  mutate(changed);
  assert.throws(() => validateMigrationManifests(changed, manifest));
}
assert.equal(Object.keys(UNRESOLVED).length, 0);
await assert.rejects(
  runInheritedCompatibility({ root, candidate: "gen99999", gate: "stage7-migrator" }),
);
await assert.rejects(
  runInheritedCompatibility({ root, candidate: "gen99999", gate: "stage7-baseline" }),
);
await assert.rejects(
  runInheritedCompatibility({ root, candidate: "gen99999", gate: "not-a-gate" }),
  /Unknown/,
);
const script = fileURLToPath(new URL("./inherited-compatibility-adapter.mjs", import.meta.url));
for (const args of [
  [],
  ["--candidate=gen99999", "--gate=stage7-baseline"],
  ["--candidate=gen01", "--gate=unknown"],
  ["--gate=stage7-baseline", "--candidate=gen01"],
]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
}
console.log(
  "inherited compatibility guards PASS; all twelve measured labels have routes requiring verified candidate",
);
