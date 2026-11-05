import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_DEPLOYMENT_CONTRACT_SHA256,
  NODE_VERSION,
  PNPM_VERSION,
  STAGE8_ACCEPTED_ARTIFACT_ID,
  STAGE8_ACCEPTED_ARTIFACT_SHA256,
  STAGE8_CONTROLLED_ACCEPTANCE_UNIT_SHA256,
  STAGE8_MIGRATION_HEAD,
  STAGE8_RUNTIME_ACCEPTANCE_UNIT_SHA256,
  STAGE8_WORKER_DROPIN_SHA256,
  STAGE9_BRANCH,
  STAGE9_CADDY_SHA256,
  STAGE9_CURRENT_ARTIFACT_ID,
  STAGE9_CURRENT_ARTIFACT_SHA256,
  STAGE9_CURRENT_MIGRATION_HEAD,
  STAGE9_PREVIOUS_MIGRATION_PATH,
  STAGE9_PREVIOUS_MIGRATION_SHA256,
  STAGE9_BASELINE_PATH,
  STAGE9_BASELINE_SHA256,
  STAGE9_MIGRATION_HEAD,
  STAGE9_MIGRATION_PATH,
  STAGE9_MIGRATION_SHA256,
  STAGE9_PREDECESSOR,
  STAGE9_STAGE,
  STAGE9_V1_CONTRACT_SHA256,
  STAGE9_V2_CONTRACT_PATH,
  STAGE9_V2_CONTRACT_SHA256,
  STAGE9_V3_CONTRACT_SHA256,
} from "./constants.mjs";

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
      } else if (metadata.isDirectory()) {
        await visit(file);
      } else {
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
  return rows.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
};

export const verifyInventory = async (root, rows, exclude = []) => {
  assert.equal(new Set(rows.map((row) => row.path)).size, rows.length, "Duplicate manifest path");
  assert.deepEqual(
    await inventory(root, exclude),
    rows,
    "Exact artifact path/byte manifest mismatch",
  );
};

const verifyShell = async (root, surface) => {
  const app = surface === "admin" ? "admin" : "portal";
  const authPath =
    surface === "admin" ? "/api/auth/staff/sign-in/email" : "/api/auth/portal/sign-in/email";
  const html = await readFile(path.join(root, `${app}-web/index.html`), "utf8");
  assert.match(html, /<html\b[^>]*\blang="pt-PT"/iu);
  assert.match(html, new RegExp(`<div\\b[^>]*\\bid="${app}-root"`, "u"));
  const forms = [...html.matchAll(/<form\b[^>]*>/giu)].map(([form]) => form);
  assert.equal(forms.length, 1, `${app} shell must have one no-JavaScript login form`);
  assert.match(forms[0], /\bmethod="post"/iu);
  assert.match(forms[0], new RegExp(`\\baction="${authPath}"`, "u"));
  assert.doesNotMatch(forms[0], /\baction="[^"]*\?/iu);
  assert.doesNotMatch(html, /<input\b[^>]*\btype="password"[^>]*\bvalue=/iu);
  assert.doesNotMatch(html, /\b(?:src|href)="https?:\/\//iu);

  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)(?:[?#][^"]*)?"/giu)].map(
    ([, asset]) => asset,
  );
  assert.ok(assets.length >= 2, `${app} shell must reference compiled JavaScript and CSS assets`);
  const uniqueAssets = [...new Set(assets)].sort();
  for (const asset of uniqueAssets) {
    const relative = path.posix.normalize(asset.slice(1));
    assert.ok(relative.startsWith("assets/") && !relative.split("/").includes(".."));
    const metadata = await lstat(path.join(root, `${app}-web`, relative));
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `Missing compiled asset: ${asset}`);
  }
  assert.ok(
    assets.some((asset) => /\.js$/u.test(asset)),
    `${app} shell JavaScript asset missing`,
  );
  assert.ok(
    assets.some((asset) => /\.css$/u.test(asset)),
    `${app} shell stylesheet asset missing`,
  );
  return { assets: uniqueAssets.length, entrypoint: `${app}-web/index.html` };
};

const requireFile = (manifest, file) =>
  assert.ok(
    manifest.files.some((row) => row.path === file && row.type === "file"),
    `Required artifact entry missing: ${file}`,
  );

