import {
  STAGE7_DEFAULT_GENERATION,
  verifyStage7Predecessor,
} from "./stage-7-successor-baseline.mjs";

const generation =
  process.argv.find((argument) => argument.startsWith("--generation="))?.split("=", 2)[1] ??
  STAGE7_DEFAULT_GENERATION;
const unexpected = process.argv
  .slice(2)
  .filter((argument) => !argument.startsWith("--generation="));
if (unexpected.length > 0) {
  throw new Error(`Unexpected arguments: ${unexpected.join(" ")}`);
}

const result = await verifyStage7Predecessor({ generation });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
