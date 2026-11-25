import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import test from "node:test";
import {
  adaptStage9ContractSource,
  verifyStage9ContractReference,
} from "./stage9-contract-regression.mjs";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const original = await readFile(
  path.join(root, "tooling/deployment/verify-stage9-deployment-contract.mjs"),
  "utf8",
);
test("rejects historical branch and import anchor drift", () => {
  assert.throws(() =>
    adaptStage9ContractSource(original.replace("assert.equal(branch, STAGE9_BRANCH);", ""), root),
  );
  assert.throws(() =>
    adaptStage9ContractSource(
      original.replace('"../ci/stage-9/constants.mjs"', '"./unknown.mjs"'),
      root,
    ),
  );
});
test("executes all historical contract assertions with current successor branch", async () => {
  const report = await verifyStage9ContractReference({ root });
  assert.equal(report.result, "PASS");
  assert.equal(report.reference.migrationHead, "0016_stage9_staff_invitations");
  assert.equal(report.reference.caddyApplyAction, "NONE");
  assert.equal(report.reference.caddyConfigurationChanges, false);
  console.log(
    JSON.stringify({
      result: report.result,
      scope: report.scope,
      migrationHead: report.reference.migrationHead,
    }),
  );
});
