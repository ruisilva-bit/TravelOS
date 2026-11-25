import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { inventory } from "../stage-9/artifact-integrity.mjs";
import {
  assertDigest,
  digest,
  exclusiveBytes,
  jsonBytes,
  regularBytes,
  safeAncestors,
  sha256,
  syncDirectory,
} from "./io.mjs";
import { claimOnce, finishOnce } from "./one-shot.mjs";

export const sealPayload = async ({ payload, archive, binding }) => {
  for (const key of ["inputDigest", "sourceSha256", "migrationSha256", "predecessorArchiveSha256"])
    assertDigest(binding[key]);
  await safeAncestors(payload, true);
  await safeAncestors(archive);
  const manifest = {
    schemaVersion: 1,
    binding,
    excludes: ["stage10-payload.json"],
    files: await inventory(payload),
  };
  await exclusiveBytes(path.join(payload, "stage10-payload.json"), jsonBytes(manifest));
  const handle = await open(
    archive,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const result = spawnSync(
      "tar",
      [
        "--create",
        "--gzip",
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--format=gnu",
        "--file=-",
        "--directory",
        payload,
        ".",
      ],
      { stdio: ["ignore", handle.fd, "pipe"] },
    );
    assert.equal(result.status, 0, "Deterministic artifact archive creation failed");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(archive));
  const bytes = await regularBytes(archive);
  return {
    schemaVersion: 1,
    result: "INTEGRITY_ONLY_NOT_QUALIFIED",
    binding,
    archiveBytes: bytes.length,
    archiveSha256: sha256(bytes),
    payloadManifestSha256: digest(manifest),
    trust: "PENDING",
    privacy: "PENDING",
    stage11Actions: 0,
  };
};
export const packageOnce = async ({ ledger, payload, archive, binding }) => {
  const { directory } = await claimOnce(ledger, binding.inputDigest, {
    operation: "PACKAGE_ONCE",
    binding,
  });
  try {
    const receipt = await sealPayload({ payload, archive, binding });
    await exclusiveBytes(path.join(directory, "build.json"), jsonBytes(receipt));
    await finishOnce(ledger, binding.inputDigest, {
      result: "PASS",
      scope: "PACKAGING_INTEGRITY_ONLY",
      buildReceiptSha256: digest(receipt),
    });
    return receipt;
  } catch (error) {
    await finishOnce(ledger, binding.inputDigest, {
      result: "FAIL",
      code: "PACKAGING_FAILED_PRESERVE_PARTIAL_OUTPUT",
    });
    throw error;
  }
};

export const verifyArtifactBinding = async ({
  payload,
  archive,
  receipt,
  expectedReceiptSha256,
  binding,
}) => {
  assertDigest(expectedReceiptSha256);
  assert.equal(
    digest(receipt),
    expectedReceiptSha256,
    "Build receipt differs from independent expected receipt digest",
  );
  assert.deepEqual(receipt.binding, binding, "Artifact/source binding mismatch");
  const archiveBytes = await regularBytes(archive);
  assert.equal(archiveBytes.length, receipt.archiveBytes, "Archive byte count mismatch");
  assert.equal(sha256(archiveBytes), receipt.archiveSha256, "Archive hash mismatch");
  const manifestBytes = await regularBytes(path.join(payload, "stage10-payload.json"));
  assert.equal(
    sha256(manifestBytes),
    receipt.payloadManifestSha256,
    "Payload manifest digest mismatch",
  );
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(manifest.binding, binding, "Packaged source binding mismatch");
  assert.deepEqual(manifest.excludes, ["stage10-payload.json"]);
  assert.deepEqual(
    await inventory(payload, manifest.excludes),
    manifest.files,
    "Exact payload inventory/manifest mismatch",
  );
  const comparison = spawnSync(
    "tar",
    ["--compare", "--gzip", `--file=${archive}`, "--directory", payload],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
  );
  const lines = `${comparison.stdout ?? ""}${comparison.stderr ?? ""}`.split("\n").filter(Boolean);
  const metadataOnly =
    lines.length > 0 && lines.every((line) => /: (?:Uid|Gid|Mod time) differs$/u.test(line));
  assert.ok(
    comparison.status === 0 || (comparison.status === 1 && metadataOnly),
    "Archive does not match exact extracted payload",
  );
  return {
    result: "INTEGRITY_ONLY_NOT_QUALIFIED",
    archiveSha256: receipt.archiveSha256,
    payloadManifestSha256: receipt.payloadManifestSha256,
    inputDigest: binding.inputDigest,
    trust: "PENDING",
    privacy: "PENDING",
  };
};
