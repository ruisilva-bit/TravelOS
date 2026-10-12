import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStage6SuccessorBaseline } from "./stage-6-successor-baseline.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage6SuccessorBaseline();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
