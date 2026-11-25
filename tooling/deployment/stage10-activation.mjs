import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readProtectedStage10Json, withVerifiedDevelopmentArchive } from "./stage10-signature.mjs";

const ROOT = "/opt/travelos";
const RELEASES = `${ROOT}/releases`;
const CURRENT = `${ROOT}/current`;
const PRIVATE = `${ROOT}/.stage10-private`;
const LOCK = `${ROOT}/.stage10-activation-lock`;
const HASH = /^[a-f0-9]{64}$/u;
const CHECKS = [
  "canonicalCi",
  "deploymentContract",
  "exactArtifactRehearsal",
  "migrationCompatibility",
  "restorePoint",
];

const protectedDirectory = async (directory) => {
  assert.equal(await realpath(directory), directory, "PROTECTED_PATH_ALIAS");
  for (let current = directory; ; current = path.dirname(current)) {
    const metadata = await lstat(current);
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), "PROTECTED_DIRECTORY_REQUIRED");
    if (current !== "/") assert.equal(metadata.uid, 0, "PROTECTED_OWNER_REQUIRED");
    assert.equal(metadata.mode & 0o022, 0, "PROTECTED_DIRECTORY_WRITABLE");
    if (current === "/") break;
  }
};

const keys = (value, names) =>
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), "UNKNOWN_OR_MISSING_FIELD");
const baseline = async (expected) => {
  const metadata = await lstat(CURRENT);
  assert.ok(metadata.isSymbolicLink() && metadata.uid === 0, "CURRENT_LINK_INVALID");
  assert.equal(await readlink(CURRENT), expected, "CURRENT_RELEASE_MISMATCH");
  assert.equal(await realpath(CURRENT), expected, "CURRENT_RELEASE_ALIAS");
  await protectedDirectory(expected);
};

// A durable pointer must never precede durable content. Flush final file bytes
// AND modes, then directory entries bottom-up, then the release's parent entry.
// Symlink metadata is persisted by its containing directory; never follow links
// while walking/flushing the installed tree. Unsupported/failed fsync rejects.
const syncInstalledPath = async (file, directory) => {
  const handle = await open(
    file,
    constants.O_RDONLY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK |
      (directory ? constants.O_DIRECTORY : 0),
  );
  try {
    const metadata = await handle.stat();
    assert.ok(directory ? metadata.isDirectory() : metadata.isFile(), "SYNC_TYPE_MISMATCH");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const syncInstalledTree = async (directory) => {
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name);
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink()) continue;
    if (metadata.isDirectory()) await syncInstalledTree(file);
    else {
      assert.ok(metadata.isFile(), "SYNC_SPECIAL_FILE_REJECTED");
      await syncInstalledPath(file, false);
    }
  }
  await syncInstalledPath(directory, true);
};

