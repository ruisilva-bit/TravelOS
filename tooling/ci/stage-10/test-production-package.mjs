import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { PREDECESSOR, STAGE, TOOLCHAIN, MIGRATION_HEAD } from "./constants.mjs";
import { digest, jsonBytes, sha256 } from "./io.mjs";
import { inputIdentity } from "./candidate.mjs";
import { sealPayload } from "./artifact.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const load = async (file) => {
  assert.ok(
    existsSync(new URL(file, import.meta.url)),
    `Missing Stage 10 production implementation: ${file}`,
  );
  return import(new URL(file, import.meta.url));
};
const temporary = async (t) => {
  assert.ok(process.env.TMPDIR?.startsWith("/home/hermes/"));
  const root = await mkdtemp(path.join(process.env.TMPDIR, "stage10-production-synthetic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};
const put = async (root, file, bytes, executable = false) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), bytes);
  if (executable) await chmod(path.join(root, file), 0o755);
};

// Catches: omitted migrator, development compilation, online dependency fetch,
// second build, or an injectable compile command. No compiler/candidate executes.
test("fixed recipe installs offline, compiles once in production and deploys all four runtime roots", async () => {
  const { productionSteps } = await load("./production-recipe.mjs");
  const steps = productionSteps("/synthetic/payload");
  assert.deepEqual(steps[0].args, [
    "pnpm",
    "install",
    "--offline",
    "--frozen-lockfile",
    "--ignore-scripts",
  ]);
  const builds = steps.filter((step) => step.args.includes("build"));
  assert.equal(builds.length, 1);
  assert.equal(builds[0].environment.NODE_ENV, "production");
  assert.deepEqual(
    steps
      .filter((step) => step.label.startsWith("deploy-"))
      .map((step) => step.args[step.args.indexOf("--filter") + 1]),
    ["@travelos/admin-api", "@travelos/portal-api", "@travelos/worker", "@travelos/migrator"],
  );
  for (const step of steps) {
    assert.equal(step.command, "corepack");
    assert.equal(step.environment.COREPACK_ENABLE_NETWORK, "0");
    assert.equal(step.environment.npm_config_offline, "true");
  }
});

test("input identity binds actual Node bytes even when Node version is unchanged", async () => {
  const base = {
    source: {},
    migration: {},
    toolchain: TOOLCHAIN,
    predecessor: PREDECESSOR,
    gatesSha256: "a".repeat(64),
    runtimeNodeSha256: "b".repeat(64),
  };
  assert.notEqual(
    inputIdentity(base),
    inputIdentity({ ...base, runtimeNodeSha256: "c".repeat(64) }),
  );
});

test("runtime root pruning removes source and build configuration without removing production entrypoints or dependencies", async (t) => {
  const { pruneRuntimeRoot } = await load("./production-recipe.mjs");
  const root = await temporary(t);
  for (const file of [
    "src/main.ts",
    "tsconfig.build.json",
    "pnpm-workspace.yaml",
    "dist/main.js",
    "node_modules/synthetic/package.json",
    "package.json",
    "pnpm-lock.yaml",
  ])
    await put(root, file, "synthetic\n");
  await pruneRuntimeRoot(root);
  assert.equal(existsSync(path.join(root, "src")), false);
  assert.equal(existsSync(path.join(root, "tsconfig.build.json")), false);
  assert.equal(existsSync(path.join(root, "dist/main.js")), true);
  assert.equal(existsSync(path.join(root, "node_modules/synthetic/package.json")), true);
});

test("Stage 10 contract binds gen11 and never grants activation or inherited Stage 9 migration permission", async () => {
  const { deploymentContract, verifyDeploymentContract } = await load("./deployment-contract.mjs");
  const contract = deploymentContract();
  assert.deepEqual(contract.predecessor, PREDECESSOR);
  assert.equal(contract.database.migrationHead, "0016_stage9_staff_invitations");
  assert.equal(contract.database.migrationChanges, false);
  assert.equal(contract.runtime.compileOnCt200, false);
  assert.equal(
    contract.activation.status,
    "BLOCKED_PENDING_HOST_SIGNING_AND_OPERATIONAL_QUALIFICATION",
  );
  verifyDeploymentContract(contract);
  assert.throws(
    () =>
      verifyDeploymentContract({
        ...contract,
        predecessor: { ...PREDECESSOR, artifactId: "travelos-stage9-gen10" },
      }),
    /contract/i,
  );
});

