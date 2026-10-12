import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const lockPath = path.join(repositoryRoot, "tooling/database/postgresql-18-packages.lock.json");

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const destinationRoot = path.resolve(argument("--root") ?? "");
const evidencePath = argument("--evidence");
const allowedDisposableRoots = [
  "travelos-stage3-",
  "travelos-stage4-",
  "travelos-stage5-",
  "travelos-stage6-",
].map((prefix) => path.join(os.tmpdir(), prefix));
if (
  !destinationRoot ||
  !allowedDisposableRoots.some((prefix) => destinationRoot.startsWith(prefix))
) {
  throw new Error(
    "--root must be a TravelOS Stage 3, Stage 4, Stage 5 or Stage 6 disposable path below the OS temp directory",
  );
}

const lock = JSON.parse(await readFile(lockPath, "utf8"));
await rm(destinationRoot, { recursive: true, force: true });
await mkdir(path.join(destinationRoot, "downloads"), { recursive: true });

const packageResults = [];
for (const packageRecord of lock.packages) {
  const archivePath = path.join(
    destinationRoot,
    "downloads",
    path.basename(new URL(packageRecord.url).pathname),
  );
  const response = await fetch(packageRecord.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Package download failed for ${packageRecord.name}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== packageRecord.sha256) {
    throw new Error(`Package checksum mismatch for ${packageRecord.name}`);
  }
  await writeFile(archivePath, bytes, { mode: 0o600 });

  const extraction = spawnSync("dpkg-deb", ["--extract", archivePath, destinationRoot], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (extraction.status !== 0) {
    throw new Error(
      `Package extraction failed for ${packageRecord.name}: ${extraction.stderr.trim()}`,
    );
  }
  packageResults.push({
    name: packageRecord.name,
    version: packageRecord.version,
    url: packageRecord.url,
    expectedSha256: packageRecord.sha256,
    actualSha256,
    checksumMatch: true,
  });
}

const result = {
  schemaVersion: 1,
  result: "PASS",
  method:
    "checksum-verified PGDG/Debian packages extracted into disposable storage; no host package installation",
  platform: lock.platform,
  postgresql: lock.postgresql,
  sourceIndex: lock.sourceIndex,
  releaseNotes: lock.releaseNotes,
  packages: packageResults,
};

if (evidencePath) {
  const absoluteEvidencePath = path.resolve(evidencePath);
  await mkdir(path.dirname(absoluteEvidencePath), { recursive: true });
  await writeFile(absoluteEvidencePath, `${JSON.stringify(result, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
