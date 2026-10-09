import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";
import { scanSensitiveFiles } from "./sensitive-data-scanner.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const textExtensions = new Set([
  ".cjs",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".sh",
  ".sql",
  ".ts",
  ".toml",
  ".txt",
  ".yaml",
  ".yml",
]);
const indexNames = new Set(["EVIDENCE_INDEX.json", "PRE_CI_EVIDENCE_INDEX.json"]);
const scanName = (phase) => `source-security-scan-${phase.toLowerCase().replaceAll("_", "-")}.json`;
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const writeExclusiveOrMatch = async (file, bytes) => {
  try {
    assert.deepEqual(
      await readRegular(file),
      bytes,
      `Refusing divergent scan-report reuse: ${file}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};

export const scanStage5CurrentSource = async ({
  candidateRoot = root,
  phase = "PRE_CI",
  write = true,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  assert(
    ["PRE_CI", "FINAL", "FINAL_CANDIDATE"].includes(phase),
    `Unsupported current-candidate source scan phase: ${phase}`,
  );
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
  const files = new Set([
    ...manifest.protectedPaths,
    manifest.correctionMatrix,
    "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json",
  ]);
  const excludedEvidencePaths = [
    ...(phase === "FINAL_CANDIDATE" ? [] : [`${manifest.evidenceDirectory}/EVIDENCE_INDEX.json`]),
    `${manifest.evidenceDirectory}/PRE_CI_EVIDENCE_INDEX.json`,
    `${manifest.evidenceDirectory}/${scanName("PRE_CI")}`,
    `${manifest.evidenceDirectory}/${scanName("FINAL")}`,
    `${manifest.evidenceDirectory}/${scanName("FINAL_CANDIDATE")}`,
  ];
  if (phase === "PRE_CI") {
    excludedEvidencePaths.push(
      `${manifest.evidenceDirectory}/readiness-preflight.json`,
      `${manifest.evidenceDirectory}/ci-verify.log`,
      `${manifest.evidenceDirectory}/ci-verify-execution.json`,
    );
  }
  const excluded = new Set(excludedEvidencePaths);
  if (phase === "FINAL_CANDIDATE") {
    files.add(manifest.finalization.validation);
    files.add(manifest.finalization.freeze);
    files.add(`${manifest.evidenceDirectory}/EVIDENCE_INDEX.json`);
  }
  let entries = [];
  try {
    entries = await readdir(evidenceDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    const relativePath = `${manifest.evidenceDirectory}/${entry.name}`;
    if (
      excluded.has(relativePath) ||
      (indexNames.has(entry.name) &&
        (phase !== "FINAL_CANDIDATE" || entry.name !== "EVIDENCE_INDEX.json"))
    )
      continue;
    assert(
      entry.isFile() && !entry.isSymbolicLink(),
      `Evidence scan input must be a regular file: ${relativePath}`,
    );
    if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.add(relativePath);
  }
  const sortedFiles = [...files].toSorted((left, right) => left.localeCompare(right));
  for (const relativePath of sortedFiles) await readRegular(path.join(workspace, relativePath));
  const scan = await scanSensitiveFiles({ root: workspace, files: sortedFiles });
  assert.equal(
    scan.result,
    "PASS",
    `Sensitive-data findings detected: ${JSON.stringify(scan.findings)}`,
  );
  const report = {
    schemaVersion: 1,
    result: scan.result,
    candidate: manifest.candidate,
    phase,
    sourceCount: sortedFiles.length,
    scopeAggregateSha256: scan.scopeAggregateSha256,
    files: scan.fileManifest,
    findingCount: scan.findings.length,
    allowlistedFindingCount: scan.allowlistedFindingCount,
    findings: scan.findings,
    exclusions: excludedEvidencePaths,
    stage6Actions: manifest.stage6Actions,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  const reportPath = path.join(evidenceDirectory, scanName(phase));
  if (write) {
    await mkdir(evidenceDirectory, { recursive: true });
    await writeExclusiveOrMatch(reportPath, reportBytes);
  }
  return {
    result: report.result,
    candidate: report.candidate,
    phase: report.phase,
    reportPath: path.relative(workspace, reportPath),
    reportSha256: hash(reportBytes),
    filesScanned: report.sourceCount,
    scopeAggregateSha256: report.scopeAggregateSha256,
    findingCount: report.findingCount,
    allowlistedFindingCount: report.allowlistedFindingCount,
    exclusions: report.exclusions,
    stage6Actions: report.stage6Actions,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase =
    process.argv.find((argument) => argument.startsWith("--phase="))?.split("=")[1] ?? "PRE_CI";
  const result = await scanStage5CurrentSource({ phase });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
