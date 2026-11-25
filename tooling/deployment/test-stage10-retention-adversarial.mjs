import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import childProcess from "node:child_process";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  retainDeploymentEvidence as retain,
  verifyRetainedDeploymentEvidence as verify,
} from "./stage10-evidence-retention.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scratch = process.env.TMPDIR;
assert.ok(scratch && path.isAbsolute(scratch), "tests require an explicit disposable TMPDIR");
const fixture = async (t, nested = false) => {
  const root = await mkdtemp(path.join(scratch, "retention-adversary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const outputRoot = path.join(root, "output");
  await mkdir(sourceRoot);
  await mkdir(outputRoot, { mode: 0o700 });
  await mkdir(path.join(sourceRoot, "nested"));
  const bytes = Buffer.from("synthetic safe log\n");
  const logPath = nested ? "nested/stdout.log" : "stdout.log";
  await writeFile(path.join(sourceRoot, logPath), bytes);
  await writeFile(path.join(sourceRoot, "stderr.log"), "");
  const receipt = {
    schemaVersion: 1,
    candidate: "gen01",
    artifactSha256: "a".repeat(64),
    commands: [
      {
        phase: "check",
        exitCode: 0,
        logs: {
          stdout: { path: logPath, bytes: bytes.length, sha256: sha256(bytes) },
          stderr: { path: "stderr.log", bytes: 0, sha256: sha256("") },
        },
      },
    ],
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  const receiptPath = path.join(sourceRoot, "receipt.json");
  await writeFile(receiptPath, receiptBytes);
  return {
    root,
    bytes,
    args: {
      sourceRoot,
      outputRoot,
      receiptPath,
      bundleName: "attempt",
      expectedReceiptSha256: sha256(receiptBytes),
    },
  };
};

// A separate non-cooperating process exchanges an actual directory and an
// outside-pointing symlink. Readiness is acknowledged only after a real swap.
const swapper = async (root, name, outside) => {
  const script = `import ctypes, os, sys\nr, n, outside = sys.argv[1:]\nos.symlink(outside, os.path.join(r, 'attacker-link'))\nd = os.open(r, os.O_RDONLY | os.O_DIRECTORY)\nf = ctypes.CDLL(None, use_errno=True).renameat2\nf.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]\ncount = 0\nwhile True:\n if f(d, os.fsencode(n), d, b'attacker-link', 2): raise OSError(ctypes.get_errno(), 'exchange')\n count += 1\n if count == 1: print('swapped', flush=True)\n`;
  const child = spawn("/usr/bin/python3", ["-I", "-c", script, root, name, outside], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`swapper exited before ready: ${code}`)));
  });
  return async () => {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
  };
};

test("scanner-only retention cannot opt into canonical acceptance or self-assert independence", async (t) => {
  const { args } = await fixture(t);
  for (const forged of [
    { publication: "CANONICAL" },
    { privacyApproved: true },
    { independentReceiptPin: { sha256: args.expectedReceiptSha256, authenticated: true } },
    { privacyDecision: { decision: "APPROVE", authenticated: true } },
  ])
    await assert.rejects(
      retain({ ...args, ...forged }),
      /QUARANTINE_ONLY|UNKNOWN_RETENTION_OPTION/u,
    );
  assert.deepEqual(await readdir(args.outputRoot), []);
});

test("retention writes only quarantine and reports unauthenticated consistency, never acceptance", async (t) => {
  const { args } = await fixture(t);
  const result = await retain(args);
  assert.equal(result.path, path.join(args.outputRoot, "quarantine", args.bundleName));
  assert.equal(result.retentionClass, "QUARANTINE");
  assert.equal(result.provenanceStatus, "CALLER_DIGEST_NOT_AUTHENTICATED");
  assert.match(result.bundleSha256, /^[a-f0-9]{64}$/u);
  const checked = await verify({
    bundleRoot: result.path,
    expectedReceiptSha256: args.expectedReceiptSha256,
  });
  assert.equal(checked.bundleSha256, result.bundleSha256);
  assert.equal(checked.retentionClass, "QUARANTINE");
});