const verifyExtension = async (root, release) => {
  const baseBytes = await readFile(path.join(root, "deployment/deployment-contract.v1.json"));
  assert.equal(sha256(baseBytes), BASE_DEPLOYMENT_CONTRACT_SHA256);
  const v1Bytes = await readFile(path.join(root, "deployment/stage-9-extension.v1.json"));
  assert.equal(sha256(v1Bytes), STAGE9_V1_CONTRACT_SHA256);
  const v2Bytes = await readFile(path.join(root, "deployment/stage-9-extension.v2.json"));
  assert.equal(sha256(v2Bytes), STAGE9_V2_CONTRACT_SHA256);
  const extensionBytes = await readFile(path.join(root, "deployment/stage-9-extension.v3.json"));
  assert.equal(sha256(extensionBytes), STAGE9_V3_CONTRACT_SHA256);
  assert.equal(sha256(extensionBytes), release.deploymentExtensionSha256);
  const extension = JSON.parse(extensionBytes.toString("utf8"));
  assert.equal(extension.schemaVersion, 3);
  assert.equal(extension.contractId, "travelos-stage9-staff-invitations-v3");
  assert.deepEqual(extension.supersedes, {
    path: STAGE9_V2_CONTRACT_PATH,
    sha256: STAGE9_V2_CONTRACT_SHA256,
  });
  assert.deepEqual(extension.approvedSuccessorBaseline, {
    path: STAGE9_BASELINE_PATH,
    sha256: STAGE9_BASELINE_SHA256,
  });
  const baselineBytes = await readFile(
    path.join(root, "provenance/stage9-successor-baseline.json"),
  );
  assert.equal(sha256(baselineBytes), STAGE9_BASELINE_SHA256);
  assert.equal(extension.stage, STAGE9_STAGE);
  assert.deepEqual(extension.extends, {
    path: "deploy/contracts/deployment-contract.v1.json",
    sha256: BASE_DEPLOYMENT_CONTRACT_SHA256,
  });
  assert.deepEqual(extension.predecessor, {
    commit: STAGE9_PREDECESSOR,
    stage: "PHASE_1_M1_STAGE_8",
    artifactId: STAGE8_ACCEPTED_ARTIFACT_ID,
    artifactSha256: STAGE8_ACCEPTED_ARTIFACT_SHA256,
    migrationHead: STAGE8_MIGRATION_HEAD,
  });
  assert.equal(extension.artifact.compileOnCt200, false);
  assert.equal(extension.artifact.expectedCurrentArtifactId, STAGE9_CURRENT_ARTIFACT_ID);
  assert.equal(extension.artifact.expectedCurrentArtifactSha256, STAGE9_CURRENT_ARTIFACT_SHA256);
  assert.equal(release.expectedCurrentArtifactId, STAGE9_CURRENT_ARTIFACT_ID);
  assert.equal(extension.presentation.language, "pt-PT");
  assert.equal(extension.presentation.sameOriginWithApi, true);
  assert.equal(extension.presentation.cacheControl, "private, no-store");
  assert.equal(extension.presentation.dotfiles, "deny");
  assert.equal(extension.presentation.unknownRouteShellFallback, false);
  assert.equal(extension.presentation.publicSignup, false);
  assert.equal(extension.routing.existingExactHostAllowlist, true);
  assert.equal(extension.routing.caddyConfigurationChanges, false);
  assert.equal(extension.routing.caddy.expectedCurrentSha256, STAGE9_CADDY_SHA256);
  assert.equal(extension.routing.caddy.configurationSha256, STAGE9_CADDY_SHA256);
  const caddyBytes = await readFile(path.join(root, extension.routing.caddy.artifactPath));
  assert.equal(sha256(caddyBytes), extension.routing.caddy.configurationSha256);
  assert.equal(
    extension.routing.caddy.configurationSource,
    "deploy/caddy/Caddyfile.stage9-development",
  );
  assert.equal(extension.routing.caddy.adminApi, "OFF");
  assert.equal(extension.routing.caddy.listener, "192.168.1.33:80");
  assert.equal(extension.routing.caddy.targetPath, "/etc/caddy/Caddyfile");
  assert.equal(extension.routing.caddy.applyAction, "NONE");
  assert.deepEqual(extension.routing.caddy.apiPaths, ["/api", "/api/*", "/health", "/health/*"]);
  assert.equal(extension.routing.caddy.adminStaticRoot, "/opt/travelos/current/admin-web");
  assert.equal(extension.routing.caddy.portalStaticRoot, "/opt/travelos/current/portal-web");
  assert.equal(extension.routing.caddy.cacheControl, "private, no-store");
  assert.equal(extension.routing.caddy.dotfiles, "DENY");
  assert.equal(extension.routing.caddy.unknownPathFallback, false);
  assert.equal(extension.routing.caddy.unknownHostStatus, 421);
  assert.deepEqual(extension.services.restartServices, [
    "travelos-admin-api.service",
    "travelos-portal-api.service",
  ]);
  assert.deepEqual(extension.services.doNotRestartServices, ["travelos-worker.service"]);
  assert.equal(extension.services.restartCaddyForConfiguration, false);
  assert.equal(extension.routing.dnsChanges, false);
  assert.deepEqual(extension.routing.newExternallyReachablePorts, []);
  assert.equal(extension.database.expectedCurrentMigrationHead, STAGE9_CURRENT_MIGRATION_HEAD);
  assert.equal(extension.database.migrationHead, STAGE9_MIGRATION_HEAD);
  assert.equal(extension.database.migrationChanges, true);
  assert.equal(extension.database.migrationPath, STAGE9_MIGRATION_PATH);
  assert.equal(extension.database.migrationSha256, STAGE9_MIGRATION_SHA256);
  assert.equal(
    extension.database.migrationExecution,
    "CONTROLLED_MIGRATOR_UP_AFTER_VERIFIED_RESTORE",
  );
  assert.equal(extension.database.betterAuthRuntimeMigrations, false);
  assert.equal(extension.portal.presentationSource, "AUTHORIZED_PUBLISHED_SNAPSHOTS_ONLY");
  assert.equal(extension.portal.mutableWorkspaceFallback, false);
  assert.equal(extension.services.systemdUnitChanges, false);
  assert.equal(extension.stage10Actions, 0);

  for (const [relative, expected] of [
    ["deployment/worker-stage8.conf", STAGE8_WORKER_DROPIN_SHA256],
    [
      "deployment/travelos-stage8-runtime-acceptance.service",
      STAGE8_RUNTIME_ACCEPTANCE_UNIT_SHA256,
    ],
    [
      "deployment/travelos-stage8-controlled-acceptance.service",
      STAGE8_CONTROLLED_ACCEPTANCE_UNIT_SHA256,
    ],
  ])
    assert.equal(
      (await hashFile(path.join(root, relative))).sha256,
      expected,
      `${relative} drifted`,
    );
  return sha256(extensionBytes);
};