// Extract only the sealed, verified descriptor. Never invoke artifact-owned code
// as root. Python's data filter is additional defense; links/duplicates and
// resource limits are checked before extraction, not after writes occur.
const extract = (fd, destination) => {
  const script = `
import json, os, pathlib, stat, tarfile
os.lseek(3, 0, os.SEEK_SET)
root = pathlib.Path(os.sys.argv[1])
with os.fdopen(os.dup(3), "rb") as stream, tarfile.open(fileobj=stream, mode="r:gz") as archive:
    members = []
    names = {}
    total = 0
    for member in archive:
        if len(members) >= 150000: raise ValueError("MEMBER_LIMIT")
        name = pathlib.PurePosixPath(member.name)
        if name.is_absolute() or ".." in name.parts: raise ValueError("UNSAFE_MEMBER")
        normalized = str(name)
        if normalized in names: raise ValueError("DUPLICATE_MEMBER")
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise ValueError("SPECIAL_MEMBER")
        if member.mode & 0o7000: raise ValueError("PRIVILEGED_MODE")
        if member.size < 0 or member.size > 1073741824: raise ValueError("MEMBER_SIZE_LIMIT")
        total += member.size
        if total > 4294967296: raise ValueError("EXPANDED_SIZE_LIMIT")
        if member.issym() or member.islnk():
            target = pathlib.PurePosixPath(member.linkname)
            if target.is_absolute(): raise ValueError("ABSOLUTE_LINK")
            # Do not let tarfile silently collapse a named link component before
            # '..': later symlinks can make its raw semantics differ from normpath.
            if any(part == ".." and previous != ".."
                   for previous, part in zip(target.parts, target.parts[1:])):
                raise ValueError("AMBIGUOUS_LINK_PARENT")
            base = name.parent if member.issym() else pathlib.PurePosixPath(".")
            depth = 0
            for part in (base / target).parts:
                depth += -1 if part == ".." else 0 if part == "." else 1
                if depth < 0: raise ValueError("ESCAPING_LINK")
        names[normalized] = member
        members.append(member)
    for member in members:
        for parent in pathlib.PurePosixPath(member.name).parents:
            ancestor = names.get(str(parent))
            if ancestor and not ancestor.isdir(): raise ValueError("LINK_ANCESTOR")
    archive.extractall(root, members=members, filter="data")
for directory, dirs, files in os.walk(root, topdown=False, followlinks=False):
    for name in files:
        file = pathlib.Path(directory) / name
        info = file.lstat()
        if stat.S_ISLNK(info.st_mode):
            if not file.resolve().is_relative_to(root): raise ValueError("FINAL_LINK_ESCAPE")
            continue
        if not stat.S_ISREG(info.st_mode): raise ValueError("SPECIAL_EXTRACTED_FILE")
        os.chmod(file, 0o555 if info.st_mode & 0o111 else 0o444)
    for name in dirs:
        child = pathlib.Path(directory) / name
        if child.is_symlink():
            if not child.resolve().is_relative_to(root): raise ValueError("FINAL_LINK_ESCAPE")
        else: os.chmod(child, 0o555)
os.chmod(root, 0o555)
`;
  try {
    execFileSync("/usr/bin/python3", ["-I", "-c", script, destination], {
      stdio: ["ignore", "ignore", "ignore", fd],
      env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" },
      timeout: 120_000,
    });
  } catch {
    throw new Error("SIGNED_ARCHIVE_EXTRACTION_REJECTED");
  }
};

