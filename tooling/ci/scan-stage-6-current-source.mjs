import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { scanSensitiveFiles } from "./sensitive-data-scanner.mjs";
import {
  STAGE6_BASELINE_PATH,
  validateStage6SuccessorManifest,
} from "./stage-6-successor-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(root, STAGE6_BASELINE_PATH), "utf8"));
await validateStage6SuccessorManifest({
  manifest,
  readBytes: (relativePath) => readFile(path.join(root, relativePath)),
});
const files = [...manifest.sourceFiles.map((row) => row.path), STAGE6_BASELINE_PATH].sort();
const scan = await scanSensitiveFiles({ root, files });
assert.equal(
  scan.result,
  "PASS",
  `Stage 6 sensitive-data findings: ${JSON.stringify(scan.findings)}`,
);
process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      result: scan.result,
      phase: "STAGE6_CURRENT_SOURCE",
      sourceCount: files.length,
      scopeAggregateSha256: scan.scopeAggregateSha256,
      findingCount: scan.findings.length,
      allowlistedFindingCount: scan.allowlistedFindingCount,
      findings: scan.findings,
      files: scan.fileManifest,
      exclusions: [],
    },
    null,
    2,
  )}\n`,
);
