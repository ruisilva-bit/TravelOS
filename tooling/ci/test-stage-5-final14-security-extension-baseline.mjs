import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
  STAGE5_FINAL14_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL17_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final14FindingLineage } from "./stage-5-final14-finding-lineage.mjs";
import { verifyStage5Final14SecurityExtensionBaseline } from "./verify-stage-5-final14-security-extension-baseline.mjs";
import { buildStage5Final14SecurityExtensionBaseline } from "./generate-stage-5-final14-security-extension-baseline.mjs";
import { STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const activeBaseline = JSON.parse(
  await readFile(
    path.join(root, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
    "utf8",
  ),
);

if (activeBaseline.lineage.final17Generation?.candidate === "FINAL-17") {
  const preservedBaselineBytes = await readFile(
    path.join(root, STAGE5_FINAL17_EVIDENCE_DIRECTORY, "final14-security-extension-baseline.json"),
  );
  assert.equal(hash(preservedBaselineBytes), STAGE5_FINAL14_SECURITY_BASELINE_SHA256);
  const preservedGeneration = JSON.parse(
    await readFile(
      path.join(root, STAGE5_FINAL17_EVIDENCE_DIRECTORY, "final14-baseline-generation.json"),
      "utf8",
    ),
  );
  assert.equal(preservedGeneration.candidate, "FINAL-14");
  assert.equal(preservedGeneration.result, "PASS");
  const lineage = await verifyStage5Final14FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  process.stdout.write(
    `${JSON.stringify(
      {
        result: "PASS",
        candidate: "FINAL-14 historical baseline",
        baselineSha256: hash(preservedBaselineBytes),
        frozenLineageVerified: true,
        stage6Actions: 0,
      },
      null,
      2,
    )}\n`,
  );
} else {
  const previousBaseline = JSON.parse(
    await readFile(
      path.join(
        root,
        STAGE5_FINAL14_EVIDENCE_DIRECTORY,
        "final13-security-extension-baseline.json",
      ),
      "utf8",
    ),
  );
  const lineage = await verifyStage5Final14FindingLineage({ root });
  const currentFiles = await Promise.all(
    STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (relativePath) => ({
      path: relativePath,
      bytes: await readFile(path.join(root, relativePath)),
    })),
  );
  const baseline = buildStage5Final14SecurityExtensionBaseline({
    previousBaseline,
    currentFiles,
    lineage,
  });
  assert.equal(baseline.lineage.final14Generation.candidate, "FINAL-14");
  assert.deepEqual(
    baseline.lineage.final14Generation.protectedPathDeltas.map((delta) => delta.path),
    ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"],
  );
  await assert.rejects(
    async () =>
      buildStage5Final14SecurityExtensionBaseline({
        previousBaseline,
        currentFiles: currentFiles.map((file) =>
          file.path === "apps/admin-api/src/m1-routes.ts"
            ? {
                ...file,
                bytes: Buffer.concat([file.bytes, Buffer.from("\n// unauthorized drift\n")]),
              }
            : file,
        ),
        lineage,
      }),
    /unauthorized protected drift/u,
  );
  const verified = await verifyStage5Final14SecurityExtensionBaseline({ root });
  assert.equal(verified.result, "PASS");
  assert.equal(verified.candidate, "FINAL-14");
  assert.equal(verified.protectedPathCount, STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.length);
  assert.equal(verified.stage6Actions, 0);
  process.stdout.write(
    `${JSON.stringify({ result: "PASS", baselineSha256: verified.baselineSha256, protectedPaths: verified.protectedPathCount })}\n`,
  );
}
