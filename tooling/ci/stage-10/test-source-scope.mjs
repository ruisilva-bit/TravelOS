import assert from "node:assert/strict";
import test from "node:test";
import { validateSourceScope } from "./source-scope.mjs";
const row = (path) => ({ path, bytes: 1, sha256: "a".repeat(64) });
const source = { files: [row("apps/example.ts"), row("tooling/ci/stage-10/source-scope.mjs")] };
const accepted = ["apps/example.ts", ".hermes/phase0-sources.json"];
test("covers accepted source and explicit Stage 10 additions", () => {
  const r = validateSourceScope(source, accepted);
  assert.equal(r.inheritedSourceFiles, 1);
  assert.equal(r.newStage10Files, 1);
  assert.deepEqual(r.inheritedLocalExclusions, [".hermes/phase0-sources.json"]);
});
for (const [name, changed, paths] of [
  ["omitted inherited evidence", { files: source.files.slice(1) }, accepted],
  ["duplicate source", { files: [...source.files, source.files[0]] }, accepted],
  [
    "unapproved application addition",
    { files: [...source.files, row("apps/customer-fork.ts")] },
    accepted,
  ],
  [
    "local runtime state",
    { files: [...source.files, row(".hermes/state/receipt.json")] },
    accepted,
  ],
  [
    "path traversal",
    { files: [...source.files, row("tooling/ci/stage-10/../../../escape.mjs")] },
    accepted,
  ],
  [
    "malformed digest",
    { files: [{ ...source.files[0], sha256: "wrong" }, source.files[1]] },
    accepted,
  ],
  ["unapproved inherited exclusion", source, [...accepted, ".hermes/unknown.json"]],
])
  test(`rejects ${name}`, () => assert.throws(() => validateSourceScope(changed, paths)));
