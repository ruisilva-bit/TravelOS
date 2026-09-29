import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.resolve(
  process.env["TRAVELOS_STAGE3_EVIDENCE_DIR"] ??
    path.join(repositoryRoot, "docs/evidence/phase-1-m1/stage-3"),
);
const corepack = path.join(path.dirname(process.execPath), "corepack");
const run = (command, args, environment = process.env) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    env: environment,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
};
const requirePass = (label, execution) => {
  if (execution.exitCode !== 0) {
    process.stdout.write(execution.stdout);
    process.stderr.write(execution.stderr);
    throw new Error(`${label} failed with exit code ${execution.exitCode}`);
  }
  return execution;
};

const disposable = requirePass(
  "Disposable PostgreSQL Stage 3 qualification",
  run(process.execPath, ["tooling/database/run-stage-3-disposable.mjs"], {
    ...process.env,
    TRAVELOS_STAGE3_EVIDENCE_DIR: evidenceDirectory,
  }),
);
process.stdout.write(disposable.stdout);
process.stderr.write(disposable.stderr);

await mkdir(evidenceDirectory, { recursive: true });
const regression = run(corepack, ["pnpm", "run", "ci:verify"]);
await writeFile(
  path.join(evidenceDirectory, "stage-2-regression.log"),
  `${regression.stdout}${regression.stderr}`,
);
await writeFile(
  path.join(evidenceDirectory, "stage-2-regression.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      result: regression.exitCode === 0 ? "PASS" : "FAIL",
      command: "pnpm run ci:verify",
      exitCode: regression.exitCode,
      logSha256: createHash("sha256")
        .update(`${regression.stdout}${regression.stderr}`)
        .digest("hex"),
      requiredCoverage: [
        "protected baseline pre/post",
        "dependency and pin policy",
        "migration checksums",
        "format and lint",
        "typecheck",
        "architecture and dependency universe",
        "backend-core vendor independence",
        "Portal package isolation",
        "configuration schema drift",
        "rejected technology scan",
        "sensitive-data scans",
        "unit tests",
        "build and smoke",
      ],
      ct200Actions: 0,
      stage4Executed: false,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(regression.stdout);
process.stderr.write(regression.stderr);
requirePass("Stage 2 regression and repository quality gates", regression);

const indexExecution = requirePass(
  "Stage 3 evidence index",
  run(process.execPath, ["tooling/database/build-stage-3-evidence-index.mjs"], {
    ...process.env,
    TRAVELOS_STAGE3_EVIDENCE_DIR: evidenceDirectory,
  }),
);
const indexResult = JSON.parse(indexExecution.stdout.trim());

const postIndexScan = requirePass(
  "Post-index source sensitive-data scan",
  run(process.execPath, ["tooling/ci/scan-source-secrets.mjs", "--stage3-final"]),
);
process.stdout.write(postIndexScan.stdout);
process.stderr.write(postIndexScan.stderr);
const postIndexScanResult = JSON.parse(postIndexScan.stdout.trim());
if (
  postIndexScanResult.result !== "PASS" ||
  postIndexScanResult.findings?.length !== 0 ||
  postIndexScanResult.matchedValuesEmitted !== false ||
  postIndexScanResult.stage3EvidenceIndexIncluded !== true ||
  postIndexScanResult.coverage?.stage3Evidence !== indexResult.artifactCount + 1
) {
  throw new Error("Post-index sensitive-data scan did not cover the complete Stage 3 evidence set");
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      readiness: "READY FOR CONTROLLED CT 200 STAGE 3 INSTALLATION",
      evidence: indexResult,
      postIndexSensitiveDataScan: {
        result: "PASS",
        filesScanned: postIndexScanResult.filesScanned,
        findings: postIndexScanResult.findings.length,
        matchedValuesEmitted: postIndexScanResult.matchedValuesEmitted,
        stage3EvidenceFilesScanned: postIndexScanResult.coverage.stage3Evidence,
        stage3EvidenceIndexIncluded: postIndexScanResult.stage3EvidenceIndexIncluded,
      },
      ct200Actions: 0,
      stage4Executed: false,
    },
    null,
    2,
  )}\n`,
);
