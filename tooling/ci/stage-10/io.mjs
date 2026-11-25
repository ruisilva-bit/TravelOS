import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";

export const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const digest = (value) => sha256(jsonBytes(value));
export const assertDigest = (value) =>
  assert.match(value ?? "", /^[a-f0-9]{64}$/u, "Invalid input digest");
export const strictOptions = (options, allowed) => {
  for (const key of Object.keys(options))
    assert.ok(allowed.includes(key), `Unknown/injected option: ${key}`);
};
export const safeAncestors = async (file, includeLeaf = false) => {
  const absolute = path.resolve(file);
  const parts = absolute.split(path.sep).filter(Boolean);
  let current = path.parse(absolute).root;
  for (const name of parts.slice(0, includeLeaf ? parts.length : -1)) {
    current = path.join(current, name);
    const metadata = await lstat(current);
    assert.ok(
      metadata.isDirectory() && !metadata.isSymbolicLink(),
      `Unsafe symlink/directory: ${current}`,
    );
  }
};
export const regularBytes = async (file) => {
  await safeAncestors(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    assert.ok(metadata.isFile(), `Expected regular file: ${file}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
};
export const syncDirectory = async (directory) => {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};
// Local accidental-reuse protection, not an adversarial same-UID trust boundary.
export const privateDirectory = async (directory) => {
  const absolute = path.resolve(directory);
  try {
    await safeAncestors(absolute, true);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await privateDirectory(path.dirname(absolute));
  try {
    await mkdir(absolute, { mode: 0o700 });
    await syncDirectory(path.dirname(absolute));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await safeAncestors(absolute, true);
};
export const exclusiveBytes = async (file, bytes) => {
  await safeAncestors(file);
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
};
export const parseCandidate = (candidate) =>
  assert.match(candidate ?? "", /^gen(?:0[1-9]|[1-9][0-9]+)$/u, "Invalid Stage 10 candidate ID");
export const parseCli = (args) => {
  assert.equal(args.length, 1, "Unexpected arguments; require exactly --candidate=genNN");
  const match = /^--candidate=(.+)$/u.exec(args[0]);
  assert.ok(match, "Unknown/unexpected argument");
  parseCandidate(match[1]);
  return { candidate: match[1] };
};
