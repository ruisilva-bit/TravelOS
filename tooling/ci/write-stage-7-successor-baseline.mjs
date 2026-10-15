import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  STAGE7_DEFAULT_GENERATION,
  createStage7SuccessorManifest,
  stage7BaselinePathFor,
  verifyStage7Predecessor,
  verifyStage7SuccessorBaseline,
} from "./stage-7-successor-baseline.mjs";

let generation = STAGE7_DEFAULT_GENERATION;
let candidateCommit = "HEAD";
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith("--generation=")) {
    assert.equal(generation, STAGE7_DEFAULT_GENERATION, "Duplicate --generation argument");
    generation = argument.split("=", 2)[1];
  } else if (argument.startsWith("--candidate-commit=")) {
    assert.equal(candidateCommit, "HEAD", "Duplicate --candidate-commit argument");
    candidateCommit = argument.split("=", 2)[1];
  } else {
    throw new Error(`Unexpected argument: ${argument}`);
  }
}

await verifyStage7Predecessor({ generation });
const manifest = await createStage7SuccessorManifest({ candidateCommit, generation });
const baselinePath = stage7BaselinePathFor(generation);
const absolutePath = path.resolve(process.cwd(), baselinePath);
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await mkdir(path.dirname(absolutePath), { recursive: true });
let action = "WRITTEN";
try {
  await writeFile(absolutePath, manifestBytes, { flag: "wx", mode: 0o644 });
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  action = "EXISTING_IDENTICAL";
  assert.deepEqual(
    await readFile(absolutePath),
    manifestBytes,
    "Existing Stage 7 baseline differs; refusing overwrite",
  );
}
const verification = await verifyStage7SuccessorBaseline({ generation });
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      action,
      baselinePath,
      baselineSha256: createHash("sha256").update(manifestBytes).digest("hex"),
      candidateCommit: manifest.candidateCommit,
      sourceCount: verification.sourceCount,
      sourceAggregateSha256: verification.sourceAggregateSha256,
      stage8Actions: verification.stage8Actions,
    },
    null,
    2,
  )}\n`,
);
