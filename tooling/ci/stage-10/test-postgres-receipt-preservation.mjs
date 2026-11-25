// Exercise the real CLI before any artifact/database setup; synthetic local evidence only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const runner = path.join(root, "tooling/database/run-stage-10-postgres-disposable.mjs");
for (const kind of ["regular", "symlink", "dangling-symlink", "directory"]) {
  test(`qualification refuses existing ${kind} receipt before allocating scratch`, async () => {
    const evidence = await mkdtemp(path.join(root, ".hermes/state/receipt-preservation-"));
    const scratch = await mkdtemp(path.join(process.env.TMPDIR, "receipt-preservation-"));
    try {
      const output = path.join(evidence, "execution.json");
      const sentinel = Buffer.from('{"synthetic":"preserve exact rejected/unknown receipt"}\n');
      const target = path.join(evidence, "target.json");
      await writeFile(target, sentinel);
      if (kind === "regular") await writeFile(output, sentinel);
      if (kind === "symlink") await symlink("target.json", output);
      if (kind === "dangling-symlink") await symlink("missing.json", output);
      if (kind === "directory") await mkdir(output);
      const result = spawnSync(process.execPath, [runner], {
        cwd: root,
        env: { PATH: "/usr/bin:/bin", TMPDIR: scratch, TRAVELOS_STAGE10_EVIDENCE_DIR: evidence },
        encoding: "utf8",
        timeout: 30000,
      });
      assert.equal(result.status, 1);
      if (["regular", "symlink"].includes(kind)) assert.deepEqual(await readFile(output), sentinel);
      if (kind === "dangling-symlink")
        await assert.rejects(readFile(path.join(evidence, "missing.json")), { code: "ENOENT" });
      assert.deepEqual(await readFile(target), sentinel);
      assert.deepEqual(await readdir(scratch), [], "Refusal must precede scratch allocation");
      assert.doesNotMatch(result.stdout, /"result":"PASS"/u);
    } finally {
      await rm(evidence, { recursive: true, force: true });
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
