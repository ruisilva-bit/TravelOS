import assert from "node:assert/strict";
import path from "node:path";
import { decodeSupportedTextInput } from "./text-input-profile.mjs";
import { scanFrozenSource } from "./source-scan-adapter.mjs";
import { inspectHistoricalArchives } from "./historical-archive-screen.mjs";
import { captureSource } from "./candidate.mjs";
import { regularBytes, sha256 } from "./io.mjs";

const reviewRoot = "docs/reviews/phase-1-m1/stage-10";
const reviews = Object.freeze({
  "SOURCE_FINDING_CLASSIFICATION.md":
    "9869ef0e81d996d0cb04eb395666ad04d4ea8369e19ef7041695c8f8f72a26a4",
  "INHERITED_SOURCE_FINDING_CLASSIFICATION.json":
    "fcd05c0d54f484d95120e3ce36398a1a1f2a256bf2ce88c1214fa94aacc3d013",
  "HISTORICAL_ARCHIVE_FINDING_CLASSIFICATION.json":
    "6b6d869e7edefee3b03f2dcd9739ada6c15e6f0b26447dbaa8cc45c37d01e8cd",
  "SOURCE_IMAGE_VISUAL_REVIEW.json":
    "e7d7e6d6ffa2147f17eed8a01f646bbc7eb97dbbe678201efb53a8ee3ab9729d",
  "ARCHIVE_SCANNER_TEST_FINDING_CLASSIFICATION.json":
    "4fc39be1fbe1b079cc9a9c88da861e842a07ad6cce90220a898e0be5114b7086",
});
const key = (file, line, rule) => JSON.stringify([file, line, rule]);

