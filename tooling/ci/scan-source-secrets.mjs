import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { collectStage2FreezeInputs } from "./stage-2-freeze-inputs.mjs";
import { collectStage5SourceFiles } from "./stage-5-source-scope.mjs";
import { createStage5FinalScanProvenance } from "./stage-5-scan-provenance.mjs";
import { verifyStage5Final11EvidenceIndex } from "./stage-5-evidence-index.mjs";
import { verifyStage5Final11FindingLineage } from "./stage-5-final11-finding-lineage.mjs";
import { createStage5Final14ScanProvenance } from "./stage-5-final14-scan-provenance.mjs";
import { verifyStage5Final14EvidenceIndex } from "./stage-5-final14-evidence-index.mjs";
import { verifyStage5Final14FindingLineage } from "./stage-5-final14-finding-lineage.mjs";
import { createStage5Final15ScanProvenance } from "./stage-5-final15-scan-provenance.mjs";
import { verifyStage5Final15EvidenceIndex } from "./stage-5-final15-evidence-index.mjs";
import { createStage5Final16ScanProvenance } from "./stage-5-final16-scan-provenance.mjs";
import { verifyStage5Final16EvidenceIndex } from "./stage-5-final16-evidence-index.mjs";
import { verifyStage5Final16FindingLineage } from "./stage-5-final16-finding-lineage.mjs";
import { createStage5Final17ScanProvenance } from "./stage-5-final17-scan-provenance.mjs";
import { verifyStage5Final17EvidenceIndex } from "./stage-5-final17-evidence-index.mjs";
import { verifyStage5Final17FindingLineage } from "./stage-5-final17-finding-lineage.mjs";
import { STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT } from "./stage-5-candidate-contract.mjs";
import { createStage5Final18ScanProvenance } from "./stage-5-final18-scan-provenance.mjs";
import { verifyStage5Final18EvidenceIndex } from "./stage-5-final18-evidence-index.mjs";
import { verifyStage5Final18FindingLineage } from "./stage-5-final18-finding-lineage.mjs";
import { createStage5Final19ScanProvenance } from "./stage-5-final19-scan-provenance.mjs";
import { verifyStage5Final19EvidenceIndex } from "./stage-5-final19-evidence-index.mjs";
import { verifyStage5Final19FindingLineage } from "./stage-5-final19-finding-lineage.mjs";
import { createStage5Final20ScanProvenance } from "./stage-5-final20-scan-provenance.mjs";
import { verifyStage5Final20EvidenceIndex } from "./stage-5-final20-evidence-index.mjs";
import { verifyStage5Final20FindingLineage } from "./stage-5-final20-finding-lineage.mjs";
import { createStage5Final21ScanProvenance } from "./stage-5-final21-scan-provenance.mjs";
import { verifyStage5Final21EvidenceIndex } from "./stage-5-final21-evidence-index.mjs";
import { verifyStage5Final21FindingLineage } from "./stage-5-final21-finding-lineage.mjs";
import {
  STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL19_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT,
} from "./stage-5-candidate-contract.mjs";
import { scanSensitiveFiles } from "./sensitive-data-scanner.mjs";