test("concurrent intermediate-directory swaps never read matching bytes found only outside source", async (t) => {
  const { root, bytes, args } = await fixture(t, true);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "stdout.log"), bytes);
  await writeFile(path.join(args.sourceRoot, "nested/stdout.log"), "wrong in-tree content\n");
  const stop = await swapper(args.sourceRoot, "nested", outside);
  try {
    for (let i = 0; i < 24; i++) await assert.rejects(retain({ ...args, bundleName: `swap-${i}` }));
  } finally {
    await stop();
  }
  assert.deepEqual(await readdir(outside), ["stdout.log"]);
});

test("concurrent verification swaps never validate matching logs found only outside bundle", async (t) => {
  const { root, args } = await fixture(t);
  const result = await retain(args);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  for (const name of await readdir(path.join(result.path, "logs"))) {
    await writeFile(path.join(outside, name), await readFile(path.join(result.path, "logs", name)));
    await writeFile(path.join(result.path, "logs", name), "wrong in-tree content\n");
  }
  const stop = await swapper(result.path, "logs", outside);
  try {
    for (let i = 0; i < 256; i++)
      await assert.rejects(
        verify({ bundleRoot: result.path, expectedReceiptSha256: args.expectedReceiptSha256 }),
      );
  } finally {
    await stop();
  }
});

test("output ancestor swaps cannot redirect quarantine writes outside the anchored output", async (t) => {
  const { root, args } = await fixture(t);
  const outside = path.join(root, "outside");
  await mkdir(outside, { mode: 0o700 });
  const stop = await swapper(root, "output", outside);
  try {
    for (let i = 0; i < 12; i++) {
      try {
        await retain({ ...args, bundleName: `output-${i}` });
      } catch {
        /* races may fail closed */
      }
    }
  } finally {
    await stop();
  }
  assert.deepEqual(await readdir(outside), []);
});

test("verification descriptor remains anchored when the checked parent is replaced exactly before open", async (t) => {
  const { root, args } = await fixture(t);
  const result = await retain(args);
  const logs = path.join(result.path, "logs");
  const outside = path.join(root, "outside");
  await mkdir(outside);
  const name = "check.stdout.log";
  await writeFile(path.join(outside, name), await readFile(path.join(logs, name)));
  await writeFile(path.join(logs, name), "wrong in-tree content\n");
  const originalOpen = fsPromises.open;
  let attacked = false;
  // Interpose scheduling only: all reads/opens/renames are real kernel I/O.
  // This places an adversarial swap in the formerly exploitable interval.
  fsPromises.open = async (file, ...rest) => {
    if (!attacked && String(file).endsWith(`/${name}`)) {
      attacked = true;
      await fsPromises.rename(logs, `${logs}-parked`);
      await fsPromises.symlink(outside, logs);
      try {
        return await originalOpen(file, ...rest);
      } finally {
        await fsPromises.unlink(logs);
        await fsPromises.rename(`${logs}-parked`, logs);
      }
    }
    return originalOpen(file, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      verify({ bundleRoot: result.path, expectedReceiptSha256: args.expectedReceiptSha256 }),
    );
    assert.equal(attacked, true);
  } finally {
    fsPromises.open = originalOpen;
    syncBuiltinESMExports();
  }
});

