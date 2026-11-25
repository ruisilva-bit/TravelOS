// Exercise the real cumulative configuration without running its database hooks.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import config from "../../testing/vitest.stage-10.config.ts";
import { POSTGRES_SUITES } from "./postgres-successor-coverage.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const transform = config.plugins[0].transform;
for (const [i, suite] of POSTGRES_SUITES.entries()) {
  test(`${suite}: real Stage 10 configuration preserves inherited cases`, async () => {
    const code = await readFile(`${root}/${suite}`, "utf8");
    const result = transform(code, `${root}/${suite}`) ?? code;
    const titles = (source) =>
      [...source.matchAll(/(?:\bit|\bbrowserIt)\(\s*"([^"]+)"/gu)].map((match) => match[1]);
    assert.deepEqual(titles(result), titles(code));
    if (i === 0) {
      assert.ok(
        result.includes('expect(migration.currentVersion).toBe("0016_stage9_staff_invitations")'),
      );
      assert.ok(result.includes('return path.join(root, "migrator")'));
    } else if (i === 1) {
      assert.ok(result.includes("tooling/ci/stage-10/rehearse-acceptance.mjs"));
      assert.ok(result.includes("TRAVELOS_STAGE10_RECEIPT_SHA256"));
      assert.ok(result.includes('expect(artifactRelease.stage).toBe("PHASE_1_M1_STAGE_10")'));
      assert.ok(result.includes("expect(artifactRelease.stage11Actions).toBe(0)"));
    } else if (i === 2) {
      assert.ok(
        result.includes('expect(result.currentVersion).toBe("0016_stage9_staff_invitations")'),
      );
      assert.ok(result.includes('"reports not-ready when $capability is missing"'));
    } else assert.equal(result, code, "Staff invitation assertions must not be transformed");
    if (i < 2)
      assert.throws(
        () => transform(`${code}\n// changed source`, `${root}/${suite}`),
        /source hash changed/u,
      );
  });
}