export function parseReviewedClassifications(markdown, inheritedBytes) {
  const entries = [];
  for (const line of markdown.split("\n")) {
    if (!/^\| \d+ \|/u.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    const location = /^`(.+):(\d+)`$/u.exec(cells[1]);
    assert.ok(location, "Invalid reviewed finding location");
    entries.push({
      file: location[1],
      line: Number(location[2]),
      rule: cells[2].replaceAll("`", ""),
      fileSha256: cells[3].replaceAll("`", ""),
      lineSha256: cells[4].replaceAll("`", ""),
      classification: cells[5].split("**")[1],
    });
  }
  assert.equal(entries.length, 19, "Successor review count drift");
  const inherited = JSON.parse(inheritedBytes);
  assert.equal(inherited.inheritedFindingCount, 141);
  const previousCount = entries.length;
  for (const finding of inherited.findings) {
    for (const rule of finding.rules)
      entries.push({
        file: finding.path,
        line: finding.line,
        rule,
        fileSha256: finding.fileSha256,
        lineSha256: finding.lineSha256,
        classification: finding.category,
      });
  }
  assert.equal(entries.length - previousCount, 141, "Inherited review count drift");
  assert.equal(new Set(entries.map((entry) => key(entry.file, entry.line, entry.rule))).size, 160);
  return entries;
}

// Exact local code-review classifications, not a receipt/privacy authority.
// A changed file or line never inherits an exception from an older review.
export async function screenFinalSource({ root, source }) {
  const reviewBytes = {};
  for (const [name, expected] of Object.entries(reviews)) {
    const relative = `${reviewRoot}/${name}`;
    const bytes = await regularBytes(path.join(root, relative));
    assert.equal(sha256(bytes), expected, "Reviewed classification changed");
    assert.equal(
      source.files.find((row) => row.path === relative)?.sha256,
      expected,
      "Review must be included in the frozen source",
    );
    reviewBytes[name] = bytes;
  }
  const classifications = parseReviewedClassifications(
    reviewBytes["SOURCE_FINDING_CLASSIFICATION.md"].toString("utf8"),
    reviewBytes["INHERITED_SOURCE_FINDING_CLASSIFICATION.json"],
  );
  const valid = new Map();
  const scannerTests = JSON.parse(reviewBytes["ARCHIVE_SCANNER_TEST_FINDING_CLASSIFICATION.json"]);
  assert.equal(scannerTests.findings.length, 2);
  for (const finding of scannerTests.findings)
    classifications.push({ ...finding, lineSha256: finding.exactLineSha256 });
  for (const entry of classifications) {
    const bytes = await regularBytes(path.join(root, entry.file));
    if (sha256(bytes) !== entry.fileSha256) continue;
    const line = bytes.toString("utf8").split(/\r?\n/u)[entry.line - 1];
    if (line === undefined || sha256(Buffer.from(line)) !== entry.lineSha256) continue;
    valid.set(key(entry.file, entry.line, entry.rule), entry.classification);
  }
  const text = await scanFrozenSource({ root, source });
  const binary = await inspectHistoricalArchives({ root });
  const archiveReview = JSON.parse(reviewBytes["HISTORICAL_ARCHIVE_FINDING_CLASSIFICATION.json"]);
  assert.equal(archiveReview.findings.length, 40);
  const archiveKey = (finding) =>
    JSON.stringify([
      finding.ref,
      finding.line,
      finding.rule,
      finding.memberSha256,
      finding.lineSha256,
    ]);
  const archiveReviewed = new Set(archiveReview.findings.map(archiveKey));
  assert.equal(archiveReviewed.size, 40);
  assert.equal(binary.findings.length, 40, "Pinned archive finding count drift");
  const unresolvedArchive = binary.findings.filter(
    (finding) => !archiveReviewed.has(archiveKey(finding)),
  );
  const inspectedRoots = new Map(binary.roots.map((entry) => [entry.path, entry.sha256]));
  assert.deepEqual(
    source.files
      .filter((entry) => entry.path.endsWith(".tar.gz"))
      .map((entry) => [entry.path, entry.sha256])
      .sort(),
    [...inspectedRoots.entries()].sort(),
    "Archive source scope mismatch",
  );
  const images = JSON.parse(reviewBytes["SOURCE_IMAGE_VISUAL_REVIEW.json"]);
  assert.equal(images.count, 12);
  assert.equal(images.images.length, 12);
  const reviewedImages = new Map(images.images.map((entry) => [entry.file, entry.sha256]));
  assert.equal(reviewedImages.size, 12);
  assert.deepEqual(
    source.files
      .filter((entry) => entry.path.endsWith(".png"))
      .map((entry) => [entry.path, entry.sha256])
      .sort(),
    [...reviewedImages.entries()].sort(),
    "Reviewed image source scope mismatch",
  );
  const unsupported = [];

  for (const entry of source.files) {
    const bytes = await regularBytes(path.join(root, entry.path));
    assert.equal(sha256(bytes), entry.sha256, "Source changed during binary screening");
    if (inspectedRoots.get(entry.path) === entry.sha256) continue;
    if (reviewedImages.get(entry.path) === entry.sha256) continue;
    try {
      decodeSupportedTextInput(entry.path, bytes);
    } catch {
      unsupported.push({ file: entry.path, sha256: entry.sha256 });
    }
  }
  const findings = text.findings.map((finding) => ({
    file: finding.file,
    line: finding.line,
    rule: finding.rule,
    classification: inspectedRoots.has(finding.file)
      ? "BINARY_BYTES_ROUTED_TO_RECURSIVE_MEMBER_SCREENING"
      : (valid.get(key(finding.file, finding.line, finding.rule)) ?? null),
  }));
  const unresolved = findings.filter((finding) => finding.classification === null);
  const binaryComplete =
    binary.archives.every((archive) => archive.status === "INSPECTED_HEURISTIC") &&
    unsupported.length === 0 &&
    binary.unsupported.length === 0 &&
    unresolvedArchive.length === 0;
  assert.deepEqual(await captureSource(root), source, "Source drift after final screening");
  return {
    result: unresolved.length === 0 && binaryComplete ? "PASS" : "FAIL",
    scope: "EXACT_REVIEWED_TEXT_AND_BOUNDED_BINARY_SCREENING_NOT_PRIVACY_ACCEPTANCE",
    sourceSha256: text.sourceSha256,
    filesChecked: source.files.length,
    reviewedTextFindings: findings.length - unresolved.length,
    unresolvedTextFindings: unresolved,
    archiveCoverage: binary.archives,
    unsupportedBinaryInputs: unsupported.length,
    archiveFindingCount: binary.findings.length,
    unresolvedArchiveFindings: unresolvedArchive,
    reviewedImages: reviewedImages.size,
    privacy: "PENDING_INDEPENDENT_FINAL_EVIDENCE_ACCEPTANCE",
  };
}
