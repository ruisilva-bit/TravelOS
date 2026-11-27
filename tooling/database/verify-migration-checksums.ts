import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { verifyMigrationChain } from "./migration-runner.js";

const directory = path.resolve("migrations");
const checksumManifestPath = path.resolve("migrations/checksums.json");

// `--write` regenerates the manifest from the migration files on disk. It is for the one moment a
// new migration is added; applied migrations are never edited, so existing entries never change.
if (process.argv.includes("--write")) {
  const files = (await readdir(directory)).filter((file) => /^\d+_[a-z0-9_]+\.cjs$/.test(file));
  const migrations = [];
  for (const file of files.toSorted()) {
    const bytes = await readFile(path.join(directory, file));
    migrations.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(
    checksumManifestPath,
    `${JSON.stringify({ schemaVersion: 1, algorithm: "sha256", migrations }, null, 2)}\n`,
  );
}

const result = await verifyMigrationChain({ directory, checksumManifestPath });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
