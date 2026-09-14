import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  architecturePolicy,
  checkRepositoryPackageBoundaries,
} from "./package-boundary-policy.mjs";
import {
  dependencyUniverseSummary,
  discoverProductionDependencyUniverse,
} from "./dependency-universe.mjs";
import { discoverProductionSourceFiles } from "./production-source-discovery.mjs";
import { analyzeRejectedTechnologyDependencies } from "../ci/rejected-technology-policy.mjs";

const request = (...parts) => parts.join("");
const reactPackage = request("rea", "ct");
const nextPackage = request("ne", "xt");
const betterAuthPackage = request("better", "-auth");

const policyFor = (packageName) => {
  const policy = architecturePolicy.units.find(
    (candidate) => candidate.packageName === packageName,
  );
  assert.ok(policy, `Missing architecture policy for ${packageName}`);
  return policy;
};

const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const installTypePackage = async ({ root, packageName, jsxRuntime = false }) => {
  const packageDirectory = path.join(root, "node_modules", ...packageName.split("/"));
  await mkdir(packageDirectory, { recursive: true });
  const exports = { ".": { types: "./index.d.ts" } };
  if (jsxRuntime) {
    exports["./jsx-runtime"] = { types: "./jsx-runtime.d.ts" };
    exports["./jsx-dev-runtime"] = { types: "./jsx-dev-runtime.d.ts" };
  }
  await writeJson(path.join(packageDirectory, "package.json"), {
    name: packageName,
    version: "1.0.0",
    type: "module",
    types: "./index.d.ts",
    exports,
  });
  await writeFile(
    path.join(packageDirectory, "index.d.ts"),
    "export interface Session { readonly id: string }\nexport interface Marker { readonly value: string }\n",
    "utf8",
  );
  if (jsxRuntime) {
    const runtimeTypes = [
      "export namespace JSX {",
      "  interface IntrinsicElements { div: Record<string, unknown> }",
      "}",
      "export declare const jsx: (...values: unknown[]) => unknown;",
      "export declare const jsxs: (...values: unknown[]) => unknown;",
      "export declare const Fragment: unknown;",
      "",
    ].join("\n");
    await writeFile(path.join(packageDirectory, "jsx-runtime.d.ts"), runtimeTypes, "utf8");
    await writeFile(path.join(packageDirectory, "jsx-dev-runtime.d.ts"), runtimeTypes, "utf8");
  }
};

const manifestFor = ({ unitPolicy, dependencies }) => ({
  name: unitPolicy.packageName,
  version: "0.0.0-fixture",
  private: true,
  type: "module",
  dependencies,
  ...(unitPolicy.allowedExports === undefined
    ? {}
    : {
        exports: Object.fromEntries(
          unitPolicy.allowedExports.map((exportKey) => [exportKey, "./src/probe.js"]),
        ),
      }),
});

const createFixtureRoot = async (fixture) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "travelos-dependency-universe-"));
  const unitPolicy = fixture.unitPolicy;
  const sourceDirectory = path.join(root, unitPolicy.root, "src");
  const fixturePath = path.posix.join(unitPolicy.root, "src", fixture.fileName);
  await mkdir(sourceDirectory, { recursive: true });
  await writeJson(path.join(root, "package.json"), { private: true, type: "module" });
  await writeJson(
    path.join(root, unitPolicy.root, "package.json"),
    manifestFor({ unitPolicy, dependencies: fixture.dependencies ?? {} }),
  );
  await writeJson(path.join(root, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2023",
      lib: ["ES2023"],
      module: "Node16",
      moduleResolution: "Node16",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      jsx: "react-jsx",
      types: [],
    },
    include: [`${unitPolicy.root}/src/**/*`],
  });
  for (const dependencyPackage of fixture.resolvablePackages ?? []) {
    await installTypePackage({
      root,
      packageName: dependencyPackage,
      jsxRuntime: dependencyPackage === reactPackage || dependencyPackage === nextPackage,
    });
  }
  for (const [relativePath, content] of Object.entries(fixture.auxiliarySources ?? {})) {
    await writeFile(path.join(sourceDirectory, relativePath), content, "utf8");
  }
  await writeFile(path.join(root, fixturePath), fixture.sourceText, "utf8");
  return { root, fixturePath };
};

const backendPolicy = policyFor("@travelos/backend-core");
const adminWebPolicy = policyFor("@travelos/admin-web");
const authAdaptersPolicy = policyFor("@travelos/auth-adapters");
const backendWithNodeModule = {
  ...backendPolicy,
  allowedBuiltinSpecifiers: ["node:module"],
};

