import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import {
  createStage6SuccessorManifest,
  STAGE6_BASELINE_PATH,
  validateStage6SuccessorManifest,
} from "./stage-6-successor-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = await createStage6SuccessorManifest({ root });
await validateStage6SuccessorManifest({
  manifest,
  readBytes: (relativePath) => readFile(path.join(root, relativePath)),
});
const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const target = path.join(root, STAGE6_BASELINE_PATH);
try {
  await writeFile(target, bytes, { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ result: "WRITTEN", path: STAGE6_BASELINE_PATH, bytes: bytes.length })}\n`,
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const existing = await readFile(target);
  assert.deepEqual(
    existing,
    bytes,
    "Refusing to overwrite a divergent Stage 6 successor baseline generation",
  );
  process.stdout.write(
    `${JSON.stringify({ result: "UNCHANGED", path: STAGE6_BASELINE_PATH, bytes: existing.length })}\n`,
  );
}
