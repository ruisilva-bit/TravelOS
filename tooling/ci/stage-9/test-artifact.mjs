import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

import {
  NODE_VERSION,
  PNPM_VERSION,
  STAGE8_ACCEPTED_ARTIFACT_ID,
  STAGE8_ACCEPTED_ARTIFACT_SHA256,
  STAGE9_BRANCH,
  STAGE9_CURRENT_ARTIFACT_ID,
  STAGE9_MIGRATION_HEAD,
  STAGE9_PREDECESSOR,
  STAGE9_STAGE,
  STAGE9_V1_CONTRACT_PATH,
  STAGE9_V2_CONTRACT_PATH,
  STAGE9_V3_CONTRACT_PATH,
  STAGE9_BASELINE_PATH,
} from "./constants.mjs";

let integrity;
try {
  integrity = await import("./artifact-integrity.mjs");
} catch {
  integrity = undefined;
}

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;
const shellHtml = (surface) => {
  const app = surface === "admin" ? "admin" : "portal";
  const endpoint =
    surface === "admin" ? "/api/auth/staff/sign-in/email" : "/api/auth/portal/sign-in/email";
  return `<!doctype html><html lang="pt-PT"><head><link rel="stylesheet" href="/assets/${app}.css"><script type="module" src="/assets/${app}.js"></script></head><body><div id="${app}-root"></div><form method="post" action="${endpoint}"><input type="email" name="email"><input type="password" name="password" autocomplete="current-password"></form></body></html>`;
};

const sealManifest = async (root) => {
  const files = await integrity.inventory(root);
  await writeFile(
    path.join(root, "payload-manifest.json"),
    jsonBytes({ schemaVersion: 1, excludes: ["payload-manifest.json"], files }),
  );
};

