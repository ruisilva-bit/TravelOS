import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const disposableRootPrefix = "travelos-postgres-";

/**
 * Download, sha256-verify and dpkg-extract the packages of a PostgreSQL lock into a
 * disposable root below the OS temp directory. Fails closed on any mismatch.
 * No host package installation takes place.
 */
export const provisionPostgresql = async ({ lockPath, root }) => {
  const destinationRoot = path.resolve(root ?? "");
  const required = path.join(os.tmpdir(), disposableRootPrefix);
  if (!destinationRoot.startsWith(required) || destinationRoot === required) {
    throw new Error(`PostgreSQL root must be below ${required}*`);
  }
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  await rm(destinationRoot, { recursive: true, force: true });
  await mkdir(path.join(destinationRoot, "downloads"), { recursive: true });

  const packages = [];
  for (const record of lock.packages) {
    if (!/^[0-9a-f]{64}$/u.test(record.sha256)) {
      throw new Error(`Invalid pinned sha256 for ${record.name}`);
    }
    const archivePath = path.join(
      destinationRoot,
      "downloads",
      path.basename(new URL(record.url).pathname),
    );
    const response = await fetch(record.url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Package download failed for ${record.name}: HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== record.sha256) {
      throw new Error(`Package checksum mismatch for ${record.name}`);
    }
    await writeFile(archivePath, bytes, { mode: 0o600 });
    const extraction = spawnSync("dpkg-deb", ["--extract", archivePath, destinationRoot], {
      encoding: "utf8",
    });
    if (extraction.status !== 0) {
      throw new Error(`Package extraction failed for ${record.name}: ${extraction.stderr.trim()}`);
    }
    packages.push({ name: record.name, version: record.version, checksumMatch: true });
  }
  return { postgresql: lock.postgresql, packages };
};
