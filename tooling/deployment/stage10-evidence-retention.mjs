import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readdir } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { scanSensitiveText } from "../ci/sensitive-data-scanner.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const privacyStatus = "SCANNER_ONLY_REQUIRES_INDEPENDENT_REVIEW";
const provenanceStatus = "CALLER_DIGEST_NOT_AUTHENTICATED";
// These are kernel-held directory capabilities, not realpath/check-then-open.
// Linux procfs fd links anchor each lookup; O_NOFOLLOW applies to the one and
// only untrusted component. No attacker-controlled intermediate path is reused.
const at = (directory, name = "") => `/proc/self/fd/${directory.fd}${name ? `/${name}` : ""}`;
const segments = (relative) => {
  assert.ok(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative));
  const names = relative.split("/");
  assert.ok(
    names.every((name) => name && name !== "." && name !== ".." && !name.includes("\0")),
    "INVALID_EVIDENCE_PATH",
  );
  return names;
};
const openDirectory = async (absolute) => {
  assert.ok(
    path.isAbsolute(absolute) && path.normalize(absolute) === absolute,
    "NORMALIZED_ABSOLUTE_ROOT_REQUIRED",
  );
  let directory = await open("/", directoryFlags);
  try {
    for (const name of absolute === "/" ? [] : segments(absolute.slice(1))) {
      const child = await open(at(directory, name), directoryFlags);
      await directory.close();
      directory = child;
    }
    return directory;
  } catch (error) {
    await directory.close();
    throw error;
  }
};
const readRegular = async (directory, relative) => {
  const names = segments(relative);
  let parent = directory;
  let handle;
  try {
    for (const name of names.slice(0, -1)) {
      const child = await open(at(parent, name), directoryFlags);
      if (parent !== directory) await parent.close();
      parent = child;
    }
    handle = await open(
      at(parent, names.at(-1)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await handle.stat();
    assert.ok(
      info.isFile() && info.nlink === 1 && info.size <= MAX_FILE_BYTES,
      "REGULAR_BOUNDED_SINGLE_LINK_FILE_REQUIRED",
    );
    // Bound the read itself, including a file that grows after fstat.
    const chunks = [];
    let length = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
      assert.ok(length <= MAX_FILE_BYTES, "EVIDENCE_FILE_TOO_LARGE");
    }
    return Buffer.concat(chunks, length);
  } finally {
    if (handle) await handle.close();
    if (parent !== directory) await parent.close();
  }
};
const cleanText = (bytes, file) => {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(scanSensitiveText({ text, file }).findings.length, 0, "SENSITIVE_EVIDENCE_REJECTED");
};
const optionsOnly = (options, allowed) => {
  assert.ok(options && typeof options === "object");
  assert.ok(
    Object.keys(options).every((key) => allowed.includes(key)),
    "UNKNOWN_RETENTION_OPTION_QUARANTINE_ONLY",
  );
};
const receiptRows = (receipt) => {
  assert.equal(receipt.schemaVersion, 1);
  assert.match(receipt.artifactSha256, /^[a-f0-9]{64}$/u);
  assert.ok(
    Array.isArray(receipt.commands) &&
      receipt.commands.length > 0 &&
      receipt.commands.length <= 128,
  );
  const rows = [];
  for (const command of receipt.commands) {
    assert.match(command.phase, /^[a-z0-9][a-z0-9-]{0,63}$/u);
    assert.ok(Number.isInteger(command.exitCode));
    assert.deepEqual(Object.keys(command.logs).sort(), ["stderr", "stdout"]);
    for (const stream of ["stdout", "stderr"]) {
      const entry = command.logs[stream];
      assert.ok(
        Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= MAX_FILE_BYTES,
      );
      assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
      segments(entry.path);
      rows.push({
        path: `logs/${command.phase}.${stream}.log`,
        phase: command.phase,
        stream,
        bytes: entry.bytes,
        sha256: entry.sha256,
      });
    }
  }
  assert.equal(new Set(rows.map((row) => row.path)).size, rows.length, "DUPLICATE_LOG_NAME");
  return rows;
};
const bundleDigest = (indexBytes, receipt, rows) =>
  digest(
    JSON.stringify([
      { path: "index.json", bytes: indexBytes.length, sha256: digest(indexBytes) },
      receipt,
      ...rows,
    ]),
  );
const checkBundle = async (directory, expectedReceiptSha256) => {
  assert.deepEqual((await readdir(at(directory))).sort(), [
    "index.json",
    "logs",
    "source-receipt.json",
  ]);
  const receiptBytes = await readRegular(directory, "source-receipt.json");
  assert.equal(digest(receiptBytes), expectedReceiptSha256, "SOURCE_RECEIPT_DIGEST_MISMATCH");
  cleanText(receiptBytes, "source-receipt.json");
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const indexBytes = await readRegular(directory, "index.json");
  cleanText(indexBytes, "index.json");
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.deepEqual(Object.keys(index).sort(), [
    "artifactSha256",
    "logs",
    "privacyStatus",
    "retentionClass",
    "schemaVersion",
    "sourceReceipt",
  ]);
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.retentionClass, "QUARANTINE");
  assert.equal(index.artifactSha256, receipt.artifactSha256);
  assert.equal(index.privacyStatus, privacyStatus);
  assert.deepEqual(index.sourceReceipt, {
    path: "source-receipt.json",
    bytes: receiptBytes.length,
    sha256: expectedReceiptSha256,
  });
  const rows = receiptRows(receipt);
  assert.deepEqual(index.logs, rows);
  const logs = await open(at(directory, "logs"), directoryFlags);
  try {
    assert.deepEqual(
      (await readdir(at(logs))).sort(),
      rows.map((row) => path.basename(row.path)).sort(),
    );
    for (const row of rows) {
      const bytes = await readRegular(logs, path.basename(row.path));
      assert.equal(bytes.length, row.bytes, "LOG_SIZE_MISMATCH");
      assert.equal(digest(bytes), row.sha256, "LOG_DIGEST_MISMATCH");
      cleanText(bytes, row.path);
    }
  } finally {
    await logs.close();
  }
  return {
    logCount: rows.length,
    retentionClass: "QUARANTINE",
    privacyStatus,
    provenanceStatus,
    bundleSha256: bundleDigest(indexBytes, index.sourceReceipt, rows),
  };
};

