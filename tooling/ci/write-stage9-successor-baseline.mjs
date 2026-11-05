import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  prepareStage9SuccessorBaseline,
  STAGE9_BASELINE_PATH,
  verifyStage9SuccessorBaseline,
} from "./stage-9-successor-baseline.mjs";

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert.deepEqual(process.argv.slice(2), ["--write"]);
  const manifest = await prepareStage9SuccessorBaseline();
  await verifyStage9SuccessorBaseline({ manifest });
  await writeFile(path.resolve(STAGE9_BASELINE_PATH), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(JSON.stringify(await verifyStage9SuccessorBaseline()));
}