test("non-cooperating process plants all destination types immediately before no-replace promotion", async (t) => {
  const { args } = await fixture(t);
  const originalSpawn = childProcess.spawn;
  const script = `import os, sys\nr, name, kind = sys.argv[1:]\np = os.path.join(r, 'quarantine', name)\nif kind == 'directory':\n os.mkdir(p)\n open(os.path.join(p, 'marker'), 'w').write('adversary')\nelif kind == 'file': open(p, 'w').write('adversary')\nelse: os.symlink('attacker-owned-target', p)\n`;
  try {
    for (const kind of ["directory", "file", "symlink"]) {
      let interfered = false;
      childProcess.spawn = (...parameters) => {
        interfered = true;
        childProcess.execFileSync("/usr/bin/python3", [
          "-I",
          "-c",
          script,
          args.outputRoot,
          kind,
          kind,
        ]);
        return originalSpawn(...parameters);
      };
      syncBuiltinESMExports();
      await assert.rejects(retain({ ...args, bundleName: kind }), /QUARANTINE_PROMOTION_FAILED/u);
      assert.equal(interfered, true);
      const target = path.join(args.outputRoot, "quarantine", kind);
      if (kind === "directory")
        assert.equal(await readFile(path.join(target, "marker"), "utf8"), "adversary");
      else if (kind === "file") assert.equal(await readFile(target, "utf8"), "adversary");
      else assert.equal(await fsPromises.readlink(target), "attacker-owned-target");
    }
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

test("same-UID process changes staged bytes after validation; promotion cannot return success", async (t) => {
  const { args } = await fixture(t);
  const originalSpawn = childProcess.spawn;
  let interfered = false;
  childProcess.spawn = (...parameters) => {
    interfered = true;
    const script = `import os, sys\np = os.path.join(sys.argv[1], 'quarantine', sys.argv[2], 'logs', 'check.stdout.log')\nopen(p, 'w').write('attacker changed staging')\n`;
    childProcess.execFileSync("/usr/bin/python3", [
      "-I",
      "-c",
      script,
      args.outputRoot,
      parameters[1].at(-2),
    ]);
    return originalSpawn(...parameters);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(retain(args), /LOG_SIZE_MISMATCH|LOG_DIGEST_MISMATCH/u);
    assert.equal(interfered, true);
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
  // The attacker CAN change the quarantine. Detection is not an isolation proof.
  assert.equal(
    await readFile(path.join(args.outputRoot, "quarantine/attempt/logs/check.stdout.log"), "utf8"),
    "attacker changed staging",
  );
});

test("same-UID staging-name replacement is rejected by anchored inode identity", async (t) => {
  const { args } = await fixture(t);
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = (...parameters) => {
    const script = `import os, sys\nr = os.path.join(sys.argv[1], 'quarantine')\np = os.path.join(r, sys.argv[2])\nos.rename(p, p + '-stolen')\nos.mkdir(p)\n`;
    childProcess.execFileSync("/usr/bin/python3", [
      "-I",
      "-c",
      script,
      args.outputRoot,
      parameters[1].at(-2),
    ]);
    return originalSpawn(...parameters);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(retain(args), /QUARANTINE_STAGING_REPLACED/u);
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

test("unsupported no-replace primitive fails closed without a fallback rename", async (t) => {
  const { args } = await fixture(t);
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = () =>
    originalSpawn(
      "/usr/bin/python3",
      ["-I", "-c", "raise OSError(38, 'synthetic unsupported renameat2')"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  syncBuiltinESMExports();
  try {
    await assert.rejects(retain(args), /QUARANTINE_PROMOTION_FAILED/u);
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
  await assert.rejects(fsPromises.lstat(path.join(args.outputRoot, "quarantine/attempt")), {
    code: "ENOENT",
  });
});

test("receipt plus caller pin substitution remains unauthenticated, and a forged privacy status fails", async (t) => {
  const { args } = await fixture(t);
  const receipt = JSON.parse(await readFile(args.receiptPath, "utf8"));
  receipt.candidate = "substituted-candidate";
  receipt.artifactSha256 = "b".repeat(64);
  const bytes = Buffer.from(JSON.stringify(receipt));
  await writeFile(args.receiptPath, bytes);
  const result = await retain({ ...args, expectedReceiptSha256: sha256(bytes) });
  assert.equal(result.provenanceStatus, "CALLER_DIGEST_NOT_AUTHENTICATED");
  assert.equal(result.retentionClass, "QUARANTINE");
  const indexPath = path.join(result.path, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  for (const forged of [
    { ...index, privacyStatus: "INDEPENDENTLY_APPROVED" },
    { ...index, retentionClass: "CANONICAL" },
  ]) {
    await writeFile(indexPath, JSON.stringify(forged));
    await assert.rejects(verify({ bundleRoot: result.path, expectedReceiptSha256: sha256(bytes) }));
  }
});