const preIndexEvidenceScan = process.argv.includes("--pre-index-evidence");
const stage5Final11EvidenceScan = process.argv.includes("--stage5-final");
const stage5Final11CandidateScan = process.argv.includes("--stage5-final-candidate");
const stage5Final14EvidenceScan = process.argv.includes("--stage5-final14");
const stage5Final14CandidateScan = process.argv.includes("--stage5-final14-candidate");
const stage5Final15EvidenceScan = process.argv.includes("--stage5-final15");
const stage5Final15CandidateScan = process.argv.includes("--stage5-final15-candidate");
const stage5Final16EvidenceScan = process.argv.includes("--stage5-final16");
const stage5Final16CandidateScan = process.argv.includes("--stage5-final16-candidate");
const stage5Final17EvidenceScan = process.argv.includes("--stage5-final17");
const stage5Final17CandidateScan = process.argv.includes("--stage5-final17-candidate");
const stage5Final18EvidenceScan = process.argv.includes("--stage5-final18");
const stage5Final18CandidateScan = process.argv.includes("--stage5-final18-candidate");
const stage5Final19EvidenceScan = process.argv.includes("--stage5-final19");
const stage5Final19CandidateScan = process.argv.includes("--stage5-final19-candidate");
const stage5Final20EvidenceScan = process.argv.includes("--stage5-final20");
const stage5Final20CandidateScan = process.argv.includes("--stage5-final20-candidate");
const stage5Final21EvidenceScan = process.argv.includes("--stage5-final21");
const stage5Final21CandidateScan = process.argv.includes("--stage5-final21-candidate");
if (
  [
    stage5Final11EvidenceScan,
    stage5Final11CandidateScan,
    stage5Final14EvidenceScan,
    stage5Final14CandidateScan,
    stage5Final15EvidenceScan,
    stage5Final15CandidateScan,
    stage5Final16EvidenceScan,
    stage5Final16CandidateScan,
    stage5Final17EvidenceScan,
    stage5Final17CandidateScan,
    stage5Final18EvidenceScan,
    stage5Final18CandidateScan,
    stage5Final19EvidenceScan,
    stage5Final19CandidateScan,
    stage5Final20EvidenceScan,
    stage5Final20CandidateScan,
    stage5Final21EvidenceScan,
    stage5Final21CandidateScan,
  ].filter(Boolean).length > 1
) {
  throw new Error("Choose only one Stage 5 scan phase");
}
const stage5FinalCandidateScan =
  stage5Final11CandidateScan ||
  stage5Final14CandidateScan ||
  stage5Final15CandidateScan ||
  stage5Final16CandidateScan ||
  stage5Final17CandidateScan ||
  stage5Final18CandidateScan ||
  stage5Final19CandidateScan ||
  stage5Final20CandidateScan ||
  stage5Final21CandidateScan;
const stage5Final14Scan = stage5Final14EvidenceScan || stage5Final14CandidateScan;
const stage5Final15Scan = stage5Final15EvidenceScan || stage5Final15CandidateScan;
const stage5Final16Scan = stage5Final16EvidenceScan || stage5Final16CandidateScan;
const stage5Final17Scan = stage5Final17EvidenceScan || stage5Final17CandidateScan;
const stage5Final18Scan = stage5Final18EvidenceScan || stage5Final18CandidateScan;
const stage5Final19Scan = stage5Final19EvidenceScan || stage5Final19CandidateScan;
const stage5Final20Scan = stage5Final20EvidenceScan || stage5Final20CandidateScan;
const stage5Final21Scan = stage5Final21EvidenceScan || stage5Final21CandidateScan;
const stage5FinalScan =
  stage5Final11EvidenceScan ||
  stage5FinalCandidateScan ||
  stage5Final14Scan ||
  stage5Final15Scan ||
  stage5Final16Scan ||
  stage5Final17Scan ||
  stage5Final18Scan ||
  stage5Final19Scan ||
  stage5Final20Scan ||
  stage5Final21Scan;
const stage3PreIndexScan = process.argv.includes("--stage3-pre-index");
const stage4PreIndexScan = process.argv.includes("--stage4-pre-index");
const stage3CorrectedFinalScan = process.argv.includes("--stage3-corrected-final");
const stage3CorrectedFrozenScan = process.argv.includes("--stage3-corrected-frozen");
const stage3FinalScan =
  process.argv.includes("--stage3-final") ||
  stage3PreIndexScan ||
  stage3CorrectedFinalScan ||
  stage3CorrectedFrozenScan;
