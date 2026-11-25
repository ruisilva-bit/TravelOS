import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const fixture = async (t, manifest, files) => {
  const root = await mkdtemp(path.join(process.env.TMPDIR, "stage10-declared-entries-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "node_modules/synthetic");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
  for (const name of files) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), "synthetic\n");
  }
  return { root, directory, packages: [{ name: manifest.name, path: "node_modules/synthetic" }] };
};
const inspect = async (fixture) => {
  const { inspectDeclaredEntries } = await import("./declared-entry-checks.mjs");
  return inspectDeclaredEntries({ root: fixture.root, packages: fixture.packages });
};

test("declared-entry inspection exists and never claims executable graph completeness", async () => {
  const module = await import("./declared-entry-checks.mjs").catch(() => null);
  assert.equal(
    typeof module?.inspectDeclaredEntries,
    "function",
    "Missing declared-entry inspector",
  );
});

test("binary-only package without a root API stays explicitly runtime-unqualified", async (t) => {
  const fixtureValue = await fixture(t, { name: "synthetic-platform", version: "1.0.0" }, [
    "bin/tool",
  ]);
  const result = await inspect(fixtureValue);
  assert.equal(result.scope, "DECLARED_FILES_ONLY_NOT_EXECUTABLE_IMPORT_GRAPH");
  assert.equal(result.runtimeQualification, "PENDING");
  assert.deepEqual(result.unqualified, [
    { package: "synthetic-platform", reason: "NO_DECLARED_ENTRY_OR_RUNTIME_IMPORT_PROOF" },
  ]);
});

test("declared binary target is checked and missing or escaping targets fail", async (t) => {
  const value = await fixture(t, { name: "synthetic", bin: { tool: "bin/tool" } }, ["bin/tool"]);
  assert.equal((await inspect(value)).entries.length, 1);
  await rm(path.join(value.directory, "bin/tool"));
  await assert.rejects(inspect(value), /Declared package target/);
  await symlink("/etc/passwd", path.join(value.directory, "bin/tool"));
  await assert.rejects(inspect(value), /Declared package target/);
});

test("npm manifests colliding with builtins validate physical package targets", async (t) => {
  for (const name of ["punycode", "string_decoder"]) {
    const value = await fixture(t, { name, main: "index.js" }, ["index.js"]);
    assert.equal((await inspect(value)).entries[0].path, "node_modules/synthetic/index.js");
    await rm(path.join(value.directory, "index.js"));
    await assert.rejects(inspect(value), /Declared package target/);
  }
});

test("exports preserve import and require conditions and verify both target files", async (t) => {
  const value = await fixture(
    t,
    { name: "synthetic", exports: { ".": { import: "./esm.js", require: "./cjs.cjs" } } },
    ["esm.js", "cjs.cjs"],
  );
  const result = await inspect(value);
  assert.deepEqual(
    result.entries.map((entry) => entry.declaration),
    ["exports...import", "exports...require"],
  );
  await rm(path.join(value.directory, "esm.js"));
  await assert.rejects(inspect(value), /Declared package target/);
});

test("non-runtime type conditions are reported separately from existing runtime targets", async (t) => {
  const value = await fixture(
    t,
    { name: "synthetic", exports: { ".": { types: "./not-shipped.d.ts", default: "./index.js" } } },
    ["index.js"],
  );
  const result = await inspect(value);
  assert.equal(result.entries.length, 1);
  assert.equal(result.unqualified[0].reason, "NON_RUNTIME_TYPE_CONDITION_NOT_EXECUTED");
});

test("custom development conditions are not treated as default Node runtime files", async (t) => {
  const value = await fixture(
    t,
    {
      name: "synthetic",
      exports: { ".": { "dev-source": "./src/not-shipped.ts", default: "./index.js" } },
    },
    ["index.js"],
  );
  const result = await inspect(value);
  assert.equal(result.entries.length, 1);
  assert.equal(result.unqualified[0].reason, "NON_DEFAULT_NODE_CONDITION_NOT_EXECUTED");
});

test("legacy main permits Node extension and directory-index resolution", async (t) => {
  for (const main of ["index", "lib"]) {
    const value = await fixture(t, { name: "synthetic", main }, [
      main === "lib" ? "lib/index.js" : "index.js",
    ]);
    assert.equal((await inspect(value)).entries.length, 1);
  }
});

test("exports override stale legacy main and typing metadata", async (t) => {
  const value = await fixture(
    t,
    {
      name: "synthetic",
      main: "missing.js",
      types: "missing.d.ts",
      exports: { ".": "./index.js" },
    },
    ["index.js"],
  );
  assert.equal((await inspect(value)).entries.length, 1);
});

test("wildcard and legacy directory exports remain explicitly unqualified", async (t) => {
  const value = await fixture(
    t,
    { name: "synthetic", exports: { "./*": "./lib/*.js", "./": "./" } },
    [],
  );
  const result = await inspect(value);
  assert.equal(result.unqualified.length, 2);
  assert.equal(result.runtimeQualification, "PENDING");
});
