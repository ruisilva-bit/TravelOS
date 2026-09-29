import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE_3_CORRECTION_EVIDENCE_ARTIFACT_NAMES,
  STAGE_3_EVIDENCE_DIRECTORY,
} from "./stage-3-evidence-contract.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(repositoryRoot, STAGE_3_EVIDENCE_DIRECTORY);
const focusedDirectory = path.join(repositoryRoot, "docs/evidence/phase-1-m1/stage-3-focused");
const historicalFreezePath = path.join(
  repositoryRoot,
  "docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_FREEZE.md",
);
const historicalFreezeSha256 = "466693ee8b1ee7a6e36dd630f4484da66c4af0154c5a913ce421f52f4a6fa388";
const historicalFreezeBytes = 41_784;
const expectedCiGates = [
  "protected-baseline:pre",
  "verify:pins",
  "db:migrations:verify",
  "test:lifecycle-policy",
  "format:check",
  "lint",
  "typecheck",
  "architecture:check",
  "test:unit",
  "config:schema:check",
  "stage3:corrections:verify",
  "test:freeze-inputs",
  "test:security-scanner",
  "test:rejected-technologies",
  "verify:rejected-technologies",
  "security:scan:source",
  "build",
  "test:smoke",
  "security:scan:bundles",
  "protected-baseline:post",
];
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const writeJson = async (name, value) =>
  writeFile(path.join(evidenceDirectory, name), `${JSON.stringify(value, null, 2)}\n`);

