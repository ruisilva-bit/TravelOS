import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, realpath, rm } from "node:fs/promises";
import path from "node:path";

const copyOpenedFile = async (source, destination, limit) => {
  assert.ok((await source.stat()).size <= limit, "SNAPSHOT_SIZE_LIMIT");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let total = 0;
  for (;;) {
    const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) return;
    total += bytesRead;
    assert.ok(total <= limit, "SNAPSHOT_SIZE_LIMIT");
    let offset = 0;
    while (offset < bytesRead) {
      const { bytesWritten } = await destination.write(buffer, offset, bytesRead - offset, null);
      assert.ok(bytesWritten > 0, "SNAPSHOT_WRITE_FAILED");
      offset += bytesWritten;
    }
  }
};

const sha256 = async (file) => {
  const hash = createHash("sha256");
  const stream = file.createReadStream({ autoClose: false, start: 0 });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
};

const openRegular = async (file) => {
  assert.ok(path.isAbsolute(file), "Absolute input path required");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile() && stat.nlink === 1, "A single-link regular file is required");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
};

export const readProtectedStage10Json = async (name) => {
  assert.ok(
    [
      "stage10-development-policy.json",
      "stage10-activation-authorization.json",
      "stage10-qualification-receipt.json",
    ].includes(name),
    "UNKNOWN_TRUST_DOCUMENT",
  );
  for (const directory of ["/etc", "/etc/travelos"]) {
    const stat = await lstat(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "TRUST_DIRECTORY_INVALID");
    assert.equal(stat.uid, 0, "TRUST_DIRECTORY_OWNER_MISMATCH");
    assert.equal(stat.mode & 0o022, 0, "TRUST_DIRECTORY_WRITABLE");
  }
  const handle = await openRegular(`/etc/travelos/${name}`);
  try {
    const stat = await handle.stat();
    assert.equal(stat.uid, 0, "TRUST_POLICY_OWNER_MISMATCH");
    assert.equal(stat.mode & 0o022, 0, "TRUST_POLICY_WRITABLE");
    assert.ok(stat.size <= 8192, "TRUST_POLICY_TOO_LARGE");
    const bytes = await handle.readFile();
    return {
      value: JSON.parse(bytes.toString("utf8")),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await handle.close();
  }
};

// Kernel seals close the verify/consume race, including writes by the same UID.
// The isolated host Python is part of the protected base-OS trust boundary.
const sealSnapshots = async (sources) => {
  const script = `
import fcntl, json, os, sys
fds = []
for index in range(4):
    fd = os.memfd_create("travelos-verified-input", os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    fds.append(fd)
    offset = 0
    while True:
        chunk = os.pread(3 + index, 1048576, offset)
        if not chunk: break
        offset += len(chunk)
        if offset > (1073741824, 4194304, 65536, 268435456)[index]:
            raise ValueError("SNAPSHOT_SIZE_LIMIT")
        view = memoryview(chunk)
        while view:
            written = os.write(fd, view)
            if written <= 0: raise RuntimeError("SNAPSHOT_WRITE_FAILED")
            view = view[written:]
    os.fchmod(fd, 0o500 if index == 3 else 0o400)
    os.lseek(fd, 0, os.SEEK_SET)
    fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW |
                fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
print(json.dumps(["/proc/%d/fd/%d" % (os.getpid(), fd) for fd in fds]), flush=True)
sys.stdin.buffer.read(1)
`;
  const child = spawn("/usr/bin/python3", ["-I", "-c", script], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" },
    stdio: ["pipe", "pipe", "ignore", ...sources.map((handle) => handle.fd)],
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  const dispose = async () => {
    child.stdin.destroy();
    child.kill();
    await closed;
  };
  try {
    const paths = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("SNAPSHOT_SEAL_TIMEOUT")), 30_000);
      const finish = (error, value) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      child.once("error", (error) => finish(error));
      child.once("exit", () => finish(new Error("SNAPSHOT_SEAL_FAILED")));
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
        if (output.length > 2048) return finish(new Error("SNAPSHOT_SEAL_FAILED"));
        if (output.includes("\n")) {
          try {
            finish(null, JSON.parse(output));
          } catch {
            finish(new Error("SNAPSHOT_SEAL_FAILED"));
          }
        }
      });
    });
    assert.equal(paths.length, 4);
    const handles = [];
    try {
      for (const file of paths) {
        assert.match(file, new RegExp(`^/proc/${child.pid}/fd/[0-9]+$`, "u"));
        const handle = await open(file, constants.O_RDONLY);
        handles.push(handle);
        const stat = await handle.stat();
        assert.ok(stat.isFile() && stat.nlink === 0, "SEALED_MEMFD_REQUIRED");
      }
      return { handles, dispose };
    } catch (error) {
      await Promise.all(handles.map((handle) => handle.close()));
      throw error;
    }
  } catch (error) {
    await dispose();
    throw error;
  }
};

