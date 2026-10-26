import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const implementation = await import("./artifact-integrity.mjs").catch(() => ({}));
test("artifact requires the controlled acceptance entrypoint and service contract", async () => {
  const artifactRoot = process.env.TRAVELOS_STAGE8_ARTIFACT_ROOT;
  assert.ok(artifactRoot, "An extracted artifact is required for package contract testing");
  const report = await implementation.verifyArtifact(artifactRoot);
  assert.equal(report.result, "PASS");
  const manifest = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(path.join(artifactRoot, "payload-manifest.json"), "utf8"),
  );
  const paths = new Set(manifest.files.map((row) => row.path));
  assert.ok(paths.has("operator/controlled-worker.mjs"));
  assert.ok(paths.has("deployment/travelos-stage8-controlled-acceptance.service"));
});
test("installer import cannot trigger installation from inherited --install arguments", async () => {
  const artifactRoot = process.env.TRAVELOS_STAGE8_ARTIFACT_ROOT;
  assert.ok(artifactRoot, "An extracted artifact is required for installer import testing");
  const root = await mkdtemp(path.join(os.tmpdir(), "stage8-installer-import-"));
  try {
    const entry = path.join(root, "importer.mjs");
    const moduleUrl = pathToFileURL(path.join(artifactRoot, "deployment/install-runtime.mjs"));
    await writeFile(entry, `await import(${JSON.stringify(moduleUrl.href)});\n`);
    const child = spawnSync(process.execPath, [entry, "--install"], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("verifier executes rather than silently skipping through the active release symlink", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stage8-cli-"));
  try {
    await symlink(path.dirname(fileURLToPath(import.meta.url)), path.join(root, "current"));
    const child = spawnSync(
      process.execPath,
      [path.join(root, "current/artifact-integrity.mjs"), `--artifact-root=${root}`],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 1);
    assert.equal(JSON.parse(child.stderr).code, "ARTIFACT_INTEGRITY_FAILED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("inventory binds exact files and contained symlinks and rejects drift", async () => {
  assert.equal(typeof implementation.inventory, "function", "artifact inventory must exist");
  const root = await mkdtemp(path.join(os.tmpdir(), "stage8-inventory-"));
  try {
    await mkdir(path.join(root, "payload"));
    await writeFile(path.join(root, "payload/a"), "safe synthetic bytes\n");
    await symlink("payload/a", path.join(root, "alias"));
    const rows = await implementation.inventory(root);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].type, "symlink");
    await implementation.verifyInventory(root, rows);
    await writeFile(path.join(root, "payload/a"), "changed\n");
    await assert.rejects(implementation.verifyInventory(root, rows));
    await symlink("../../outside", path.join(root, "escape"));
    await assert.rejects(implementation.inventory(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("inventory rejects omitted and duplicate paths", async () => {
  assert.equal(typeof implementation.verifyInventory, "function");
  const root = await mkdtemp(path.join(os.tmpdir(), "stage8-set-"));
  try {
    await writeFile(path.join(root, "a"), "synthetic\n");
    const rows = await implementation.inventory(root);
    await assert.rejects(implementation.verifyInventory(root, []));
    await assert.rejects(implementation.verifyInventory(root, [...rows, ...rows]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
