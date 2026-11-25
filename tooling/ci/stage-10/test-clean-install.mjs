import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import { captureSource } from "./candidate.mjs";
import { qualifyCleanInstall } from "./clean-install.mjs";
const root = fileURLToPath(new URL("../../..", import.meta.url));
test("rejects source drift before creating installation output", async () => {
  const source = await captureSource(root);
  source.files[0].sha256 = "0".repeat(64);
  const outputDirectory = path.join(
    root,
    ".hermes/state",
    `stage10-clean-install-denied-${process.pid}`,
  );
  await assert.rejects(qualifyCleanInstall({ root, source, outputDirectory }), /drift/iu);
  await assert.rejects(access(outputDirectory), { code: "ENOENT" });
});
test(
  "installs frozen dependencies offline in a fresh private source copy",
  { timeout: 900000 },
  async () => {
    const source = await captureSource(root);
    const outputDirectory = await mkdtemp(path.join(root, ".hermes/state/stage10-clean-install-"));
    const result = await qualifyCleanInstall({ root, source, outputDirectory });
    assert.equal(result.result, "PASS");
    assert.equal(result.freshNodeModules, true);
    assert.equal(result.compilation, false);
    assert.equal(result.lifecycleScripts, false);
    await writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify(result)}\n`);
    console.log(JSON.stringify({ outputDirectory, ...result }));
  },
);
