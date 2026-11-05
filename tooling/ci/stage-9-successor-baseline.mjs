import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STAGE9_BASELINE_PATH = "docs/reviews/phase-1-m1/STAGE_9_SUCCESSOR_BASELINE_GEN11.json";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const predecessor = "a5cac93bbaa0214456739f7b571795ca8080bfb6";
const phase0 = {
  path: "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md",
  sha256: "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb",
};
const originalVerifier = {
  path: "tooling/ci/verify-protected-baseline.mjs",
  sha256: "c6ba5ebb1ea9657d52a198b297805267df13b9eae44c1c2fe84e6ce9921fd36e",
};
const designPath = "docs/superpowers/specs/2026-11-02-stage9-staff-invitation-design.md";
const approvedDesignSha256 = "ac63ff20260c66f17c658f7e1bd52d59b8ad1563ebe2d2ccdbfe74b93b7d7d39";
const planPath = "docs/superpowers/plans/2026-11-02-stage9-staff-invitation-implementation-plan.md";
const approvedDeltaPaths = Object.freeze([
  "docs/DATA_MODEL.md",
  "docs/DOMAIN_MODEL.md",
  "docs/PERMISSIONS.md",
  "docs/PRODUCT_BLUEPRINT.md",
  "docs/SECURITY_MODEL.md",
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = async (root, file) => {
  const bytes = await readFile(path.join(root, file));
  return { path: file, bytes: bytes.length, sha256: hash(bytes) };
};

const acceptedBaseline = async (root, predecessorRepository) => {
  const manifestBytes = await readFile(path.join(root, phase0.path));
  assert.equal(hash(manifestBytes), phase0.sha256, "Phase 0 manifest changed");
  assert.equal((await digest(root, originalVerifier.path)).sha256, originalVerifier.sha256);
  const rows = [
    ...manifestBytes
      .toString("utf8")
      .matchAll(/^\|\s*`?([^|`]+?)`?\s*\|\s*`?([a-f0-9]{64})`?\s*\|/gmu),
  ]
    .map((match) => ({ path: match[1].trim(), predecessorSha256: match[2] }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  assert.equal(rows.length, 40);
  assert.equal(new Set(rows.map((row) => row.path)).size, 40);
  const archive = execFileSync(
    "git",
    ["archive", predecessor, phase0.path, originalVerifier.path, ...rows.map((row) => row.path)],
    { cwd: predecessorRepository, maxBuffer: 8 * 1024 * 1024 },
  );
  const clean = await mkdtemp(path.join(tmpdir(), "travelos-stage9-predecessor-baseline-"));
  try {
    execFileSync("tar", ["-xf", "-", "-C", clean], { input: archive });
    assert.equal((await digest(clean, phase0.path)).sha256, phase0.sha256);
    assert.equal((await digest(clean, originalVerifier.path)).sha256, originalVerifier.sha256);
    const report = JSON.parse(
      execFileSync(process.execPath, [originalVerifier.path], {
        cwd: clean,
        encoding: "utf8",
      }),
    );
    assert.equal(report.result, "PASS");
    assert.equal(report.protectedFiles.matchingCount, 40);
    for (const row of rows)
      assert.equal((await digest(clean, row.path)).sha256, row.predecessorSha256);
    return { rows, report };
  } finally {
    await rm(clean, { recursive: true, force: true });
  }
};

export const prepareStage9SuccessorBaseline = async ({
  root = repositoryRoot,
  predecessorRepository = repositoryRoot,
} = {}) => {
  const { rows } = await acceptedBaseline(root, predecessorRepository);
  const protectedFiles = [];
  for (const row of rows) protectedFiles.push({ ...row, ...(await digest(root, row.path)) });
  const actualDeltaPaths = protectedFiles
    .filter((row) => row.sha256 !== row.predecessorSha256)
    .map((row) => row.path)
    .sort();
  assert.deepEqual(
    actualDeltaPaths,
    approvedDeltaPaths,
    "Only the five approved document deltas are allowed",
  );
  const design = await digest(root, designPath);
  assert.equal(design.sha256, approvedDesignSha256, "Approved design drift");
  const payload = {
    schemaVersion: 1,
    stage: "PHASE_1_M1_STAGE_9",
    candidate: "gen11",
    predecessor,
    phase0,
    originalVerifier,
    approvedDeltaPaths: [...approvedDeltaPaths],
    design,
    plan: await digest(root, planPath),
    serialization: "SHA-256 of UTF-8 two-space JSON payload excluding aggregateSha256, final LF",
    protectedFiles,
    stage10Actions: 0,
  };
  return { ...payload, aggregateSha256: hash(json(payload)) };
};

export const verifyStage9SuccessorBaseline = async ({
  root = repositoryRoot,
  manifest,
  predecessorRepository = repositoryRoot,
} = {}) => {
  const recorded =
    manifest ?? JSON.parse(await readFile(path.join(root, STAGE9_BASELINE_PATH), "utf8"));
  const { aggregateSha256, ...payload } = recorded;
  assert.equal(aggregateSha256, hash(json(payload)), "Successor aggregate mismatch");
  const expected = await prepareStage9SuccessorBaseline({ root, predecessorRepository });
  assert.deepEqual(recorded, expected, "Successor protected bytes/approval mismatch");
  return {
    result: "PASS",
    predecessor: { commit: predecessor, matchingCount: 40 },
    protectedCount: 40,
    approvedDeltaCount: 5,
    aggregateSha256,
    stage10Actions: 0,
  };
};

export const verifyStage9PredecessorFreezeInputs = async ({ root = repositoryRoot } = {}) => {
  const archive = execFileSync("git", ["archive", predecessor], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  });
  const clean = await mkdtemp(path.join(tmpdir(), "travelos-stage9-historical-freeze-"));
  try {
    execFileSync("tar", ["-xf", "-", "-C", clean], { input: archive });
    assert.equal((await digest(clean, phase0.path)).sha256, phase0.sha256);
    assert.equal((await digest(clean, originalVerifier.path)).sha256, originalVerifier.sha256);
    const phase0Report = JSON.parse(
      execFileSync(process.execPath, [originalVerifier.path], {
        cwd: clean,
        encoding: "utf8",
      }),
    );
    assert.equal(phase0Report.result, "PASS");
    const freezeReport = JSON.parse(
      execFileSync(process.execPath, ["tooling/ci/test-stage-2-freeze-inputs.mjs"], {
        cwd: clean,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
    assert.equal(freezeReport.result, "PASS");
    return {
      result: "PASS",
      predecessor,
      phase0MatchingCount: phase0Report.protectedFiles.matchingCount,
      historicalFreezeRegression: "PASS",
      collectedInputs: freezeReport.collectedInputs,
      stage10Actions: 0,
    };
  } finally {
    await rm(clean, { recursive: true, force: true });
  }
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = process.argv.slice(2);
    assert.ok(
      options.length === 0 ||
        (options.length === 1 && options[0] === "--predecessor-freeze-inputs"),
    );
    console.log(
      JSON.stringify(
        options.length
          ? await verifyStage9PredecessorFreezeInputs()
          : await verifyStage9SuccessorBaseline(),
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        result: "FAIL",
        code: "STAGE9_SUCCESSOR_BASELINE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exitCode = 1;
  }
}
