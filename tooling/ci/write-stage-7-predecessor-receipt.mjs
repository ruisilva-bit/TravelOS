import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  STAGE7_DEFAULT_GENERATION,
  stage7PredecessorReportPathFor,
  stage7PredecessorReceiptPathFor,
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

const verification = await verifyStage7Predecessor({ generation, requireReceipt: false });
const receiptPath = stage7PredecessorReceiptPathFor(generation);
const absolutePath = path.resolve(process.cwd(), receiptPath);
const receiptBytes = Buffer.from(`${JSON.stringify(verification.stage6Verification, null, 2)}\n`);
const proofPath = stage7PredecessorReportPathFor(generation);
const proofAbsolutePath = path.resolve(process.cwd(), proofPath);
const proofBytes = Buffer.from(`${JSON.stringify(verification, null, 2)}\n`);
await mkdir(path.dirname(absolutePath), { recursive: true });
let action = "WRITTEN";
try {
  await writeFile(absolutePath, receiptBytes, { flag: "wx", mode: 0o644 });
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  action = "EXISTING_IDENTICAL";
  assert.deepEqual(
    await readFile(absolutePath),
    receiptBytes,
    "Existing predecessor receipt differs; refusing overwrite",
  );
}
let proofAction = "WRITTEN";
try {
  await writeFile(proofAbsolutePath, proofBytes, { flag: "wx", mode: 0o644 });
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  proofAction = "EXISTING_IDENTICAL";
  assert.deepEqual(
    await readFile(proofAbsolutePath),
    proofBytes,
    "Existing Stage 7 predecessor proof differs; refusing overwrite",
  );
}
const verified = await verifyStage7Predecessor({ generation, requireReceipt: true });
const receiptSha256 = createHash("sha256").update(receiptBytes).digest("hex");
const proofSha256 = createHash("sha256").update(proofBytes).digest("hex");
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      action,
      receiptPath,
      receiptSha256,
      proofAction,
      proofPath,
      proofSha256,
      predecessorCommit: verified.predecessorCommit,
      stage8Actions: verified.stage8Actions,
    },
    null,
    2,
  )}\n`,
);
