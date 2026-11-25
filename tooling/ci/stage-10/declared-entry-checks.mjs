import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

// Metadata/file integrity only. Actual import specifiers, conditional resolution,
// computed references and native executable behavior require separate runtime tests.
export const inspectDeclaredEntries = async ({ root, packages }) => {
  const base = await realpath(root);
  const entries = [];
  const unqualified = [];
  for (const row of packages) {
    const directory = await realpath(path.join(base, row.path));
    assert.ok(directory.startsWith(`${base}/`), "Declared package target escapes artifact");
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json")));
    assert.equal(manifest.name, row.name, "Declared package identity mismatch");
    let declarations = 0;
    const check = async (target, declaration) => {
      declarations += 1;
      assert.equal(typeof target, "string", "Declared package target must be a string");
      if (target.includes("*") || target.endsWith("/")) {
        unqualified.push({
          package: row.name,
          declaration,
          reason: "PATTERN_OR_DIRECTORY_REQUIRES_CONSUMER_SPECIFIER_PROOF",
        });
        return;
      }
      assert.ok(
        target && !path.isAbsolute(target) && !target.includes("\\"),
        "Declared package target is unsafe",
      );
      let lexical = path.resolve(directory, target);
      assert.ok(lexical.startsWith(`${directory}/`), "Declared package target escapes package");
      let physical;
      try {
        if (declaration === "main")
          lexical = createRequire(path.join(directory, "package.json")).resolve(lexical);
        if ((declaration === "types" || declaration === "typings") && !path.extname(lexical))
          lexical += ".d.ts";
        physical = await realpath(lexical);
        assert.ok(physical.startsWith(`${directory}/`));
        const metadata = await lstat(lexical);
        assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
      } catch {
        throw new Error(
          `Declared package target missing, unsafe or not a regular file: ${row.name} (${declaration})`,
        );
      }
      entries.push({
        package: row.name,
        declaration,
        path: path.relative(base, physical).split(path.sep).join("/"),
      });
    };
    const walkExports = async (value, label) => {
      if (value === null) return;
      if (typeof value === "string") return check(value, label);
      assert.ok(value && typeof value === "object", "Invalid declared package exports");
      for (const [condition, target] of Object.entries(value)) {
        if (condition === "types") {
          unqualified.push({
            package: row.name,
            declaration: `${label}.types`,
            reason: "NON_RUNTIME_TYPE_CONDITION_NOT_EXECUTED",
          });
        } else if (
          !condition.startsWith(".") &&
          !/^\d+$/u.test(condition) &&
          !["node", "node-addons", "module-sync", "default", "import", "require"].includes(
            condition,
          )
        ) {
          unqualified.push({
            package: row.name,
            declaration: `${label}.${condition}`,
            reason: "NON_DEFAULT_NODE_CONDITION_NOT_EXECUTED",
          });
        } else await walkExports(target, `${label}.${condition}`);
      }
    };
    if (!manifest.exports) {
      for (const name of ["main", "module", "types", "typings"]) {
        if (manifest[name]) await check(manifest[name], name);
      }
    }
    if (manifest.bin) {
      if (typeof manifest.bin === "string") await check(manifest.bin, "bin");
      else {
        assert.ok(
          typeof manifest.bin === "object" && !Array.isArray(manifest.bin),
          "Invalid declared package bin",
        );
        for (const [name, target] of Object.entries(manifest.bin))
          await check(target, `bin.${name}`);
      }
    }
    if (manifest.exports) await walkExports(manifest.exports, "exports");
    if (!declarations)
      unqualified.push({ package: row.name, reason: "NO_DECLARED_ENTRY_OR_RUNTIME_IMPORT_PROOF" });
  }
  return {
    scope: "DECLARED_FILES_ONLY_NOT_EXECUTABLE_IMPORT_GRAPH",
    runtimeQualification: "PENDING",
    entries,
    unqualified,
    limitations:
      "Does not enumerate actual imports or validate ESM/CJS condition selection, computed references, wildcard consumers, native ABI or service startup",
  };
};
