import assert from "node:assert/strict";
import { verifyStage5Final19SecurityExtensionBaseline } from "./verify-stage-5-final19-security-extension-baseline.mjs";

const result = await verifyStage5Final19SecurityExtensionBaseline({ root: process.cwd() });
assert.equal(result.result, "PASS");
assert.equal(result.candidate, "FINAL-19");
assert.equal(result.protectedPathCount, 12);
assert.deepEqual(result.permittedDeltaPaths, [
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
  "package.json",
]);
assert.equal(result.stage6Actions, 0);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
