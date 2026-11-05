import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

import { STAGE9_BRANCH, STAGE9_PREDECESSOR, STAGE9_STAGE } from "./constants.mjs";

let snapshotModule;
try {
  snapshotModule = await import("./source-snapshot.mjs");
} catch {
  snapshotModule = undefined;
}

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("source selection binds the approved invitation design, plan and successor baseline", () => {
  assert.equal(typeof snapshotModule?.selectedPath, "function");
  for (const file of [
    "docs/superpowers/specs/2026-11-02-stage9-staff-invitation-design.md",
    "docs/superpowers/plans/2026-11-02-stage9-staff-invitation-implementation-plan.md",
    "docs/reviews/phase-1-m1/STAGE_9_SUCCESSOR_BASELINE_GEN11.json",
  ])
    assert.equal(snapshotModule.selectedPath(file), true, file);
  assert.equal(snapshotModule.selectedPath("docs/unrelated.md"), false);
  assert.equal(snapshotModule.selectedPath(".hermes/state/local.json"), false);
});

test("Stage 9 source snapshot binds the Stage 8 predecessor and all release-relevant source", async () => {
  assert.equal(typeof snapshotModule?.sourceSnapshot, "function");
  const { snapshot, bytes, sha256 } = await snapshotModule.sourceSnapshot(repositoryRoot);
  const paths = snapshot.files.map((row) => row.path);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.stage, STAGE9_STAGE);
  assert.equal(snapshot.predecessor, STAGE9_PREDECESSOR);
  assert.equal(snapshot.branch, STAGE9_BRANCH);
  assert.equal(snapshot.stage10Actions, 0);
  assert.ok(paths.includes("deploy/contracts/stage-9-extension.v1.json"));
  assert.ok(paths.includes("deploy/contracts/stage-9-extension.v2.json"));
  assert.ok(paths.includes("deploy/caddy/Caddyfile.stage9-development"));
  assert.ok(paths.includes("tooling/deployment/stage9-development-apply.mjs"));
  assert.ok(paths.includes("apps/admin-api/src/app.ts"));
  assert.ok(paths.includes(".taste-skill/direction.json"));
  assert.ok(
    paths.includes("docs/superpowers/plans/2026-10-26-stage-9-first-usable-admin-portal.md"),
  );
  assert.ok(paths.every((file) => !file.startsWith(".hermes/")));
  assert.deepEqual(paths, [...paths].sort());
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(bytes.toString("utf8"), `${JSON.stringify(snapshot, null, 2)}\n`);
  assert.equal(sha256, createHash("sha256").update(bytes).digest("hex"));
});

test("source snapshot verification rejects changed candidate bytes", async () => {
  assert.equal(typeof snapshotModule?.verifySourceSnapshot, "function");
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-snapshot-"));
  const manifestPath = path.join(root, "source-snapshot.json");
  try {
    const expected = await snapshotModule.sourceSnapshot(repositoryRoot);
    await writeFile(manifestPath, expected.bytes);
    assert.equal(
      await snapshotModule.verifySourceSnapshot(repositoryRoot, manifestPath),
      expected.sha256,
    );
    await writeFile(manifestPath, `${expected.bytes.toString("utf8")}\n`);
    await assert.rejects(
      snapshotModule.verifySourceSnapshot(repositoryRoot, manifestPath),
      /Candidate source drift/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
