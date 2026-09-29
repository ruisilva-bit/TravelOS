import { collectStage3FreezeInputs, STAGE_3_CANDIDATE_FREEZE } from "./stage-3-freeze-inputs.mjs";

const suppliedExclusions = process.argv
  .filter((argument) => argument.startsWith("--exclude-output="))
  .map((argument) => argument.slice("--exclude-output=".length));
const mode = process.argv.includes("--pre-final") ? "PRE_FINAL" : "FINAL_FREEZE";
const excludedOutputPaths =
  mode === "FINAL_FREEZE" && suppliedExclusions.length === 0
    ? [STAGE_3_CANDIDATE_FREEZE]
    : suppliedExclusions;
const report = await collectStage3FreezeInputs({ excludedOutputPaths, mode });

if (process.argv.includes("--summary")) {
  console.log(
    JSON.stringify(
      {
        schemaVersion: report.schemaVersion,
        purpose: report.purpose,
        result: report.result,
        mode: report.mode,
        finalFreezeCreated: report.finalFreezeCreated,
        finalFreezeEligible: report.finalFreezeEligible,
        preFinalAllowedMissingPaths: report.preFinalAllowedMissingPaths,
        exclusions: report.exclusions,
        entryCount: report.entryCount,
        aggregateAlgorithm: report.aggregateAlgorithm,
        aggregateSha256: report.aggregateSha256,
        completeness: {
          result: report.completeness.result,
          requirementCount: report.completeness.requirementCount,
          failedRequirementIds: report.completeness.failedRequirementIds,
        },
      },
      null,
      2,
    ),
  );
} else {
  console.log(JSON.stringify(report, null, 2));
}