const synthetic = async (t, dependencyExports, declarationOnly = false) => {
  const { PACKAGE_COPIES, RUNTIME_ROOTS, deploymentContract } = await load(
    "./deployment-contract.mjs",
  );
  const { materializeProvenance } = await load("./production-recipe.mjs");
  const root = await temporary(t);
  const sourceRoot = path.join(root, "source");
  const payload = path.join(root, "payload");
  await mkdir(sourceRoot);
  await mkdir(payload);
  const rows = [];
  const addSource = async (file, bytes, executable = false) => {
    await put(sourceRoot, file, bytes, executable);
    rows.push({ path: file, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes), executable });
  };
  for (const [from] of PACKAGE_COPIES) {
    if (rows.some((row) => row.path === from)) continue;
    // Real immutable operational inputs; app package/compiler outputs below are
    // explicitly synthetic and never passed off as a TravelOS production build.
    await addSource(from, await readFile(path.join(repository, from)));
  }
  for (const file of [
    "constants.mjs",
    "io.mjs",
    "qualify-artifact.mjs",
    "declared-entry-checks.mjs",
    "bootstrap-preflight.mjs",
    "service-path-rehearsal.mjs",
    "artifact.mjs",
    "candidate.mjs",
    "gates.mjs",
    "postgres-successor-coverage.mjs",
    "one-shot.mjs",
    "deployment-contract.mjs",
  ]) {
    const source = `tooling/ci/stage-10/${file}`;
    if (!rows.some((row) => row.path === source))
      await addSource(source, await readFile(path.join(repository, source)));
  }
  await addSource(
    "pnpm-lock.yaml",
    "lockfileVersion: '9.0'\n\npackages:\n\n  synthetic-dependency@1.0.0:\n    resolution: {integrity: synthetic-not-a-receipt}\n\nsnapshots:\n  synthetic-dependency@1.0.0: {}\n",
  );
  const migration = "exports.up = () => {}; exports.down = false;\n";
  const checksum = jsonBytes({
    schemaVersion: 1,
    algorithm: "sha256",
    migrations: [{ file: `${MIGRATION_HEAD}.cjs`, sha256: sha256(migration) }],
  });
  await addSource(`migrations/${MIGRATION_HEAD}.cjs`, migration);
  await addSource("migrations/checksums.json", checksum);
  for (const runtime of RUNTIME_ROOTS) {
    const manifest = {
      name: runtime.name,
      version: "0.0.0-synthetic",
      type: "module",
      dependencies: { "synthetic-dependency": "1.0.0" },
    };
    await addSource(`${runtime.source}/package.json`, jsonBytes(manifest));
    await put(payload, `${runtime.target}/package.json`, jsonBytes(manifest));
    await put(
      payload,
      `${runtime.target}/${runtime.entrypoint}`,
      runtime.name === "@travelos/migrator"
        ? "export const synthetic = true;\n"
        : `console.error(JSON.stringify({event:"process_bootstrap_failed",service:${JSON.stringify(runtime.name.slice("@travelos/".length))}})); process.exitCode=1;\n`,
    );
    await put(
      payload,
      `${runtime.target}/node_modules/synthetic-dependency/package.json`,
      jsonBytes({
        name: "synthetic-dependency",
        version: "1.0.0",
        ...(declarationOnly ? { types: "index.d.ts" } : { main: "index.js" }),
        ...(dependencyExports ? { exports: dependencyExports } : {}),
      }),
    );
    await put(
      payload,
      `${runtime.target}/node_modules/synthetic-dependency/${declarationOnly ? "index.d.ts" : "index.js"}`,
      declarationOnly ? "export declare const synthetic: boolean;\n" : "module.exports = {};\n",
    );
    if (!declarationOnly)
      await put(
        payload,
        `${runtime.target}/node_modules/synthetic-dependency/index.d.ts`,
        "export declare const synthetic: boolean;\n",
      );
    if (runtime.name === "@travelos/migrator")
      await put(
        payload,
        "migrator/dist/tooling/database/migration-runner.js",
        "export const synthetic = true;\n",
      );
  }
  for (const surface of ["admin", "portal"]) {
    const realm = surface === "admin" ? "staff" : "portal";
    const html = `<html lang="pt-PT"><form method="post" action="/api/auth/${realm}/sign-in/email"><input type="password"></form><div id="${surface}-root"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></html>`;
    await put(sourceRoot, `apps/${surface}-web/dist/index.html`, html);
    await put(sourceRoot, `apps/${surface}-web/dist/assets/app.js`, "export {};\n");
    await put(sourceRoot, `apps/${surface}-web/dist/assets/app.css`, "body {}\n");
  }
  rows.sort((a, b) => (a.path < b.path ? -1 : 1));
  const source = { schemaVersion: 1, stage: STAGE, files: rows };
  const inputs = {
    source,
    migration: {
      head: MIGRATION_HEAD,
      files: rows.filter((row) => row.path.startsWith("migrations/")),
    },
    toolchain: TOOLCHAIN,
    predecessor: PREDECESSOR,
    gatesSha256: "f".repeat(64),
  };
  inputs.inputDigest = inputIdentity(inputs);
  await materializeProvenance({ root: sourceRoot, payload, inputs, candidate: "gen01" });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(payload, "deployment/stage10-contract.json"))),
    deploymentContract(),
  );
  const binding = JSON.parse(await readFile(path.join(payload, "release.json"))).binding;
  const archive = path.join(root, "synthetic.tar.gz");
  const receipt = await sealPayload({ payload, archive, binding });
  const extracted = path.join(root, "extracted");
  await mkdir(extracted);
  execFileSync("tar", [
    "--extract",
    "--gzip",
    `--file=${archive}`,
    "--directory",
    extracted,
    "--no-same-owner",
  ]);
  return {
    root,
    sourceRoot,
    payload: extracted,
    archive,
    receipt,
    expectedReceiptSha256: digest(receipt),
    inputs,
    expectedNodeSha256: sha256(await readFile(process.execPath)),
  };
};