// Consistency of an observed quarantine snapshot only; NOT provenance, privacy
// approval, stable storage or canonical acceptance. No acceptance mode exists.
export const verifyRetainedDeploymentEvidence = async (options) => {
  optionsOnly(options, ["bundleRoot", "expectedReceiptSha256"]);
  const { bundleRoot, expectedReceiptSha256 } = options;
  assert.match(expectedReceiptSha256, /^[a-f0-9]{64}$/u);
  const directory = await openDirectory(bundleRoot);
  try {
    return await checkBundle(directory, expectedReceiptSha256);
  } finally {
    await directory.close();
  }
};

// renameat2 is the only name-promotion primitive. The root descriptor is passed
// directly, never reopened by pathname. There is deliberately no rename fallback.
const promoteQuarantineNoReplace = async (directory, stagingName, bundleName) => {
  const script = `import ctypes, os, sys\nf = ctypes.CDLL(None, use_errno=True).renameat2\nf.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]\nf.restype = ctypes.c_int\nif f(3, os.fsencode(sys.argv[1]), 3, os.fsencode(sys.argv[2]), 1):\n raise OSError(ctypes.get_errno(), 'renameat2 failed')`;
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/python3", ["-I", "-c", script, stagingName, bundleName], {
      stdio: ["ignore", "ignore", "pipe", directory.fd],
    });
    let error = "";
    child.stderr.on("data", (chunk) => {
      error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`EVIDENCE_QUARANTINE_PROMOTION_FAILED: ${error}`)),
    );
  });
};
const writeExclusive = async (directory, name, bytes) => {
  const handle = await open(
    at(directory, name),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
};

// Scanner-only bytes may enter quarantine, never canonical storage. Caller hash
// pinning proves consistency only. Same-UID staging interference is NOT solved:
// canonical acceptance remains unavailable until an independently administered
// writer/verifier and authenticated receipt/privacy authorities are provisioned.
export const retainDeploymentEvidence = async (options) => {
  optionsOnly(options, [
    "sourceRoot",
    "receiptPath",
    "outputRoot",
    "bundleName",
    "expectedReceiptSha256",
  ]);
  const { sourceRoot, receiptPath, outputRoot, bundleName, expectedReceiptSha256 } = options;
  assert.match(expectedReceiptSha256, /^[a-f0-9]{64}$/u);
  assert.match(bundleName, /^[a-z0-9][a-z0-9-]{0,63}$/u);
  assert.ok(path.isAbsolute(receiptPath) && path.normalize(receiptPath) === receiptPath);
  const root = await openDirectory(sourceRoot);
  let output;
  let quarantine;
  let staging;
  let logsDirectory;
  try {
    const receiptBytes = await readRegular(root, path.relative(sourceRoot, receiptPath));
    assert.equal(digest(receiptBytes), expectedReceiptSha256, "SOURCE_RECEIPT_DIGEST_MISMATCH");
    cleanText(receiptBytes, "source-receipt.json");
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    const rows = receiptRows(receipt);
    const logs = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const command = receipt.commands[Math.floor(i / 2)];
      const bytes = await readRegular(root, command.logs[row.stream].path);
      assert.equal(bytes.length, row.bytes, "LOG_SIZE_MISMATCH");
      assert.equal(digest(bytes), row.sha256, "LOG_DIGEST_MISMATCH");
      cleanText(bytes, row.path);
      logs.push(bytes);
    }
    output = await openDirectory(outputRoot);
    const info = await output.stat();
    assert.ok(
      info.uid === process.getuid() && (info.mode & 0o777) === 0o700,
      "OUTPUT_DIRECTORY_MUST_BE_PRIVATE",
    );
    try {
      await mkdir(at(output, "quarantine"), { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    quarantine = await open(at(output, "quarantine"), directoryFlags);
    const quarantineInfo = await quarantine.stat();
    assert.ok(
      quarantineInfo.uid === process.getuid() && (quarantineInfo.mode & 0o777) === 0o700,
      "QUARANTINE_DIRECTORY_MUST_BE_PRIVATE",
    );
    const stagingPath = await mkdtemp(at(quarantine, `.${bundleName}.staging-`));
    const stagingName = path.basename(stagingPath);
    staging = await open(at(quarantine, stagingName), directoryFlags);
    await mkdir(at(staging, "logs"), { mode: 0o700 });
    logsDirectory = await open(at(staging, "logs"), directoryFlags);
    await writeExclusive(staging, "source-receipt.json", receiptBytes);
    for (let i = 0; i < rows.length; i++)
      await writeExclusive(logsDirectory, path.basename(rows[i].path), logs[i]);
    const index = {
      schemaVersion: 2,
      artifactSha256: receipt.artifactSha256,
      sourceReceipt: {
        path: "source-receipt.json",
        bytes: receiptBytes.length,
        sha256: expectedReceiptSha256,
      },
      retentionClass: "QUARANTINE",
      privacyStatus,
      logs: rows,
    };
    const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
    await writeExclusive(staging, "index.json", indexBytes);
    const intendedDigest = bundleDigest(indexBytes, index.sourceReceipt, rows);
    const before = await checkBundle(staging, expectedReceiptSha256);
    assert.equal(before.bundleSha256, intendedDigest);
    await promoteQuarantineNoReplace(quarantine, stagingName, bundleName);
    // Detect replaced staging entries, but do not pretend this closes the
    // same-UID race or grants durable integrity after this observed read.
    const promoted = await open(at(quarantine, bundleName), directoryFlags);
    try {
      const stagedInfo = await staging.stat();
      const promotedInfo = await promoted.stat();
      assert.ok(
        stagedInfo.dev === promotedInfo.dev && stagedInfo.ino === promotedInfo.ino,
        "QUARANTINE_STAGING_REPLACED",
      );
      const result = await checkBundle(promoted, expectedReceiptSha256);
      assert.equal(result.bundleSha256, intendedDigest, "QUARANTINE_STAGING_MUTATED");
      return { ...result, path: path.join(outputRoot, "quarantine", bundleName) };
    } finally {
      await promoted.close();
    }
  } finally {
    // No locks or recursive pathname cleanup: an attacker can replace those
    // names. Failed partial attempts are left quarantined for operator disposal.
    for (const handle of [logsDirectory, staging, quarantine, output, root])
      if (handle) await handle.close();
  }
};