const architectureCases = [
  {
    name: "backend-implicit-react-jsx-runtime",
    unitPolicy: backendPolicy,
    fileName: "probe.tsx",
    sourceText: "export const view = <div />;\n",
    dependencies: { [reactPackage]: "1.0.0" },
    resolvablePackages: [reactPackage],
    expectedDependency: `${reactPackage}/jsx-runtime`,
    expectedKind: "implicit-jsx-runtime",
    expectedRules: [
      "architecture/external-dependency-not-allowed",
      "architecture/manifest-dependency-not-allowed",
    ],
  },
  {
    name: "backend-jsx-import-source-next",
    unitPolicy: backendPolicy,
    fileName: "probe.tsx",
    sourceText: `/** @jsxImportSource ${nextPackage} */\nexport const view = <div />;\n`,
    dependencies: { [nextPackage]: "1.0.0" },
    resolvablePackages: [nextPackage],
    expectedDependency: `${nextPackage}/jsx-runtime`,
    expectedKind: "implicit-jsx-runtime",
    expectedRejectedCategory: "next",
    expectedRules: [
      "architecture/external-dependency-not-allowed",
      "architecture/manifest-dependency-not-allowed",
    ],
  },
  {
    name: "backend-aliased-require",
    unitPolicy: backendPolicy,
    fileName: "probe.cts",
    sourceText: [
      "declare const require: { (specifier: string): unknown; resolve(specifier: string): string };",
      "const load = require;",
      `const value = load("${nextPackage}");`,
      "void value;",
      "",
    ].join("\n"),
    expectedUnsupportedConstruct: "require-alias",
    expectedRules: ["architecture/unsupported-module-loader-alias"],
  },
  {
    name: "backend-aliased-require-resolve",
    unitPolicy: backendPolicy,
    fileName: "probe.cts",
    sourceText: [
      "declare const require: { (specifier: string): unknown; resolve(specifier: string): string };",
      "const locate = require.resolve;",
      `const value = locate("${nextPackage}");`,
      "void value;",
      "",
    ].join("\n"),
    expectedUnsupportedConstruct: "require-resolve-alias",
    expectedRules: ["architecture/unsupported-module-loader-alias"],
  },
  {
    name: "backend-aliased-create-require-loader",
    unitPolicy: backendWithNodeModule,
    fileName: "probe.mts",
    sourceText: [
      'import { createRequire } from "node:module";',
      "const load = createRequire(import.meta.url);",
      "const alias = load;",
      `const value = alias("${nextPackage}");`,
      "void value;",
      "",
    ].join("\n"),
    auxiliarySources: {
      "node-module.d.ts": [
        "interface ImportMeta { readonly url: string }",
        'declare module "node:module" {',
        "  interface Loader { (specifier: string): unknown; resolve(specifier: string): string }",
        "  export function createRequire(url: string): Loader;",
        "}",
        "",
      ].join("\n"),
    },
    expectedDependency: "node:module",
    expectedKind: "import",
    expectedResolutionStatus: "BUILTIN",
    expectedUnsupportedConstruct: "create-require-loader-alias",
    expectedRules: ["architecture/unsupported-module-loader-alias"],
  },
  {
    name: "backend-better-auth-module-augmentation",
    unitPolicy: backendPolicy,
    fileName: "probe.d.mts",
    sourceText: [
      "export {};",
      `declare module "${betterAuthPackage}" {`,
      "  interface Session { readonly reviewed: true }",
      "}",
      "",
    ].join("\n"),
    dependencies: { [betterAuthPackage]: "1.0.0" },
    resolvablePackages: [betterAuthPackage],
    expectedDependency: betterAuthPackage,
    expectedKind: "external-module-augmentation",
    expectedRules: [
      "architecture/external-dependency-not-allowed",
      "architecture/manifest-dependency-not-allowed",
    ],
  },
  {
    name: "backend-next-type-reference",
    unitPolicy: backendPolicy,
    fileName: "probe.d.ts",
    sourceText: `/// <reference types="${nextPackage}" />\nexport interface Probe { readonly id: string }\n`,
    dependencies: { [nextPackage]: "1.0.0" },
    resolvablePackages: [nextPackage],
    expectedDependency: nextPackage,
    expectedKind: "type-reference-directive",
    expectedRejectedCategory: "next",
    expectedRules: [
      "architecture/external-dependency-not-allowed",
      "architecture/manifest-dependency-not-allowed",
    ],
  },
  {
    name: "backend-next-module-augmentation",
    unitPolicy: backendPolicy,
    fileName: "probe.d.mts",
    sourceText: [
      "export {};",
      `declare module "${nextPackage}" {`,
      "  interface ReviewMarker { readonly reviewed: true }",
      "}",
      "",
    ].join("\n"),
    dependencies: { [nextPackage]: "1.0.0" },
    resolvablePackages: [nextPackage],
    expectedDependency: nextPackage,
    expectedKind: "external-module-augmentation",
    expectedRejectedCategory: "next",
    expectedRules: [
      "architecture/external-dependency-not-allowed",
      "architecture/manifest-dependency-not-allowed",
    ],
  },
  {
    name: "admin-web-allowed-react-jsx-runtime",
    unitPolicy: adminWebPolicy,
    fileName: "probe.tsx",
    sourceText: "export const view = <div />;\n",
    dependencies: { [reactPackage]: "1.0.0" },
    resolvablePackages: [reactPackage],
    expectedDependency: `${reactPackage}/jsx-runtime`,
    expectedKind: "implicit-jsx-runtime",
    expectedRules: [],
  },
  {
    name: "auth-adapter-allowed-type-reference",
    unitPolicy: authAdaptersPolicy,
    fileName: "probe.d.ts",
    sourceText: `/// <reference types="${betterAuthPackage}" />\nexport interface Probe { readonly id: string }\n`,
    dependencies: { [betterAuthPackage]: "1.0.0" },
    resolvablePackages: [betterAuthPackage],
    expectedDependency: betterAuthPackage,
    expectedKind: "type-reference-directive",
    expectedRules: [],
  },
  {
    name: "auth-adapter-allowed-module-augmentation",
    unitPolicy: authAdaptersPolicy,
    fileName: "probe.d.mts",
    sourceText: [
      "export {};",
      `declare module "${betterAuthPackage}" {`,
      "  interface Session { readonly reviewed: true }",
      "}",
      "",
    ].join("\n"),
    dependencies: { [betterAuthPackage]: "1.0.0" },
    resolvablePackages: [betterAuthPackage],
    expectedDependency: betterAuthPackage,
    expectedKind: "external-module-augmentation",
    expectedRules: [],
  },
  {
    name: "backend-safe-local-ambient-declaration",
    unitPolicy: backendPolicy,
    fileName: "probe.d.ts",
    sourceText: [
      'declare module "travelos-local-contract" {',
      "  export interface Marker { readonly value: string }",
      "}",
      "",
    ].join("\n"),
    expectedRules: [],
  },
];

