import assert from "node:assert/strict";

import { adaptRegression as adaptStage8Regression } from "../stage-8/regression-adapter.mjs";

const STAGE8_MIGRATION_HEAD = "0014_stage8_worker_activity";
const STAGE9_MIGRATION_HEAD = "0016_stage9_staff_invitations";

const replace = (code, before, after, count = 1) => {
  assert.equal(code.split(before).length - 1, count, `Stage 9 regression anchor drift: ${before}`);
  return code.replaceAll(before, after);
};

export const adaptStage9Regression = (code, stage) => {
  if (stage === 6) {
    return adaptStage8Regression(code, stage);
  }

  if (stage === 7) {
    code = adaptStage8Regression(code, stage);
    code = replace(
      code,
      `const stage7Head = "${STAGE8_MIGRATION_HEAD}"`,
      `const stage7Head = "${STAGE9_MIGRATION_HEAD}"`,
    );
    code = replace(
      code,
      ".verifiedMigrationCount).toBe(14)",
      ".verifiedMigrationCount).toBe(16)",
      3,
    );
    code = replace(code, "emptyRun.ledger).toHaveLength(14)", "emptyRun.ledger).toHaveLength(16)");
    return replace(
      code,
      'priorStage7Run.appliedMigrations).toEqual(["0013_stage7_runtime_acceptance_cleanup", stage7Head])',
      'priorStage7Run.appliedMigrations).toEqual(["0013_stage7_runtime_acceptance_cleanup", "0014_stage8_worker_activity", "0015_stage9_trip_workspace_writes", stage7Head])',
    );
  }

  if (stage === 8) {
    return replace(
      code,
      `expect(result.currentVersion).toBe("${STAGE8_MIGRATION_HEAD}")`,
      `expect(result.currentVersion).toBe("${STAGE9_MIGRATION_HEAD}")`,
    );
  }

  throw new Error(`Unsupported Stage 9 PostgreSQL regression suite: ${stage}`);
};
