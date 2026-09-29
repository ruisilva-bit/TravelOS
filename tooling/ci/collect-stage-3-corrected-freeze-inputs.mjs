import {
  collectStage3CorrectedFreezeInputs,
  STAGE_3_CORRECTED_CANDIDATE_FREEZE,
} from "./stage-3-corrected-freeze-inputs.mjs";

const suppliedExclusions = process.argv
  .filter((argument) => argument.startsWith("--exclude-output="))
  .map((argument) => argument.slice("--exclude-output=".length));
const mode = process.argv.includes("--pre-final") ? "PRE_FINAL" : "FINAL_FREEZE";
const excludedOutputPaths =
  mode === "FINAL_FREEZE" && suppliedExclusions.length === 0
    ? [STAGE_3_CORRECTED_CANDIDATE_FREEZE]
    : suppliedExclusions;
const report = await collectStage3CorrectedFreezeInputs({ excludedOutputPaths, mode });

if (process.argv.includes("--summary")) {
  console.log(
    JSON.stringify(
      {
        schemaVersion: report.schemaVersion,
        result: report.result,
        mode: report.mode,
        finalFreezeEligible: report.finalFreezeEligible,
        exclusions: report.exclusions,
        entryCount: report.entryCount,
        aggregateAlgorithm: report.aggregateAlgorithm,
        aggregateSha256: report.aggregateSha256,
        completeness: {
          result: report.completeness.result,
          requirementCount: report.completeness.requirementCount,
          failedRequirementIds: report.completeness.failedRequirementIds,
        },
        evidenceVerification: report.evidenceVerification,
        correctionDispositions: report.correctionDispositions,
      },
      null,
      2,
    ),
  );
} else {
  console.log(JSON.stringify(report, null, 2));
}
