import { spawnSync } from "node:child_process";

import {
  architecturePolicy,
  checkRepositoryPackageBoundaries,
} from "./package-boundary-policy.mjs";
import {
  dependencyUniverseSummary,
  discoverProductionDependencyUniverse,
} from "./dependency-universe.mjs";
import { runDependencyUniverseFixtureSuite } from "./dependency-universe-fixture-suite.mjs";
import {
  dependencyCruiserResolverExtensions,
  discoverProductionSourceFiles,
} from "./production-source-discovery.mjs";
import { runSourceDiscoveryFixtureSuite } from "./source-discovery-fixture-suite.mjs";

const runCruise = (config, targets) => {
  const result = spawnSync(
    "pnpm",
    ["exec", "depcruise", "--config", config, "--output-type", "json", ...targets],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`dependency-cruiser did not return JSON for ${config}`);
  }
  return { result, report };
};

const reportViolations = (report) => {
  const violations = report?.summary?.violations;
  return Array.isArray(violations) ? violations : [];
};

const sourceDiscovery = await discoverProductionSourceFiles({
  root: process.cwd(),
  units: architecturePolicy.units,
});
if (sourceDiscovery.result !== "PASS" || sourceDiscovery.uncoveredProductionSourceCount !== 0) {
  process.stderr.write(`${JSON.stringify(sourceDiscovery, null, 2)}\n`);
  process.exit(1);
}

const dependencyUniverse = await discoverProductionDependencyUniverse({
  root: process.cwd(),
  sourceDiscovery,
});
const expectedNonTypeScriptAssetDependencies = [
  "apps/admin-web/src/leads-view.tsx\0./leads.css",
  "apps/admin-web/src/main.tsx\0@travelos/design-system/styles.css",
  "apps/admin-web/src/staff-invitations-view.tsx\0./staff-invitations.css",
  "apps/portal-web/src/main.tsx\0@travelos/design-system/styles.css",
];
const actualNonTypeScriptAssetDependencies = dependencyUniverse.nonTypeScriptAssetDependencies
  .map(({ file, specifier }) => `${file}\0${specifier}`)
  .sort();
if (
  dependencyUniverse.result !== "PASS" ||
  dependencyUniverse.unexplainedCompilerDependencyReferenceCount !== 0 ||
  dependencyUniverse.unsupportedDependencyConstructCount !== 0 ||
  dependencyUniverse.unresolvedNormalizedDependencyCount !== 0 ||
  JSON.stringify(actualNonTypeScriptAssetDependencies) !==
    JSON.stringify(expectedNonTypeScriptAssetDependencies)
) {
  process.stderr.write(`${JSON.stringify(dependencyUniverse, null, 2)}\n`);
  process.exit(1);
}

const production = runCruise(
  "tooling/architecture/dependency-cruiser.cjs",
  sourceDiscovery.policyInspectedProductionSourceFiles,
);
const productionViolations = reportViolations(production.report);
if (production.result.status !== 0 || productionViolations.length !== 0) {
  process.stderr.write(production.result.stderr);
  process.stderr.write(JSON.stringify(production.report?.summary ?? production.report, null, 2));
  process.exit(1);
}

const requiredRules = [
  "no-circular-dependencies",
  "no-unresolvable-dependencies",
  "portal-api-cannot-import-admin-workspace",
  "portal-safe-core-cannot-import-admin-workspace",
  "backend-core-dependencies-must-be-explicitly-allowed",
  "core-cannot-import-frameworks-or-adapters",
  "portal-roots-cannot-import-admin-contracts",
  "admin-roots-cannot-import-portal-contracts",
  "browser-apps-cannot-import-privileged-backend",
  "packages-cannot-import-composition-roots",
  "composition-root-admin-web-cannot-import-another-root",
  "composition-root-portal-web-cannot-import-another-root",
  "composition-root-admin-api-cannot-import-another-root",
  "composition-root-portal-api-cannot-import-another-root",
  "composition-root-worker-cannot-import-another-root",
  "production-cannot-import-test-support",
  "production-cannot-import-tests",
];
const enforcedRules =
  production.report.summary?.ruleSetUsed?.forbidden?.map((rule) => rule.name) ?? [];
const missingRules = requiredRules.filter((rule) => !enforcedRules.includes(rule));
if (missingRules.length !== 0) {
  process.stderr.write(
    `Architecture rules missing from executed graph: ${missingRules.join(", ")}\n`,
  );
  process.exit(1);
}

const configuredResolverExtensions =
  production.report.summary?.optionsUsed?.enhancedResolveOptions?.extensions ?? [];
const missingResolverExtensions = dependencyCruiserResolverExtensions.filter(
  (extension) => !configuredResolverExtensions.includes(extension),
);
if (missingResolverExtensions.length !== 0) {
  process.stderr.write(
    `Dependency-cruiser resolver source forms are incomplete: ${missingResolverExtensions.join(", ")}\n`,
  );
  process.exit(1);
}

