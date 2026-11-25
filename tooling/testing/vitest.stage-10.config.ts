import { createHash } from "node:crypto";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.stage-9.config.js";

// Replace exactly the successor rehearsal call; all inherited test assertions remain intact.
const expectedSource = "6a7e9d255366390d2319e668ce51d7d15cd8f71c6a8328d15db7a1488fb640a3";
const anchor = "tooling/ci/stage-8/rehearse-acceptance.mjs";
const replacement = "tooling/ci/stage-10/rehearse-acceptance.mjs";
const inherited = base.plugins![0] as { transform: (code: string, id: string) => string | null };
const adapt = inherited.transform;
inherited.transform = (code, id) => {
  if (id.endsWith("/tests/integration/stage-6-publication-postgresql.test.ts")) {
    if (
      createHash("sha256").update(code).digest("hex") !==
      "10240d267038a43abfdb2e955d5d8c752523d1dbd8195b09acf8e5455f542418"
    )
      throw new Error("Stage 6 regression source hash changed");
    const result = adapt(code, id);
    const before = 'expect(migration.currentVersion).toBe("0014_stage8_worker_activity")';
    if (result === null || result.split(before).length !== 2)
      throw new Error("Stage 10 inherited migration head anchor drift");
    return result.replace(
      before,
      'expect(migration.currentVersion).toBe("0016_stage9_staff_invitations")',
    );
  }
  if (!id.endsWith("/tests/integration/stage-7-postgresql.test.ts")) return adapt(code, id);
  if (createHash("sha256").update(code).digest("hex") !== expectedSource)
    throw new Error("Stage 7 regression source hash changed");
  const adapted = adapt(code, id);
  if (adapted === null || adapted.split(anchor).length !== 2)
    throw new Error("Stage 10 rehearsal anchor drift");
  const call =
    "await rehearseAcceptance({ ...input, databaseName: emptyDatabaseName, port, staffRealmKey: stage7RealmKey, workRoot });";
  if (adapted.split(call).length !== 2) throw new Error("Stage 10 rehearsal call drift");
  const rehearsalAdapted = adapted.replace(anchor, replacement).replace(
    call,
    `await rehearseAcceptance({ ...input, databaseName: emptyDatabaseName, port, staffRealmKey: stage7RealmKey, workRoot, verification: {
    archive: process.env.TRAVELOS_STAGE10_ARCHIVE, receipt: process.env.TRAVELOS_STAGE10_RECEIPT,
    receiptSha256: process.env.TRAVELOS_STAGE10_RECEIPT_SHA256, inputs: process.env.TRAVELOS_STAGE10_INPUTS,
    inputsSha256: process.env.TRAVELOS_STAGE10_INPUTS_SHA256, nodeSha256: process.env.TRAVELOS_STAGE10_NODE_SHA256,
    predecessorArchive: process.env.TRAVELOS_STAGE10_PREDECESSOR_ARCHIVE
  } });`,
  );
  const replaceOnce = (before: string, after: string): string => {
    if (rehearsalAdapted.split(before).length !== 2)
      throw new Error("Stage 10 browser metadata anchor drift");
    return before === after ? rehearsalAdapted : rehearsalAdapted.replace(before, after);
  };
  // Only successor metadata assertions change; browser journey assertions stay intact.
  let result = replaceOnce(
    'expect(artifactRelease.stage).toBe("PHASE_1_M1_STAGE_9");',
    'expect(artifactRelease.stage).toBe("PHASE_1_M1_STAGE_10");',
  );
  for (const [before, after] of [
    [
      "readonly stage10Actions?: unknown;",
      "readonly stage11Actions?: unknown; readonly binding?: { readonly inputDigest?: unknown };",
    ],
    [
      "expect(artifactRelease.stage10Actions).toBe(0);",
      "expect(artifactRelease.stage11Actions).toBe(0);",
    ],
    [
      "`travelos-stage9-${stage9Candidate}-${String(artifactRelease.source?.snapshotSha256).slice(0, 8)}`",
      "`travelos-stage10-${stage9Candidate}-${String(artifactRelease.binding?.inputDigest).slice(0, 8)}`",
    ],
  ] as const) {
    if (result.split(before).length !== 2)
      throw new Error("Stage 10 browser metadata anchor drift");
    result = result.replace(before, after);
  }
  return result;
};
export default mergeConfig(base, defineConfig({}));
