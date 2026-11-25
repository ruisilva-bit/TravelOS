import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This private function is serialized as DATA, never called in this module.
// The Python runner executes the program only after constructing new mounts.
const privateScenarios = async () => {
  const { default: assert } = await import("node:assert/strict");
  const { execFileSync, spawn } = await import("node:child_process");
  const { createHash, randomBytes } = await import("node:crypto");
  const { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { default: path } = await import("node:path");
  const { default: test } = await import("node:test");
  const { fileURLToPath } = await import("node:url");
  const { stat, readlink } = await import("node:fs/promises");
  assert.equal(process.getuid(), 0, "PRIVATE_USER_NAMESPACE_REQUIRED");
  for (const mount of ["/etc", "/opt"]) {
    const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.split(" ")[4] === mount);
    assert.equal(mounts.length, 1);
    assert.match(mounts[0], new RegExp(` ${mount} rw[^ ]* (?:[^ ]+ )*- tmpfs `, "u"));
    assert.doesNotMatch(mounts[0], /\b(?:shared|master|propagate_from):/u);
  }

  let withVerified;
  try {
    ({ withVerifiedDevelopmentArchive: withVerified } = await import("./stage10-signature.mjs"));
  } catch {
    withVerified = undefined;
  }
  const cosign = process.env.TRAVELOS_COSIGN;
  const digest = (data) => createHash("sha256").update(data).digest("hex");

  test("signatures, sealed snapshots and guarded activation reject unsafe inputs", async (t) => {
    assert.equal(typeof withVerified, "function", "Snapshot verification must exist");
    assert.ok(cosign && path.isAbsolute(cosign), "TRAVELOS_COSIGN must name verified Cosign");
    assert.match(await readFile("/proc/self/uid_map", "utf8"), /^\s*0\s+[0-9]+\s+1\s*$/u);
    assert.match(await readFile("/proc/self/mountinfo", "utf8"), / \/etc .* - tmpfs /u);
    const root = await mkdtemp(path.join(tmpdir(), "travelos-stage10-signature-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const env = { ...process.env, COSIGN_PASSWORD: randomBytes(32).toString("hex") };
    const run = (...args) => execFileSync(cosign, args, { cwd: root, env, stdio: "pipe" });
    run("generate-key-pair", "--output-key-prefix", "trusted");
    run("generate-key-pair", "--output-key-prefix", "other");
    run("signing-config", "create", "--out", "offline.json");
    const archive = path.join(root, "artifact.tar.gz");
    const bundle = path.join(root, "artifact.bundle.json");
    const publicKey = path.join(root, "trusted.pub");
    const stagingRoot = "/etc/travelos/private-stage";
    await mkdir(stagingRoot, { mode: 0o700 });
    await writeFile(archive, "synthetic signed artifact\n");
    run(
      "sign-blob",
      "--key",
      "trusted.key",
      "--signing-config",
      "offline.json",
      "--bundle",
      bundle,
      archive,
    );
    const policy = {
      environment: "DEVELOPMENT",
      artifactSha256: digest(await readFile(archive)),
      publicKeySha256: digest(await readFile(publicKey)),
      cosignSha256: digest(await readFile(cosign)),
    };
    const policyFile = "/etc/travelos/stage10-development-policy.json";
    await writeFile(policyFile, `${JSON.stringify(policy)}\n`, { mode: 0o600 });
    const args = { archive, bundle, publicKey, cosign, stagingRoot };
    const verify = (inputs) => withVerified(inputs, async (verified) => verified);
    assert.equal((await verify(args)).artifactSha256, policy.artifactSha256);
    assert.equal(
      (await verify(args)).policySha256,
      digest(await readFile(policyFile)),
      "verification must identify the exact protected policy snapshot",
    );
    await withVerified(args, async ({ archive: snapshot }) => {
      // Removing kernel seals must make this test fail even for a same-UID writer.
      const attack = spawn(
        process.execPath,
        [
          "-e",
          `
      const fs = require("node:fs");
      const fd = fs.openSync(process.argv[1], "r+");
      for (const mutate of [
        () => fs.writeSync(fd, Buffer.from("attacker bytes"), 0, 14, 0),
        () => fs.ftruncateSync(fd, 0),
        () => fs.ftruncateSync(fd, 1048576),
      ]) {
        try { mutate(); process.exit(7); }
        catch (error) { if (error.code !== "EPERM") process.exit(8); }
      }
      fs.closeSync(fd);
    `,
          snapshot.replace("/proc/self/", `/proc/${process.pid}/`),
        ],
        { stdio: "ignore" },
      );
      const code = await new Promise((resolve, reject) => {
        attack.once("error", reject);
        attack.once("exit", resolve);
      });
      assert.equal(code, 0, "snapshot must reject a separate same-UID writer with EPERM");
      assert.equal(await readFile(snapshot, "utf8"), "synthetic signed artifact\n");
    });
    await withVerified(args, async ({ archive: snapshot }) => {
      await writeFile(archive, "concurrently changed source\n");
      assert.equal(await readFile(snapshot, "utf8"), "synthetic signed artifact\n");
    });
    assert.deepEqual(await readdir(stagingRoot), []);
    await writeFile(archive, "synthetic signed artifact\n");
    await assert.rejects(
      withVerified(args, async () => {
        throw new Error("synthetic failure");
      }),
    );
    assert.deepEqual(await readdir(stagingRoot), []);
    await chmod(stagingRoot, 0o770);
    await assert.rejects(verify(args));
    await chmod(stagingRoot, 0o700);
    await chmod(policyFile, 0o666);
    await assert.rejects(verify(args));
    await chmod(policyFile, 0o600);
    await chmod("/etc/travelos", 0o777);
    await assert.rejects(verify(args));
    await chmod("/etc/travelos", 0o700);
    await unlink(policyFile);
    await assert.rejects(verify({ ...args, policy }));
    await symlink(path.join(root, "attacker-policy.json"), policyFile);
    await writeFile(path.join(root, "attacker-policy.json"), JSON.stringify(policy));
    await assert.rejects(verify(args));
    await unlink(policyFile);
    await writeFile(policyFile, JSON.stringify(policy), { mode: 0o600 });
    const writer = spawn(
      process.execPath,
      [
        "-e",
        `const fs = require("node:fs"); const path = require("node:path");
     const [root, archive] = process.argv.slice(1); let attempts = 0;
     const timer = setInterval(() => {
       if (++attempts > 2000) { clearInterval(timer); process.exit(2); }
       const active = fs.readdirSync(root).some((name) => fs.existsSync(path.join(root, name, "3")));
       if (active) { fs.writeFileSync(archive, "concurrent tampering\\n"); clearInterval(timer); }
     }, 5);`,
        stagingRoot,
        archive,
      ],
      { stdio: "ignore" },
    );
    t.after(() => writer.kill());
    const writerDone = new Promise((resolve, reject) => {
      writer.once("error", reject);
      writer.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("writer failed"))));
    });
    await withVerified(args, async ({ archive: snapshot }) => {
      await writerDone;
      assert.equal(await readFile(archive, "utf8"), "concurrent tampering\n");
      assert.equal(await readFile(snapshot, "utf8"), "synthetic signed artifact\n");
    });
    await writeFile(archive, "synthetic signed artifact\n");
    await writeFile(policyFile, JSON.stringify({ ...policy, environment: "PRODUCTION" }));
    await assert.rejects(verify(args));
    await writeFile(policyFile, JSON.stringify(policy));
    await assert.rejects(verify({ ...args, publicKey: path.join(root, "other.pub") }));
    await writeFile(
      policyFile,
      JSON.stringify({
        ...policy,
        publicKeySha256: digest(await readFile(path.join(root, "other.pub"))),
      }),
    );
    await assert.rejects(verify({ ...args, publicKey: path.join(root, "other.pub") }));
    await writeFile(policyFile, JSON.stringify(policy));
    await assert.rejects(verify({ ...args, bundle: path.join(root, "missing.bundle") }));
    const oversized = path.join(root, "oversized.bundle");
    await writeFile(oversized, Buffer.alloc(4 * 1024 * 1024 + 1));
    await assert.rejects(verify({ ...args, bundle: oversized }), /SNAPSHOT_SIZE_LIMIT/u);
    await writeFile(policyFile, JSON.stringify({ ...policy, cosignSha256: "0".repeat(64) }));
    await assert.rejects(verify(args));
    await writeFile(policyFile, JSON.stringify(policy));
    const linked = path.join(root, "linked-archive");
    await symlink(archive, linked);
    await assert.rejects(verify({ ...args, archive: linked }));
    await writeFile(archive, "modified artifact\n");
    await assert.rejects(verify(args));
    await writeFile(
      policyFile,
      JSON.stringify({ ...policy, artifactSha256: digest(await readFile(archive)) }),
    );
    await assert.rejects(verify(args));

    // Actual pointer activation, not an injected operations callback. Removing
    // the verifier, receipt pin, baseline check, or extraction gate breaks these.
    const { activateStage10Development } = await import("./stage10-activation.mjs").catch(
      () => ({}),
    );
    assert.equal(typeof activateStage10Development, "function", "guarded activation must exist");
    const baseline = "/opt/travelos/releases/baseline";
    await mkdir(baseline, { recursive: true, mode: 0o755 });
    await mkdir("/opt/travelos/.stage10-private", { mode: 0o700 });
    await symlink(baseline, "/opt/travelos/current");
    const fixture = path.join(root, "release-fixture");
    await mkdir(fixture);
    await writeFile(
      path.join(fixture, "release.json"),
      JSON.stringify({ artifactId: "travelos-stage10-test" }),
    );
    await writeFile(path.join(fixture, "payload.txt"), "exact signed deployment bytes\n");
    await symlink("payload.txt", path.join(fixture, "payload-link"));
    await mkdir(path.join(fixture, "dependency"));
    await writeFile(path.join(fixture, "dependency", "index.js"), "synthetic dependency\n");
    await symlink("dependency", path.join(fixture, "dependency-link"));
    execFileSync("/usr/bin/tar", ["-czf", archive, "-C", fixture, "."]);
    run(
      "sign-blob",
      "--key",
      "trusted.key",
      "--signing-config",
      "offline.json",
      "--bundle",
      bundle,
      archive,
    );
    const activationPolicy = { ...policy, artifactSha256: digest(await readFile(archive)) };
    await writeFile(policyFile, JSON.stringify(activationPolicy));
    const receiptFile = "/etc/travelos/stage10-qualification-receipt.json";
    const authorizationFile = "/etc/travelos/stage10-activation-authorization.json";
    const receipt = {
      schemaVersion: 1,
      environment: "DEVELOPMENT",
      artifactId: "travelos-stage10-test",
      artifactSha256: activationPolicy.artifactSha256,
      publicKeySha256: policy.publicKeySha256,
      bundleSha256: digest(await readFile(bundle)),
      expectedCurrentTarget: baseline,
      migrationHead: "synthetic-migration-head",
      offlineTransparencyAccepted: true,
      checks: {
        canonicalCi: "PASS",
        exactArtifactRehearsal: "PASS",
        deploymentContract: "PASS",
        restorePoint: "PASS",
        migrationCompatibility: "PASS",
      },
    };
    const authorize = async (value = receipt) => {
      await writeFile(receiptFile, JSON.stringify(value), { mode: 0o600 });
      await writeFile(
        authorizationFile,
        JSON.stringify({
          schemaVersion: 1,
          environment: "DEVELOPMENT",
          artifactId: value.artifactId,
          artifactSha256: value.artifactSha256,
          expectedCurrentTarget: baseline,
          qualificationReceiptSha256: digest(await readFile(receiptFile)),
        }),
        { mode: 0o600 },
      );
    };
    const unchanged = async () => assert.equal(await readlink("/opt/travelos/current"), baseline);
    const activate = () => activateStage10Development(args);
    await assert.rejects(activate()); // No authorization/receipt may mean no switch.
    await unchanged();
    await authorize();
    await writeFile(receiptFile, JSON.stringify({ ...receipt, migrationHead: "altered" }));
    await assert.rejects(activate(), /QUALIFICATION_RECEIPT_DIGEST_MISMATCH/u);
    await unchanged();
    await authorize({ ...receipt, checks: { ...receipt.checks, migrationCompatibility: "FAIL" } });
    await assert.rejects(activate());
    await unchanged();
    await authorize({ ...receipt, offlineTransparencyAccepted: false });
    await assert.rejects(activate());
    await authorize({ ...receipt, environment: "PRODUCTION" });
    await assert.rejects(activate());
    await authorize();
    await chmod(authorizationFile, 0o666);
    await assert.rejects(activate());
    await chmod(authorizationFile, 0o600);
    await assert.rejects(
      activateStage10Development({ ...args, bundle: path.join(root, "missing") }),
    );
    await assert.rejects(
      activateStage10Development({ ...args, publicKey: path.join(root, "other.pub") }),
    );
    const signedArchive = await readFile(archive);
    await writeFile(archive, "tampered archive");
    await assert.rejects(activate());
    await unchanged();
    await writeFile(archive, signedArchive);
    const signedBundle = await readFile(bundle);
    const originalDigest = activationPolicy.artifactSha256;
    const originalBundleDigest = receipt.bundleSha256;
    for (const attack of [
      "traversal",
      "absolute-link",
      "late-link-escape",
      "device",
      "duplicate",
      "wrong-release-id",
    ]) {
      execFileSync("/usr/bin/python3", [
        "-I",
        "-c",
        `
import io, json, sys, tarfile
with tarfile.open(sys.argv[1], "w:gz") as archive:
    content = json.dumps({"artifactId": "wrong" if sys.argv[2] == "wrong-release-id" else "travelos-stage10-test"}).encode()
    member = tarfile.TarInfo("release.json"); member.size = len(content)
    archive.addfile(member, io.BytesIO(content))
    member = tarfile.TarInfo("../stage10-escaped" if sys.argv[2] == "traversal" else "attack")
    if sys.argv[2] == "absolute-link": member.type = tarfile.SYMTYPE; member.linkname = "/etc"
    if sys.argv[2] == "device": member.type = tarfile.CHRTYPE
    archive.addfile(member)
    if sys.argv[2] == "duplicate": archive.addfile(member)
    if sys.argv[2] == "late-link-escape":
        member = tarfile.TarInfo("directory"); member.type = tarfile.DIRTYPE; archive.addfile(member)
        member = tarfile.TarInfo("directory/link"); member.type = tarfile.SYMTYPE; member.linkname = "alias/../outside"; archive.addfile(member)
        member = tarfile.TarInfo("directory/alias"); member.type = tarfile.SYMTYPE; member.linkname = ".."; archive.addfile(member)
    `,
        archive,
        attack,
      ]);
      run(
        "sign-blob",
        "--key",
        "trusted.key",
        "--signing-config",
        "offline.json",
        "--bundle",
        bundle,
        archive,
      );
      activationPolicy.artifactSha256 = digest(await readFile(archive));
      receipt.artifactSha256 = activationPolicy.artifactSha256;
      receipt.bundleSha256 = digest(await readFile(bundle));
      await writeFile(policyFile, JSON.stringify(activationPolicy));
      await authorize();
      await assert.rejects(
        activate(),
        attack === "wrong-release-id"
          ? /RELEASE_ID_MISMATCH/u
          : /SIGNED_ARCHIVE_EXTRACTION_REJECTED/u,
      );
      await unchanged();
      assert.deepEqual(await readdir("/opt/travelos/releases"), ["baseline"]);
      await assert.rejects(stat("/opt/travelos/releases/stage10-escaped"), { code: "ENOENT" });
    }
    activationPolicy.artifactSha256 = originalDigest;
    receipt.artifactSha256 = originalDigest;
    receipt.bundleSha256 = originalBundleDigest;
    await writeFile(archive, signedArchive);
    await writeFile(bundle, signedBundle);
    await writeFile(policyFile, JSON.stringify(activationPolicy));
    await authorize();
    const target = `/opt/travelos/releases/sha256-${activationPolicy.artifactSha256}`;
    await mkdir(target);
    await writeFile(path.join(target, "attacker.txt"), "must not overwrite");
    await assert.rejects(activate(), { code: "EEXIST" });
    assert.equal(await readFile(path.join(target, "attacker.txt"), "utf8"), "must not overwrite");
    await unchanged();
    await rm(target, { recursive: true });
    await mkdir("/opt/travelos/.stage10-activation-lock", { mode: 0o700 });
    await assert.rejects(activate(), { code: "EEXIST" });
    await unchanged();
    await rm("/opt/travelos/.stage10-activation-lock", { recursive: true });
    const activationCli = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "stage10-activation.mjs",
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [activationCli, archive, path.join(root, "missing"), publicKey, cosign],
          { encoding: "utf8", stdio: "pipe" },
        ),
      (error) => {
        assert.equal(error.status, 1);
        assert.equal(error.stdout, "");
        assert.deepEqual(JSON.parse(error.stderr), {
          result: "FAIL",
          code: "STAGE10_ACTIVATION_REJECTED",
        });
        return true;
      },
    );
    await unchanged();
    const fifo = path.join(root, "caller-controlled-fifo");
    execFileSync("/usr/bin/mkfifo", [fifo]);
    assert.throws(
      () =>
        execFileSync(process.execPath, [activationCli, fifo, bundle, publicKey, cosign], {
          encoding: "utf8",
          stdio: "pipe",
          timeout: 5000,
        }),
      (error) => {
        assert.equal(
          error.status,
          1,
          "special files must reject rather than block the privileged executor",
        );
        return true;
      },
    );
    await unchanged();
    // The real FileHandle.sync is observed (not replaced by a no-op). Removing
    // any release barrier, or moving it after rename, must fail these assertions.
    const { open } = await import("node:fs/promises");
    const sample = await open(archive, "r");
    const handles = Object.getPrototypeOf(sample);
    await sample.close();
    const realSync = handles.sync;
    const barriers = [];
    const observe = (failAt) =>
      t.mock.method(handles, "sync", async function () {
        const file = await readlink(`/proc/self/fd/${this.fd}`);
        barriers.push({ file, current: await readlink("/opt/travelos/current") });
        if (file === failAt) throw new Error("SYNTHETIC_FSYNC_FAILURE");
        return realSync.call(this);
      });
    const resetRelease = async () => {
      await unlink("/opt/travelos/current");
      await symlink(baseline, "/opt/travelos/current");
      execFileSync("/usr/bin/chmod", ["-R", "u+w", target]);
      await rm(target, { recursive: true });
    };
    const observation = observe();
    await activate();
    observation.mock.restore();
    const expectedBarriers = [
      `${target}/dependency/index.js`,
      `${target}/dependency`,
      `${target}/payload.txt`,
      `${target}/release.json`,
      target,
      "/opt/travelos/releases",
      "/opt/travelos",
    ];
    assert.deepEqual(
      barriers.map(({ file }) => file).sort(),
      [...expectedBarriers].sort(),
      "all installed regular files and directories require fsync; symlinks must not be followed",
    );
    for (const { file, current } of barriers) {
      assert.equal(
        current,
        file === "/opt/travelos" ? target : baseline,
        "all release barriers must complete before the pointer switch",
      );
    }
    const order = barriers.map(({ file }) => file);
    assert.ok(
      order.indexOf(`${target}/dependency/index.js`) < order.indexOf(`${target}/dependency`),
    );
    assert.ok(order.indexOf(`${target}/dependency`) < order.indexOf(target));
    assert.ok(order.indexOf(target) < order.indexOf("/opt/travelos/releases"));
    assert.ok(order.indexOf("/opt/travelos/releases") < order.indexOf("/opt/travelos"));
    await resetRelease();
    for (const failAt of expectedBarriers) {
      barriers.length = 0;
      const fault = observe(failAt);
      await assert.rejects(activate(), /SYNTHETIC_FSYNC_FAILURE/u);
      fault.mock.restore();
      assert.ok(
        barriers.some(({ file }) => file === failAt),
        "fault must reach the real barrier",
      );
      if (failAt === "/opt/travelos") {
        assert.equal(await readlink("/opt/travelos/current"), target);
        assert.equal(
          await readFile(`${target}/payload.txt`, "utf8"),
          "exact signed deployment bytes\n",
        );
        await resetRelease();
      } else {
        await unchanged();
        await assert.rejects(stat(target), { code: "ENOENT" });
      }
      await assert.rejects(stat("/opt/travelos/.stage10-activation-lock"), { code: "ENOENT" });
      assert.deepEqual(await readdir("/opt/travelos/.stage10-private"), []);
    }
    const report = JSON.parse(
      execFileSync(process.execPath, [activationCli, archive, bundle, publicKey, cosign], {
        encoding: "utf8",
      }),
    );
    assert.equal(await readlink("/opt/travelos/current"), target);
    assert.equal(
      await readFile(path.join(target, "payload.txt"), "utf8"),
      "exact signed deployment bytes\n",
    );
    assert.equal(
      await readFile(path.join(target, "payload-link"), "utf8"),
      "exact signed deployment bytes\n",
    );
    assert.equal(
      await readFile(path.join(target, "dependency-link", "index.js"), "utf8"),
      "synthetic dependency\n",
    );
    assert.equal((await stat(path.join(target, "payload.txt"))).mode & 0o777, 0o444);
    assert.equal((await stat(target)).mode & 0o777, 0o555);
    assert.equal(report.qualificationReceiptSha256, digest(await readFile(receiptFile)));
    assert.equal(report.publicKeySha256, policy.publicKeySha256);
    assert.equal(report.transparency, "OFFLINE_NO_TRANSPARENCY_PROOF");
    await assert.rejects(activate(), /CURRENT_RELEASE_MISMATCH/u);
    assert.equal(await readlink("/opt/travelos/current"), target);
  });
};

if (process.argv.slice(2).join(" ") === "--emit-private-test-program") {
  process.stdout.write(`await (${privateScenarios.toString()})();\n`);
} else {
  // No environment-controlled bypass, even for imports or node --test.
  const result = spawnSync(
    "/usr/bin/python3",
    [
      "-I",
      path.join(path.dirname(fileURLToPath(import.meta.url)), "run-stage10-signature-tests.py"),
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
