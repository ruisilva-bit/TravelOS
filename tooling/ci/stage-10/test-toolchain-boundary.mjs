import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { corepackInvocation } from "./candidate.mjs";

const candidate = fileURLToPath(new URL("./candidate.mjs", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));

test("toolchain measurement never executes a PATH-shadowed Corepack", async (t) => {
  const directory = await mkdtemp(path.join(process.env.TMPDIR, "stage10-toolchain-shadow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "executed");
  const shim = path.join(directory, "corepack");
  await writeFile(
    shim,
    '#!/bin/sh\nprintf executed > "$SHADOW_MARKER"\nif [ "$1" = "--version" ]; then printf "0.35.0\\n"; else printf "11.21.0\\n"; fi\n',
  );
  await chmod(shim, 0o755);
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { readToolchain } from ${JSON.stringify(candidate)}; readToolchain(${JSON.stringify(repository)});`,
    ],
    {
      cwd: repository,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, SHADOW_MARKER: marker },
      encoding: "utf8",
      timeout: 30000,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("fixed child PATH supports nested pinned pnpm without inherited directories", () => {
  const invocation = corepackInvocation();
  const child = spawnSync("/bin/sh", ["-c", "pnpm --version"], {
    cwd: repository,
    env: { PATH: invocation.path, HOME: "/home/hermes", COREPACK_ENABLE_NETWORK: "0" },
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), "11.21.0");
});
