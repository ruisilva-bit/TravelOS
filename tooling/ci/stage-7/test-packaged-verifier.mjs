import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const fixture = await mkdtemp(path.join(process.env.TMPDIR, "stage7-verifier-isolation-"));
try {
  const deployment = path.join(fixture, "deployment");
  await mkdir(deployment);
  const previous = execFileSync(
    "git",
    ["show", "d8ae418ff825b59845b45b7fbf8b4dfa8c141d7d:tooling/ci/stage-7/verify-artifact.mjs"],
    { cwd: root },
  );
  const entry = path.join(deployment, "verify-stage7-artifact.mjs");
  await writeFile(entry, previous);
  const args = [entry, `--artifact-root=${fixture}`, "--generation=gen07"];
  const gen07 = spawnSync(process.execPath, args, { cwd: fixture, encoding: "utf8" });
  assert.equal(gen07.status, 1);
  assert.match(gen07.stderr, /ERR_MODULE_NOT_FOUND/u);
  assert.match(gen07.stderr, /stage-7-successor-baseline\.mjs/u);
  await copyFile(path.join(root, "tooling/ci/stage-7/verify-artifact.mjs"), entry);
  const gen08 = spawnSync(
    process.execPath,
    [entry, `--artifact-root=${fixture}`, "--generation=gen08"],
    {
      cwd: fixture,
      encoding: "utf8",
    },
  );
  assert.equal(gen08.status, 1, "An incomplete artifact must fail closed");
  assert.match(gen08.stderr, /release\.json/u, "A packaged verifier must reach payload validation");
  assert.doesNotMatch(gen08.stderr, /ERR_MODULE_NOT_FOUND|stage-7-successor-baseline\.mjs/u);
  const missingGeneration = spawnSync(process.execPath, [entry, `--artifact-root=${fixture}`], {
    cwd: fixture,
    encoding: "utf8",
  });
  assert.equal(missingGeneration.status, 1);
  assert.match(missingGeneration.stderr, /Missing required --generation/u);
  process.stdout.write(`${JSON.stringify({ result: "PASS", cases: 3 })}\n`);
} finally {
  await rm(fixture, { recursive: true, force: true });
}
