import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL16_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final15FindingLineage } from "./stage-5-final16-finding-lineage.mjs";
import { buildStage5Final15SecurityExtensionBaseline } from "./generate-stage-5-final16-security-extension-baseline.mjs";
import { verifyStage5Final15SecurityExtensionBaseline } from "./verify-stage-5-final16-security-extension-baseline.mjs";
import { STAGE5_FINAL16_SECURITY_EXTENSION_PROTECTED_PATHS } from "./verify-stage-5-security-extension-baseline.mjs";

const root = process.cwd();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const previousBytes = await readFile(
  path.join(
    root,
    STAGE5_FINAL16_EVIDENCE_DIRECTORY,
    "final15-failed-security-extension-baseline.json",
  ),
);
assert.equal(digest(previousBytes), STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256);
const previousBaseline = JSON.parse(previousBytes.toString("utf8"));
const lineage = await verifyStage5Final15FindingLineage({ root });
const currentFiles = await Promise.all(
  STAGE5_FINAL16_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (relativePath) => ({
    path: relativePath,
    bytes: await readFile(path.join(root, relativePath)),
  })),
);
const generated = buildStage5Final15SecurityExtensionBaseline({
  previousBaseline,
  currentFiles,
  lineage,
});
const active = await readJson("docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json");
assert.deepEqual(
  generated,
  active,
  "FINAL-16 baseline must reproduce deterministically from frozen inputs",
);
assert.equal(
  active.lineage.phase0AcceptedBaseline.sha256,
  "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb",
);
assert.equal(
  active.lineage.phase0Permissions.sha256,
  "ad036b8647f4482bc5e59bff09e5adbf653a4d3ed3994a20cd5b201d104ea1d9",
);
assert.equal(
  active.lineage.final16Generation.packageJsonSha256,
  digest(await readFile(path.join(root, "package.json"))),
);
assert.equal(
  active.lineage.final16Generation.runnerSha256,
  digest(await readFile(path.join(root, "tooling/ci/run-stage-5-final16-authoritative-ci.mjs"))),
);
assert.deepEqual(
  active.lineage.final16Generation.protectedPathDeltas.map((delta) => delta.path),
  ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"],
);
assert.equal(active.extension.permissionRegistryVersion, 3);
const verified = await verifyStage5Final15SecurityExtensionBaseline({ root });
assert.equal(verified.result, "PASS");

const tampered = currentFiles.map((file) =>
  file.path === "docs/PERMISSIONS.md"
    ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from("\n")]) }
    : file,
);
assert.throws(
  () =>
    buildStage5Final15SecurityExtensionBaseline({
      previousBaseline,
      currentFiles: tampered,
      lineage,
    }),
  /unauthorized protected drift/u,
);
assert.throws(
  () =>
    buildStage5Final15SecurityExtensionBaseline({
      previousBaseline,
      currentFiles: currentFiles.slice(1),
      lineage,
    }),
  /deep-equal|missing|unexpected/u,
);
assert.throws(
  () =>
    buildStage5Final15SecurityExtensionBaseline({
      previousBaseline,
      currentFiles: [...currentFiles, currentFiles[0]],
      lineage,
    }),
  /deep-equal|duplicate|unexpected/u,
);
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-16",
      baselineSha256: verified.baselineSha256,
      predecessorSha256: verified.previousBaselineSha256,
      protectedPathCount: verified.protectedPathCount,
      permittedDeltaPaths: verified.permittedDeltaPaths,
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