const stage4FinalScan = process.argv.includes("--stage4-final") || stage4PreIndexScan;
const stage3EvidenceDirectory = "docs/evidence/phase-1-m1/stage-3";
const stage4EvidenceDirectory = "docs/evidence/phase-1-m1/stage-4";
const ignoredDirectoryNames = new Set([".vite", "coverage", "dist", "node_modules"]);
// These are deliberately line-specific: unreviewed PII-looking emails must
// remain scan failures, including in Stage 4 and Stage 7 synthetic fixtures.
const syntheticFixtureEmailAllowlist = [
  ...[294, 303, 315, 321, 331, 344, 385, 403, 480, 486].map((line) => ({
    path: "tests/integration/stage-4-postgresql.test.ts",
    rule: "email-address",
    line,
  })),
  {
    path: "tooling/ci/stage-7/test-runtime-acceptance-runner.mjs",
    rule: "email-address",
    line: 231,
  },
];
const readRegularFiles = async (relativeDirectory) => {
  const files = [];
  const walk = async (currentDirectory) => {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Sensitive-data scan may not follow symbolic links: ${relativePath}`);
      }
      if (entry.isDirectory() && !ignoredDirectoryNames.has(entry.name)) await walk(relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  };
  await walk(relativeDirectory);
  return files;
};

const stage5Scope = stage5FinalScan
  ? await collectStage5SourceFiles({
      phase: stage5FinalCandidateScan ? "FINAL_CANDIDATE" : "FINAL_EVIDENCE",
      candidate: stage5Final21Scan ? "FINAL-21" : "FINAL-20",
    })
  : null;
const stage5EvidenceIndexVerification = stage5FinalScan
  ? await (
      stage5Final21Scan
        ? verifyStage5Final21EvidenceIndex
        : stage5Final20Scan
          ? verifyStage5Final20EvidenceIndex
          : stage5Final19Scan
            ? verifyStage5Final19EvidenceIndex
            : stage5Final18Scan
              ? verifyStage5Final18EvidenceIndex
              : stage5Final17Scan
                ? verifyStage5Final17EvidenceIndex
                : stage5Final16Scan
                  ? verifyStage5Final16EvidenceIndex
                  : stage5Final15Scan
                    ? verifyStage5Final15EvidenceIndex
                    : stage5Final14Scan
                      ? verifyStage5Final14EvidenceIndex
                      : verifyStage5Final11EvidenceIndex
    )({
      allowedPhases: stage5FinalCandidateScan ? ["FINAL"] : ["PRE_CI", "FINAL", "CI_FAILED"],
      requiredPhase: stage5FinalCandidateScan ? "FINAL" : undefined,
    })
  : null;
const stage5FindingLineageVerification = stage5FinalScan
  ? await (
      stage5Final21Scan
        ? verifyStage5Final21FindingLineage
        : stage5Final20Scan
          ? verifyStage5Final20FindingLineage
          : stage5Final19Scan
            ? verifyStage5Final19FindingLineage
            : stage5Final18Scan
              ? verifyStage5Final18FindingLineage
              : stage5Final17Scan
                ? verifyStage5Final17FindingLineage
                : stage5Final16Scan
                  ? verifyStage5Final16FindingLineage
                  : stage5Final15Scan
                    ? (await import("./stage-5-final15-finding-lineage.mjs"))
                        .verifyStage5Final15FindingLineage
                    : stage5Final14Scan
                      ? verifyStage5Final14FindingLineage
                      : verifyStage5Final11FindingLineage
    )()
  : null;
const freezeInputs = stage5FinalScan
  ? null
  : await collectStage2FreezeInputs({
      mode: "PRE_FINAL",
    });
const stage3EvidenceFiles = stage3FinalScan ? await readRegularFiles(stage3EvidenceDirectory) : [];
const stage3ReviewFiles = stage3FinalScan
  ? (await readRegularFiles("docs/reviews/phase-1-m1")).filter((file) =>
      /^docs\/reviews\/phase-1-m1\/STAGE_3_.*[.]md$/.test(file),
    )
  : [];
const stage3AdditionalFiles = stage3FinalScan
  ? [
      ...(await readRegularFiles("migrations")),
      ...(await readRegularFiles("tests")),
      ...stage3EvidenceFiles,
      ...stage3ReviewFiles,
      "docs/implementation/M1_STAGE_3_DATABASE_FOUNDATION.md",
    ]
  : [];
const stage4EvidenceFiles = stage4FinalScan
  ? (await readRegularFiles(stage4EvidenceDirectory)).filter(
      (file) =>
        !stage4PreIndexScan || file !== `${stage4EvidenceDirectory}/source-safety-pre-index.json`,
    )
  : [];
const stage4ReviewFiles = stage4FinalScan
  ? (await readRegularFiles("docs/reviews/phase-1-m1")).filter((file) =>
      /^docs\/reviews\/phase-1-m1\/STAGE_4_.*[.]md$/.test(file),
    )
  : [];
const stage4AdditionalFiles = stage4FinalScan
  ? [
      ...(await readRegularFiles("apps")),
      ...(await readRegularFiles("packages")),
      ...(await readRegularFiles("tooling")),
      ...(await readRegularFiles("tests")),
      ...(await readRegularFiles("migrations")),
      ...(await readRegularFiles("deploy")),
      ...stage4EvidenceFiles,
      ...stage4ReviewFiles,
      "docs/implementation/M1_STAGE_4_AUTHENTICATION_AND_AUTHORIZATION.md",
      "eslint.config.mjs",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.base.json",
    ]
  : [];
const files = stage5FinalScan
  ? stage5Scope.files
  : [
      ...new Set([
        ...freezeInputs.entries.map((entry) => entry.path),
        ...stage3AdditionalFiles,
        ...stage4AdditionalFiles,
      ]),
    ].toSorted();
const allowlist = stage4FinalScan || stage5FinalScan ? syntheticFixtureEmailAllowlist : [];
const scan = await scanSensitiveFiles({ files, allowlist });
const stage5FinalScanProvenance = stage5FinalScan
  ? (stage5Final21Scan
      ? createStage5Final21ScanProvenance
      : stage5Final20Scan
        ? createStage5Final20ScanProvenance
        : stage5Final19Scan
          ? createStage5Final19ScanProvenance
          : stage5Final18Scan
            ? createStage5Final18ScanProvenance
            : stage5Final17Scan
              ? createStage5Final17ScanProvenance
              : stage5Final16Scan
                ? createStage5Final16ScanProvenance
                : stage5Final15Scan
                  ? createStage5Final15ScanProvenance
                  : stage5Final14Scan
                    ? createStage5Final14ScanProvenance
                    : createStage5FinalScanProvenance)({
      phase: stage5FinalCandidateScan ? "FINAL_CANDIDATE" : "FINAL_EVIDENCE",
      sourceScopeFiles: stage5Scope.files,
      scanReport: scan,
      findingLineage: stage5FindingLineageVerification,
      evidenceIndexVerification: stage5EvidenceIndexVerification,
    })
  : null;
const coverage = stage5FinalScan
  ? stage5Scope.coverage
  : {
      repositoryOwnedSource: files.filter((file) => /^(?:apps|packages)\//.test(file)).length,
      scriptsAndTooling: files.filter((file) => file.startsWith("tooling/")).length,
      githubWorkflows: files.filter((file) => file.startsWith(".github/workflows/")).length,
      manifestsAndExampleConfiguration: files.filter(
        (file) =>
          /(?:^|\/)package[.]json$/.test(file) ||
          file === "pnpm-workspace.yaml" ||
          file.startsWith("deploy/manifests/"),
      ).length,
      retainedEvidence: files.filter((file) => file.startsWith("docs/evidence/")).length,
      reviewMarkdown: files.filter(
        (file) => file.startsWith("docs/reviews/") && file.endsWith(".md"),
      ).length,
      ...(stage3FinalScan
        ? {
            stage3Migrations: files.filter((file) => file.startsWith("migrations/")).length,
            stage3IntegrationTests: files.filter((file) => file.startsWith("tests/integration/"))
              .length,
            databaseDeployment: files.filter((file) => file.startsWith("deploy/database/")).length,
            stage3Evidence: files.filter((file) => file.startsWith(`${stage3EvidenceDirectory}/`))
              .length,
            stage3ImplementationDocs: files.filter(
              (file) => file === "docs/implementation/M1_STAGE_3_DATABASE_FOUNDATION.md",
            ).length,
            stage3ReviewMarkdown: stage3ReviewFiles.length,
          }
        : {}),
      ...(stage4FinalScan
        ? {
            stage4Migrations: files.filter((file) => file.startsWith("migrations/")).length,
            stage4IntegrationTests: files.filter(
              (file) => file === "tests/integration/stage-4-postgresql.test.ts",
            ).length,
            stage4AuthAdapters: files.filter((file) =>
              /^packages\/auth-adapters\/(?:src|test)\//.test(file),
            ).length,
            stage4Evidence: files.filter((file) => file.startsWith(`${stage4EvidenceDirectory}/`))
              .length,
            stage4ImplementationDocs: files.filter(
              (file) =>
                file === "docs/implementation/M1_STAGE_4_AUTHENTICATION_AND_AUTHORIZATION.md",
            ).length,
            stage4ReviewMarkdown: stage4ReviewFiles.length,
          }
        : {}),
    };
const requiredCoverage = Object.entries(coverage).filter(
  ([name]) => name !== "stage3ReviewMarkdown" && name !== "stage4ReviewMarkdown",
);
if (requiredCoverage.some(([, count]) => count === 0)) {
  throw new Error(`Security scan coverage is incomplete: ${JSON.stringify(coverage)}`);
}
const stage3EvidenceIndexIncluded = files.includes(
  `${stage3EvidenceDirectory}/EVIDENCE_INDEX.json`,
);
const stage3CandidateValidationIncluded = files.includes(
  "docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_VALIDATION.md",
);
const stage3CandidateFreezeIncluded = files.includes(
  "docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_FREEZE.md",
);
const stage3CorrectedCandidateValidationIncluded = files.includes(
  "docs/reviews/phase-1-m1/STAGE_3_CORRECTED_CANDIDATE_VALIDATION.md",
);
const stage3CorrectedCandidateFreezeIncluded = files.includes(
  "docs/reviews/phase-1-m1/STAGE_3_CORRECTED_CANDIDATE_FREEZE.md",
);
const stage4EvidenceIndexIncluded = files.includes(
  `${stage4EvidenceDirectory}/EVIDENCE_INDEX.json`,
);
if (
  stage3FinalScan &&
  ((!stage3PreIndexScan && !stage3EvidenceIndexIncluded) ||
    coverage.stage3Evidence !== stage3EvidenceFiles.length)
) {
  throw new Error("Final Stage 3 evidence scan coverage is incomplete");
}
if (stage3CorrectedFinalScan && !stage3CorrectedCandidateValidationIncluded) {
  throw new Error("Corrected Stage 3 validation is absent from the final scan");
}
if (
  stage3CorrectedFrozenScan &&
  (!stage3CorrectedCandidateValidationIncluded || !stage3CorrectedCandidateFreezeIncluded)
) {
  throw new Error("Corrected Stage 3 freeze inputs are absent from the frozen-candidate scan");
}
if (
  stage4FinalScan &&
  !stage4PreIndexScan &&
  (!stage4EvidenceIndexIncluded || coverage.stage4Evidence !== stage4EvidenceFiles.length)
) {
  throw new Error("Final Stage 4 evidence scan coverage is incomplete");
}

const scanOutput = {
  schemaVersion: 5,
  result: scan.result,
  scope: stage5FinalScan
    ? stage5Final21Scan
      ? stage5FinalCandidateScan
        ? "repository-owned-source-plus-final-21-evidence-review-validation-and-freeze"
        : "repository-owned-source-plus-final-21-evidence-and-review"
      : stage5Final20Scan
        ? stage5FinalCandidateScan
          ? "repository-owned-source-plus-final-20-evidence-review-validation-and-freeze"
          : "repository-owned-source-plus-final-20-evidence-and-review"
        : stage5Final19Scan
          ? stage5FinalCandidateScan
            ? "repository-owned-source-plus-final-19-evidence-review-validation-and-freeze"
            : "repository-owned-source-plus-final-19-evidence-and-review"
          : stage5Final18Scan
            ? stage5FinalCandidateScan
              ? "repository-owned-source-plus-final-18-evidence-review-validation-and-freeze"
              : "repository-owned-source-plus-final-18-evidence-and-review"
            : stage5Final16Scan
              ? stage5FinalCandidateScan
                ? "repository-owned-source-plus-final-16-evidence-review-validation-and-freeze"
                : "repository-owned-source-plus-final-16-evidence-and-review"
              : stage5Final15Scan
                ? stage5FinalCandidateScan
                  ? "repository-owned-source-plus-final-15-evidence-review-validation-and-freeze"
                  : "repository-owned-source-plus-final-15-evidence-and-review"
                : stage5Final14Scan
                  ? stage5FinalCandidateScan
                    ? "repository-owned-source-plus-final-14-evidence-review-validation-and-freeze"
                    : "repository-owned-source-plus-final-14-evidence-and-review"
                  : stage5FinalCandidateScan
                    ? "repository-owned-source-plus-final-stage-5-evidence-review-validation-and-freeze"
                    : "repository-owned-source-plus-final-stage-5-evidence-and-review"
    : stage4FinalScan
      ? stage4PreIndexScan
        ? "repository-owned-source-plus-stage-4-evidence-before-index"
        : "repository-owned-source-plus-final-stage-4-evidence"
      : stage3CorrectedFrozenScan
        ? "deterministic-repository-inputs-plus-corrected-stage-3-evidence-validation-and-freeze"
        : stage3CorrectedFinalScan
          ? "deterministic-repository-inputs-plus-corrected-stage-3-evidence-and-validation"
          : stage3PreIndexScan
            ? "deterministic-repository-inputs-plus-corrected-stage-3-evidence-before-index"
            : stage3FinalScan
              ? "deterministic-repository-inputs-plus-final-stage-3-evidence"
              : preIndexEvidenceScan
                ? "deterministic-stage-2-freeze-inputs-before-evidence-index"
                : "deterministic-stage-2-freeze-inputs",
  ...(stage5FinalScan ? {} : { freezeInputAggregateSha256: freezeInputs.aggregateSha256 }),
  filesScanned: scan.filesScanned.length,
  coverage,
  stage3EvidenceIndexIncluded,
  stage3CandidateValidationIncluded,
  stage3CandidateFreezeIncluded,
  stage3CorrectedCandidateValidationIncluded,
  stage3CorrectedCandidateFreezeIncluded,
  stage4EvidenceIndexIncluded,
  stage5EvidenceIndexes: stage5Scope?.stage5EvidenceIndexes ?? [],
  stage5ExpectedEvidenceIndexes: stage5Scope?.expectedStage5EvidenceIndexes ?? [],
  stage5MissingEvidenceIndexes: stage5Scope?.missingStage5EvidenceIndexes ?? [],
  stage5UnexpectedEvidenceIndexes: stage5Scope?.unexpectedStage5EvidenceIndexes ?? [],
  stage5SourceCoverage: stage5Scope?.failedRequirementIds ?? [],
  stage5MissingCurrentGenerationInputs: stage5Scope?.missingFinalCandidateInputs ?? [],
  stage5PostFreezeScanReceipt: stage5Scope?.postFreezeScanReceipt ?? null,
  stage5PostFreezeScanReceiptState: stage5Scope?.postFreezeScanReceiptState ?? null,
  stage5EvidenceIndexVerification,
  stage5FindingLineageVerification,
  stage5FinalScanProvenance,
  explicitAllowlistEntries: allowlist.length,
  allowlistedFindingCount: scan.allowlistedFindingCount,
  findings: scan.findings,
  matchedValuesEmitted: false,
  stage6Actions: 0,
};
let scanReceiptSha256 = null;
if (stage5FinalCandidateScan && scan.result === "PASS") {
  const reportRelativePath = stage5Final21Scan
    ? STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT
    : stage5Final20Scan
      ? STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT
      : stage5Final19Scan
        ? STAGE5_FINAL19_POST_FREEZE_SCAN_REPORT
        : stage5Final18Scan
          ? STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT
          : stage5Final17Scan
            ? STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT
            : stage5Final16Scan
              ? STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT
              : stage5Final15Scan
                ? STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT
                : stage5Final14Scan
                  ? STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT
                  : STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT;
  const reportPath = path.join(process.cwd(), reportRelativePath);
  const reportText = `${JSON.stringify(scanOutput, null, 2)}\n`;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, reportText);
  const persistedReport = await readFile(reportPath, "utf8");
  if (persistedReport !== reportText) {
    throw new Error("Post-freeze Stage 5 scan receipt did not persist byte-for-byte");
  }
  scanReceiptSha256 = createHash("sha256").update(persistedReport).digest("hex");
}
console.log(
  JSON.stringify(
    {
      ...scanOutput,
      ...(stage5FinalCandidateScan ? { scanReceiptSha256 } : {}),
    },
    null,
    2,
  ),
);
if (scan.result !== "PASS") process.exit(1);
