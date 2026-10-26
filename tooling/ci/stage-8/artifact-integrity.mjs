import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const hashFile = async (file) => {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
};
export const inventory = async (directory, exclude = []) => {
  const root = await realpath(directory);
  assert.ok((await lstat(root)).isDirectory());
  const rows = [];
  const visit = async (folder) => {
    for (const name of (await readdir(folder)).sort()) {
      const file = path.join(folder, name);
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (exclude.includes(relative)) continue;
      const metadata = await lstat(file);
      if (metadata.isSymbolicLink()) {
        const target = await readlink(file);
        assert.ok(!path.isAbsolute(target), `Absolute symlink: ${relative}`);
        const resolved = await realpath(file);
        assert.ok(resolved.startsWith(`${root}${path.sep}`), `Escaping symlink: ${relative}`);
        rows.push({ path: relative, type: "symlink", target });
      } else if (metadata.isDirectory()) await visit(file);
      else {
        assert.ok(metadata.isFile(), `Unsupported entry: ${relative}`);
        rows.push({
          path: relative,
          type: "file",
          executable: (metadata.mode & 0o111) !== 0,
          ...(await hashFile(file)),
        });
      }
    }
  };
  await visit(root);
  return rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
};
export const verifyInventory = async (root, rows, exclude = []) => {
  assert.equal(new Set(rows.map((row) => row.path)).size, rows.length, "Duplicate manifest path");
  assert.deepEqual(
    await inventory(root, exclude),
    rows,
    "Exact artifact path/byte manifest mismatch",
  );
};
export const verifyArtifact = async (directory) => {
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(path.join(root, "payload-manifest.json"), "utf8"));
  assert.deepEqual(manifest.excludes, ["payload-manifest.json"]);
  await verifyInventory(root, manifest.files, manifest.excludes);
  const release = JSON.parse(await readFile(path.join(root, "release.json"), "utf8"));
  assert.equal(release.stage, "PHASE_1_M1_STAGE_8");
  assert.equal(release.environment, "DEVELOPMENT");
  assert.equal(release.stage9Actions, 0);
  const source = await readFile(path.join(root, "provenance/source-snapshot.json"));
  assert.equal(sha256(source), release.source.snapshotSha256);
  assert.equal(
    release.artifactId,
    `travelos-stage8-${release.candidate}-${release.source.snapshotSha256.slice(0, 8)}`,
  );
  const checksums = JSON.parse(
    await readFile(path.join(root, "migrations/checksums.json"), "utf8"),
  );
  assert.equal(checksums.migrations.at(-1).file, "0014_stage8_worker_activity.cjs");
  for (const row of checksums.migrations) {
    assert.match(row.file, /^\d{4}_[a-z0-9_]+\.cjs$/u);
    assert.equal((await hashFile(path.join(root, "migrations", row.file))).sha256, row.sha256);
    assert.equal(
      (await hashFile(path.join(root, "migrator/migrations", row.file))).sha256,
      row.sha256,
    );
  }
  for (const required of [
    "apps/worker/dist/main.js",
    "apps/admin-api/dist/main.js",
    "apps/portal-api/dist/main.js",
    "migrator/run-stage6-migrations.mjs",
    "runtime/node/bin/node",
    "deployment/worker-stage8.conf",
    "deployment/travelos-stage8-controlled-acceptance.service",
    "operator/controlled-worker.mjs",
    "operator/stage8-runtime-acceptance.mjs",
  ])
    assert.ok(
      manifest.files.some((row) => row.path === required && row.type === "file"),
      `Required entry missing: ${required}`,
    );
  return {
    result: "PASS",
    artifactId: release.artifactId,
    sourceSnapshotSha256: release.source.snapshotSha256,
    entries: manifest.files.length,
    files: manifest.files.filter((row) => row.type === "file").length,
    migrationHead: "0014_stage8_worker_activity",
    stage9Actions: 0,
  };
};
if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3);
    assert.ok(process.argv[2].startsWith("--artifact-root="));
    console.log(
      JSON.stringify(await verifyArtifact(process.argv[2].slice("--artifact-root=".length))),
    );
  } catch {
    console.error(JSON.stringify({ result: "FAIL", code: "ARTIFACT_INTEGRITY_FAILED" }));
    process.exitCode = 1;
  }
}
