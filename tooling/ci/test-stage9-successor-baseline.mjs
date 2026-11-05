import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("historical freeze regression runs on the exact accepted predecessor, not successor document bytes", async () => {
  const module = await import("./stage-9-successor-baseline.mjs");
  assert.equal(typeof module.verifyStage9PredecessorFreezeInputs, "function");
  const report = await module.verifyStage9PredecessorFreezeInputs({ root: repositoryRoot });
  assert.equal(report.result, "PASS");
  assert.equal(report.predecessor, "a5cac93bbaa0214456739f7b571795ca8080bfb6");
  assert.equal(report.phase0MatchingCount, 40);
  assert.equal(report.historicalFreezeRegression, "PASS");
  assert.equal(report.stage10Actions, 0);
});
let baseline;
try {
  baseline = await import("./stage-9-successor-baseline.mjs");
} catch {
  baseline = undefined;
}

const fixture = async (context) => {
  assert.equal(typeof baseline?.prepareStage9SuccessorBaseline, "function");
  const manifest = await baseline.prepareStage9SuccessorBaseline({ root: repositoryRoot });
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-baseline-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const file of [
    ...manifest.protectedFiles.map((row) => row.path),
    manifest.phase0.path,
    manifest.originalVerifier.path,
    manifest.design.path,
    manifest.plan.path,
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await cp(path.join(repositoryRoot, file), path.join(root, file));
  }
  return { root, manifest, predecessorRepository: repositoryRoot };
};

test("successor proves the exact predecessor's original 40-file baseline", async (context) => {
  const input = await fixture(context);
  const report = await baseline.verifyStage9SuccessorBaseline(input);
  assert.equal(report.result, "PASS");
  assert.equal(report.predecessor.matchingCount, 40);
  assert.equal(report.protectedCount, 40);
  assert.equal(report.approvedDeltaCount, 5);
  assert.equal(report.stage10Actions, 0);
});

test("successor rejects any unapproved protected-file change", async (context) => {
  const input = await fixture(context);
  await writeFile(path.join(input.root, "AGENTS.md"), "unapproved change\n");
  await assert.rejects(baseline.verifyStage9SuccessorBaseline(input));
});

test("successor rejects changed approved document bytes", async (context) => {
  const input = await fixture(context);
  await writeFile(path.join(input.root, "docs/PERMISSIONS.md"), "unapproved widening\n");
  await assert.rejects(baseline.verifyStage9SuccessorBaseline(input));
});

test("successor binds the approved design and plan", async (context) => {
  const input = await fixture(context);
  await writeFile(path.join(input.root, input.manifest.design.path), "changed design\n");
  await assert.rejects(baseline.verifyStage9SuccessorBaseline(input));
});

test("successor rejects manifest digest and aggregate tampering", async (context) => {
  const input = await fixture(context);
  input.manifest.protectedFiles[0].sha256 = "0".repeat(64);
  await assert.rejects(baseline.verifyStage9SuccessorBaseline(input));
  input.manifest.aggregateSha256 = "0".repeat(64);
  await assert.rejects(baseline.verifyStage9SuccessorBaseline(input));
});

test("successor cannot replace the Phase 0 manifest or original verifier", async (context) => {
  const input = await fixture(context);
  await writeFile(path.join(input.root, input.manifest.phase0.path), "replacement\n");
  await assert.rejects(baseline.verifyStage9SuccessorBaseline(input));
  await cp(
    path.join(repositoryRoot, input.manifest.phase0.path),
    path.join(input.root, input.manifest.phase0.path),
  );
  await writeFile(path.join(input.root, input.manifest.originalVerifier.path), "replacement\n");
  await assert.rejects(baseline.verifyStage9SuccessorBaseline(input));
});

test("successor requires exactly the five approved delta paths with no duplicates", async (context) => {
  const input = await fixture(context);
  input.manifest.approvedDeltaPaths.push("AGENTS.md");
  await assert.rejects(baseline.verifyStage9SuccessorBaseline(input));
  assert.equal(
    JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).private,
    true,
  );
});