export const verifyArtifact = async (directory) => {
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(path.join(root, "payload-manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.excludes, ["payload-manifest.json"]);
  await verifyInventory(root, manifest.files, manifest.excludes);

  const release = JSON.parse(await readFile(path.join(root, "release.json"), "utf8"));
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.stage, STAGE9_STAGE);
  assert.equal(release.environment, "DEVELOPMENT");
  assert.match(release.candidate, /^gen[0-9]{2}$/u);
  assert.equal(release.productionSigning, "NOT_PRODUCTION_SIGNED");
  assert.equal(release.qualification, "EXTERNAL_CANONICAL_CI_RECEIPT_REQUIRED");
  assert.equal(release.stage10Actions, 0);
  assert.equal(release.source.predecessor, STAGE9_PREDECESSOR);
  assert.equal(release.source.predecessorArtifactId, STAGE8_ACCEPTED_ARTIFACT_ID);
  assert.equal(release.source.predecessorArtifactSha256, STAGE8_ACCEPTED_ARTIFACT_SHA256);
  assert.equal(release.toolchain.node, NODE_VERSION);
  assert.equal(release.toolchain.pnpm, PNPM_VERSION);
  assert.equal(release.expectedCurrentArtifactId, STAGE9_CURRENT_ARTIFACT_ID);
  assert.equal(release.migrationHead, STAGE9_MIGRATION_HEAD);
  assert.equal(
    release.artifactId,
    `travelos-stage9-${release.candidate}-${release.source.snapshotSha256.slice(0, 8)}`,
  );
  const sourceBytes = await readFile(path.join(root, "provenance/source-snapshot.json"));
  assert.equal(sha256(sourceBytes), release.source.snapshotSha256);
  const source = JSON.parse(sourceBytes.toString("utf8"));
  assert.equal(source.schemaVersion, 1);
  assert.equal(source.stage, STAGE9_STAGE);
  assert.equal(source.predecessor, STAGE9_PREDECESSOR);
  assert.equal(source.branch, STAGE9_BRANCH);
  assert.equal(source.stage10Actions, 0);
  assert.ok(Array.isArray(source.files));
  assert.equal(new Set(source.files.map((row) => row.path)).size, source.files.length);
  const baseline = JSON.parse(
    await readFile(path.join(root, "provenance/stage9-successor-baseline.json"), "utf8"),
  );
  const baselineRow = source.files.find((row) => row.path === STAGE9_BASELINE_PATH);
  assert.equal(baselineRow?.sha256, STAGE9_BASELINE_SHA256);
  // The local baseline verifier proves all 40 historical inputs against the
  // exact predecessor. Only the five approved deltas and their approval are
  // release source; historical review/local-state inputs stay out of bundles.
  const approvedDocuments = baseline.protectedFiles.filter((row) =>
    baseline.approvedDeltaPaths.includes(row.path),
  );
  assert.equal(approvedDocuments.length, 5);
  for (const expected of [...approvedDocuments, baseline.design, baseline.plan]) {
    const row = source.files.find((candidate) => candidate.path === expected.path);
    assert.equal(row?.sha256, expected.sha256, `Baseline source drift: ${expected.path}`);
    assert.equal(row?.bytes, expected.bytes);
  }
  await verifyExtension(root, release);

  const checksums = JSON.parse(
    await readFile(path.join(root, "migrations/checksums.json"), "utf8"),
  );
  assert.ok(Array.isArray(checksums.migrations) && checksums.migrations.length > 0);
  assert.equal(checksums.migrations.at(-3).file, `${STAGE8_MIGRATION_HEAD}.cjs`);
  assert.deepEqual(checksums.migrations.at(-2), {
    file: path.basename(STAGE9_PREVIOUS_MIGRATION_PATH),
    sha256: STAGE9_PREVIOUS_MIGRATION_SHA256,
  });
  assert.deepEqual(checksums.migrations.at(-1), {
    file: path.basename(STAGE9_MIGRATION_PATH),
    sha256: STAGE9_MIGRATION_SHA256,
  });
  const expectedMigrationFiles = checksums.migrations.map((row) => row.file).toSorted();
  assert.equal(new Set(expectedMigrationFiles).size, expectedMigrationFiles.length);
  for (const row of checksums.migrations) {
    assert.match(row.file, /^\d{4}_[a-z0-9_]+\.cjs$/u);
    assert.equal((await hashFile(path.join(root, "migrations", row.file))).sha256, row.sha256);
    assert.equal(
      (await hashFile(path.join(root, "migrator/migrations", row.file))).sha256,
      row.sha256,
    );
  }
  for (const directoryName of ["migrations", "migrator/migrations"]) {
    const actual = (await readdir(path.join(root, directoryName)))
      .filter((name) => name.endsWith(".cjs"))
      .toSorted();
    assert.deepEqual(
      actual,
      expectedMigrationFiles,
      `Unexpected migration chain in ${directoryName}`,
    );
  }

  const required = [
    "apps/admin-api/dist/main.js",
    "apps/portal-api/dist/main.js",
    "apps/worker/dist/main.js",
    "migrator/run-stage6-migrations.mjs",
    "runtime/node/bin/node",
    "deployment/deployment-contract.v1.json",
    "deployment/stage-9-extension.v1.json",
    "deployment/stage-9-extension.v2.json",
    "deployment/stage-9-extension.v3.json",
    "provenance/stage9-successor-baseline.json",
    "deployment/Caddyfile",
    "deployment/verify-artifact.mjs",
    "deployment/constants.mjs",
    "deployment/install-runtime.mjs",
    "deployment/worker-stage8.conf",
    "deployment/travelos-stage8-runtime-acceptance.service",
    "deployment/travelos-stage8-controlled-acceptance.service",
    "operator/stage8-runtime-acceptance.mjs",
    "operator/controlled-worker.mjs",
    "operator/stage7-regression.mjs",
    "operator/stage9-static-runtime-acceptance.mjs",
    "operator/stage9-development-apply.mjs",
    "instance-manifest/development.example.json",
    "provenance/pnpm-lock.yaml",
    "migrations/checksums.json",
    "migrator/migrations/checksums.json",
    "admin-web/index.html",
    "portal-web/index.html",
  ];
  for (const file of required) requireFile(manifest, file);
  const nodeRow = manifest.files.find((row) => row.path === "runtime/node/bin/node");
  assert.equal(nodeRow.executable, true, "Packaged Node runtime must be executable");
  const shells = {
    admin: await verifyShell(root, "admin"),
    portal: await verifyShell(root, "portal"),
  };

  return {
    result: "PASS",
    artifactId: release.artifactId,
    sourceSnapshotSha256: release.source.snapshotSha256,
    deploymentExtensionSha256: release.deploymentExtensionSha256,
    entries: manifest.files.length,
    files: manifest.files.filter((row) => row.type === "file").length,
    migrationHead: STAGE9_MIGRATION_HEAD,
    shells,
    stage10Actions: 0,
  };
};

if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3);
    assert.ok(process.argv[2].startsWith("--artifact-root="));
    process.stdout.write(
      `${JSON.stringify(await verifyArtifact(process.argv[2].slice("--artifact-root=".length)))}\n`,
    );
  } catch {
    process.stderr.write(
      `${JSON.stringify({ result: "FAIL", code: "ARTIFACT_INTEGRITY_FAILED" })}\n`,
    );
    process.exitCode = 1;
  }
}
