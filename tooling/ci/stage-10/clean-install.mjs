import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureSource, corepackInvocation } from "./candidate.mjs";
import { verifyCurrentSourceScope } from "./source-scope.mjs";
import { _runBoundedProcess } from "./gate-process.mjs";
import { digest, regularBytes, sha256 } from "./io.mjs";

// Install dependencies in a fresh, private copy; never compile or run lifecycle scripts.
export async function qualifyCleanInstall({ root, source, outputDirectory }) {
  await verifyCurrentSourceScope({ root, source });
  const invocation = corepackInvocation();
  const temporary = await mkdtemp("/home/hermes/.hermes/cache/scratch/stage10-clean-install-");
  try {
    const disk = await statfs(temporary);
    assert.ok(
      disk.bavail * disk.bsize >= 2 * 1024 ** 3,
      "Insufficient clean-install disk headroom",
    );
    for (const row of source.files) {
      const destination = path.resolve(temporary, row.path);
      assert.ok(destination.startsWith(`${temporary}${path.sep}`));
      const bytes = await regularBytes(path.join(root, row.path));
      assert.equal(sha256(bytes), row.sha256, "Source drift before clean installation");
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, bytes, { flag: "wx", mode: row.executable ? 0o700 : 0o600 });
    }
    const packageDirectory = path.join(temporary, "node_modules");
    await assert.rejects(readFile(packageDirectory), { code: "ENOENT" });
    const beforeLock = await regularBytes(path.join(temporary, "pnpm-lock.yaml"));
    const beforeManifest = await regularBytes(path.join(temporary, "package.json"));
    const run = await _runBoundedProcess({
      root: temporary,
      label: "stage10-clean-install",
      outputDirectory,
      command: invocation.command,
      args: [
        ...invocation.prefix,
        "pnpm",
        "install",
        "--offline",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--package-import-method=copy",
      ],
      environment: {
        PATH: invocation.path,
        HOME: "/home/hermes",
        TMPDIR: temporary,
        LANG: "C.UTF-8",
        TZ: "UTC",
        CI: "true",
        COREPACK_ENABLE_NETWORK: "0",
        npm_config_offline: "true",
      },
      timeout: 10 * 60 * 1000,
      outputLimit: 32 * 1024 * 1024,
    });
    assert.equal(run.status, "PASS", "Clean offline frozen installation failed");
    assert.deepEqual(
      await regularBytes(path.join(temporary, "pnpm-lock.yaml")),
      beforeLock,
      "Lockfile changed",
    );
    assert.deepEqual(
      await regularBytes(path.join(temporary, "package.json")),
      beforeManifest,
      "Root manifest changed",
    );
    await regularBytes(path.join(packageDirectory, ".modules.yaml"));
    assert.deepEqual(await captureSource(root), source, "Source drift during clean installation");
    return {
      result: "PASS",
      sourceManifestSha256: digest(source),
      copiedFiles: source.files.length,
      freshNodeModules: true,
      offline: true,
      frozenLockfile: true,
      lifecycleScripts: false,
      compilation: false,
      scope: "REAL_FRESH_SOURCE_DEPENDENCY_INSTALL_NOT_CANONICAL_CI_OR_ARTIFACT_BUILD",
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
