import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseCiVerifyGateLabels,
  verifyStage5Final11CiExecution,
  verifyStage5Final11EvidenceIndex,
  writeStage5Final11EvidenceIndex,
} from "./stage-5-evidence-index.mjs";
import {
  STAGE5_FINAL11_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL11_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL11_EVIDENCE_DIRECTORY,
  STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "travelos-stage5-evidence-index-"));
const evidenceDirectory = path.join(root, STAGE5_FINAL11_EVIDENCE_DIRECTORY);
const artifactPath = (name) => path.join(evidenceDirectory, name);

try {
  await mkdir(evidenceDirectory, { recursive: true });
  const originalArtifacts = new Map();
  for (const name of STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
    if (name === "ci-verify.log" || name === "ci-verify-execution.json") continue;
    const bytes = Buffer.from(`synthetic ${name}\n`, "utf8");
    originalArtifacts.set(name, bytes);
    await writeFile(artifactPath(name), bytes);
  }

  const preCi = await writeStage5Final11EvidenceIndex({ root, phase: "PRE_CI" });
  assert.equal(preCi.result, "PASS");
  assert.equal(preCi.phase, "PRE_CI");
  assert.equal(preCi.artifactCount, STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length);
  assert.equal(
    await readFile(artifactPath("ci-verify.log"), "utf8"),
    STAGE5_FINAL11_CI_LOG_PLACEHOLDER,
  );
  assert.equal(
    await readFile(artifactPath("ci-verify-execution.json"), "utf8"),
    STAGE5_FINAL11_CI_EXECUTION_PLACEHOLDER,
  );

  const tamperName = STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.find(
    (name) => name !== "ci-verify.log" && name !== "ci-verify-execution.json",
  );
  await writeFile(artifactPath(tamperName), "tampered\n");
  await assert.rejects(
    verifyStage5Final11EvidenceIndex({ root, requiredPhase: "PRE_CI" }),
    /byte\/aggregate verification failed/u,
  );
  await writeFile(artifactPath(tamperName), originalArtifacts.get(tamperName));

  const missingName = STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.at(-1);
  await unlink(artifactPath(missingName));
  await assert.rejects(
    verifyStage5Final11EvidenceIndex({ root, requiredPhase: "PRE_CI" }),
    /directory is not exact/u,
  );
  await writeFile(artifactPath(missingName), originalArtifacts.get(missingName));

  await writeFile(path.join(evidenceDirectory, "unexpected.txt"), "extra\n");
  await assert.rejects(
    verifyStage5Final11EvidenceIndex({ root, requiredPhase: "PRE_CI" }),
    /directory is not exact/u,
  );
  await unlink(path.join(evidenceDirectory, "unexpected.txt"));

  const symlinkRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage5-evidence-symlink-"));
  try {
    const symlinkEvidenceDirectory = path.join(symlinkRoot, STAGE5_FINAL11_EVIDENCE_DIRECTORY);
    await mkdir(path.dirname(symlinkEvidenceDirectory), { recursive: true });
    await mkdir(path.join(symlinkRoot, "redirected-evidence"));
    await symlink(path.join(symlinkRoot, "redirected-evidence"), symlinkEvidenceDirectory, "dir");
    await assert.rejects(
      verifyStage5Final11EvidenceIndex({ root: symlinkRoot }),
      /evidence root must be a regular directory/u,
    );
  } finally {
    await rm(symlinkRoot, { recursive: true, force: true });
  }

  const verifySource = `const gates = [\n  ["verify:pins", "verify:pins"],\n  ["unit-test", "unit-test"],\n];\n`;
  await mkdir(path.join(root, "tooling/ci"), { recursive: true });
  await writeFile(path.join(root, "tooling/ci/verify.mjs"), verifySource);
  const parsedGates = parseCiVerifyGateLabels(verifySource);
  assert.deepEqual(parsedGates, ["verify:pins", "unit-test"]);
  const completedLog = [
    "=== TravelOS CI gate: verify:pins ===",
    JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        toolchain: { node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" },
      },
      null,
      2,
    ),
    "=== TravelOS CI gate: unit-test ===",
    "gate output",
    JSON.stringify({ schemaVersion: 1, result: "PASS", completed: parsedGates }, null, 2),
    "",
  ].join("\n");
  await writeFile(artifactPath("ci-verify.log"), completedLog);
  await writeFile(
    artifactPath("ci-verify-execution.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: "FINAL-11",
        phase: "FINAL",
        invocationCount: 1,
        result: "PASS",
        exitCode: 0,
        command: "corepack pnpm ci:verify",
        cwd: root,
        nodeExecutable: process.execPath,
        nodeVersion: "v24.19.0",
        corepackVersion: "0.35.0",
        pnpmVersion: "11.21.0",
        startedAtUtc: "2026-10-01T00:00:00.000Z",
        finishedAtUtc: "2026-10-01T00:01:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
  const final = await writeStage5Final11EvidenceIndex({ root, phase: "FINAL" });
  assert.equal(final.result, "PASS");
  assert.equal(final.phase, "FINAL");
  assert.equal(final.ciExecution.completedGates.length, 2);
  assert.deepEqual(final.ciExecution.childToolchainPinReport, {
    nodeVersion: "24.19.0",
    corepackVersion: "0.35.0",
    pnpmVersion: "11.21.0",
  });

  const incorrectPinReport = completedLog.replace('"corepack": "0.35.0"', '"corepack": "0.34.6"');
  await writeFile(artifactPath("ci-verify.log"), incorrectPinReport);
  await assert.rejects(
    verifyStage5Final11CiExecution({ root, phase: "FINAL" }),
    /exact child-gate toolchain pin report/u,
  );

  const incompleteLog = completedLog.replace(
    '"completed": [\n    "verify:pins",\n    "unit-test"\n  ]',
    '"completed": []',
  );
  await writeFile(artifactPath("ci-verify.log"), incompleteLog);
  await assert.rejects(
    verifyStage5Final11CiExecution({ root, phase: "FINAL" }),
    /ordered run of the current gate list/u,
  );

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        expectedArtifactCount: STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length,
        preCiExactDirectory: "PASS",
        missingArtifactRejected: true,
        extraArtifactRejected: true,
        symlinkedEvidenceRootRejected: true,
        mutatedArtifactRejected: true,
        singleFinalCiPassRequired: true,
        gateListBoundToVerifySource: true,
        childGateToolchainReportRequired: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