export const activateStage10Development = async (inputs) => {
  assert.equal(process.getuid?.(), 0, "ROOT_REQUIRED");
  await protectedDirectory(RELEASES);
  await protectedDirectory(PRIVATE);
  assert.equal((await lstat(PRIVATE)).mode & 0o777, 0o700, "PRIVATE_STAGE_REQUIRED");
  // mkdir is exclusive; stale locks require explicit root recovery, never unlink
  // an unknown lock or infer that the previous owner is dead.
  await mkdir(LOCK, { mode: 0o700 });
  let target;
  let created = false;
  let activated = false;
  const temporaryLink = `${ROOT}/.stage10-current-${randomUUID()}`;
  try {
    const { value: authorization, sha256: authorizationSha256 } = await readProtectedStage10Json(
      "stage10-activation-authorization.json",
    );
    keys(authorization, [
      "schemaVersion",
      "environment",
      "artifactId",
      "artifactSha256",
      "expectedCurrentTarget",
      "qualificationReceiptSha256",
    ]);
    assert.equal(authorization.schemaVersion, 1);
    assert.equal(authorization.environment, "DEVELOPMENT");
    assert.match(authorization.artifactId, /^travelos-stage(?:9|10)-[a-z0-9][a-z0-9-]{0,80}$/u);
    assert.match(authorization.artifactSha256, HASH);
    assert.match(authorization.qualificationReceiptSha256, HASH);
    const expected = authorization.expectedCurrentTarget;
    assert.equal(path.dirname(expected), RELEASES, "INVALID_BASELINE");
    assert.equal(path.normalize(expected), expected, "INVALID_BASELINE");
    const { value: receipt, sha256: qualificationReceiptSha256 } = await readProtectedStage10Json(
      "stage10-qualification-receipt.json",
    );
    assert.equal(
      qualificationReceiptSha256,
      authorization.qualificationReceiptSha256,
      "QUALIFICATION_RECEIPT_DIGEST_MISMATCH",
    );
    keys(receipt, [
      "schemaVersion",
      "environment",
      "artifactId",
      "artifactSha256",
      "publicKeySha256",
      "bundleSha256",
      "expectedCurrentTarget",
      "migrationHead",
      "offlineTransparencyAccepted",
      "checks",
    ]);
    for (const field of [
      "schemaVersion",
      "environment",
      "artifactId",
      "artifactSha256",
      "expectedCurrentTarget",
    ])
      assert.equal(receipt[field], authorization[field], "QUALIFICATION_SCOPE_MISMATCH");
    assert.match(receipt.publicKeySha256, HASH);
    assert.match(receipt.bundleSha256, HASH);
    assert.match(receipt.migrationHead, /^[a-zA-Z0-9_-]{1,128}$/u);
    assert.equal(receipt.offlineTransparencyAccepted, true, "OFFLINE_TRANSPARENCY_NOT_ACCEPTED");
    keys(receipt.checks, CHECKS);
    for (const check of CHECKS)
      assert.equal(receipt.checks[check], "PASS", "QUALIFICATION_CHECK_FAILED");
    await baseline(expected);

    return await withVerifiedDevelopmentArchive(
      { ...inputs, stagingRoot: PRIVATE },
      async (verified) => {
        for (const field of ["artifactSha256", "publicKeySha256", "bundleSha256"])
          assert.equal(verified[field], receipt[field], "SIGNATURE_QUALIFICATION_MISMATCH");
        target = `${RELEASES}/sha256-${verified.artifactSha256}`;
        // Never overwrite or reuse pre-existing extracted trees. The signed archive
        // is the source of truth, not an attacker-prepared release directory.
        await mkdir(target, { mode: 0o700 });
        created = true;
        extract(verified.archiveFd, target);
        const releasePath = path.join(target, "release.json");
        const metadata = await lstat(releasePath);
        assert.ok(
          metadata.isFile() &&
            !metadata.isSymbolicLink() &&
            metadata.nlink === 1 &&
            metadata.size <= 65536,
          "RELEASE_METADATA_INVALID",
        );
        const release = JSON.parse(await readFile(releasePath, "utf8"));
        assert.equal(release.artifactId, receipt.artifactId, "RELEASE_ID_MISMATCH");
        await syncInstalledTree(target);
        await syncInstalledPath(RELEASES, true);
        // Fail closed if independent authorization was revoked/replaced during
        // signature verification or extraction. Host root is trusted, not a caller.
        assert.equal(
          (await readProtectedStage10Json("stage10-activation-authorization.json")).sha256,
          authorizationSha256,
          "AUTHORIZATION_CHANGED",
        );
        assert.equal(
          (await readProtectedStage10Json("stage10-qualification-receipt.json")).sha256,
          qualificationReceiptSha256,
          "QUALIFICATION_CHANGED",
        );
        assert.equal(
          (await readProtectedStage10Json("stage10-development-policy.json")).sha256,
          verified.policySha256,
          "SIGNATURE_POLICY_CHANGED",
        );
        await baseline(expected);
        await symlink(target, temporaryLink);
        await rename(temporaryLink, CURRENT);
        activated = true;
        assert.equal(await readlink(CURRENT), target, "ACTIVATION_READBACK_FAILED");
        await syncInstalledPath(ROOT, true);
        return {
          result: "ACTIVATED_DEVELOPMENT_POINTER",
          environment: "DEVELOPMENT",
          artifactId: receipt.artifactId,
          artifactSha256: verified.artifactSha256,
          publicKeySha256: verified.publicKeySha256,
          bundleSha256: verified.bundleSha256,
          transparency: verified.transparency,
          qualificationReceiptSha256,
          authorizationSha256,
          previousTarget: expected,
          activeTarget: target,
          runtimeAcceptance: "NOT_PERFORMED",
        };
      },
    );
  } finally {
    await rm(temporaryLink, { force: true });
    if (created && !activated) {
      // Restore directory write access only in our own failed unpublished tree.
      await chmod(target, 0o700);
      execFileSync("/usr/bin/chmod", ["-R", "u+w", target], { stdio: "ignore" });
      await rm(target, { recursive: true, force: true });
    }
    await rmdir(LOCK);
  }
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.equal(process.argv.length, 6, "USAGE");
    const [archive, bundle, publicKey, cosign] = process.argv.slice(2);
    process.stdout.write(
      `${JSON.stringify(await activateStage10Development({ archive, bundle, publicKey, cosign }))}\n`,
    );
  } catch {
    // No raw exception, artifact bytes, subprocess stderr, or caller path in logs.
    process.stderr.write(
      `${JSON.stringify({ result: "FAIL", code: "STAGE10_ACTIVATION_REJECTED" })}\n`,
    );
    process.exitCode = 1;
  }
}
