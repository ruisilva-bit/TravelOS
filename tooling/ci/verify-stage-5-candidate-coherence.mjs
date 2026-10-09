import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyStage5CandidateCoherence } from "./stage-5-candidate-coherence.mjs";

export const runCurrentCandidateCoherenceCli = async () => {
  const result = await verifyStage5CandidateCoherence();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runCurrentCandidateCoherenceCli();
  process.exitCode = result.result === "PASS" ? 0 : 1;
}
