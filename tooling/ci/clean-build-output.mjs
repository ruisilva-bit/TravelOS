import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const removed = [];
for (const parent of ["apps", "packages"]) {
  const entries = await readdir(path.join(root, parent), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relativePath = path.posix.join(parent, entry.name, "dist");
    await rm(path.join(root, relativePath), { recursive: true, force: true });
    removed.push(relativePath);
  }
}
console.log(
  JSON.stringify({
    schemaVersion: 1,
    result: "PASS",
    generatedDirectoriesRemovedOrConfirmedAbsent: removed.sort(),
  }),
);
