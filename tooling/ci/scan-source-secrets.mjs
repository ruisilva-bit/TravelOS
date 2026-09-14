import { collectStage2FreezeInputs } from "./stage-2-freeze-inputs.mjs";
import { scanSensitiveFiles } from "./sensitive-data-scanner.mjs";

const preIndexEvidenceScan = process.argv.includes("--pre-index-evidence");
const freezeInputs = await collectStage2FreezeInputs({
  mode: "PRE_FINAL",
});
const files = freezeInputs.entries.map((entry) => entry.path);
const scan = await scanSensitiveFiles({ files });
const coverage = {
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
  reviewMarkdown: files.filter((file) => file.startsWith("docs/reviews/") && file.endsWith(".md"))
    .length,
};
if (Object.values(coverage).some((count) => count === 0)) {
  throw new Error(`Security scan coverage is incomplete: ${JSON.stringify(coverage)}`);
}

console.log(
  JSON.stringify(
    {
      schemaVersion: 2,
      result: scan.result,
      scope: preIndexEvidenceScan
        ? "deterministic-stage-2-freeze-inputs-before-evidence-index"
        : "deterministic-stage-2-freeze-inputs",
      freezeInputAggregateSha256: freezeInputs.aggregateSha256,
      filesScanned: scan.filesScanned.length,
      coverage,
      explicitAllowlistEntries: 0,
      allowlistedFindingCount: scan.allowlistedFindingCount,
      findings: scan.findings,
      matchedValuesEmitted: false,
    },
    null,
    2,
  ),
);
if (scan.result !== "PASS") process.exit(1);