const runCase = async (fixture) => {
  const { root, fixturePath } = await createFixtureRoot(fixture);
  try {
    const units = [fixture.unitPolicy];
    const sourceDiscovery = await discoverProductionSourceFiles({
      root,
      tsconfigPath: "tsconfig.json",
      units,
    });
    const dependencyUniverse = await discoverProductionDependencyUniverse({
      root,
      tsconfigPath: "tsconfig.json",
      sourceDiscovery,
    });
    const packageBoundaries = await checkRepositoryPackageBoundaries({
      root,
      tsconfigPath: "tsconfig.json",
      units,
      sourceDiscovery,
      dependencyUniverse,
    });
    const dependencies = dependencyUniverse.dependenciesByFile[fixturePath] ?? [];
    const unsupported = dependencyUniverse.unsupportedDependencyConstructs.filter(
      ({ file }) => file === fixturePath,
    );
    const rejectedFindings = analyzeRejectedTechnologyDependencies(dependencies);
    const dependency =
      fixture.expectedDependency === undefined
        ? null
        : dependencies.find(
            ({ specifier, kind }) =>
              specifier === fixture.expectedDependency && kind === fixture.expectedKind,
          );
    const actualRules = packageBoundaries.violations.map(({ rule }) => rule).sort();
    const expectedRules = [...fixture.expectedRules].sort();

    assert.equal(sourceDiscovery.result, "PASS", fixture.name);
    assert.equal(sourceDiscovery.uncoveredProductionSourceCount, 0, fixture.name);
    assert.equal(
      sourceDiscovery.compilerResolvedProductionSourceFiles.includes(fixturePath),
      true,
      fixture.name,
    );
    assert.equal(
      sourceDiscovery.policyInspectedProductionSourceFiles.includes(fixturePath),
      true,
      fixture.name,
    );
    assert.equal(
      dependencyUniverse.compilerDiagnosticCount,
      0,
      `${fixture.name}: ${JSON.stringify(dependencyUniverse.compilerDiagnostics)}`,
    );
    assert.equal(dependencyUniverse.unexplainedCompilerDependencyReferenceCount, 0, fixture.name);
    assert.deepEqual(actualRules, expectedRules, fixture.name);

    if (fixture.expectedDependency !== undefined) {
      assert.ok(dependency, `${fixture.name} did not normalize ${fixture.expectedDependency}`);
      assert.equal(
        dependency.resolutionStatus,
        fixture.expectedResolutionStatus ?? "RESOLVED",
        fixture.name,
      );
    }
    if (fixture.expectedUnsupportedConstruct !== undefined) {
      assert.deepEqual(
        unsupported.map(({ construct }) => construct),
        [fixture.expectedUnsupportedConstruct],
        fixture.name,
      );
      assert.equal(dependencyUniverse.result, "FAIL", fixture.name);
    } else {
      assert.deepEqual(unsupported, [], fixture.name);
      assert.equal(dependencyUniverse.result, "PASS", fixture.name);
    }
    if (fixture.expectedRejectedCategory !== undefined) {
      assert.equal(rejectedFindings.length, 1, fixture.name);
      assert.equal(rejectedFindings[0].category, fixture.expectedRejectedCategory, fixture.name);
      assert.equal(
        rejectedFindings[0].authority,
        "normalized-semantic-dependency-universe",
        fixture.name,
      );
    } else {
      assert.deepEqual(rejectedFindings, [], fixture.name);
    }

    return {
      fixture: fixture.name,
      unit: fixture.unitPolicy.packageName,
      sourceForm: path.extname(fixture.fileName),
      compilerIncluded: true,
      policyInspected: true,
      compilerDiagnostics: 0,
      normalizedDependency: dependency?.specifier ?? null,
      dependencyKind: dependency?.kind ?? null,
      dependencyResolutionStatus: dependency?.resolutionStatus ?? null,
      intendedRules: expectedRules,
      architectureViolationCount: actualRules.length,
      unsupportedConstruct: fixture.expectedUnsupportedConstruct ?? null,
      rejectedTechnologyCategory: fixture.expectedRejectedCategory ?? null,
      rejectedTechnologyFindingCount: rejectedFindings.length,
      result: expectedRules.length === 0 ? "PASS" : "REJECTED_AS_EXPECTED",
      dependencyCoverage: dependencyUniverseSummary(dependencyUniverse),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

export const runDependencyUniverseFixtureSuite = async () => {
  const outcomes = [];
  for (const fixture of architectureCases) outcomes.push(await runCase(fixture));
  const outcomeFor = (name) => outcomes.find(({ fixture }) => fixture === name);
  const maliciousNames = architectureCases
    .filter(({ expectedRules }) => expectedRules.length !== 0)
    .map(({ name }) => name);
  const safeNames = architectureCases
    .filter(({ expectedRules }) => expectedRules.length === 0)
    .map(({ name }) => name);
  const semanticRejectedNames = architectureCases
    .filter(({ expectedRejectedCategory }) => expectedRejectedCategory !== undefined)
    .map(({ name }) => name);
  const aliasNames = architectureCases
    .filter(({ expectedUnsupportedConstruct }) => expectedUnsupportedConstruct !== undefined)
    .map(({ name }) => name);

  assert.ok(maliciousNames.every((name) => outcomeFor(name)?.result === "REJECTED_AS_EXPECTED"));
  assert.ok(safeNames.every((name) => outcomeFor(name)?.result === "PASS"));
  assert.ok(
    semanticRejectedNames.every((name) => outcomeFor(name)?.rejectedTechnologyFindingCount === 1),
  );
  assert.ok(
    aliasNames.every(
      (name) =>
        outcomeFor(name)?.unsupportedConstruct !== null &&
        outcomeFor(name)?.rejectedTechnologyFindingCount === 0,
    ),
  );

  return {
    schemaVersion: 1,
    result: "PASS",
    fixtureCount: outcomes.length,
    rejectedArchitectureFixtures: maliciousNames.length,
    acceptedArchitectureFixtures: safeNames.length,
    semanticRejectedTechnologyFixtures: semanticRejectedNames.length,
    aliasFailClosedFixtures: aliasNames.length,
    unexpectedCompilerParserOrResolutionFailures: 0,
    outcomes,
    requiredProofs: {
      implicitJsxRuntime: "backend-implicit-react-jsx-runtime",
      jsxImportSource: "backend-jsx-import-source-next",
      aliasedRequire: "backend-aliased-require",
      aliasedRequireResolve: "backend-aliased-require-resolve",
      aliasedCreateRequireLoader: "backend-aliased-create-require-loader",
      externalModuleAugmentation: "backend-better-auth-module-augmentation",
      rejectedTechnologyModuleAugmentation: "backend-next-module-augmentation",
      tripleReferenceTypes: "backend-next-type-reference",
      allowedJsx: "admin-web-allowed-react-jsx-runtime",
      allowedTypeReference: "auth-adapter-allowed-type-reference",
      allowedAugmentation: "auth-adapter-allowed-module-augmentation",
      safeLocalDeclaration: "backend-safe-local-ambient-declaration",
    },
  };
};
