import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { browserLeakageRules, scanSensitiveText } from "./sensitive-data-scanner.mjs";

const root = process.cwd();
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const findings = [];
const bundleResults = [];
const allowlistedFindings = [];
// ADR-015: bundles are scanned as built from the current tree. The previously pinned
// bundle-digest exceptions covered Fetch `credentials: "same-origin"` options, which the shared
// scanner now recognises as a public enum value, so no per-build exception is needed. Add an
// exception here only for a reviewed finding the scanner cannot express generically.
const reviewedBundleDigests = new Map();
const reviewedBundleFindings = [];
const findingKey = ({ path: file, rule, line }) => `${file}\0${rule}\0${line}`;
const observedReviewedFindings = new Set();

for (const app of ["admin-web", "portal-web"]) {
  const directory = path.join(root, "apps", app, "dist");
  const files = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.push(absolute);
    }
  };
  await walk(directory);
  if (files.length === 0) throw new Error(`${app} has no built browser files to scan`);
  for (const filePath of files.sort()) {
    const content = await readFile(filePath);
    const text = content.toString("utf8");
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    const reviewedForFile = reviewedBundleFindings.filter(
      (finding) => finding.path === relativePath,
    );
    const contentSha256 = sha256(content);
    const expectedReviewedSha256 = reviewedBundleDigests.get(relativePath);
    const reviewedDigestMatches =
      expectedReviewedSha256 === undefined || expectedReviewedSha256 === contentSha256;
    if (expectedReviewedSha256 !== undefined && !reviewedDigestMatches) {
      findings.push({
        app,
        file: relativePath,
        rule: "reviewed-bundle-sha256-mismatch",
        line: null,
      });
    }
    const activeReviewedFindings = reviewedDigestMatches ? reviewedForFile : [];
    const unfiltered = scanSensitiveText({
      text,
      file: relativePath,
      additionalRules: browserLeakageRules,
    });
    for (const reviewed of activeReviewedFindings) {
      const matched = unfiltered.findings.some(
        (finding) =>
          finding.file === reviewed.path &&
          finding.rule === reviewed.rule &&
          finding.line === reviewed.line,
      );
      if (!matched) {
        throw new Error(
          `Reviewed browser-bundle finding is stale: ${reviewed.path}:${reviewed.line} (${reviewed.rule})`,
        );
      }
      observedReviewedFindings.add(findingKey(reviewed));
      allowlistedFindings.push(reviewed);
    }
    const result = scanSensitiveText({
      text,
      file: relativePath,
      allowlist: activeReviewedFindings,
      additionalRules: browserLeakageRules,
    });
    findings.push(...result.findings.map((finding) => ({ app, ...finding })));
    bundleResults.push({
      app,
      file: relativePath,
      bytes: (await stat(filePath)).size,
      sha256: contentSha256,
    });
  }
}
const scannedPaths = new Set(bundleResults.map(({ file }) => file));
for (const reviewedPath of reviewedBundleDigests.keys()) {
  if (!scannedPaths.has(reviewedPath)) {
    findings.push({
      app: reviewedPath.startsWith("apps/admin-web/") ? "admin-web" : "portal-web",
      file: reviewedPath,
      rule: "reviewed-bundle-missing",
      line: null,
    });
  }
}
const staleReviewedFindings = reviewedBundleFindings.filter(
  (finding) =>
    bundleResults.some(
      (bundle) =>
        bundle.file === finding.path && bundle.sha256 === reviewedBundleDigests.get(finding.path),
    ) && !observedReviewedFindings.has(findingKey(finding)),
);
if (staleReviewedFindings.length > 0) {
  throw new Error(
    `Reviewed browser-bundle findings were not observed: ${staleReviewedFindings
      .map((finding) => `${finding.path}:${finding.line} (${finding.rule})`)
      .join(", ")}`,
  );
}
allowlistedFindings.sort(
  (left, right) =>
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.rule.localeCompare(right.rule),
);
console.log(
  JSON.stringify(
    {
      schemaVersion: 2,
      result: findings.length === 0 ? "PASS" : "FAIL",
      bundlesScanned: bundleResults,
      findings,
      allowlistedFindingCount: allowlistedFindings.length,
      allowlistedFindings,
      matchedValuesEmitted: false,
      stage10Actions: 0,
    },
    null,
    2,
  ),
);
if (findings.length !== 0) process.exit(1);