const createArtifactFixture = async () => {
  assert.equal(typeof integrity?.inventory, "function", "artifact inventory must exist");
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-artifact-"));
  const directories = [
    "apps/admin-api/dist",
    "apps/portal-api/dist",
    "apps/worker/dist",
    "admin-web/assets",
    "portal-web/assets",
    "deployment",
    "instance-manifest",
    "migrator",
    "operator",
    "provenance",
    "runtime/node/bin",
  ];
  for (const directory of directories) await mkdir(path.join(root, directory), { recursive: true });
  for (const [file, bytes] of [
    ["apps/admin-api/dist/main.js", "synthetic admin api entry\n"],
    ["apps/portal-api/dist/main.js", "synthetic portal api entry\n"],
    ["apps/worker/dist/main.js", "synthetic worker entry\n"],
    ["admin-web/index.html", shellHtml("admin")],
    ["admin-web/assets/admin.js", "synthetic admin bundle\n"],
    ["admin-web/assets/admin.css", "synthetic admin styles\n"],
    ["portal-web/index.html", shellHtml("portal")],
    ["portal-web/assets/portal.js", "synthetic portal bundle\n"],
    ["portal-web/assets/portal.css", "synthetic portal styles\n"],
    ["migrator/run-stage6-migrations.mjs", "synthetic migrator entry\n"],
    ["deployment/verify-artifact.mjs", "synthetic verifier\n"],
    ["deployment/install-runtime.mjs", "synthetic read-only installer\n"],
    ["operator/stage8-runtime-acceptance.mjs", "synthetic predecessor acceptance\n"],
    ["operator/controlled-worker.mjs", "synthetic predecessor worker\n"],
    ["operator/stage7-regression.mjs", "synthetic predecessor regression\n"],
    ["operator/stage9-static-runtime-acceptance.mjs", "synthetic static runtime acceptance\n"],
  ])
    await writeFile(path.join(root, file), bytes);
  await writeFile(path.join(root, "runtime/node/bin/node"), "synthetic pinned node executable\n");
  await chmod(path.join(root, "runtime/node/bin/node"), 0o755);
  await cp(path.join(repositoryRoot, "migrations"), path.join(root, "migrations"), {
    recursive: true,
  });
  await cp(path.join(repositoryRoot, "migrations"), path.join(root, "migrator/migrations"), {
    recursive: true,
  });
  for (const [source, target] of [
    ["deploy/contracts/deployment-contract.v1.json", "deployment/deployment-contract.v1.json"],
    [STAGE9_V1_CONTRACT_PATH, "deployment/stage-9-extension.v1.json"],
    [STAGE9_V2_CONTRACT_PATH, "deployment/stage-9-extension.v2.json"],
    [STAGE9_V3_CONTRACT_PATH, "deployment/stage-9-extension.v3.json"],
    [STAGE9_BASELINE_PATH, "provenance/stage9-successor-baseline.json"],
    ["deploy/caddy/Caddyfile.stage9-development", "deployment/Caddyfile"],
    ["tooling/deployment/stage9-development-apply.mjs", "operator/stage9-development-apply.mjs"],
    ["deploy/systemd/worker-stage8.conf", "deployment/worker-stage8.conf"],
    [
      "deploy/systemd/travelos-stage8-runtime-acceptance.service",
      "deployment/travelos-stage8-runtime-acceptance.service",
    ],
    [
      "deploy/systemd/travelos-stage8-controlled-acceptance.service",
      "deployment/travelos-stage8-controlled-acceptance.service",
    ],
    ["deploy/manifests/development.example.json", "instance-manifest/development.example.json"],
    ["tooling/ci/stage-9/constants.mjs", "deployment/constants.mjs"],
    ["pnpm-lock.yaml", "provenance/pnpm-lock.yaml"],
  ])
    await cp(path.join(repositoryRoot, source), path.join(root, target));

  const baselineBytes = await readFile(
    path.join(root, "provenance/stage9-successor-baseline.json"),
  );
  const baseline = JSON.parse(baselineBytes.toString("utf8"));
  const sourceSnapshot = {
    schemaVersion: 1,
    stage: STAGE9_STAGE,
    predecessor: STAGE9_PREDECESSOR,
    branch: STAGE9_BRANCH,
    files: [
      ...baseline.protectedFiles
        .filter((row) => baseline.approvedDeltaPaths.includes(row.path))
        .map(({ path: file, bytes, sha256: digest }) => ({
          path: file,
          bytes,
          sha256: digest,
        })),
      baseline.design,
      baseline.plan,
      { path: STAGE9_BASELINE_PATH, bytes: baselineBytes.length, sha256: sha256(baselineBytes) },
    ],
    stage10Actions: 0,
  };
  const snapshotBytes = Buffer.from(jsonBytes(sourceSnapshot));
  await writeFile(path.join(root, "provenance/source-snapshot.json"), snapshotBytes);
  const extensionBytes = await readFile(path.join(root, "deployment/stage-9-extension.v3.json"));
  const release = {
    schemaVersion: 1,
    stage: STAGE9_STAGE,
    environment: "DEVELOPMENT",
    candidate: "gen01",
    artifactId: `travelos-stage9-gen01-${sha256(snapshotBytes).slice(0, 8)}`,
    source: {
      baselineCommit: STAGE9_PREDECESSOR,
      snapshotSha256: sha256(snapshotBytes),
      identity: "WORKING_TREE_CONTENT_SNAPSHOT_NOT_BASELINE_COMMIT",
      predecessor: STAGE9_PREDECESSOR,
      predecessorArtifactId: STAGE8_ACCEPTED_ARTIFACT_ID,
      predecessorArtifactSha256: STAGE8_ACCEPTED_ARTIFACT_SHA256,
    },
    toolchain: { node: NODE_VERSION, pnpm: PNPM_VERSION, postgresql: "18.6" },
    expectedCurrentArtifactId: STAGE9_CURRENT_ARTIFACT_ID,
    migrationHead: STAGE9_MIGRATION_HEAD,
    productionSigning: "NOT_PRODUCTION_SIGNED",
    qualification: "EXTERNAL_CANONICAL_CI_RECEIPT_REQUIRED",
    deploymentExtensionSha256: sha256(extensionBytes),
    stage10Actions: 0,
  };
  await writeFile(path.join(root, "release.json"), jsonBytes(release));
  await sealManifest(root);
  return root;
};

