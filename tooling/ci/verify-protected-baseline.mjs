import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifestPath = "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md";
const expectedManifestSha256 = "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb";
const expectedProtectedCount = 40;
const requiredHashes = {
  "AGENTS.md": "224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340",
  "IDEA.md": "2c7be6b7154835a1301118670a33f2c8b9d9f8a0f178b9565515ab2484a2f524",
};

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const manifestBytes = await readFile(path.join(root, manifestPath));
const manifestSha256 = sha256(manifestBytes);
const rows = manifestBytes
  .toString("utf8")
  .split(/\r?\n/)
  .flatMap((line) => {
    if (!line.startsWith("|") || !line.endsWith("|")) return [];
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    return cells.length >= 2 && /^[0-9a-f]{64}$/.test(cells[1])
      ? [{ path: cells[0], expectedSha256: cells[1] }]
      : [];
  });

const checks = [];
for (const row of rows) {
  try {
    const bytes = await readFile(path.join(root, row.path));
    const actualSha256 = sha256(bytes);
    checks.push({
      path: row.path,
      expectedSha256: row.expectedSha256,
      actualSha256,
      bytes: bytes.length,
      match: actualSha256 === row.expectedSha256,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      checks.push({
        path: row.path,
        expectedSha256: row.expectedSha256,
        actualSha256: null,
        bytes: null,
        match: false,
      });
    } else {
      throw error;
    }
  }
}

const required = Object.fromEntries(
  Object.entries(requiredHashes).map(([filePath, expectedSha256]) => {
    const check = checks.find((candidate) => candidate.path === filePath);
    return [
      filePath,
      {
        expectedSha256,
        actualSha256: check?.actualSha256 ?? null,
        match: check?.actualSha256 === expectedSha256,
      },
    ];
  }),
);
const missing = checks.filter((check) => check.actualSha256 === null).map((check) => check.path);
const mismatches = checks
  .filter((check) => check.actualSha256 !== null && !check.match)
  .map(({ path: filePath, expectedSha256, actualSha256 }) => ({
    path: filePath,
    expectedSha256,
    actualSha256,
  }));
const pass =
  manifestSha256 === expectedManifestSha256 &&
  rows.length === expectedProtectedCount &&
  checks.length === expectedProtectedCount &&
  missing.length === 0 &&
  mismatches.length === 0 &&
  Object.values(required).every((check) => check.match);

const report = {
  schemaVersion: 1,
  result: pass ? "PASS" : "FAIL",
  sourceOfTruth: {
    path: manifestPath,
    expectedSha256: expectedManifestSha256,
    actualSha256: manifestSha256,
    match: manifestSha256 === expectedManifestSha256,
  },
  protectedFiles: {
    declaredCount: expectedProtectedCount,
    parsedCount: rows.length,
    checkedCount: checks.length,
    matchingCount: checks.filter((check) => check.match).length,
    missing,
    mismatches,
  },
  required,
};
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exit(1);
