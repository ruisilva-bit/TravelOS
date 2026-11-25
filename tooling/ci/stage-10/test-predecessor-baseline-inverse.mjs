import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { verifyBaseline, verifyPredecessor } from "./candidate.mjs";
import { PREDECESSOR } from "./constants.mjs";

const sourceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const temporary = await mkdtemp("/home/hermes/.hermes/cache/scratch/stage10-baseline-inverse-");
const fixture = path.join(temporary, "repository");
const git = (...args) =>
  execFileSync("git", args, { cwd: fixture, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
try {
  execFileSync(
    "git",
    ["clone", "--shared", "--no-checkout", "--no-hardlinks", sourceRoot, fixture],
    { stdio: "pipe", timeout: 60000 },
  );
  git("checkout", "--detach", PREDECESSOR.commit);
  const valid = await verifyBaseline(fixture);
  assert.equal(valid.result, "PASS");
  assert.equal(valid.matched, 2662);
  const archive = path.join(sourceRoot, ".hermes/state/stage9-gen11-artifact.tar.gz");
  assert.deepEqual(await verifyPredecessor(fixture, archive), PREDECESSOR);
  const target = path.join(fixture, "package.json");
  const original = await readFile(target);
  await writeFile(target, Buffer.concat([original, Buffer.from(" \n")]));
  await assert.rejects(verifyBaseline(fixture), /Protected Stage 9 predecessor changed/);
  await writeFile(target, original);
  await chmod(target, 0o755);
  await assert.rejects(verifyBaseline(fixture), /Predecessor mode changed/);
  await chmod(target, 0o644);
  await rm(target);
  await assert.rejects(verifyBaseline(fixture), /ENOENT/);
  await symlink("pnpm-workspace.yaml", target);
  await assert.rejects(verifyBaseline(fixture), /regular|symlink|ELOOP/i);
  await rm(target);
  await writeFile(target, original);
  const invalidArchive = path.join(temporary, "invalid.tar.gz");
  await writeFile(invalidArchive, "synthetic invalid archive\n");
  await assert.rejects(verifyPredecessor(fixture, invalidArchive), /archive mismatch/);
  git("tag", "-f", PREDECESSOR.tag, `${PREDECESSOR.commit}^`);
  await assert.rejects(verifyBaseline(fixture), /Exact accepted Stage 9 ref mismatch/);
  console.log(
    JSON.stringify({
      result: "PASS",
      scope: "REAL_ISOLATED_REPOSITORY_BASELINE_AND_PREDECESSOR_INVERSE_TESTS_NOT_CANONICAL_CI",
      matched: valid.matched,
      rejectedCases: ["bytes", "mode", "deletion", "symlink", "archive", "moved-tag"],
      sourceRepositoryChanged: false,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
