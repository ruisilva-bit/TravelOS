import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { inventory } from "../stage-9/artifact-integrity.mjs";
import { verifyArtifactBinding } from "./artifact.mjs";
import { inputIdentity } from "./candidate.mjs";
import { BRANCH, MIGRATION_HEAD, PREDECESSOR, STAGE, TOOLCHAIN } from "./constants.mjs";
import {
  PACKAGE_COPIES,
  RUNTIME_ROOTS,
  deploymentContract,
  verifyDeploymentContract,
} from "./deployment-contract.mjs";
import { assertDigest, digest, jsonBytes, regularBytes, safeAncestors, sha256 } from "./io.mjs";
import { rehearseServicePaths } from "./service-path-rehearsal.mjs";
import { inspectDeclaredEntries } from "./declared-entry-checks.mjs";
import { probeBootstrapFailure } from "./bootstrap-preflight.mjs";

const contained = (root, target) => {
  assert.ok(
    target.startsWith(`${root}${path.sep}`),
    `Runtime dependency escapes artifact containment: ${target}`,
  );
  return target;
};
const readJson = async (file) => JSON.parse(await regularBytes(file));
// Parse only the packages-key universe of the pinned pnpm v9 lock grammar, NOT
// arbitrary YAML or a claimed lock-graph/integrity attestation. Package bytes
// remain covered by the exact archive/manifest; frozen offline pnpm constructs
// the graph, and canonical dependency-universe/runtime gates remain mandatory.
const lockPackageKeys = (bytes) => {
  const text = bytes.toString("utf8");
  assert.match(text, /^lockfileVersion: ['"]9\.0['"]$/mu, "Unsupported pnpm lock grammar");
  const section = /^packages:\n([\s\S]*?)^snapshots:/mu.exec(text)?.[1];
  assert.ok(section, "Missing lock dependency universe");
  const result = new Set();
  for (const line of section.split("\n")) {
    if (!/^ {2}\S/u.test(line)) continue;
    const match = /^ {2}(?:(['"])(.+)\1|([^'"].*)):$/u.exec(line);
    assert.ok(match, `Unsupported lock package key: ${line}`);
    result.add(match[2] ?? match[3]);
  }
  assert.ok(result.size, "Empty lock dependency universe");
  return result;
};
const resolveDependency = async (root, from, name) => {
  assert.match(name, /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu, "Unsafe dependency name");
  let cursor = from;
  while (cursor === root || cursor.startsWith(`${root}${path.sep}`)) {
    const candidate = path.join(cursor, "node_modules", name);
    try {
      const resolved = contained(root, await realpath(candidate));
      assert.ok((await lstat(resolved)).isDirectory(), "Dependency must be a directory");
      return resolved;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (cursor === root) break;
    cursor = path.dirname(cursor);
  }
  return null;
};
export const inspectRuntimeDependencies = async (payload, { inputs } = {}) => {
  const root = await realpath(payload);
  const rows = [];
  const optionalMissing = [];
  const seen = new Set();
  const sourcePackages = new Map();
  if (inputs) {
    for (const row of inputs.source.files.filter((row) =>
      /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(row.path),
    )) {
      const bytes = await regularBytes(path.join(root, "provenance/source", row.path));
      assert.equal(sha256(bytes), row.sha256, "Dependency source manifest drift");
      const pkg = JSON.parse(bytes);
      sourcePackages.set(pkg.name, pkg);
    }
  }
  const lock = inputs
    ? lockPackageKeys(await regularBytes(path.join(root, "provenance/pnpm-lock.yaml")))
    : null;
  const visit = async (directory, expectedName, directExpectedVersion) => {
    const resolved = contained(root, await realpath(directory));
    const relative = path.relative(root, resolved).split(path.sep).join("/");
    const pkg = await readJson(path.join(resolved, "package.json"));
    assert.equal(pkg.name, expectedName, `Runtime dependency identity mismatch: ${expectedName}`);
    if (directExpectedVersion)
      assert.equal(
        pkg.version,
        directExpectedVersion,
        `Runtime dependency version drift: ${expectedName}`,
      );
    if (seen.has(relative)) return;
    seen.add(relative);
    if (lock && !sourcePackages.has(pkg.name))
      assert.ok(
        lock.has(`${pkg.name}@${pkg.version}`),
        `Runtime dependency missing from frozen lock: ${pkg.name}@${pkg.version}`,
      );
    const source = sourcePackages.get(pkg.name);
    if (source) {
      assert.equal(
        pkg.version,
        source.version,
        `Workspace dependency version mismatch: ${pkg.name}`,
      );
      assert.deepEqual(
        Object.keys(pkg.dependencies ?? {}).sort(),
        Object.keys(source.dependencies ?? {}).sort(),
        `Workspace dependency declarations mismatch: ${pkg.name}`,
      );
    }
    const edges = [];
    const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies };
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {}))
      if (!(name in dependencies)) dependencies[name] = range;
    for (const name of Object.keys(dependencies).sort()) {
      const optional =
        Object.hasOwn(pkg.optionalDependencies ?? {}, name) ||
        pkg.peerDependenciesMeta?.[name]?.optional === true;
      const target = await resolveDependency(root, resolved, name);
      if (!target) {
        assert.ok(optional, `Required runtime dependency missing: ${pkg.name} -> ${name}`);
        optionalMissing.push({ from: relative, name });
        continue;
      }
      const declaration = source?.dependencies?.[name] ?? dependencies[name];
      const exact = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(declaration) ? declaration : undefined;
      const targetPackage = await readJson(path.join(target, "package.json"));
      assert.equal(targetPackage.name, name, `Runtime dependency name mismatch: ${name}`);
      if (exact)
        assert.equal(targetPackage.version, exact, `Runtime dependency version mismatch: ${name}`);
      if (declaration.startsWith("workspace:"))
        assert.ok(sourcePackages.has(name), `Missing frozen workspace dependency: ${name}`);
      edges.push({
        name,
        version: targetPackage.version,
        path: path.relative(root, target).split(path.sep).join("/"),
        optional,
      });
      await visit(target, name, exact);
    }
    rows.push({
      path: relative,
      name: pkg.name,
      version: pkg.version,
      packageJsonSha256: sha256(await regularBytes(path.join(resolved, "package.json"))),
      dependencies: edges,
    });
  };
  for (const runtime of RUNTIME_ROOTS) await visit(path.join(root, runtime.target), runtime.name);
  rows.sort((a, b) => (a.path < b.path ? -1 : 1));
  optionalMissing.sort((a, b) => (`${a.from}/${a.name}` < `${b.from}/${b.name}` ? -1 : 1));
  return {
    schemaVersion: 1,
    scope: "MANIFEST_CLOSURE_AND_LOCK_MEMBERSHIP_NOT_LOCK_GRAPH_ATTESTATION",
    roots: RUNTIME_ROOTS.length,
    packages: rows,
    optionalMissing,
  };
};
const assertRequired = async (root, file) => {
  let bytes;
  try {
    bytes = await regularBytes(path.join(root, file));
  } catch (error) {
    throw new Error(`Required artifact entrypoint missing/unsafe: ${file}`, { cause: error });
  }
  assert.ok(bytes.length, `Required artifact entrypoint is empty: ${file}`);
  return bytes;
};
const shell = async (root, surface) => {
  const html = (await assertRequired(root, `${surface}-web/index.html`)).toString("utf8");
  const realm = surface === "admin" ? "staff" : "portal";
  assert.match(html, /<html\b[^>]*\blang="pt-PT"/iu, "Shell language missing");
  assert.match(html, new RegExp(`<div\\b[^>]*\\bid="${surface}-root"`, "iu"), "Shell root missing");
  const forms = [...html.matchAll(/<form\b[^>]*>/giu)].map(([value]) => value);
  assert.equal(forms.length, 1, "Shell requires exactly one no-JavaScript form");
  assert.match(forms[0], /\bmethod="post"/iu, "Shell form must POST");
  assert.match(
    forms[0],
    new RegExp(`\\baction="/api/auth/${realm}/sign-in/email"`, "iu"),
    "Shell form realm mismatch",
  );
  assert.doesNotMatch(
    html,
    /<input\b[^>]*\btype="password"[^>]*\bvalue=/iu,
    "Shell preset password forbidden",
  );
  assert.doesNotMatch(html, /\b(?:src|href)="https?:\/\//iu, "External shell assets forbidden");
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)(?:[?#][^"]*)?"/giu)].map(
    ([, value]) => value.slice(1),
  );
  for (const extension of [".js", ".css"])
    assert.ok(
      assets.some((asset) => asset.endsWith(extension)),
      `Shell compiled ${extension} missing`,
    );
  for (const asset of assets) {
    assert.equal(path.posix.normalize(asset), asset, "Unsafe shell asset");
    await assertRequired(root, `${surface}-web/${asset}`);
  }
  return { entrypoint: `${surface}-web/index.html`, assets: new Set(assets).size };
};
export const qualifyExtractedArtifact = async ({
  payload,
  archive,
  receipt,
  expectedReceiptSha256,
  inputs,
  expectedNodeSha256,
}) => {
  assert.deepEqual(
    inputs.predecessor,
    PREDECESSOR,
    "Qualification predecessor must be accepted gen11",
  );
  assert.deepEqual(inputs.toolchain, TOOLCHAIN, "Qualification toolchain mismatch");
  assert.equal(inputIdentity(inputs), inputs.inputDigest, "Qualification input identity mismatch");
  assert.equal(inputs.migration.head, MIGRATION_HEAD);
  assertDigest(expectedNodeSha256);
  await safeAncestors(payload, true);
  const root = await realpath(payload);
  const binding = {
    inputDigest: inputs.inputDigest,
    sourceSha256: digest(inputs.source),
    migrationSha256: digest(inputs.migration),
    toolchain: inputs.toolchain,
    predecessorCommit: PREDECESSOR.commit,
    predecessorArchiveSha256: PREDECESSOR.archiveSha256,
  };
  await verifyArtifactBinding({ payload: root, archive, receipt, expectedReceiptSha256, binding });
  const release = await readJson(path.join(root, "release.json"));
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.stage, STAGE);
  assert.match(release.candidate, /^gen(?:0[1-9]|[1-9][0-9]+)$/u);
  assert.equal(
    release.artifactId,
    `travelos-stage10-${release.candidate}-${inputs.inputDigest.slice(0, 8)}`,
  );
  assert.deepEqual(release.binding, binding);
  assert.deepEqual(release.source, {
    branch: BRANCH,
    identity: "WORKING_TREE_CONTENT_SNAPSHOT_NOT_BASELINE_COMMIT",
    snapshotSha256: digest(inputs.source),
    predecessor: PREDECESSOR,
  });
  assert.deepEqual(release.toolchain, TOOLCHAIN);
  assert.equal(release.migrationHead, MIGRATION_HEAD);
  assert.equal(release.expectedCurrentArtifactId, PREDECESSOR.artifactId);
  assert.equal(release.expectedCurrentArtifactSha256, PREDECESSOR.archiveSha256);
  assert.equal(release.environment, "DEVELOPMENT");
  assert.equal(release.designation, "DEVELOPMENT_CANDIDATE_UNQUALIFIED");
  assert.equal(release.productionSigning, "NOT_PRODUCTION_SIGNED");
  assert.equal(release.qualification, "PENDING_CANONICAL_CI_RUNTIME_SIGNATURE_PRIVACY_REVIEW");
  assert.equal(release.stage11Actions, 0);
  assert.deepEqual(
    await regularBytes(path.join(root, "provenance/source-snapshot.json")),
    jsonBytes(inputs.source),
    "Packaged source snapshot mismatch",
  );
  assert.deepEqual(
    await regularBytes(path.join(root, "provenance/inputs.json")),
    jsonBytes(inputs),
    "Packaged frozen input mismatch",
  );
  const sourceRows = new Map();
  for (const row of inputs.source.files) {
    assert.ok(
      !path.isAbsolute(row.path) &&
        !row.path.split("/").some((part) => ["", ".", ".."].includes(part)),
      "Unsafe source path",
    );
    assert.ok(!sourceRows.has(row.path), "Duplicate source path");
    sourceRows.set(row.path, row);
    const bytes = await regularBytes(path.join(root, "provenance/source", row.path));
    assert.equal(bytes.length, row.bytes, `Source byte count mismatch: ${row.path}`);
    assert.equal(sha256(bytes), row.sha256, `Source digest mismatch: ${row.path}`);
    assert.equal(
      ((await lstat(path.join(root, "provenance/source", row.path))).mode & 0o111) !== 0,
      row.executable,
      "Source mode mismatch",
    );
  }
  const checkCopy = async (from, to) => {
    const row = sourceRows.get(from);
    assert.ok(row, `Required frozen source missing: ${from}`);
    const bytes = await assertRequired(root, to);
    assert.equal(bytes.length, row.bytes, `Source copy byte mismatch: ${to}`);
    assert.equal(sha256(bytes), row.sha256, `Source copy digest mismatch: ${to}`);
  };
  for (const [from, to] of PACKAGE_COPIES) await checkCopy(from, to);
  await checkCopy("pnpm-lock.yaml", "provenance/pnpm-lock.yaml");
  assert.deepEqual(
    inputs.migration.files,
    inputs.source.files.filter((row) => row.path.startsWith("migrations/")),
    "Migration source set mismatch",
  );
  const checksums = await readJson(path.join(root, "migrations/checksums.json"));
  assert.equal(checksums.schemaVersion, 1);
  assert.equal(checksums.algorithm, "sha256");
  assert.ok(checksums.migrations.length);
  const names = checksums.migrations.map((row) => row.file);
  assert.equal(new Set(names).size, names.length, "Duplicate migration");
  assert.deepEqual(names, [...names].sort(), "Migration chain order mismatch");
  assert.equal(names.at(-1), `${MIGRATION_HEAD}.cjs`);
  const expectedNames = inputs.migration.files.map((row) => path.posix.basename(row.path)).sort();
  assert.deepEqual(
    expectedNames,
    [...names, "checksums.json"].sort(),
    "Migration chain membership mismatch",
  );
  for (const folder of ["migrations", "migrator/migrations"]) {
    assert.deepEqual(
      (await readdir(path.join(root, folder))).sort(),
      expectedNames,
      "Unexpected migration chain files",
    );
    for (const name of expectedNames) {
      await checkCopy(`migrations/${name}`, `${folder}/${name}`);
      if (name !== "checksums.json") {
        assert.match(name, /^\d{4}_[a-z0-9_]+\.cjs$/u);
        assert.equal(
          sourceRows.get(`migrations/${name}`).sha256,
          checksums.migrations.find((row) => row.file === name)?.sha256,
          "Migration checksum mismatch",
        );
      }
    }
  }
  const contract = await readJson(path.join(root, "deployment/stage10-contract.json"));
  verifyDeploymentContract(contract);
  assert.equal(release.deploymentContractSha256, digest(deploymentContract()));
  // Only map the runtime service paths; inherited verifier/acceptance programs
  // retain their historical interface and are not Stage 10 authority.
  const historical = await readJson(path.join(root, contract.runtime.serviceContract.source));
  const servicePaths = await rehearseServicePaths({
    payload: root,
    profile: contract.environment,
    services: historical.services,
  });
  for (const runtime of RUNTIME_ROOTS)
    await assertRequired(root, `${runtime.target}/${runtime.entrypoint}`);
  await assertRequired(root, "migrator/dist/tooling/database/migration-runner.js");
  const dependencies = await inspectRuntimeDependencies(root, { inputs });
  assert.deepEqual(
    await regularBytes(path.join(root, "provenance/runtime-dependencies.json")),
    jsonBytes(dependencies),
    "Runtime dependency inventory mismatch",
  );
  assert.equal(release.runtimeDependenciesSha256, digest(dependencies));
  const fixed = new Set([
    "release.json",
    "stage10-payload.json",
    "deployment/stage10-contract.json",
    "runtime/node/bin/node",
    "provenance/source-snapshot.json",
    "provenance/inputs.json",
    "provenance/pnpm-lock.yaml",
    "provenance/runtime-dependencies.json",
    ...PACKAGE_COPIES.map(([, to]) => to),
    ...inputs.source.files.map((row) => `provenance/source/${row.path}`),
    ...inputs.migration.files.flatMap((row) => [row.path, `migrator/${row.path}`]),
  ]);
  for (const row of await inventory(root)) {
    const inRuntime = RUNTIME_ROOTS.some(
      (runtime) =>
        row.path.startsWith(`${runtime.target}/dist/`) ||
        row.path.startsWith(`${runtime.target}/node_modules/`) ||
        row.path === `${runtime.target}/package.json` ||
        row.path === `${runtime.target}/pnpm-lock.yaml`,
    );
    const inWeb =
      /^(?:admin|portal)-web\/(?:index\.html|assets\/[^/]+\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?|ico))$/u.test(
        row.path,
      );
    assert.ok(
      fixed.has(row.path) || inRuntime || inWeb,
      `Unexpected artifact path outside allowlist: ${row.path}`,
    );
    if (row.path.startsWith("provenance/source/")) continue;
    assert.ok(
      !row.path
        .split("/")
        .some((part) => [".env", ".git", "test", "tests", "__tests__"].includes(part)),
      `Forbidden runtime source/test/credential path: ${row.path}`,
    );
    assert.doesNotMatch(
      row.path,
      /\.(?:test|spec)\.[cm]?[jt]sx?(?:\.map)?$/u,
      "Packaged test forbidden",
    );
  }
  const shells = { admin: await shell(root, "admin"), portal: await shell(root, "portal") };
  const nodePath = path.join(root, "runtime/node/bin/node");
  const nodeBytes = await regularBytes(nodePath);
  assert.equal(
    sha256(nodeBytes),
    expectedNodeSha256,
    "Bundled Node digest differs from independent Node pin",
  );
  assert.equal(release.nodeSha256, expectedNodeSha256, "Release Node hash mismatch");
  assert.ok((await lstat(nodePath)).mode & 0o111, "Bundled Node must be executable");
  const runNode = (args, cwd = root) => {
    const child = spawnSync(nodePath, args, {
      cwd,
      env: { PATH: "/usr/bin:/bin", HOME: root, TZ: "UTC", LANG: "C.UTF-8" },
      timeout: 60_000,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(child.error, undefined, "Bundled Node execution failed");
    assert.equal(child.status, 0, "Bundled Node probe failed");
    assert.equal(child.signal, null);
    return child.stdout.trim();
  };
  const nodeVersion = runNode(["--version"]).replace(/^v/u, "");
  assert.equal(nodeVersion, TOOLCHAIN.node, "Actual bundled Node version mismatch");
  for (const runtime of RUNTIME_ROOTS)
    runNode(["--check", path.join(root, runtime.target, runtime.entrypoint)]);
  // Manifest dependencies do not imply package-root JavaScript APIs. Inspect
  // declared files separately; actual consumer-specifier and service qualification
  // remains mandatory and explicitly pending, never inferred from this check.
  const declaredEntries = await inspectDeclaredEntries({ root, packages: dependencies.packages });
  const bootstrapPreflight = await probeBootstrapFailure({ payload: root, expectedNodeSha256 });
  // Recheck after all probes; executing a pinned binary is not a substitute for
  // source/archive correspondence or independent receipt/key authority.
  await verifyArtifactBinding({ payload: root, archive, receipt, expectedReceiptSha256, binding });
  return {
    result: "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED",
    artifactId: release.artifactId,
    inputDigest: inputs.inputDigest,
    archiveSha256: receipt.archiveSha256,
    nodeSha256: expectedNodeSha256,
    nodeVersion,
    sourceFiles: sourceRows.size,
    migrationHead: MIGRATION_HEAD,
    dependencies,
    declaredEntries,
    bootstrapPreflight,
    executableImportGraph: "PENDING_ACTUAL_CONSUMER_SPECIFIER_AND_RUNTIME_QUALIFICATION",
    shells,
    servicePaths,
    releaseQualification: release.qualification,
    trust: "PENDING",
    privacy: "PENDING",
    stage11Actions: 0,
  };
};