const historicalFreeze = await readFile(historicalFreezePath);
assert.equal(historicalFreeze.length, historicalFreezeBytes);
assert.equal(sha256(historicalFreeze), historicalFreezeSha256);
const historicalRows = [
  ...historicalFreeze
    .toString("utf8")
    .matchAll(/^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([a-f0-9]{64})`\s*\|$/gm),
].map((match) => ({ path: match[1], bytes: Number(match[2]), sha256: match[3] }));
const historicalEvidenceRows = historicalRows.filter(
  (entry) =>
    entry.path.startsWith(`${STAGE_3_EVIDENCE_DIRECTORY}/`) &&
    !entry.path.endsWith("/EVIDENCE_INDEX.json"),
);
assert.equal(historicalEvidenceRows.length, 26);
for (const entry of historicalEvidenceRows) {
  const bytes = await readFile(path.join(repositoryRoot, entry.path));
  assert.equal(bytes.length, entry.bytes, `Historical evidence byte mismatch: ${entry.path}`);
  assert.equal(sha256(bytes), entry.sha256, `Historical evidence hash mismatch: ${entry.path}`);
}

for (const name of [...STAGE_3_CORRECTION_EVIDENCE_ARTIFACT_NAMES, "EVIDENCE_INDEX.json"]) {
  await rm(path.join(evidenceDirectory, name), { force: true });
}

const ciLogArgument = process.argv.find((argument) => argument.startsWith("--ci-log="));
assert(ciLogArgument, "Expected --ci-log=/absolute/path/to/final-ci.log");
const ciLogSource = ciLogArgument.slice("--ci-log=".length);
assert(path.isAbsolute(ciLogSource), "Final CI log path must be absolute");
const ciLog = await readFile(ciLogSource);
const ciLogText = ciLog.toString("utf8");
const observedCiGates = [...ciLogText.matchAll(/^=== TravelOS CI gate: ([^=]+?) ===$/gm)].map(
  (match) => match[1],
);
assert.deepEqual(observedCiGates, expectedCiGates);
const completionMarkerStart = ciLogText.lastIndexOf(
  '{\n  "schemaVersion": 1,\n  "result": "PASS",\n  "completed": [',
);
assert.notEqual(completionMarkerStart, -1, "Final CI completion marker is absent");
const completionMarkerEnd = ciLogText.indexOf("\n}\n", completionMarkerStart);
assert.notEqual(completionMarkerEnd, -1, "Final CI completion marker is incomplete");
const completionMarker = JSON.parse(
  ciLogText.slice(completionMarkerStart, completionMarkerEnd + 2),
);
assert.deepEqual(completionMarker.completed, expectedCiGates);
assert.match(ciLogText, /"node": "24\.19\.0"/);
assert.match(ciLogText, /"corepack": "0\.35\.0"/);
assert.match(ciLogText, /"pnpm": "11\.21\.0"/);
await copyFile(ciLogSource, path.join(evidenceDirectory, "correction-ci-verify.log"));
await writeJson("correction-ci-verify.json", {
  schemaVersion: 1,
  result: "PASS",
  command: "pnpm run ci:verify",
  exitCode: 0,
  toolchain: { node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" },
  completedGateCount: expectedCiGates.length,
  completedGates: expectedCiGates,
  phase0ProtectedBaseline: { pre: "PASS — 40/40", post: "PASS — 40/40" },
  log: { bytes: ciLog.length, sha256: sha256(ciLog) },
  ctQualificationRepeated: false,
  stage4Actions: 0,
});

const correctionVerification = spawnSync(
  path.join(repositoryRoot, "node_modules/.bin/tsx"),
  ["tooling/database/verify-stage-3-corrections.ts"],
  { cwd: repositoryRoot, encoding: "utf8" },
);
assert.equal(correctionVerification.status, 0, correctionVerification.stderr);
const correctionReport = JSON.parse(correctionVerification.stdout);
assert.equal(correctionReport.result, "PASS");
assert.equal(correctionReport.stage4Actions, 0);
for (const findingId of ["TOS-S3-001", "TOS-S3-002"]) {
  assert.equal(
    correctionReport.findings[findingId].status,
    "CORRECTED — PENDING INDEPENDENT CLOSURE",
  );
}
const correctionOutput = Buffer.from(correctionVerification.stdout);
await writeJson("correction-tos-s3-001.json", {
  schemaVersion: 1,
  result: "PASS",
  findingId: "TOS-S3-001",
  severity: "HIGH",
  status: correctionReport.findings["TOS-S3-001"].status,
  sourceVerification: {
    command: "tsx tooling/database/verify-stage-3-corrections.ts",
    exitCode: correctionVerification.status,
    stdoutBytes: correctionOutput.length,
    stdoutSha256: sha256(correctionOutput),
  },
  proof: correctionReport.findings["TOS-S3-001"],
  stage4Actions: 0,
});

const focusedRoleTopology = await readJson(path.join(focusedDirectory, "role-topology.json"));
const focusedIntegrationExecution = await readJson(
  path.join(focusedDirectory, "integration-test-execution.json"),
);
const focusedCtRoleTopology = await readJson(
  path.join(focusedDirectory, "ct-200-focused-role-topology.json"),
);
const focusedCtAccessCleanup = await readJson(
  path.join(focusedDirectory, "ct-200-focused-access-cleanup.json"),
);
assert.equal(focusedRoleTopology.result, "PASS");
assert.equal(focusedIntegrationExecution.result, "PASS");
assert.equal(focusedCtRoleTopology.result, "PASS");
assert.equal(focusedCtRoleTopology.exactGraph.actualCount, 4);
assert.deepEqual(focusedCtRoleTopology.exactGraph.missing, []);
assert.deepEqual(focusedCtRoleTopology.exactGraph.unexpected, []);
assert.deepEqual(focusedCtRoleTopology.exactGraph.duplicateActual, []);
assert.equal(focusedCtAccessCleanup.result, "PASS");
await copyFile(
  path.join(focusedDirectory, "ct-200-focused-role-topology.json"),
  path.join(evidenceDirectory, "ct-200-focused-role-topology.json"),
);
await copyFile(
  path.join(focusedDirectory, "ct-200-focused-access-cleanup.json"),
  path.join(evidenceDirectory, "ct-200-focused-access-cleanup.json"),
);
await writeJson("correction-tos-s3-002.json", {
  schemaVersion: 1,
  result: "PASS",
  findingId: "TOS-S3-002",
  severity: "MEDIUM",
  status: correctionReport.findings["TOS-S3-002"].status,
  sourceVerification: {
    command: "tsx tooling/database/verify-stage-3-corrections.ts",
    exitCode: correctionVerification.status,
    stdoutBytes: correctionOutput.length,
    stdoutSha256: sha256(correctionOutput),
  },
  proof: correctionReport.findings["TOS-S3-002"],
  focusedDisposableProof: {
    integrationExecution: focusedIntegrationExecution,
    membershipVerification: focusedRoleTopology.membershipVerification,
    adversarialMembershipVerification: focusedRoleTopology.adversarialMembershipVerification,
  },
  focusedCtProof: {
    query: focusedCtRoleTopology.query,
    exactGraph: focusedCtRoleTopology.exactGraph,
    repeatedQualificationWork: focusedCtRoleTopology.repeatedQualificationWork,
    accessCleanup: "PASS",
  },
  stage4Actions: 0,
});

const preIndexScan = spawnSync(
  process.execPath,
  ["tooling/ci/scan-source-secrets.mjs", "--stage3-pre-index"],
  { cwd: repositoryRoot, encoding: "utf8" },
);
assert.equal(preIndexScan.status, 0, preIndexScan.stderr);
const preIndexScanReport = JSON.parse(preIndexScan.stdout);
assert.equal(preIndexScanReport.result, "PASS");
assert.equal(preIndexScanReport.findings.length, 0);
assert.equal(preIndexScanReport.matchedValuesEmitted, false);
await writeJson("correction-sensitive-data-pre-index.json", preIndexScanReport);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      historicalRejectedFreeze: {
        bytes: historicalFreeze.length,
        sha256: sha256(historicalFreeze),
        retainedEvidenceArtifactsVerified: historicalEvidenceRows.length,
      },
      correctionVerification: {
        result: correctionReport.result,
        findings: Object.keys(correctionReport.findings),
      },
      focusedCtRoleGraph: focusedCtRoleTopology.exactGraph,
      focusedAccessCleanup: focusedCtAccessCleanup.result,
      finalCi: {
        result: completionMarker.result,
        completedGateCount: completionMarker.completed.length,
        logBytes: ciLog.length,
        logSha256: sha256(ciLog),
      },
      preIndexSensitiveDataScan: {
        result: preIndexScanReport.result,
        findings: preIndexScanReport.findings.length,
      },
      stage4Actions: 0,
    },
    null,
    2,
  ),
);
