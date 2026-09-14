import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateInstallLifecycleReport,
  lifecyclePolicyRegressionCases,
} from "./install-lifecycle-policy.mjs";

const root = process.cwd();
const outputDirectory = path.join(root, "docs/evidence/phase-1-m1/stage-2");
const frozenInstallInput =
  process.env.TRAVELOS_FROZEN_INSTALL_EVIDENCE ?? "/tmp/travelos-stage2-frozen-install-result.json";
const redaction =
  "Bounded evidence only. No credentials, tokens, cookies, environment values, temporary secrets, dependency caches, node_modules, or dist contents are stored.";
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const commandVersion = (command, args = ["--version"]) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} version check failed`);
  return result.stdout.trim();
};
const toolVersions = {
  node: process.version.slice(1),
  corepack: commandVersion("corepack"),
  pnpm: commandVersion("pnpm"),
};
if (
  toolVersions.node !== "24.19.0" ||
  toolVersions.corepack !== "0.35.0" ||
  toolVersions.pnpm !== "11.21.0"
) {
  throw new Error(`Unexpected toolchain: ${JSON.stringify(toolVersions)}`);
}

if (process.argv.includes("--self-test-install-lifecycle-policy")) {
  const outcomes = lifecyclePolicyRegressionCases().map(({ name, expected, report }) => ({
    name,
    expected,
    actual: evaluateInstallLifecycleReport(report).result,
  }));
  if (outcomes.some(({ actual, expected }) => actual !== expected)) {
    throw new Error(`Install lifecycle policy self-test failed: ${JSON.stringify(outcomes)}`);
  }
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      result: "PASS",
      acceptedCases: outcomes.filter(({ actual }) => actual === "PASS").length,
      rejectedCases: outcomes.filter(({ actual }) => actual === "FAIL").length,
      outcomes,
    }),
  );
  process.exit(0);
}

const run = (command, args, expectedExitCodes = [0]) => {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const exitCode = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (!expectedExitCodes.includes(exitCode)) {
    const bounded = `${stdout}\n${stderr}`.slice(-4_000);
    throw new Error(`${command} ${args.join(" ")} exited ${exitCode}:\n${bounded}`);
  }
  return {
    startedAt,
    finishedAt,
    exitCode,
    stdout,
    stderr,
    outputBytes: Buffer.byteLength(stdout) + Buffer.byteLength(stderr),
    outputSha256: sha256(`${stdout}\n${stderr}`),
  };
};

const parseJsonSuffix = (text) => {
  for (let index = text.lastIndexOf("{"); index >= 0; index = text.lastIndexOf("{", index - 1)) {
    try {
      return JSON.parse(text.slice(index).trim());
    } catch {
      // Continue until the start of the final complete JSON object is found.
    }
  }
  throw new Error("Command output did not end with a JSON object");
};

const artifacts = [];
const writeEvidence = async ({ fileName, evidenceId, command, execution, details, timestamp }) => {
  const document = {
    schemaVersion: 1,
    evidenceId,
    timestamp: timestamp ?? execution?.finishedAt ?? new Date().toISOString(),
    command,
    toolVersions,
    exitCode: execution?.exitCode ?? 0,
    result: "PASS",
    execution:
      execution === undefined
        ? null
        : {
            startedAt: execution.startedAt,
            finishedAt: execution.finishedAt,
            outputBytes: execution.outputBytes,
            outputSha256: execution.outputSha256,
          },
    details,
    redaction,
  };
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const filePath = path.join(outputDirectory, fileName);
  await writeFile(filePath, serialized, "utf8");
  artifacts.push({ evidenceId, fileName, result: "PASS" });
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const protectedExecution = run("node", ["tooling/ci/verify-protected-baseline.mjs"]);
const protectedReport = parseJsonSuffix(protectedExecution.stdout);
if (
  protectedReport.result !== "PASS" ||
  protectedReport.protectedFiles?.matchingCount !== 40 ||
  protectedReport.protectedFiles?.mismatches?.length !== 0
) {
  throw new Error("Protected baseline evidence is not 40/40 PASS");
}
await writeEvidence({
  fileName: "protected-baseline.json",
  evidenceId: "TOS-S2-EV-001",
  command: "node tooling/ci/verify-protected-baseline.mjs",
  execution: protectedExecution,
  details: protectedReport,
});

const formatExecution = run("pnpm", ["run", "format:check"]);
const formatterLine = formatExecution.stdout
  .split(/\r?\n/)
  .find((line) => line.includes('"mode":"--check"'));
if (formatterLine === undefined) throw new Error("Formatter safety summary is missing");
const formatterReport = JSON.parse(formatterLine);
if (
  formatterReport.result !== "PASS" ||
  formatterReport.protectedOverlap?.length !== 0 ||
  formatterReport.protectedBaselineFiles !== 40
) {
  throw new Error("Formatter safety evidence is not PASS");
}
await writeEvidence({
  fileName: "formatter-safety.json",
  evidenceId: "TOS-S2-EV-002",
  command: "pnpm run format:check",
  execution: formatExecution,
  details: formatterReport,
});

const frozenInstallReport = JSON.parse(await readFile(frozenInstallInput, "utf8"));
const currentLockfileSha256 = sha256(await readFile(path.join(root, "pnpm-lock.yaml")));
const frozenInstallLifecycle = evaluateInstallLifecycleReport(frozenInstallReport);
const structuralPolicyChecks = frozenInstallReport.exactPinVerification?.policies?.structuralChecks;
if (
  frozenInstallReport.result !== "PASS" ||
  frozenInstallReport.generator !== "tooling/ci/run-clean-frozen-install.mjs" ||
  frozenInstallReport.exitCode !== 0 ||
  frozenInstallReport.command !== "bash tooling/ci/install.sh --reporter=append-only" ||
  frozenInstallReport.effectiveRequiredFlags?.join("\n") !==
    ["--frozen-lockfile", "--strict-peer-dependencies"].join("\n") ||
  frozenInstallReport.toolVersions?.node !== toolVersions.node ||
  frozenInstallReport.toolVersions?.corepack !== toolVersions.corepack ||
  frozenInstallReport.toolVersions?.pnpm !== toolVersions.pnpm ||
  frozenInstallReport.workspaceProjectCount !== 15 ||
  frozenInstallReport.installedPackageCount !== 561 ||
  frozenInstallReport.lockfile?.sha256After !== currentLockfileSha256 ||
  frozenInstallReport.lockfile?.unchanged !== true ||
  frozenInstallReport.ignoredBuilds?.none !== true ||
  frozenInstallLifecycle.result !== "PASS" ||
  frozenInstallReport.lifecyclePolicy?.result !== "PASS" ||
  structuralPolicyChecks === undefined ||
  Object.keys(structuralPolicyChecks).length !== 6 ||
  !Object.values(structuralPolicyChecks).every(Boolean)
) {
  throw new Error("Frozen-install evidence does not match the final candidate");
}
await writeEvidence({
  fileName: "clean-frozen-install.json",
  evidenceId: "TOS-S2-EV-003",
  command: frozenInstallReport.command,
  details: {
    ...frozenInstallReport,
    independentlyReevaluatedLifecyclePolicy: frozenInstallLifecycle,
  },
  timestamp: frozenInstallReport.timestamp,
});

const pinsExecution = run("node", ["tooling/ci/verify-pins.mjs"]);
const pinsReport = parseJsonSuffix(pinsExecution.stdout);
if (pinsReport.result !== "PASS" || pinsReport.directPins?.count !== 46) {
  throw new Error("Exact pin verification did not pass");
}
await writeEvidence({
  fileName: "exact-pins.json",
  evidenceId: "TOS-S2-EV-004",
  command: "node tooling/ci/verify-pins.mjs",
  execution: pinsExecution,
  details: pinsReport,
});

const lifecyclePolicyExecution = run("pnpm", ["run", "test:lifecycle-policy"]);
const lifecyclePolicyReport = parseJsonSuffix(lifecyclePolicyExecution.stdout);
if (
  lifecyclePolicyReport.result !== "PASS" ||
  lifecyclePolicyReport.evaluatorCases?.length !== 6 ||
  lifecyclePolicyReport.evaluatorCases.some(({ passed }) => passed !== true) ||
  lifecyclePolicyReport.packageManagerProbe?.lifecycleMarkerAbsent !== true ||
  lifecyclePolicyReport.packageManagerProbe?.unapprovedLifecycleBlocked !== true ||
  lifecyclePolicyReport.packageManagerProbe?.ignoredBuildReported !== true ||
  lifecyclePolicyReport.broadenedPermissionProbe?.rejected !== true ||
  lifecyclePolicyReport.repositoryPolicy?.result !== "PASS"
) {
  throw new Error("Corrected lifecycle policy regression evidence did not pass");
}
await writeEvidence({
  fileName: "correction-tos-s2-002-lifecycle-policy.json",
  evidenceId: "TOS-S2-EV-021",
  command: "pnpm run test:lifecycle-policy",
  execution: lifecyclePolicyExecution,
  details: {
    finding: "TOS-S2-002",
    status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
    effectiveStructuredPolicy: pinsReport.policies,
    cleanInstallLifecycle: frozenInstallLifecycle,
    cleanInstallScriptsObserved: frozenInstallReport.installScriptsObserved,
    cleanInstallIgnoredBuilds: frozenInstallReport.ignoredBuilds,
    regression: lifecyclePolicyReport,
  },
});

const freezeInputsExecution = run("pnpm", ["run", "test:freeze-inputs"]);
const freezeInputsReport = parseJsonSuffix(freezeInputsExecution.stdout);
if (
  freezeInputsReport.result !== "PASS" ||
  freezeInputsReport.finalFreezeCreated !== false ||
  freezeInputsReport.deterministicRepeatedCollection !== true ||
  !Number.isInteger(freezeInputsReport.collectedInputs) ||
  freezeInputsReport.collectedInputs <= 200 ||
  !Number.isInteger(freezeInputsReport.completenessRequirements) ||
  freezeInputsReport.completenessRequirements <= 0 ||
  freezeInputsReport.omissionProbe?.result !== "REJECTED_AS_EXPECTED"
) {
  throw new Error("Corrected freeze-input collector evidence did not pass");
}
await writeEvidence({
  fileName: "correction-tos-s2-003-freeze-self-containment.json",
  evidenceId: "TOS-S2-EV-022",
  command: "pnpm run test:freeze-inputs",
  execution: freezeInputsExecution,
  details: {
    finding: "TOS-S2-003",
    status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
    ...freezeInputsReport,
    finalCorrectedValidationIncludedByCollectorWhenPresent: true,
    mutableExternalReviewInputRequired: false,
  },
});

const scannerRegressionExecution = run("pnpm", ["run", "test:security-scanner"]);
const scannerRegressionReport = parseJsonSuffix(scannerRegressionExecution.stdout);
if (
  scannerRegressionReport.result !== "PASS" ||
  scannerRegressionReport.syntheticSentinelFixtures !== 6 ||
  scannerRegressionReport.outcomes?.some(({ result }) => result !== "REJECTED_AS_EXPECTED") ||
  scannerRegressionReport.generatedBrowserAsset !== "REJECTED_AS_EXPECTED" ||
  scannerRegressionReport.explicitSafeFixtureAllowlist !== "PASS" ||
  scannerRegressionReport.matchedValuesEmitted !== false
) {
  throw new Error("Corrected sensitive-data scanner regression evidence did not pass");
}
await writeEvidence({
  fileName: "correction-tos-s2-004-sensitive-data-scanner.json",
  evidenceId: "TOS-S2-EV-023",
  command: "pnpm run test:security-scanner",
  execution: scannerRegressionExecution,
  details: {
    finding: "TOS-S2-004",
    status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
    ...scannerRegressionReport,
    finalSourceEvidence: "TOS-S2-EV-013",
    finalBrowserBundleEvidence: "TOS-S2-EV-016",
    finalPostIndexScanRequired: true,
  },
});

const lintExecution = run("pnpm", ["run", "lint"]);
await writeEvidence({
  fileName: "lint.json",
  evidenceId: "TOS-S2-EV-005",
  command: "pnpm run lint",
  execution: lintExecution,
  details: { errors: 0, warnings: 0 },
});

const typecheckExecution = run("pnpm", ["run", "typecheck"]);
await writeEvidence({
  fileName: "typecheck.json",
  evidenceId: "TOS-S2-EV-006",
  command: "pnpm run typecheck",
  execution: typecheckExecution,
  details: { compilerProjectsChecked: 2, errors: 0 },
});

const architectureExecution = run("node", ["tooling/architecture/check.mjs"]);
const architectureReport = parseJsonSuffix(architectureExecution.stdout);
if (
  architectureReport.result !== "PASS" ||
  architectureReport.productionGraph?.cycles !== 0 ||
  architectureReport.productionGraph?.violations !== 0
) {
  throw new Error("Production architecture graph did not pass");
}
await writeEvidence({
  fileName: "architecture-production-graph.json",
  evidenceId: "TOS-S2-EV-007",
  command: "node tooling/architecture/check.mjs",
  execution: architectureExecution,
  details: architectureReport.productionGraph,
});

const expectedArchitectureFixtures = [
  "backend-better-auth-static",
  "backend-better-auth-deep",
  "backend-qualified-auth-alias",
  "backend-design-system-indirect-react",
  "backend-computed-dynamic-import",
  "backend-computed-require",
  "portal-admin-contract-inversion",
  "backend-manifest-better-auth",
  "backend-manifest-design-system",
];
const layeredArchitectureFixtures = architectureReport.layeredBoundaryFixtures;
const actualArchitectureFixtures =
  layeredArchitectureFixtures?.outcomes?.map(({ fixture }) => fixture).sort() ?? [];
const sourceDiscovery = architectureReport.sourceDiscovery;
const sourceDiscoveryFixtures = architectureReport.sourceDiscoveryFixtures;
const dependencyUniverse = architectureReport.dependencyUniverse;
const dependencyUniverseFixtures = architectureReport.dependencyUniverseFixtures;
const expectedDependencyUniverseFixtures = [
  "backend-implicit-react-jsx-runtime",
  "backend-jsx-import-source-next",
  "backend-aliased-require",
  "backend-aliased-require-resolve",
  "backend-aliased-create-require-loader",
  "backend-better-auth-module-augmentation",
  "backend-next-type-reference",
  "backend-next-module-augmentation",
  "admin-web-allowed-react-jsx-runtime",
  "auth-adapter-allowed-type-reference",
  "auth-adapter-allowed-module-augmentation",
  "backend-safe-local-ambient-declaration",
];
const actualDependencyUniverseFixtures =
  dependencyUniverseFixtures?.outcomes?.map(({ fixture }) => fixture).sort() ?? [];
const expectedCssAssetDependencies = [
  "apps/admin-web/src/main.tsx\0@travelos/design-system/styles.css",
  "apps/portal-web/src/main.tsx\0@travelos/design-system/styles.css",
];
const actualCssAssetDependencies =
  architectureReport.nonTypeScriptAssetDependencies
    ?.map(({ file, specifier }) => `${file}\0${specifier}`)
    .sort() ?? [];
const expectedSourceDiscoveryArchitectureFixtures = [
  "backend-mts-better-auth",
  "backend-cts-better-auth",
  "backend-declaration-type-better-auth",
  "backend-safe-ordinary-ts",
  "backend-safe-mts",
  "backend-safe-cts",
];
const actualSourceDiscoveryArchitectureFixtures =
  sourceDiscoveryFixtures?.architecture?.outcomes?.map(({ fixture }) => fixture).sort() ?? [];
if (
  architectureReport.packageBoundaries?.result !== "PASS" ||
  architectureReport.packageBoundaries?.unitsChecked !== 14 ||
  architectureReport.packageBoundaries?.sourceFilesChecked <= 0 ||
  architectureReport.packageBoundaries?.moduleRequestsChecked <= 0 ||
  sourceDiscovery?.result !== "PASS" ||
  sourceDiscovery?.compilerResolvedProductionSourceCount <= 0 ||
  sourceDiscovery?.policyInspectedProductionSourceCount <= 0 ||
  sourceDiscovery?.uncoveredProductionSourceCount !== 0 ||
  sourceDiscovery?.unsupportedCompilerResolvedProductionFiles?.length !== 0 ||
  dependencyUniverse?.result !== "PASS" ||
  dependencyUniverse?.compilerDiagnosticCount !== 0 ||
  dependencyUniverse?.compilerProductionSourceCount !==
    dependencyUniverse?.policyProductionSourceCount ||
  dependencyUniverse?.uncoveredProductionSourceCount !== 0 ||
  dependencyUniverse?.unexplainedCompilerDependencyReferenceCount !== 0 ||
  dependencyUniverse?.unsupportedDependencyConstructCount !== 0 ||
  dependencyUniverse?.unresolvedNormalizedDependencyCount !== 0 ||
  dependencyUniverse?.nonTypeScriptAssetDependencyCount !== 2 ||
  JSON.stringify(actualCssAssetDependencies) !== JSON.stringify(expectedCssAssetDependencies) ||
  dependencyUniverseFixtures?.result !== "PASS" ||
  dependencyUniverseFixtures?.fixtureCount !== expectedDependencyUniverseFixtures.length ||
  dependencyUniverseFixtures?.rejectedArchitectureFixtures !== 8 ||
  dependencyUniverseFixtures?.acceptedArchitectureFixtures !== 4 ||
  dependencyUniverseFixtures?.semanticRejectedTechnologyFixtures !== 3 ||
  dependencyUniverseFixtures?.aliasFailClosedFixtures !== 3 ||
  dependencyUniverseFixtures?.unexpectedCompilerParserOrResolutionFailures !== 0 ||
  JSON.stringify(actualDependencyUniverseFixtures) !==
    JSON.stringify([...expectedDependencyUniverseFixtures].sort()) ||
  dependencyUniverseFixtures.outcomes.some(
    ({ compilerIncluded, policyInspected, compilerDiagnostics, result }) =>
      compilerIncluded !== true ||
      policyInspected !== true ||
      compilerDiagnostics !== 0 ||
      !["PASS", "REJECTED_AS_EXPECTED"].includes(result),
  ) ||
  sourceDiscoveryFixtures?.result !== "PASS" ||
  sourceDiscoveryFixtures?.architecture?.fixtureCount !==
    expectedSourceDiscoveryArchitectureFixtures.length ||
  sourceDiscoveryFixtures?.architecture?.rejectedFixtures !== 3 ||
  sourceDiscoveryFixtures?.architecture?.acceptedFixtures !== 3 ||
  sourceDiscoveryFixtures?.unexpectedOrUnresolvedFailures !== 0 ||
  JSON.stringify(actualSourceDiscoveryArchitectureFixtures) !==
    JSON.stringify([...expectedSourceDiscoveryArchitectureFixtures].sort()) ||
  sourceDiscoveryFixtures.architecture.outcomes.some(
    ({ compilerIncluded, policyInspected, compilerDiagnostics, result, moduleResolved }) =>
      compilerIncluded !== true ||
      policyInspected !== true ||
      compilerDiagnostics !== 0 ||
      !["PASS", "REJECTED_AS_EXPECTED"].includes(result) ||
      (result === "REJECTED_AS_EXPECTED" && moduleResolved !== true),
  ) ||
  layeredArchitectureFixtures?.result !== "PASS" ||
  layeredArchitectureFixtures?.fixtureCount !== expectedArchitectureFixtures.length ||
  layeredArchitectureFixtures?.unexpectedOrUnresolvedFailures !== 0 ||
  JSON.stringify(actualArchitectureFixtures) !==
    JSON.stringify([...expectedArchitectureFixtures].sort()) ||
  layeredArchitectureFixtures.outcomes.some(
    ({ processExitCode, violationCount, unresolvedLiteralImports }) =>
      processExitCode !== 1 || violationCount !== 1 || unresolvedLiteralImports !== 0,
  )
) {
  throw new Error("Corrected architecture boundary and fixture evidence did not pass");
}
await writeEvidence({
  fileName: "correction-tos-s2-001-architecture-boundaries.json",
  evidenceId: "TOS-S2-EV-020",
  command: "node tooling/architecture/check.mjs",
  execution: architectureExecution,
  details: {
    finding: "TOS-S2-001",
    status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
    productionGraph: architectureReport.productionGraph,
    capabilityOrientedBoundaryPolicy: architectureReport.packageBoundaries,
    authoritativeProductionSourceDiscovery: sourceDiscovery,
    normalizedDependencyUniverse: dependencyUniverse,
    nonTypeScriptAssetDependencies: architectureReport.nonTypeScriptAssetDependencies,
    legacyPortalFixture: architectureReport.negativePortalFixture,
    adversarialFixtures: layeredArchitectureFixtures,
    sourceDiscoveryAdversarialFixtures: sourceDiscoveryFixtures.architecture,
    dependencyUniverseAdversarialFixtures: dependencyUniverseFixtures,
    requiredProofs: {
      directBetterAuthImportRejection: "backend-better-auth-static",
      betterAuthDeepSubpathRejection: "backend-better-auth-deep",
      backendDesignSystemReactFirstEdgeRejection: "backend-design-system-indirect-react",
      computedImportRejection: "backend-computed-dynamic-import",
      computedRequireRejection: "backend-computed-require",
      portalAdminContractRejection: "portal-admin-contract-inversion",
      compilerResolvedMtsRejection: "backend-mts-better-auth",
      compilerResolvedCtsRejection: "backend-cts-better-auth",
      compilerResolvedDeclarationTypeImportRejection: "backend-declaration-type-better-auth",
      compilerVsPolicySourceSetConsistency: {
        compilerResolvedProductionSourceCount:
          sourceDiscovery.compilerResolvedProductionSourceCount,
        policyInspectedProductionSourceCount: sourceDiscovery.policyInspectedProductionSourceCount,
        uncoveredProductionSourceCount: sourceDiscovery.uncoveredProductionSourceCount,
      },
      compilerVsNormalizedDependencyConsistency: {
        compilerKnownArchitecturalDependencyCount:
          dependencyUniverse.compilerKnownArchitecturalDependencyCount,
        normalizedPolicyDependencyCount: dependencyUniverse.normalizedPolicyDependencyCount,
        unexplainedCompilerDependencyReferenceCount:
          dependencyUniverse.unexplainedCompilerDependencyReferenceCount,
        unsupportedDependencyConstructCount: dependencyUniverse.unsupportedDependencyConstructCount,
      },
      implicitJsxRuntimeRejection: dependencyUniverseFixtures.requiredProofs.implicitJsxRuntime,
      jsxImportSourceRejection: dependencyUniverseFixtures.requiredProofs.jsxImportSource,
      aliasedRequireFailClosed: dependencyUniverseFixtures.requiredProofs.aliasedRequire,
      aliasedRequireResolveFailClosed:
        dependencyUniverseFixtures.requiredProofs.aliasedRequireResolve,
      aliasedCreateRequireLoaderFailClosed:
        dependencyUniverseFixtures.requiredProofs.aliasedCreateRequireLoader,
      externalModuleAugmentationRejection:
        dependencyUniverseFixtures.requiredProofs.externalModuleAugmentation,
      tripleReferenceTypeRejection: dependencyUniverseFixtures.requiredProofs.tripleReferenceTypes,
      forbiddenManifestDependencyRejections: [
        "backend-manifest-better-auth",
        "backend-manifest-design-system",
      ],
    },
  },
});

const negativeExecution = run("node", ["tooling/architecture/reject-negative-fixture.mjs"], [1]);
const negativeReport = parseJsonSuffix(negativeExecution.stdout);
if (
  negativeReport.result !== "REJECTED_AS_EXPECTED" ||
  negativeExecution.exitCode !== 1 ||
  negativeReport.violation?.rule !== "portal-fixture-cannot-import-backend-core" ||
  negativeReport.unexpectedViolationCount !== 0
) {
  throw new Error("Invalid Portal fixture was not rejected by the intended rule");
}
await writeEvidence({
  fileName: "architecture-invalid-portal-fixture.json",
  evidenceId: "TOS-S2-EV-008",
  command: "node tooling/architecture/reject-negative-fixture.mjs (expected exit 1)",
  execution: negativeExecution,
  details: {
    expectedNonZeroExitObserved: true,
    expectedViolationCount: 1,
    ...negativeReport,
  },
});

const testsExecution = run("pnpm", [
  "exec",
  "vitest",
  "run",
  "--config",
  "tooling/testing/vitest.config.ts",
  "--reporter=json",
]);
const testsReport = parseJsonSuffix(testsExecution.stdout);
const assertions = (testsReport.testResults ?? []).flatMap((testResult) =>
  (testResult.assertionResults ?? []).map((assertion) => ({
    title: assertion.fullName ?? assertion.title,
    status: assertion.status,
  })),
);
if (
  testsReport.success !== true ||
  !Array.isArray(testsReport.testResults) ||
  testsReport.testResults.length === 0 ||
  testsReport.testResults.some((testResult) => testResult.status !== "passed") ||
  !Number.isInteger(testsReport.numTotalTests) ||
  testsReport.numTotalTests <= 0 ||
  testsReport.numPassedTests !== testsReport.numTotalTests ||
  assertions.some((assertion) => assertion.status !== "passed")
) {
  throw new Error("Unit-test evidence does not show a non-empty all-passing test set");
}
await writeEvidence({
  fileName: "unit-tests.json",
  evidenceId: "TOS-S2-EV-009",
  command: "pnpm exec vitest run --config tooling/testing/vitest.config.ts --reporter=json",
  execution: testsExecution,
  details: {
    testFiles: testsReport.testResults.length,
    passedTestFiles: testsReport.testResults.filter((testResult) => testResult.status === "passed")
      .length,
    reporterSuiteCount: testsReport.numTotalTestSuites,
    tests: testsReport.numTotalTests,
    passedTests: testsReport.numPassedTests,
    assertions,
  },
});

const assertionTitles = assertions.map((assertion) => assertion.title);
const requiredConfigCases = {
  validDevelopmentManifestAccepted: "accepts the safe repository example",
  unknownRootKeyRejected: "rejects an unknown root key",
  unknownNestedKeyRejected: "rejects an unknown nested key",
  secretLikeFieldRejected: "rejects secret-like field password before schema parsing",
  sameAdminPortalHostRejected: "rejects equal Admin and Portal hosts",
  apiListenerCollisionRejected: "rejects an Admin and Portal API listener collision",
  distinctAddressEqualPortAccepted:
    "accepts equal API port numbers on clearly distinct loopback bind addresses",
  incoherentHostAllowlistRejected: "rejects a host allowlist that does not match the surface hosts",
  runtimeAndJsonSchemaValidAccepted:
    "accepts the representative valid manifest in runtime and JSON Schema",
  runtimeAndJsonSchemaRepresentedInvalidKeysRejected:
    "rejects unknown root and represented nested keys in runtime and JSON Schema",
  runtimeAndJsonSchemaInvalidListenerHostsRejected: "rejects invalid listener host",
  runtimeAndJsonSchemaHostCardinalityRejected: "represents exact host surface cardinality",
  runtimeAndJsonSchemaInvalidPortsRejected: "represents invalid API port",
  runtimeOnlyCollisionIdentified:
    "identifies listener collision as runtime-only without weakening runtime validation",
  runtimeOnlyHostAllowlistRelationshipIdentified:
    "identifies host and allowlist relationships as runtime-only",
  invariantRegistryCurrent:
    "keeps the generated schema and machine-readable invariant registry current",
};
const configCases = Object.fromEntries(
  Object.entries(requiredConfigCases).map(([name, titleFragment]) => [
    name,
    assertionTitles.some((title) => title.includes(titleFragment)),
  ]),
);
if (!Object.values(configCases).every(Boolean)) {
  throw new Error(`Required config cases missing: ${JSON.stringify(configCases)}`);
}
const adminApiMainSource = await readFile(path.join(root, "apps/admin-api/src/main.ts"), "utf8");
const portalApiMainSource = await readFile(path.join(root, "apps/portal-api/src/main.ts"), "utf8");
const listenerCompositionRoots = {
  adminApiConsumesOnlyAdminListener:
    adminApiMainSource.includes("manifest.runtime.listeners.adminApi") &&
    !adminApiMainSource.includes("manifest.runtime.listeners.portalApi"),
  portalApiConsumesOnlyPortalListener:
    portalApiMainSource.includes("manifest.runtime.listeners.portalApi") &&
    !portalApiMainSource.includes("manifest.runtime.listeners.adminApi"),
};
if (!Object.values(listenerCompositionRoots).every(Boolean)) {
  throw new Error("Admin and Portal composition roots do not consume their separate listeners");
}
await writeEvidence({
  fileName: "configuration-contract-tests.json",
  evidenceId: "TOS-S2-EV-010",
  command: "Derived from final Vitest JSON report",
  details: { cases: configCases, runtimeSecretManagementClaimed: false },
});

const schemaExecution = run("pnpm", ["run", "config:schema:check"]);
const schemaReport = parseJsonSuffix(schemaExecution.stdout);
if (schemaReport.result !== "PASS" || schemaReport.generatedSchemaCurrent !== true) {
  throw new Error("Generated configuration schema is not current");
}
await writeEvidence({
  fileName: "configuration-schema-drift.json",
  evidenceId: "TOS-S2-EV-011",
  command: "pnpm run config:schema:check",
  execution: schemaExecution,
  details: schemaReport,
});

const generatedSchemaPath = path.join(
  root,
  "deploy/manifests/schema/instance-manifest.schema.json",
);
const generatedSchemaBytes = await readFile(generatedSchemaPath);
const generatedSchemaDocument = JSON.parse(generatedSchemaBytes.toString("utf8"));
const generatedInvariantRegistry = generatedSchemaDocument["x-travelos-invariant-registry"];
if (
  generatedSchemaDocument.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
  !/not fully semantically equivalent/i.test(generatedSchemaDocument.$comment ?? "") ||
  generatedInvariantRegistry?.jsonSchemaScope !== "STRUCTURAL_WITH_DECLARED_RUNTIME_REFINEMENTS" ||
  generatedInvariantRegistry?.authoritativeRuntimeValidator !==
    "@travelos/config.parseDevelopmentInstanceManifest" ||
  generatedInvariantRegistry?.runtimeOnly?.length !== 4 ||
  !configCases.runtimeAndJsonSchemaValidAccepted ||
  !configCases.runtimeAndJsonSchemaRepresentedInvalidKeysRejected ||
  !configCases.runtimeAndJsonSchemaInvalidListenerHostsRejected ||
  !configCases.runtimeAndJsonSchemaHostCardinalityRejected ||
  !configCases.runtimeAndJsonSchemaInvalidPortsRejected ||
  !configCases.runtimeOnlyCollisionIdentified ||
  !configCases.runtimeOnlyHostAllowlistRelationshipIdentified
) {
  throw new Error("Corrected JSON Schema/runtime conformance evidence did not pass");
}
await writeEvidence({
  fileName: "correction-tos-s2-006-json-schema-runtime-contract.json",
  evidenceId: "TOS-S2-EV-025",
  command: "Final Vitest JSON report plus pnpm run config:schema:check",
  execution: schemaExecution,
  details: {
    finding: "TOS-S2-006",
    status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
    generatedSchema: {
      path: "deploy/manifests/schema/instance-manifest.schema.json",
      bytes: generatedSchemaBytes.length,
      sha256: sha256(generatedSchemaBytes),
      drift: "PASS",
    },
    runtimeAndJsonSchemaCases: configCases,
    invariantRegistry: generatedInvariantRegistry,
    completeSemanticEquivalenceClaimed: false,
  },
});

const rejectedFixtureExecution = run("pnpm", ["run", "test:rejected-technologies"]);
const rejectedFixtureReport = parseJsonSuffix(rejectedFixtureExecution.stdout);
if (
  rejectedFixtureReport.result !== "PASS" ||
  rejectedFixtureReport.semanticSourceFixtures !== 9 ||
  rejectedFixtureReport.sourceOutcomes?.some(({ result }) => result !== "REJECTED_AS_EXPECTED") ||
  rejectedFixtureReport.npmAliasFixture !== "REJECTED_AS_EXPECTED" ||
  rejectedFixtureReport.safeOrdinarySource !== "PASS" ||
  rejectedFixtureReport.acceptedBetterAuthDirectDependency !== "PASS" ||
  rejectedFixtureReport.acceptedBetterAuthTransitiveDisclosure !==
    "PASS_NOT_ARCHITECTURAL_ADOPTION" ||
  rejectedFixtureReport.ordinaryStaticBypassClaim !== "DISPROVED_AND_REGRESSION_COVERED" ||
  rejectedFixtureReport.compilerVsPolicySourceDiscovery !== "PASS" ||
  rejectedFixtureReport.productionSourceDiscoveryFixtures?.fixtureCount !== 4 ||
  rejectedFixtureReport.productionSourceDiscoveryFixtures?.rejectedFixtures !== 2 ||
  rejectedFixtureReport.productionSourceDiscoveryFixtures?.acceptedFixtures !== 2 ||
  rejectedFixtureReport.productionSourceDiscoveryFixtures?.outcomes?.some(
    ({ compilerIncluded, policyInspected, compilerDiagnostics, result, moduleResolved }) =>
      compilerIncluded !== true ||
      policyInspected !== true ||
      compilerDiagnostics !== 0 ||
      !["PASS", "REJECTED_AS_EXPECTED"].includes(result) ||
      (result === "REJECTED_AS_EXPECTED" && moduleResolved !== true),
  ) ||
  rejectedFixtureReport.dependencyUniverseSemanticFixtures?.result !== "PASS" ||
  rejectedFixtureReport.dependencyUniverseSemanticFixtures?.fixtureCount !== 12 ||
  rejectedFixtureReport.dependencyUniverseSemanticFixtures?.semanticRejectedTechnologyFixtures !==
    3 ||
  rejectedFixtureReport.dependencyUniverseSemanticFixtures?.aliasFailClosedFixtures !== 3
) {
  throw new Error("Rejected-technology adversarial fixture evidence did not pass");
}

const rejectedExecution = run("pnpm", ["run", "verify:rejected-technologies"]);
const rejectedReport = parseJsonSuffix(rejectedExecution.stdout);
if (
  rejectedReport.result !== "PASS" ||
  rejectedReport.compilerResolvedProductionSourceCount <= 0 ||
  rejectedReport.policyInspectedProductionSourceCount <= 0 ||
  rejectedReport.uncoveredProductionSourceCount !== 0 ||
  rejectedReport.sourceDiscovery?.result !== "PASS" ||
  rejectedReport.dependencyUniverse?.result !== "PASS" ||
  rejectedReport.dependencyUniverse?.unexplainedCompilerDependencyReferenceCount !== 0 ||
  rejectedReport.dependencyUniverse?.unsupportedDependencyConstructCount !== 0 ||
  rejectedReport.unsupportedProductionDependencyConstructs?.length !== 0 ||
  rejectedReport.rejectedDirectOrResolvedPackages?.length !== 0 ||
  rejectedReport.rejectedImports?.length !== 0
) {
  throw new Error("Rejected technology scan did not pass");
}
await writeEvidence({
  fileName: "rejected-technologies.json",
  evidenceId: "TOS-S2-EV-012",
  command: "pnpm run verify:rejected-technologies",
  execution: rejectedExecution,
  details: rejectedReport,
});
await writeEvidence({
  fileName: "correction-tos-s2-007-semantic-rejected-technologies.json",
  evidenceId: "TOS-S2-EV-026",
  command: "pnpm run test:rejected-technologies; pnpm run verify:rejected-technologies",
  execution: rejectedFixtureExecution,
  details: {
    finding: "TOS-S2-007",
    status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
    directTravelosAdoptionPolicy: "FAIL",
    acceptedDependencyTransitiveReferencePolicy: "DISCLOSE_WITHOUT_AUTOMATIC_ARCHITECTURAL_FAILURE",
    adversarialFixtures: rejectedFixtureReport,
    finalRepositoryScan: rejectedReport,
  },
});

const buildExecution = run("pnpm", ["run", "build"]);
const buildScopeMatch = buildExecution.stdout.match(/Scope:\s+(\d+) of (\d+) workspace projects/);
if (buildScopeMatch?.[1] !== "14" || buildScopeMatch[2] !== "15") {
  throw new Error("Clean build did not report the expected 14 of 15 workspace scope");
}
await writeEvidence({
  fileName: "clean-build.json",
  evidenceId: "TOS-S2-EV-014",
  command: "pnpm run build",
  execution: buildExecution,
  details: {
    cleanOutputRemovalExecuted: buildExecution.stdout.includes(
      '"generatedDirectoriesRemovedOrConfirmedAbsent"',
    ),
    workspaceProjectsWithBuild: 14,
    workspaceProjectCount: 15,
    deployableCompositionRoots: 5,
  },
});

const smokeExecution = run("pnpm", ["run", "test:smoke"]);
const smokeReport = parseJsonSuffix(smokeExecution.stdout);
const apiSmokes =
  smokeReport.processSmokes?.filter((entry) => entry.service.endsWith("-api")) ?? [];
const webSmokes = smokeReport.webBuilds ?? [];
const isValidApiSmokeEvent = (event) =>
  event.event === "process_smoke" &&
  event.listening === true &&
  event.initialized === true &&
  event.binding?.requestedPort === 0 &&
  event.binding?.boundAddress === "127.0.0.1" &&
  Number.isInteger(event.binding?.boundPort) &&
  event.binding.boundPort > 0 &&
  event.binding?.ephemeralPortRequested === true &&
  event.healthRequest?.method === "GET" &&
  event.healthRequest?.path === "/health/live" &&
  event.healthStatus === 200 &&
  event.cleanShutdown === true;
if (
  smokeReport.result !== "PASS" ||
  smokeReport.deployablesBuilt !== 5 ||
  webSmokes.length !== 2 ||
  webSmokes.some(
    (entry) =>
      entry.markerChecks?.ownMarkerPresent !== true ||
      entry.markerChecks?.otherMarkerAbsent !== true,
  ) ||
  apiSmokes.length !== 2 ||
  JSON.stringify(apiSmokes.map(({ service }) => service).sort()) !==
    JSON.stringify(["admin-api", "portal-api"]) ||
  apiSmokes.some((entry) => entry.exitCode !== 0) ||
  apiSmokes.some((entry) => !entry.events?.some(isValidApiSmokeEvent)) ||
  !smokeReport.processSmokes
    ?.find((entry) => entry.service === "worker")
    ?.events?.some((event) => event.event === "process_bootstrap" && event.state === "RUNNING") ||
  !smokeReport.processSmokes
    ?.find((entry) => entry.service === "worker")
    ?.events?.some((event) => event.event === "process_shutdown" && event.state === "STOPPED")
) {
  throw new Error("Five-deployable smoke evidence did not pass the final requirements");
}
await writeEvidence({
  fileName: "five-deployable-smokes.json",
  evidenceId: "TOS-S2-EV-015",
  command: "pnpm run test:smoke",
  execution: smokeExecution,
  details: smokeReport,
});
await writeEvidence({
  fileName: "correction-tos-s2-005-api-listener-separation.json",
  evidenceId: "TOS-S2-EV-024",
  command: "Final Vitest JSON report, composition-root inspection, and pnpm run test:smoke",
  execution: smokeExecution,
  details: {
    finding: "TOS-S2-005",
    status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
    runtimeContractCases: {
      distinctHostPortCombinations: configCases.validDevelopmentManifestAccepted,
      sameHostAndSameNumericPortRejected: configCases.apiListenerCollisionRejected,
      sameNumericPortOnDistinctExplicitBindAddressesAccepted:
        configCases.distinctAddressEqualPortAccepted,
    },
    compositionRootListenerConsumption: listenerCompositionRoots,
    realEphemeralLoopbackHttpSmokes: Object.fromEntries(
      apiSmokes.map((entry) => [entry.service, entry.events.find(isValidApiSmokeEvent)]),
    ),
  },
});

const bundleExecution = run("pnpm", ["run", "security:scan:bundles"]);
const bundleReport = parseJsonSuffix(bundleExecution.stdout);
if (
  bundleReport.result !== "PASS" ||
  bundleReport.bundlesScanned?.length !== 6 ||
  bundleReport.findings?.length !== 0
) {
  throw new Error("Browser bundle credential scan did not pass");
}
await writeEvidence({
  fileName: "browser-bundle-secret-scan.json",
  evidenceId: "TOS-S2-EV-016",
  command: "pnpm run security:scan:bundles",
  execution: bundleExecution,
  details: bundleReport,
});

const implementationFiles = [];
const implementationRoots = ["apps", "packages", "tooling", "deploy", ".github"];
const ignoredDirectoryNames = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);
const collectFiles = async (relativeDirectory) => {
  const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) await collectFiles(relativePath);
    } else if (!entry.name.endsWith(".tsbuildinfo")) {
      implementationFiles.push(relativePath);
    }
  }
};
for (const implementationRoot of implementationRoots) await collectFiles(implementationRoot);

const sourceFiles = architectureReport.sourceDiscovery?.policyInspectedProductionSourceFiles ?? [];
if (sourceFiles.length === 0) {
  throw new Error("Stage-boundary evidence requires authoritative production-source discovery");
}
const forbiddenRuntimeImport =
  /(?:from\s+|import\s*[(])["'](?:auth|better-auth|kysely|node-pg-migrate|pg)(?:[/"'])/;
const forbiddenRuntimeImports = [];
for (const filePath of sourceFiles) {
  if (forbiddenRuntimeImport.test(await readFile(path.join(root, filePath), "utf8"))) {
    forbiddenRuntimeImports.push(filePath);
  }
}
const migrationOrSqlFiles = implementationFiles.filter((filePath) =>
  /(?:^|\/)migrations?(?:\/|$)|[.]sql$/i.test(filePath),
);
const databaseImplementationFiles = implementationFiles.filter(
  (filePath) =>
    filePath.startsWith("packages/database/src/") && filePath !== "packages/database/src/index.ts",
);
const authImplementationFiles = implementationFiles.filter(
  (filePath) =>
    filePath.startsWith("packages/auth-adapters/src/") &&
    filePath !== "packages/auth-adapters/src/index.ts",
);
const backendDomainImplementationFiles = implementationFiles.filter(
  (filePath) =>
    filePath.startsWith("packages/backend-core/src/") &&
    filePath !== "packages/backend-core/src/index.ts",
);
const ctDeploymentActivationFiles = implementationFiles.filter((filePath) =>
  /^deploy\/(?!manifests\/)/.test(filePath),
);
const expectedBoundaryMarkers = {
  "packages/backend-core/src/index.ts":
    "// Stage 2 boundary marker only. Domain and application behavior begins in later authorized stages.\nexport {};",
  "packages/database/src/index.ts":
    "// Stage 2 boundary marker only. No database connection, schema, migration, or row type exists yet.\nexport {};",
  "packages/auth-adapters/src/index.ts":
    "// Stage 2 boundary marker only. Authentication behavior is intentionally absent.\nexport {};",
};
const boundaryMarkers = {};
for (const [filePath, expected] of Object.entries(expectedBoundaryMarkers)) {
  boundaryMarkers[filePath] =
    (await readFile(path.join(root, filePath), "utf8")).trim() === expected;
}
const controllerFiles = sourceFiles.filter((filePath) => filePath.endsWith(".controller.ts"));
const apiControllerRoutes = [];
for (const filePath of controllerFiles) {
  const content = await readFile(path.join(root, filePath), "utf8");
  const controller = content.match(/@Controller\("([^"]+)"\)/)?.[1] ?? null;
  const gets = [...content.matchAll(/@Get\("([^"]+)"\)/g)].map((match) => match[1]);
  apiControllerRoutes.push({ file: filePath, controller, gets });
}
const stageBoundaryPass =
  forbiddenRuntimeImports.length === 0 &&
  migrationOrSqlFiles.length === 0 &&
  databaseImplementationFiles.length === 0 &&
  authImplementationFiles.length === 0 &&
  backendDomainImplementationFiles.length === 0 &&
  ctDeploymentActivationFiles.length === 0 &&
  Object.values(boundaryMarkers).every(Boolean) &&
  controllerFiles.length === 2 &&
  apiControllerRoutes.every(
    (route) => route.controller === "health" && route.gets.length === 1 && route.gets[0] === "live",
  );
if (!stageBoundaryPass) throw new Error("Stage 2 scope boundary verification failed");
await writeEvidence({
  fileName: "stage-boundary.json",
  evidenceId: "TOS-S2-EV-017",
  command: "Repository-owned Stage 2 source/tree inspection",
  details: {
    result: "PASS",
    sourceFilesChecked: sourceFiles.length,
    forbiddenDatabaseOrAuthRuntimeImports: forbiddenRuntimeImports,
    migrationOrSqlFiles,
    databaseRoleDefinitionFiles: migrationOrSqlFiles,
    databaseImplementationFiles,
    authImplementationFiles,
    backendDomainImplementationFiles,
    ctDeploymentActivationFiles,
    ctDeploymentConfigurationActivated: false,
    boundaryMarkers,
    apiControllerRoutes,
    allowedApiSurface: ["GET /health/live"],
    absentBehavior: [
      "PostgreSQL runtime database or bootstrap",
      "database migrations",
      "database connections",
      "database roles",
      "authentication implementation",
      "Better Auth runtime wiring",
      "Trip behavior",
      "Customer behavior",
      "Publishing behavior",
      "Portal business-data endpoints",
      "CT deployment configuration activation",
    ],
    ct200ActionsPerformed: 0,
  },
});

const ciExecution = run("pnpm", ["run", "ci:verify"]);
const ciReport = parseJsonSuffix(ciExecution.stdout);
if (ciReport.result !== "PASS" || ciReport.completed?.length !== 18) {
  throw new Error("Final ci:verify did not complete all 18 gates");
}
await writeEvidence({
  fileName: "ci-verify.json",
  evidenceId: "TOS-S2-EV-018",
  command: "pnpm run ci:verify",
  execution: ciExecution,
  details: ciReport,
});

const treeRootFiles = [
  ".gitignore",
  ".node-version",
  ".npmrc",
  ".prettierignore",
  "AGENTS.md",
  "IDEA.md",
  "eslint.config.mjs",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "prettier.config.mjs",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.workspace.ts",
];
const treeFiles = [...new Set([...treeRootFiles, ...implementationFiles])].sort();
const workspaceListExecution = run("pnpm", ["-r", "list", "--depth", "-1", "--json"]);
const workspaceProjects = JSON.parse(workspaceListExecution.stdout);
const workspacePaths = workspaceProjects.map((project) =>
  path.relative(root, project.path).split(path.sep).join("/"),
);
const workspaceShape = {
  rootWorkspace: workspacePaths.filter((workspacePath) => workspacePath === "").length,
  apps: workspacePaths.filter((workspacePath) => /^apps\/[^/]+$/.test(workspacePath)).length,
  packages: workspacePaths.filter((workspacePath) => /^packages\/[^/]+$/.test(workspacePath))
    .length,
  pnpmWorkspaceProjects: workspacePaths.length,
  toolingWorkspaceProjects: workspacePaths.filter((workspacePath) =>
    /^tooling(?:\/|$)/.test(workspacePath),
  ).length,
};
if (
  workspaceShape.rootWorkspace !== 1 ||
  workspaceShape.apps !== 5 ||
  workspaceShape.packages !== 9 ||
  workspaceShape.pnpmWorkspaceProjects !== 15 ||
  workspaceShape.toolingWorkspaceProjects !== 0
) {
  throw new Error(`Unexpected workspace shape: ${JSON.stringify(workspaceShape)}`);
}
const treeEntries = [];
for (const filePath of treeFiles) {
  const bytes = await readFile(path.join(root, filePath));
  treeEntries.push({ path: filePath, bytes: bytes.length, sha256: sha256(bytes) });
}
const treeAggregate = sha256(
  treeEntries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n"),
);
await writeEvidence({
  fileName: "implementation-tree.json",
  evidenceId: "TOS-S2-EV-019",
  command: "Deterministic implementation tree inventory",
  details: {
    fileCount: treeEntries.length,
    aggregateSha256: treeAggregate,
    workspaceShape,
    toolingDirectoriesAreWorkspacePackages: false,
    exclusions: [".git", "node_modules", "dist", "coverage", ".vite", "*.tsbuildinfo"],
    files: treeEntries,
  },
});

const sourceScanExecution = run("node", [
  "tooling/ci/scan-source-secrets.mjs",
  "--pre-index-evidence",
]);
const sourceScanReport = parseJsonSuffix(sourceScanExecution.stdout);
if (sourceScanReport.result !== "PASS" || sourceScanReport.findings?.length !== 0) {
  throw new Error("Pre-index freeze-input credential/PII scan did not pass");
}
await writeEvidence({
  fileName: "source-credential-pii-scan.json",
  evidenceId: "TOS-S2-EV-013",
  command: "node tooling/ci/scan-source-secrets.mjs --pre-index-evidence",
  execution: sourceScanExecution,
  details: sourceScanReport,
});

const indexedArtifacts = [];
for (const artifact of artifacts.sort((left, right) =>
  left.evidenceId.localeCompare(right.evidenceId),
)) {
  const artifactPath = path.join(outputDirectory, artifact.fileName);
  const bytes = await readFile(artifactPath);
  indexedArtifacts.push({
    evidenceId: artifact.evidenceId,
    path: path.posix.join("docs/evidence/phase-1-m1/stage-2", artifact.fileName),
    bytes: bytes.length,
    sha256: sha256(bytes),
    result: artifact.result,
  });
}
const correctionArtifactCount = indexedArtifacts.filter(({ path: artifactPath }) =>
  path.posix.basename(artifactPath).startsWith("correction-tos-s2-"),
).length;
if (indexedArtifacts.length !== 26 || correctionArtifactCount !== 7) {
  throw new Error("Final evidence set must contain 19 original gates and 7 correction artifacts");
}
const index = {
  schemaVersion: 1,
  evidenceSet: "TravelOS Phase 1 M1 Stage 2 corrected candidate validation",
  generatedAt: new Date().toISOString(),
  result: indexedArtifacts.every((artifact) => artifact.result === "PASS") ? "PASS" : "FAIL",
  artifactCount: indexedArtifacts.length,
  toolVersions,
  artifacts: indexedArtifacts,
  redaction,
};
await writeFile(
  path.join(outputDirectory, "EVIDENCE_INDEX.json"),
  `${JSON.stringify(index, null, 2)}\n`,
  "utf8",
);

for (const artifact of indexedArtifacts) {
  const bytes = await readFile(path.join(root, artifact.path));
  if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
    throw new Error(`Evidence index verification failed for ${artifact.path}`);
  }
}
const indexBytes = await readFile(path.join(outputDirectory, "EVIDENCE_INDEX.json"));
const finalSourceScanExecution = run("node", ["tooling/ci/scan-source-secrets.mjs"]);
const finalSourceScanReport = parseJsonSuffix(finalSourceScanExecution.stdout);
if (finalSourceScanReport.result !== "PASS" || finalSourceScanReport.findings?.length !== 0) {
  throw new Error("Final indexed-evidence credential/PII scan did not pass");
}
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: index.result,
      evidenceIndex: "docs/evidence/phase-1-m1/stage-2/EVIDENCE_INDEX.json",
      artifactCount: index.artifactCount,
      correctionArtifactCount,
      evidenceIndexBytes: indexBytes.length,
      evidenceIndexSha256: sha256(indexBytes),
      allArtifactHashesVerified: true,
      finalIndexedEvidenceScan: {
        result: finalSourceScanReport.result,
        filesScanned: finalSourceScanReport.filesScanned,
        evidenceFilesScanned: finalSourceScanReport.coverage?.retainedEvidence,
        findings: finalSourceScanReport.findings,
        outputSha256: finalSourceScanExecution.outputSha256,
      },
    },
    null,
    2,
  ),
);