test("qualification resolves subpath-only runtime exports without demanding a package root", async (t) => {
  const { qualifyExtractedArtifact } = await load("./qualify-artifact.mjs");
  const fixture = await synthetic(t, { "./admin": "./index.js", "./portal": "./index.js" });
  const result = await qualifyExtractedArtifact(fixture);
  assert.equal(result.result, "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED");
});

test("qualification distinguishes a type-only export condition from a runtime entry", async (t) => {
  const { qualifyExtractedArtifact } = await load("./qualify-artifact.mjs");
  const fixture = await synthetic(t, {
    ".": "./index.js",
    "./optional-types.js": { types: "./index.d.ts" },
  });
  assert.equal(
    (await qualifyExtractedArtifact(fixture)).result,
    "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED",
  );
});

test("qualification does not treat legacy export directory prefixes as entrypoints", async (t) => {
  const { qualifyExtractedArtifact } = await load("./qualify-artifact.mjs");
  const fixture = await synthetic(t, { ".": "./index.js", "./": "./" });
  assert.equal(
    (await qualifyExtractedArtifact(fixture)).result,
    "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED",
  );
});

test("qualification validates declaration-only dependency files without inventing JavaScript", async (t) => {
  const { qualifyExtractedArtifact } = await load("./qualify-artifact.mjs");
  const fixture = await synthetic(t, undefined, true);
  assert.equal(
    (await qualifyExtractedArtifact(fixture)).result,
    "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED",
  );
});

test("qualification rejects a missing declared runtime subpath target", async (t) => {
  const { qualifyExtractedArtifact } = await load("./qualify-artifact.mjs");
  const fixture = await synthetic(t, { "./admin": "./missing.js" });
  await assert.rejects(qualifyExtractedArtifact(fixture), /Declared package target/);
});

