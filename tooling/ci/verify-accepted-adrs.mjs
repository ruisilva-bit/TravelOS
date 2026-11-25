// Accepted ADRs are immutable records (AGENTS.md §1, ADR-015). This current-tree gate checks
// that every Accepted Phase 0 ADR still has the exact bytes recorded in the accepted baseline
// manifest, and that every ADR file in docs/adr is listed in the ADR index.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifestPath = "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md";
const manifest = await readFile(path.join(root, manifestPath), "utf8");
const acceptedRows = [
  ...manifest.matchAll(
    /^\|\s*`?(docs\/adr\/ADR-\d{3}[^|`]*\.md)`?\s*\|\s*`?([a-f0-9]{64})`?\s*\|/gmu,
  ),
].map((match) => ({ path: match[1].trim(), sha256: match[2] }));
assert.ok(acceptedRows.length >= 14, `expected accepted ADR rows in ${manifestPath}`);

const mismatches = [];
for (const row of acceptedRows) {
  const bytes = await readFile(path.join(root, row.path));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== row.sha256) mismatches.push(row.path);
}

const index = await readFile(path.join(root, "docs/adr/README.md"), "utf8");
const adrFiles = (await readdir(path.join(root, "docs/adr")))
  .filter((name) => /^ADR-\d{3}-.+\.md$/u.test(name))
  .sort();
const unindexed = adrFiles.filter((name) => !index.includes(`(${name})`));

const result = mismatches.length === 0 && unindexed.length === 0 ? "PASS" : "FAIL";
process.stdout.write(
  `${JSON.stringify({ result, acceptedAdrCount: acceptedRows.length, adrFileCount: adrFiles.length, mismatches, unindexed }, null, 2)}\n`,
);
if (result !== "PASS") process.exitCode = 1;
