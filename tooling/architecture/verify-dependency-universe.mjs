import { architecturePolicy } from "./package-boundary-policy.mjs";
import {
  collectNormalizedSourceDependencies,
  dependencyUniverseSummary,
  discoverProductionDependencyUniverse,
  evaluateDependencyCoverage,
} from "./dependency-universe.mjs";
import { runDependencyUniverseFixtureSuite } from "./dependency-universe-fixture-suite.mjs";
import { discoverProductionSourceFiles } from "./production-source-discovery.mjs";

const sourceDiscovery = await discoverProductionSourceFiles({
  root: process.cwd(),
  units: architecturePolicy.units,
});
const repository = await discoverProductionDependencyUniverse({
  root: process.cwd(),
  sourceDiscovery,
});
const fixtures = await runDependencyUniverseFixtureSuite();
const unexplainedCompilerReferenceProbe = evaluateDependencyCoverage({
  compilerReferences: [
    {
      file: "packages/backend-core/src/unexplained.ts",
      compilerCategory: "module",
      specifier: "unexplained-package",
    },
  ],
  normalizedDependencies: [],
  unsupportedDependencyConstructs: [],
});
const unsupportedAliasProbe = collectNormalizedSourceDependencies({
  fileName: "packages/backend-core/src/unsupported.cts",
  sourceText: [
    "declare const require: (specifier: string) => unknown;",
    "const load = require;",
    'void load("uninspected-package");',
    "",
  ].join("\n"),
});

const result =
  sourceDiscovery.result === "PASS" &&
  repository.result === "PASS" &&
  repository.unexplainedCompilerDependencyReferenceCount === 0 &&
  repository.unsupportedDependencyConstructCount === 0 &&
  repository.unresolvedNormalizedDependencyCount === 0 &&
  repository.nonTypeScriptAssetDependencyCount === 3 &&
  fixtures.result === "PASS" &&
  fixtures.unexpectedCompilerParserOrResolutionFailures === 0 &&
  unexplainedCompilerReferenceProbe.result === "FAIL" &&
  unexplainedCompilerReferenceProbe.unexplainedCompilerDependencyReferences.length === 1 &&
  unsupportedAliasProbe.unsupportedDependencyConstructs.length === 1
    ? "PASS"
    : "FAIL";

const report = {
  schemaVersion: 1,
  result,
  sourceDiscovery: {
    result: sourceDiscovery.result,
    compilerResolvedProductionSourceCount: sourceDiscovery.compilerResolvedProductionSourceCount,
    policyInspectedProductionSourceCount: sourceDiscovery.policyInspectedProductionSourceCount,
    uncoveredProductionSourceCount: sourceDiscovery.uncoveredProductionSourceCount,
    unsupportedCompilerResolvedProductionFiles:
      sourceDiscovery.unsupportedCompilerResolvedProductionFiles,
  },
  repository: dependencyUniverseSummary(repository),
  nonTypeScriptAssetDependencies: repository.nonTypeScriptAssetDependencies,
  fixtures,
  failClosedProbes: {
    unexplainedCompilerReference: {
      expected: "FAIL",
      result: unexplainedCompilerReferenceProbe.result,
      unexplainedReferenceCount:
        unexplainedCompilerReferenceProbe.unexplainedCompilerDependencyReferences.length,
    },
    unsupportedRuntimeLoaderAlias: {
      expectedRule: "architecture/unsupported-module-loader-alias",
      findingCount: unsupportedAliasProbe.unsupportedDependencyConstructs.length,
      findings: unsupportedAliasProbe.unsupportedDependencyConstructs,
    },
  },
};

console.log(JSON.stringify(report, null, 2));
if (result !== "PASS") process.exit(1);