const verifyBlob = (handles) =>
  new Promise((resolve, reject) => {
    const [archive, bundle, publicKey, cosign] = handles;
    const child = spawn(
      "/proc/self/fd/6",
      [
        "verify-blob",
        "--key",
        "/proc/self/fd/5",
        "--bundle",
        "/proc/self/fd/4",
        "--insecure-ignore-tlog",
        "/proc/self/fd/3",
      ],
      {
        stdio: ["ignore", "ignore", "ignore", archive.fd, bundle.fd, publicKey.fd, cosign.fd],
        env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" },
        timeout: 30_000,
      },
    );
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error("DEVELOPMENT_SIGNATURE_REJECTED"));
    });
  });

// Call only from the root-owned operator after authenticating the provisioning.
// The callback must consume the snapshot;
// original input paths are not authenticated or suitable for later extraction.
export const withVerifiedDevelopmentArchive = async (
  { archive, bundle, publicKey, cosign, stagingRoot },
  consume,
) => {
  assert.equal(process.getuid?.(), 0, "ROOT_REQUIRED");
  assert.equal(typeof consume, "function");
  assert.ok(path.isAbsolute(stagingRoot));
  assert.equal(await realpath(stagingRoot), path.normalize(stagingRoot));
  for (let directory = stagingRoot; directory !== "/"; directory = path.dirname(directory)) {
    const stat = await lstat(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "STAGE_ANCESTOR_INVALID");
    assert.equal(stat.uid, 0, "STAGE_ANCESTOR_OWNER_MISMATCH");
    assert.equal(stat.mode & 0o022, 0, "STAGE_ANCESTOR_WRITABLE");
  }
  const stageInfo = await lstat(stagingRoot);
  assert.ok(stageInfo.isDirectory() && !stageInfo.isSymbolicLink());
  assert.equal(stageInfo.uid, 0, "STAGE_OWNER_MISMATCH");
  assert.equal(stageInfo.mode & 0o777, 0o700, "STAGE_MODE_MISMATCH");
  const { value: policy, sha256: policySha256 } = await readProtectedStage10Json(
    "stage10-development-policy.json",
  );
  assert.deepEqual(Object.keys(policy).sort(), [
    "artifactSha256",
    "cosignSha256",
    "environment",
    "publicKeySha256",
  ]);
  assert.equal(policy.environment, "DEVELOPMENT");
  for (const value of [policy.artifactSha256, policy.cosignSha256, policy.publicKeySha256])
    assert.match(value, /^[a-f0-9]{64}$/u);
  const snapshotDirectory = await mkdtemp(path.join(stagingRoot, "candidate-"));
  let handles = [];
  let sealed;
  try {
    const snapshotPaths = [];
    const limits = [1024 * 1024 * 1024, 4 * 1024 * 1024, 64 * 1024, 256 * 1024 * 1024];
    for (const [index, file] of [archive, bundle, publicKey, cosign].entries()) {
      const source = await openRegular(file);
      const destinationPath = path.join(snapshotDirectory, String(index));
      let destination;
      try {
        destination = await open(destinationPath, "wx", index === 3 ? 0o700 : 0o600);
        await copyOpenedFile(source, destination, limits[index]);
      } finally {
        await source.close();
        await destination?.close();
      }
      snapshotPaths.push(destinationPath);
    }
    for (const file of snapshotPaths) handles.push(await openRegular(file));
    sealed = await sealSnapshots(handles);
    await Promise.all(handles.map((handle) => handle.close()));
    handles = sealed.handles;
    const [archiveFile, bundleFile, publicKeyFile, cosignFile] = handles;
    assert.equal(await sha256(archiveFile), policy.artifactSha256, "ARTIFACT_DIGEST_MISMATCH");
    assert.equal(await sha256(publicKeyFile), policy.publicKeySha256, "PUBLIC_KEY_DIGEST_MISMATCH");
    assert.equal(await sha256(cosignFile), policy.cosignSha256, "COSIGN_DIGEST_MISMATCH");
    const bundleSha256 = await sha256(bundleFile);
    await verifyBlob(handles);
    assert.equal(await sha256(archiveFile), policy.artifactSha256, "ARTIFACT_CHANGED");
    assert.equal(await sha256(publicKeyFile), policy.publicKeySha256, "PUBLIC_KEY_CHANGED");
    assert.equal(await sha256(cosignFile), policy.cosignSha256, "COSIGN_CHANGED");
    assert.equal(await sha256(bundleFile), bundleSha256, "BUNDLE_CHANGED");
    return await consume({
      environment: "DEVELOPMENT",
      policySha256,
      artifactSha256: policy.artifactSha256,
      bundleSha256,
      publicKeySha256: policy.publicKeySha256,
      transparency: "OFFLINE_NO_TRANSPARENCY_PROOF",
      archive: `/proc/self/fd/${archiveFile.fd}`,
      archiveFd: archiveFile.fd,
    });
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
    await sealed?.dispose();
    await rm(snapshotDirectory, { recursive: true, force: true });
  }
};