test("packaged verifier accepts SHA-256 option names while retaining strict argument validation", async (t) => {
  const fixture = await synthetic(t);
  await put(fixture.root, "external-receipt.json", jsonBytes(fixture.receipt));
  await put(fixture.root, "external-inputs.json", jsonBytes(fixture.inputs));
  const node = path.join(fixture.payload, "runtime/node/bin/node");
  const verifier = path.join(fixture.payload, "deployment/verify-artifact.mjs");
  const args = [
    `--archive=${fixture.archive}`,
    `--receipt=${path.join(fixture.root, "external-receipt.json")}`,
    `--receipt-sha256=${fixture.expectedReceiptSha256}`,
    `--inputs=${path.join(fixture.root, "external-inputs.json")}`,
    `--inputs-sha256=${digest(fixture.inputs)}`,
    `--node-sha256=${fixture.expectedNodeSha256}`,
    `--predecessor-archive=${fixture.archive}`,
  ];
  const run = (options) =>
    spawnSync(node, [verifier, ...options], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
  const accepted = run(args);
  assert.equal(accepted.status, 1);
  assert.match(accepted.stderr, /Predecessor archive must be accepted gen11/);
  const historical = run(["--artifact-root=/opt/travelos/current"]);
  assert.equal(historical.status, 1);
  assert.match(historical.stderr, /Unknown\/duplicate verifier argument/);
  for (const options of [
    [...args, "--unexpected2=value"],
    [...args, args[2]],
    args.filter((arg) => !arg.startsWith("--node-sha256=")),
    args.map((arg) => (arg.startsWith("--receipt-sha256=") ? "--receipt-sha256=invalid" : arg)),
  ]) {
    const rejected = run(options);
    assert.equal(rejected.status, 1);
    assert.doesNotMatch(rejected.stderr, /Predecessor archive must be accepted gen11/);
  }
});

test("exact extracted qualification executes pinned bundled Node and verifies packaged source/migrations/dependencies without claiming release GO", async (t) => {
  const { qualifyExtractedArtifact } = await load("./qualify-artifact.mjs");
  const fixture = await synthetic(t);
  const result = await qualifyExtractedArtifact(fixture);
  await put(fixture.root, "external-receipt.json", jsonBytes(fixture.receipt));
  await put(fixture.root, "external-inputs.json", jsonBytes(fixture.inputs));
  const cli = spawnSync(
    path.join(fixture.payload, "runtime/node/bin/node"),
    [
      path.join(fixture.payload, "deployment/verify-artifact.mjs"),
      `--archive=${fixture.archive}`,
      `--receipt=${path.join(fixture.root, "external-receipt.json")}`,
      `--receipt-sha256=${fixture.expectedReceiptSha256}`,
      `--inputs=${path.join(fixture.root, "external-inputs.json")}`,
      `--inputs-sha256=${digest(fixture.inputs)}`,
      `--node-sha256=${fixture.expectedNodeSha256}`,
      `--predecessor-archive=${fixture.archive}`,
    ],
    { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } },
  );
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /Predecessor archive must be accepted gen11/);
  if (process.env.TRAVELOS_REHEARSAL_PREDECESSOR) {
    const accepted = spawnSync(
      path.join(fixture.payload, "runtime/node/bin/node"),
      [
        path.join(fixture.payload, "deployment/verify-artifact.mjs"),
        `--archive=${fixture.archive}`,
        `--receipt=${path.join(fixture.root, "external-receipt.json")}`,
        `--receipt-sha256=${fixture.expectedReceiptSha256}`,
        `--inputs=${path.join(fixture.root, "external-inputs.json")}`,
        `--inputs-sha256=${digest(fixture.inputs)}`,
        `--node-sha256=${fixture.expectedNodeSha256}`,
        `--predecessor-archive=${process.env.TRAVELOS_REHEARSAL_PREDECESSOR}`,
      ],
      { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } },
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    const packaged = JSON.parse(accepted.stdout);
    assert.equal(packaged.result, "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED");
    assert.equal(packaged.servicePaths.result, "PATHS_ONLY_NOT_RUNTIME_OR_DEPLOYMENT_ACCEPTANCE");
    assert.equal(packaged.servicePaths.services.length, 3);
  }
  assert.equal(result.result, "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED");
  assert.equal(result.servicePaths.result, "PATHS_ONLY_NOT_RUNTIME_OR_DEPLOYMENT_ACCEPTANCE");
  assert.equal(result.servicePaths.services.length, 3);
  assert.equal(result.nodeVersion, "24.19.0");
  assert.equal(result.dependencies.roots, 4);
  assert.equal(
    result.releaseQualification,
    "PENDING_CANONICAL_CI_RUNTIME_SIGNATURE_PRIVACY_REVIEW",
  );
  assert.equal(result.stage11Actions, 0);
});

