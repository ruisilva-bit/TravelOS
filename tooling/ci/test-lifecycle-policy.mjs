import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { evaluateWorkspacePolicy, readEffectiveWorkspacePolicy } from "./workspace-policy.mjs";
import {
  evaluateInstallLifecycleReport,
  lifecyclePolicyRegressionCases,
} from "./install-lifecycle-policy.mjs";

const root = process.cwd();
const outcomes = lifecyclePolicyRegressionCases().map(({ name, expected, report }) => {
  const actual = evaluateInstallLifecycleReport(report).result;
  return { name, expected, actual, passed: actual === expected };
});
if (outcomes.some((outcome) => !outcome.passed)) {
  throw new Error(`Lifecycle evaluator regression failed: ${JSON.stringify(outcomes)}`);
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "travelos-lifecycle-policy-"));
try {
  await mkdir(path.join(temporary, "fixture"));
  await writeFile(
    path.join(temporary, "package.json"),
    `${JSON.stringify(
      {
        name: "travelos-lifecycle-policy-probe",
        version: "1.0.0",
        private: true,
        dependencies: { "synthetic-lifecycle-probe": "file:./fixture" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(temporary, "fixture/package.json"),
    `${JSON.stringify(
      {
        name: "synthetic-lifecycle-probe",
        version: "1.0.0",
        scripts: { postinstall: "node postinstall.mjs" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(temporary, "fixture/postinstall.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(new URL("../executed.marker", import.meta.url), "executed");',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(temporary, "pnpm-workspace.yaml"),
    [
      "packages: []",
      "minimumReleaseAge: 1440",
      "minimumReleaseAgeExclude: []",
      "overrides:",
      "  lodash: 4.18.1",
      "allowBuilds:",
      "  esbuild: true",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(temporary, ".npmrc"),
    ["engine-strict=true", "strict-peer-dependencies=true", "save-exact=true", ""].join("\n"),
  );

  const install = spawnSync("pnpm", ["install", "--reporter=append-only"], {
    cwd: temporary,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const markerExists = await readFile(path.join(temporary, "fixture/executed.marker"), "utf8")
    .then(() => true)
    .catch(() => false);
  const ignored = spawnSync("pnpm", ["ignored-builds"], {
    cwd: temporary,
    encoding: "utf8",
  });
  const unapprovedBlocked =
    install.status !== 0 &&
    markerExists === false &&
    ignored.status === 0 &&
    ignored.stdout.includes("synthetic-lifecycle-probe");
  if (!unapprovedBlocked) {
    throw new Error("pnpm did not block the synthetic unapproved lifecycle dependency");
  }

  await writeFile(
    path.join(temporary, "pnpm-workspace.yaml"),
    [
      "packages: []",
      "minimumReleaseAge: 1440",
      "minimumReleaseAgeExclude: []",
      "overrides:",
      "  lodash: 4.18.1",
      "allowBuilds:",
      "  esbuild: true",
      "  synthetic-lifecycle-probe: true",
      "",
    ].join("\n"),
  );
  const broadenedPolicy = evaluateWorkspacePolicy(await readEffectiveWorkspacePolicy(temporary));
  if (broadenedPolicy.result !== "FAIL" || broadenedPolicy.checks.approvedBuildsExact !== false) {
    throw new Error(
      "Broadened build permission was not rejected by structural policy verification",
    );
  }

  const repositoryPolicy = evaluateWorkspacePolicy(await readEffectiveWorkspacePolicy(root));
  if (repositoryPolicy.result !== "PASS") {
    throw new Error(`Repository workspace policy failed: ${JSON.stringify(repositoryPolicy)}`);
  }

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        evaluatorCases: outcomes,
        packageManagerProbe: {
          syntheticDependency: true,
          installExitWasNonZero: install.status !== 0,
          lifecycleMarkerAbsent: markerExists === false,
          ignoredBuildReported: ignored.stdout.includes("synthetic-lifecycle-probe"),
          unapprovedLifecycleBlocked: true,
        },
        broadenedPermissionProbe: {
          policyResult: broadenedPolicy.result,
          approvedBuildsExact: broadenedPolicy.checks.approvedBuildsExact,
          rejected: true,
        },
        repositoryPolicy: {
          result: repositoryPolicy.result,
          checks: repositoryPolicy.checks,
        },
        syntheticFixturesOnly: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
