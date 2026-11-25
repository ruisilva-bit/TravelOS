import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import path from "node:path";
import test from "node:test";

const scratch = process.env.TMPDIR;
assert.ok(scratch && scratch !== "/tmp", "Tests require the configured scratch directory");
const load = async (name) => {
  const url = new URL(name, import.meta.url);
  assert.ok(existsSync(url), `Stage 10 implementation missing: ${name}`);
  return import(url);
};
const fixture = async (t) => {
  const root = await mkdtemp(path.join(scratch, "travelos-stage10-unit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};
const git = (root, ...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const repository = async (t) => {
  const root = await fixture(t);
  git(root, "init", "-b", "fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Synthetic fixture");
  await writeFile(path.join(root, "a.txt"), "alpha\n");
  await writeFile(path.join(root, ".gitignore"), ".hermes/\nnode_modules/\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "synthetic fixture");
  return root;
};

test("source inventory includes untracked operational docs and detects bytes, mode and path drift", async (t) => {
  const { captureSource } = await load("./candidate.mjs");
  const root = await repository(t);
  await mkdir(path.join(root, "docs/implementation"), { recursive: true });
  await writeFile(path.join(root, "docs/implementation/stage10.md"), "synthetic decision\n");
  const before = await captureSource(root);
  assert.ok(before.files.some((row) => row.path === "docs/implementation/stage10.md"));
  assert.deepEqual(await captureSource(root), before);
  await chmod(path.join(root, "a.txt"), 0o755);
  assert.notDeepEqual(await captureSource(root), before);
  await chmod(path.join(root, "a.txt"), 0o644);
  await writeFile(path.join(root, "a.txt"), "changed\n");
  assert.notDeepEqual(await captureSource(root), before);
  await writeFile(path.join(root, "a.txt"), "alpha\n");
  await writeFile(path.join(root, "new.txt"), "new\n");
  assert.notDeepEqual(await captureSource(root), before);
});

test("source inventory rejects symlink ancestors and tracked deletions", async (t) => {
  const { captureSource } = await load("./candidate.mjs");
  const root = await repository(t);
  await rm(path.join(root, "a.txt"));
  await assert.rejects(captureSource(root), /ENOENT|missing/i);
  await symlink(".gitignore", path.join(root, "a.txt"));
  await assert.rejects(captureSource(root), /symlink|symbolic|regular|ELOOP/i);
  await rm(path.join(root, "a.txt"));
  await writeFile(path.join(root, "a.txt"), "alpha\n");
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "nested/source.txt"), "synthetic\n");
  git(root, "add", "nested/source.txt");
  await rm(path.join(root, "nested"), { recursive: true });
  await mkdir(path.join(root, "outside-source"));
  await writeFile(path.join(root, "outside-source/source.txt"), "synthetic\n");
  await symlink("outside-source", path.join(root, "nested"));
  await assert.rejects(captureSource(root), /symlink|directory|symbolic|ELOOP/i);
});

test("input identity excludes candidate labels and binds source, migrations, pins and gate definition", async () => {
  const { inputIdentity } = await load("./candidate.mjs");
  const base = {
    source: { files: [{ path: "a", bytes: 1, sha256: "a".repeat(64), executable: false }] },
    migration: { head: "0016_stage9_staff_invitations" },
    toolchain: { node: "24.19.0" },
    predecessor: { commit: "f".repeat(40) },
    gatesSha256: "b".repeat(64),
  };
  assert.equal(
    inputIdentity({ ...base, candidate: "gen01" }),
    inputIdentity({ ...base, candidate: "gen02" }),
  );
  for (const key of ["source", "migration", "toolchain", "predecessor", "gatesSha256"])
    assert.notEqual(inputIdentity(base), inputIdentity({ ...base, [key]: "different" }));
});

test("immutable claim survives completion, concurrent contenders and an interrupted incomplete claim", async (t) => {
  const { claimOnce, finishOnce, inspectClaim } = await load("./one-shot.mjs");
  const root = await fixture(t);
  const digest = "1".repeat(64);
  const contenders = await Promise.allSettled([
    claimOnce(root, digest, { candidate: "gen01" }),
    claimOnce(root, digest, { candidate: "gen02" }),
  ]);
  assert.equal(contenders.filter((entry) => entry.status === "fulfilled").length, 1);
  const bytes = await readFile(path.join(root, digest, "claim.json"));
  await finishOnce(root, digest, { result: "FAIL", reason: "synthetic command failure" });
  assert.deepEqual(await readFile(path.join(root, digest, "claim.json")), bytes);
  assert.equal((await inspectClaim(root, digest)).state, "FAILED_CONSUMED");
  await assert.rejects(claimOnce(root, digest, { candidate: "gen99" }), /EEXIST|consumed/i);
  await assert.rejects(finishOnce(root, digest, { result: "PASS" }), /EEXIST/i);
  const interrupted = "2".repeat(64);
  await mkdir(path.join(root, interrupted));
  assert.equal((await inspectClaim(root, interrupted)).state, "INTERRUPTED_CONSUMED");
  await assert.rejects(claimOnce(root, interrupted, {}), /EEXIST|consumed/i);
});

test("SIGKILL after a durable claim leaves the input consumed without a success receipt", async (t) => {
  const { inspectClaim, claimOnce } = await load("./one-shot.mjs");
  const root = await fixture(t);
  const inputDigest = "9".repeat(64);
  const moduleUrl = new URL("./one-shot.mjs", import.meta.url).href;
  const code = `import { claimOnce } from ${JSON.stringify(moduleUrl)}; await claimOnce(${JSON.stringify(root)}, ${JSON.stringify(inputDigest)}, { synthetic: true }); process.stdout.write("CLAIMED\\n"); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGKILL"));
  const childExit = once(child, "exit");
  const ready = await Promise.race([
    once(child.stdout, "data"),
    childExit.then(() => {
      throw new Error("Synthetic interruption child exited before claim");
    }),
  ]);
  assert.match(ready[0].toString(), /CLAIMED/);
  child.kill("SIGKILL");
  const [exitCode, signal] = await childExit;
  assert.equal(exitCode, null);
  assert.equal(signal, "SIGKILL");
  assert.equal((await inspectClaim(root, inputDigest)).state, "INTERRUPTED_OR_RUNNING_CONSUMED");
  await assert.rejects(claimOnce(root, inputDigest, { candidate: "gen99" }), /EEXIST|consumed/i);
});

test("one-shot ledger rejects symlink parents and invalid input digest", async (t) => {
  const { claimOnce } = await load("./one-shot.mjs");
  const root = await fixture(t);
  await mkdir(path.join(root, "target"));
  await symlink("target", path.join(root, "linked"));
  await assert.rejects(
    claimOnce(path.join(root, "linked"), "3".repeat(64), {}),
    /symlink|directory/i,
  );
  await assert.rejects(claimOnce(root, "../bad", {}), /digest/i);
});

test("exact artifact binding rejects changed payload, receipt, archive and source", async (t) => {
  const { sealPayload, verifyArtifactBinding } = await load("./artifact.mjs");
  const root = await fixture(t);
  const payload = path.join(root, "payload");
  await mkdir(payload);
  await writeFile(path.join(payload, "hello.txt"), "synthetic compiled payload\n");
  const binding = {
    inputDigest: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    migrationSha256: "c".repeat(64),
    toolchain: { node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" },
    predecessorCommit: "f65a64d9c3aabd446ca95a605faed92630a72963",
    predecessorArchiveSha256: "8b74c305c12eecb9339acdd777449fbdb0b3bf25c498d87a2c7d43931bb6d125",
  };
  const archive = path.join(root, "artifact.tar.gz");
  const receipt = await sealPayload({ payload, archive, binding });
  const expectedReceiptSha256 = (await import("node:crypto"))
    .createHash("sha256")
    .update(JSON.stringify(receipt, null, 2) + "\n")
    .digest("hex");
  const extracted = path.join(root, "extracted");
  await mkdir(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  const request = { payload: extracted, archive, receipt, expectedReceiptSha256, binding };
  assert.equal((await verifyArtifactBinding(request)).result, "INTEGRITY_ONLY_NOT_QUALIFIED");
  await assert.rejects(
    verifyArtifactBinding({ ...request, binding: { ...binding, sourceSha256: "d".repeat(64) } }),
    /binding/i,
  );
  await assert.rejects(
    verifyArtifactBinding({ ...request, receipt: { ...receipt, archiveSha256: "e".repeat(64) } }),
    /receipt/i,
  );
  await writeFile(path.join(extracted, "hello.txt"), "tampered\n");
  await assert.rejects(verifyArtifactBinding(request), /manifest|inventory/i);
  await writeFile(path.join(extracted, "hello.txt"), "synthetic compiled payload\n");
  await writeFile(archive, "not the archive");
  await assert.rejects(verifyArtifactBinding(request), /archive/i);
});

test("readiness is fail closed before claiming when Stage 10 integration gates are pending", async (t) => {
  const { assertPipelineReady, runCanonicalCi } = await load("./run-canonical-ci.mjs");
  const root = await fixture(t);
  assert.throws(() => assertPipelineReady(), /pending|unimplemented/i);
  await assert.rejects(
    runCanonicalCi({ root, candidate: "gen01", runGate: () => ({ exitCode: 0 }) }),
    /unknown|injected/i,
  );
  await assert.rejects(runCanonicalCi({ root, candidate: "gen01" }), /pending|unimplemented/i);
  assert.equal(existsSync(path.join(root, ".hermes")), false);
});

test("gate coverage cannot omit cumulative real PostgreSQL/browser, source, security and operational checks", async () => {
  const { validateGateCoverage, GATES } = await load("./gates.mjs");
  validateGateCoverage(GATES);
  for (const required of [
    "stage6-postgres",
    "stage7-postgres",
    "stage8-postgres",
    "stage9-postgres-browser",
    "stage10-source-security",
    "stage10-exact-artifact",
    "stage10-operational-preflight",
    "stage10-retention-privacy",
  ]) {
    assert.throws(
      () => validateGateCoverage(GATES.filter((gate) => gate.label !== required)),
      /missing|coverage/i,
    );
  }
});

test("build-once production entry rejects injected builders and pending contracts without a claim", async (t) => {
  const { buildArtifact } = await load("./build-artifact.mjs");
  const root = await fixture(t);
  await assert.rejects(
    buildArtifact({ root, candidate: "gen01", build: () => {} }),
    /unknown|injected/i,
  );
  await assert.rejects(buildArtifact({ root, candidate: "gen01" }), /pending|unimplemented/i);
  assert.equal(existsSync(path.join(root, ".hermes")), false);
});

test("production CLIs reject unknown shell-pass or preflight injection arguments", async () => {
  for (const name of ["run-canonical-ci.mjs", "build-artifact.mjs"]) {
    const url = new URL(name, import.meta.url);
    assert.ok(existsSync(url), `Stage 10 implementation missing: ${name}`);
    const result = spawnSync(process.execPath, [url.pathname, "--run-gate=true"], {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: scratch },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown|unexpected/i);
  }
});

test("package-once preserves failure, blocks changed labels and produces deterministic archives", async (t) => {
  const { packageOnce } = await load("./artifact.mjs");
  assert.equal(typeof packageOnce, "function", "Package-once primitive missing");
  const { inspectClaim } = await load("./one-shot.mjs");
  const root = await fixture(t);
  const binding = {
    inputDigest: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    migrationSha256: "c".repeat(64),
    toolchain: { node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" },
    predecessorCommit: "f65a64d9c3aabd446ca95a605faed92630a72963",
    predecessorArchiveSha256: "8b74c305c12eecb9339acdd777449fbdb0b3bf25c498d87a2c7d43931bb6d125",
  };
  for (const name of ["one", "two", "failed"]) {
    await mkdir(path.join(root, name));
    await writeFile(path.join(root, name, "payload.txt"), "synthetic bytes\n");
  }
  const ledger = path.join(root, "ledger");
  const first = await packageOnce({
    ledger,
    payload: path.join(root, "one"),
    archive: path.join(root, "one.tgz"),
    binding,
  });
  await assert.rejects(
    packageOnce({
      ledger,
      payload: path.join(root, "two"),
      archive: path.join(root, "two.tgz"),
      binding,
    }),
    /EEXIST|consumed/i,
  );
  const second = await packageOnce({
    ledger: path.join(root, "other-ledger"),
    payload: path.join(root, "two"),
    archive: path.join(root, "two.tgz"),
    binding,
  });
  assert.equal(second.archiveSha256, first.archiveSha256);
  await writeFile(path.join(root, "occupied.tgz"), "preserve this file");
  const failureBinding = { ...binding, inputDigest: "d".repeat(64) };
  await assert.rejects(
    packageOnce({
      ledger,
      payload: path.join(root, "failed"),
      archive: path.join(root, "occupied.tgz"),
      binding: failureBinding,
    }),
    /EEXIST/i,
  );
  assert.equal(await readFile(path.join(root, "occupied.tgz"), "utf8"), "preserve this file");
  assert.equal((await inspectClaim(ledger, failureBinding.inputDigest)).state, "FAILED_CONSUMED");
  assert.equal(existsSync(path.join(root, "failed/stage10-payload.json")), true);
  await assert.rejects(
    packageOnce({
      ledger,
      payload: path.join(root, "failed"),
      archive: path.join(root, "new.tgz"),
      binding: failureBinding,
    }),
    /EEXIST|consumed/i,
  );
});

test("predecessor baseline refuses a same-named tag at the wrong commit", async (t) => {
  const { verifyBaseline, verifyPredecessor } = await load("./candidate.mjs");
  const root = await repository(t);
  git(root, "tag", "travelos-phase-1-m1-stage-9-gen11-go");
  await assert.rejects(verifyBaseline(root), /accepted Stage 9 ref mismatch/i);
  await assert.rejects(
    verifyPredecessor(root, path.join(root, "absent.tgz")),
    /accepted Stage 9 ref mismatch/i,
  );
});