test("qualification rejects externally changed Node pin and frozen source binding before executing payload code", async (t) => {
  const { qualifyExtractedArtifact } = await load("./qualify-artifact.mjs");
  const fixture = await synthetic(t);
  await assert.rejects(
    qualifyExtractedArtifact({ ...fixture, expectedNodeSha256: "0".repeat(64) }),
    /node.*digest|node.*hash/i,
  );
  await assert.rejects(
    qualifyExtractedArtifact({
      ...fixture,
      inputs: { ...fixture.inputs, predecessor: { ...PREDECESSOR, artifactId: "gen10" } },
    }),
    /predecessor|input/i,
  );
});

// Reseal deliberately after edits to prove the semantic checker, not only the
// generic manifest, rejects self-consistent but incomplete/misbound packages.
for (const [name, mutate, expected] of [
  [
    "omitted migrator",
    (f) => rm(path.join(f.payload, "migrator/dist"), { recursive: true }),
    /required|entrypoint/i,
  ],
  [
    "omitted runtime dependency",
    (f) =>
      rm(path.join(f.payload, "apps/admin-api/node_modules/synthetic-dependency"), {
        recursive: true,
      }),
    /dependency/i,
  ],
  [
    "wrong dependency version",
    (f) =>
      put(
        f.payload,
        "apps/admin-api/node_modules/synthetic-dependency/package.json",
        jsonBytes({ name: "synthetic-dependency", version: "9.9.9", main: "index.js" }),
      ),
    /dependency|lock/i,
  ],
  [
    "migration mismatch",
    (f) => put(f.payload, `migrator/migrations/${MIGRATION_HEAD}.cjs`, "tampered\n"),
    /migration|source/i,
  ],
  [
    "source snapshot mismatch",
    (f) => put(f.payload, "provenance/source-snapshot.json", jsonBytes({ files: [] })),
    /source/i,
  ],
  [
    "unexpected runtime source",
    (f) => put(f.payload, "apps/admin-api/src/leaked.ts", "secret = false;\n"),
    /allowlist|source|unexpected/i,
  ],
  [
    "credential file",
    (f) => put(f.payload, ".env", "SYNTHETIC_ONLY=true\n"),
    /allowlist|forbidden|unexpected/i,
  ],
  [
    "no-JavaScript GET form",
    (f) =>
      put(
        f.payload,
        "portal-web/index.html",
        '<html lang="pt-PT"><form method="get" action="/api/auth/portal/sign-in/email"></form></html>',
      ),
    /shell|form|post/i,
  ],
]) {
  test(`semantic qualification rejects resealed ${name}`, async (t) => {
    const { qualifyExtractedArtifact } = await load("./qualify-artifact.mjs");
    const fixture = await synthetic(t);
    await mutate(fixture);
    const binding = fixture.receipt.binding;
    await rm(path.join(fixture.payload, "stage10-payload.json"));
    const archive = path.join(fixture.root, "resealed.tar.gz");
    const receipt = await sealPayload({ payload: fixture.payload, archive, binding });
    await assert.rejects(
      qualifyExtractedArtifact({
        ...fixture,
        archive,
        receipt,
        expectedReceiptSha256: digest(receipt),
      }),
      expected,
    );
  });
}

test("runtime dependency graph rejects an escaping symlink instead of resolving from the build host", async (t) => {
  const { inspectRuntimeDependencies } = await load("./qualify-artifact.mjs");
  const root = await temporary(t);
  await put(
    root,
    "payload/apps/admin-api/package.json",
    jsonBytes({ name: "@travelos/admin-api", dependencies: { escape: "1.0.0" } }),
  );
  await put(root, "outside/package.json", jsonBytes({ name: "escape", version: "1.0.0" }));
  await mkdir(path.join(root, "payload/apps/admin-api/node_modules"));
  await symlink(
    path.join(root, "outside"),
    path.join(root, "payload/apps/admin-api/node_modules/escape"),
  );
  await assert.rejects(
    inspectRuntimeDependencies(path.join(root, "payload")),
    /escape|outside|contain/i,
  );
});