test("Admin and Portal Vite configs use the deployment asset prefix", async () => {
  const extension = JSON.parse(
    await readFile(path.join(repositoryRoot, STAGE9_V2_CONTRACT_PATH), "utf8"),
  );
  assert.equal(extension.presentation.staticAssetPrefix, "/assets/");
  for (const app of ["admin-web", "portal-web"]) {
    const viteConfig = await readFile(
      path.join(repositoryRoot, "apps", app, "vite.config.ts"),
      "utf8",
    );
    assert.match(viteConfig, /\bbase:\s*["']\/["']/u, `${app} must emit root-based asset URLs`);
  }
});

test("Stage 9 verifier exposes an exact artifact inventory and integrity check", () => {
  assert.equal(typeof integrity?.inventory, "function");
  assert.equal(typeof integrity?.verifyInventory, "function");
  assert.equal(typeof integrity?.verifyArtifact, "function");
});

test("artifact verifier accepts only a complete Stage 9 release with both compiled shells", async (context) => {
  if (typeof integrity?.verifyArtifact !== "function") {
    context.skip("Stage 9 artifact verifier is not implemented yet");
    return;
  }
  const root = await createArtifactFixture();
  try {
    const report = await integrity.verifyArtifact(root);
    assert.equal(report.result, "PASS");
    assert.match(report.artifactId, /^travelos-stage9-gen01-[a-f0-9]{8}$/u);
    assert.equal(report.migrationHead, STAGE9_MIGRATION_HEAD);
    assert.equal(report.shells.admin.assets, 2);
    assert.equal(report.shells.portal.assets, 2);
    assert.equal(report.stage10Actions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact verifier rejects a Portal credential form that is not POST-only", async (context) => {
  if (typeof integrity?.verifyArtifact !== "function") {
    context.skip("Stage 9 artifact verifier is not implemented yet");
    return;
  }
  const root = await createArtifactFixture();
  try {
    const file = path.join(root, "portal-web/index.html");
    const html = await readFile(file, "utf8");
    await writeFile(file, html.replace('method="post"', 'method="get"'));
    await sealManifest(root);
    await assert.rejects(integrity.verifyArtifact(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact verifier rejects successor baseline and immutable v2 tampering after resealing", async () => {
  for (const file of [
    "provenance/stage9-successor-baseline.json",
    "deployment/stage-9-extension.v2.json",
  ]) {
    const root = await createArtifactFixture();
    try {
      assert.equal((await integrity.verifyArtifact(root)).result, "PASS");
      await writeFile(path.join(root, file), "tampered evidence\n");
      await sealManifest(root);
      await assert.rejects(integrity.verifyArtifact(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("artifact verifier rejects missing compiled assets after the manifest is resealed", async (context) => {
  if (typeof integrity?.verifyArtifact !== "function") {
    context.skip("Stage 9 artifact verifier is not implemented yet");
    return;
  }
  const root = await createArtifactFixture();
  try {
    await rm(path.join(root, "admin-web/assets/admin.js"));
    await sealManifest(root);
    await assert.rejects(integrity.verifyArtifact(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact inventory rejects duplicate, omitted, and escaping entries", async (context) => {
  if (typeof integrity?.inventory !== "function") {
    context.skip("Stage 9 artifact inventory is not implemented yet");
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-inventory-"));
  try {
    await writeFile(path.join(root, "payload"), "synthetic payload\n");
    const rows = await integrity.inventory(root);
    await assert.rejects(integrity.verifyInventory(root, []));
    await assert.rejects(integrity.verifyInventory(root, [...rows, ...rows]));
    await symlink("../../outside", path.join(root, "escape"));
    await assert.rejects(integrity.inventory(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
