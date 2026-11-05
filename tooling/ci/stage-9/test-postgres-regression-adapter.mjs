import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

import { adaptRegression as adaptStage8Regression } from "../stage-8/regression-adapter.mjs";

let stage9Adapter;
try {
  stage9Adapter = await import("./postgres-regression-adapter.mjs");
} catch {
  stage9Adapter = undefined;
}

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const source = (file) => readFile(path.join(repositoryRoot, file), "utf8");
const successorHead = "0016_stage9_staff_invitations";

test("Stage 9 preserves the packaged Stage 8 head in the Stage 6 regression suite", async () => {
  assert.equal(typeof stage9Adapter?.adaptStage9Regression, "function");

  const [stage6, stage7, stage8] = await Promise.all([
    source("tests/integration/stage-6-publication-postgresql.test.ts"),
    source("tests/integration/stage-7-postgresql.test.ts"),
    source("tests/integration/stage-8-postgresql.test.ts"),
  ]);
  const adaptedStage6 = stage9Adapter.adaptStage9Regression(stage6, 6);
  const adaptedStage7 = stage9Adapter.adaptStage9Regression(stage7, 7);
  const adaptedStage8 = stage9Adapter.adaptStage9Regression(stage8, 8);

  assert.ok(
    adaptedStage6.includes('expect(migration.currentVersion).toBe("0014_stage8_worker_activity")'),
  );
  assert.ok(adaptedStage7.includes(`const stage7Head = "${successorHead}"`));
  assert.equal((adaptedStage7.match(/verifiedMigrationCount\)\.toBe\(16\)/gu) ?? []).length, 3);
  assert.ok(adaptedStage7.includes("emptyRun.ledger).toHaveLength(16)"));
  assert.ok(
    adaptedStage7.includes(
      'priorStage7Run.appliedMigrations).toEqual(["0013_stage7_runtime_acceptance_cleanup", "0014_stage8_worker_activity", "0015_stage9_trip_workspace_writes", stage7Head])',
    ),
  );
  assert.ok(adaptedStage8.includes(`expect(result.currentVersion).toBe("${successorHead}")`));
});

test("Stage 8 keeps its original 0014 migration-head regression defaults", async () => {
  const stage7 = await source("tests/integration/stage-7-postgresql.test.ts");
  const adaptedStage7 = adaptStage8Regression(stage7, 7);

  assert.ok(adaptedStage7.includes('const stage7Head = "0014_stage8_worker_activity"'));
  assert.ok(adaptedStage7.includes("emptyRun.ledger).toHaveLength(14)"));
});

test("Stage 9 PostgreSQL package staging uses a prefix accepted by the preparer", async () => {
  const [preparer, runner] = await Promise.all([
    source("tooling/database/prepare-postgresql-18.mjs"),
    source("tooling/database/run-stage-9-postgres-disposable.mjs"),
  ]);
  const allowedRootBlock = preparer.match(
    /const allowedDisposableRoots = \[([\s\S]*?)\]\.map\(\(prefix\) => path\.join\(os\.tmpdir\(\), prefix\)\);/u,
  )?.[1];
  const packageRootPrefix = runner.match(
    /const packageRoot = await mkdtemp\(path\.join\(os\.tmpdir\(\), "([^"]+)"\)\);/u,
  )?.[1];
  assert.ok(allowedRootBlock, "PostgreSQL package root allowlist must remain explicit");
  assert.ok(packageRootPrefix, "Stage 9 disposable runner must declare its package root prefix");
  const allowedPrefixes = [...allowedRootBlock.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(
    allowedPrefixes.some((prefix) => packageRootPrefix.startsWith(prefix)),
    `Stage 9 PostgreSQL package root prefix is rejected by the preparer: ${packageRootPrefix}`,
  );
});
