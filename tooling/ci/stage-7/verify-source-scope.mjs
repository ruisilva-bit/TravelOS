import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import {
  STAGE7_DEFAULT_GENERATION,
  verifyStage7SuccessorBaseline,
} from "../stage-7-successor-baseline.mjs";
import { verifyStage7CandidateSourceScope } from "./source-scope.mjs";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export const verifyStage7SourceScope = async ({
  root: workspace = root,
  generation = STAGE7_DEFAULT_GENERATION,
} = {}) => {
  const baseline = await verifyStage7SuccessorBaseline({ root: workspace, generation });
  assert.equal(baseline.result, "PASS", "Stage 7 successor baseline must pass");
  assert.equal(baseline.currentBranch, "phase-1/stage-7");
  assert.equal(baseline.currentHead, baseline.candidateCommit);

  const sourceScope = await verifyStage7CandidateSourceScope({
    root: workspace,
    candidateGeneration: generation,
    candidateCommit: baseline.candidateCommit,
    baselinePath: baseline.baselinePath,
    baselineSha256: baseline.baselineSha256,
  });
  assert.equal(
    sourceScope.result,
    "PASS",
    `Prior-evidence source-scope verification must pass: ${sourceScope.violations.join("; ")}`,
  );
  return sourceScope;
};

const generationArguments = process.argv
  .slice(2)
  .filter((argument) => argument.startsWith("--generation="));
const unexpectedArguments = process.argv
  .slice(2)
  .filter((argument) => !argument.startsWith("--generation="));
if (generationArguments.length > 1) {
  throw new Error("Only one --generation argument is permitted");
}
if (unexpectedArguments.length > 0) {
  throw new Error(`Unexpected arguments: ${unexpectedArguments.join(" ")}`);
}
const generation = generationArguments[0]?.split("=", 2)[1] ?? STAGE7_DEFAULT_GENERATION;

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await verifyStage7SourceScope({ generation });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