const packageBoundaries = await checkRepositoryPackageBoundaries({
  sourceDiscovery,
  dependencyUniverse,
});
if (packageBoundaries.result !== "PASS" || packageBoundaries.violations.length !== 0) {
  process.stderr.write(`${JSON.stringify(packageBoundaries, null, 2)}\n`);
  process.exit(1);
}

const portalImportFixtures = spawnSync(
  process.execPath,
  ["tooling/architecture/fixtures/stage-7/verify-portal-import-boundaries.mjs"],
  { cwd: process.cwd(), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
);
let portalImportFixtureReport;
try {
  portalImportFixtureReport = JSON.parse(portalImportFixtures.stdout);
} catch {
  process.stderr.write(portalImportFixtures.stderr);
  process.stderr.write("Portal import-boundary fixtures did not return JSON\n");
  process.exit(1);
}
if (
  portalImportFixtures.status !== 0 ||
  portalImportFixtureReport.result !== "PASS" ||
  portalImportFixtureReport.failedCaseCount !== 0
) {
  process.stderr.write(portalImportFixtures.stderr);
  process.stderr.write(`${JSON.stringify(portalImportFixtureReport, null, 2)}\n`);
  process.exit(1);
}

const negative = spawnSync(process.execPath, ["tooling/architecture/reject-negative-fixture.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
let negativeReport;
try {
  negativeReport = JSON.parse(negative.stdout);
} catch {
  process.stderr.write(negative.stderr);
  process.stderr.write("Negative architecture fixture did not return JSON\n");
  process.exit(1);
}
if (negative.status !== 1 || negativeReport.result !== "REJECTED_AS_EXPECTED") {
  process.stderr.write(negative.stderr);
  process.stderr.write(JSON.stringify(negativeReport, null, 2));
  process.exit(1);
}

const layeredFixtures = spawnSync(
  process.execPath,
  ["tooling/architecture/verify-layered-boundary-fixtures.mjs"],
  { cwd: process.cwd(), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
);
let layeredFixtureReport;
try {
  layeredFixtureReport = JSON.parse(layeredFixtures.stdout);
} catch {
  process.stderr.write(layeredFixtures.stderr);
  process.stderr.write("Layered architecture fixtures did not return JSON\n");
  process.exit(1);
}
if (
  layeredFixtures.status !== 0 ||
  layeredFixtureReport.result !== "PASS" ||
  layeredFixtureReport.unexpectedOrUnresolvedFailures !== 0
) {
  process.stderr.write(layeredFixtures.stderr);
  process.stderr.write(JSON.stringify(layeredFixtureReport, null, 2));
  process.exit(1);
}

const sourceDiscoveryFixtures = await runSourceDiscoveryFixtureSuite();
if (
  sourceDiscoveryFixtures.result !== "PASS" ||
  sourceDiscoveryFixtures.unexpectedOrUnresolvedFailures !== 0
) {
  process.stderr.write(`${JSON.stringify(sourceDiscoveryFixtures, null, 2)}\n`);
  process.exit(1);
}

const dependencyUniverseFixtures = await runDependencyUniverseFixtureSuite();
if (
  dependencyUniverseFixtures.result !== "PASS" ||
  dependencyUniverseFixtures.unexpectedCompilerParserOrResolutionFailures !== 0
) {
  process.stderr.write(`${JSON.stringify(dependencyUniverseFixtures, null, 2)}\n`);
  process.exit(1);
}

const output = {
  schemaVersion: 1,
  result: "PASS",
  productionGraph: {
    productionSourceTargets: sourceDiscovery.policyInspectedProductionSourceCount,
    modulesCruised: production.report.summary?.totalCruised ?? null,
    dependenciesCruised: production.report.summary?.totalDependenciesCruised ?? null,
    cycles: productionViolations.filter(
      (violation) => violation.rule?.name === "no-circular-dependencies",
    ).length,
    violations: productionViolations.length,
    enforcedRules,
    resolverSourceForms: configuredResolverExtensions,
  },
  sourceDiscovery,
  dependencyUniverse: dependencyUniverseSummary(dependencyUniverse),
  nonTypeScriptAssetDependencies: dependencyUniverse.nonTypeScriptAssetDependencies,
  packageBoundaries,
  portalImportBoundaries: portalImportFixtureReport,
  negativePortalFixture: {
    expectedFailureObserved: true,
    processExitCode: negative.status,
    rule: negativeReport.violation.rule,
    from: negativeReport.violation.from,
    to: negativeReport.violation.to,
    violationCount: 1,
  },
  layeredBoundaryFixtures: layeredFixtureReport,
  sourceDiscoveryFixtures,
  dependencyUniverseFixtures,
};
console.log(JSON.stringify(output, null, 2));
