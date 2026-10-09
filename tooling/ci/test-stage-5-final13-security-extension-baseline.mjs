import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL13_SOURCE_ARCHIVE,
  STAGE5_FINAL13_SOURCE_ARCHIVE_SHA256,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
  STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final13FindingLineage } from "./stage-5-final13-finding-lineage.mjs";
import {
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS,
} from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const historicalBytes = await readFile(
  path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY, "final13-security-extension-baseline.json"),
);
assert.equal(sha256(historicalBytes), STAGE5_FINAL13_SECURITY_BASELINE_SHA256);
const historical = JSON.parse(historicalBytes.toString("utf8"));
const previousBytes = await readFile(
  path.join(
    root,
    "docs/evidence/phase-1-m1/stage-5-final-13",
    "final12-security-extension-baseline.json",
  ),
);
assert.equal(sha256(previousBytes), STAGE5_FINAL12_SECURITY_BASELINE_SHA256);
const previous = JSON.parse(previousBytes.toString("utf8"));
const lineage = await verifyStage5Final13FindingLineage({ root });
const archiveBytes = await readFile(path.join(root, STAGE5_FINAL13_SOURCE_ARCHIVE));
assert.equal(sha256(archiveBytes), STAGE5_FINAL13_SOURCE_ARCHIVE_SHA256);
assert.equal(historical.result, "PASS");
assert.equal(historical.lineage.final13Generation.candidate, "FINAL-13");
assert.deepEqual(
  historical.protectedFiles.map((entry) => entry.path),
  STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS,
);
assert.equal(new Set(historical.protectedFiles.map((entry) => entry.path)).size, 10);
const aggregateRecords = historical.protectedFiles
  .map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`)
  .join("");
assert.equal(sha256(Buffer.from(aggregateRecords)), historical.aggregateSha256);
assert.deepEqual(
  historical.lineage.final13Generation.protectedPathDeltas.map((delta) => delta.path).toSorted(),
  [STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH, "package.json"].toSorted(),
);
assert.equal(
  historical.lineage.final13Generation.previousBaselineSha256,
  STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
);
assert.equal(historical.lineage.rejectedFinal12Candidate.ciLogSha256, lineage.ciLog.sha256);
assert.equal(historical.lineage.rejectedFinal12Candidate.stage6Actions, 0);
const previousRows = new Map(previous.protectedFiles.map((entry) => [entry.path, entry]));
for (const delta of historical.lineage.final13Generation.protectedPathDeltas) {
  assert.equal(delta.previousSha256, previousRows.get(delta.path)?.sha256);
  assert.equal(
    delta.currentSha256,
    historical.protectedFiles.find((entry) => entry.path === delta.path)?.sha256,
  );
}
const packageRow = historical.protectedFiles.find((entry) => entry.path === "package.json");
assert.equal(
  packageRow.sha256,
  historical.lineage.final13Generation.protectedPathDeltas.find(
    (delta) => delta.path === "package.json",
  )?.currentSha256,
);
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-13",
      protectedPaths: historical.protectedFiles.length,
      permittedDeltas: historical.lineage.final13Generation.protectedPathDeltas.map(
        (delta) => delta.path,
      ),
      baselineSha256: sha256(historicalBytes),
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
