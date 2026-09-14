import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import ts from "typescript";

import {
  analyzeSourceText,
  architecturePolicy,
  collectModuleRequests,
} from "./package-boundary-policy.mjs";
import { discoverProductionSourceFiles } from "./production-source-discovery.mjs";
import { scanRejectedTechnologySourceFiles } from "../ci/rejected-technology-policy.mjs";

const request = (...parts) => parts.join("");
const betterAuthPackage = request("better", "-auth");
const prismaClientPackage = request("@prisma", "/client");
const nextPackage = request("ne", "xt");
const backendPolicy = architecturePolicy.units.find(
  ({ packageName }) => packageName === "@travelos/backend-core",
);
assert.ok(backendPolicy);

const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const installResolvableTypePackage = async (root, packageName) => {
  const packageDirectory = path.join(root, "node_modules", ...packageName.split("/"));
  await mkdir(packageDirectory, { recursive: true });
  await writeJson(path.join(packageDirectory, "package.json"), {
    name: packageName,
    version: "1.0.0",
    type: "module",
    types: "./index.d.ts",
    exports: { ".": { types: "./index.d.ts" } },
  });
  await writeFile(
    path.join(packageDirectory, "index.d.ts"),
    "export interface Session { readonly id: string }\nexport interface Record { readonly id: string }\n",
    "utf8",
  );
};

const entrySourceFor = (form) => {
  if (form === ".d.mts") return '/// <reference path="./probe.d.mts" />\nexport {};\n';
  const emittedForm =
    form === ".mts" ? ".mjs" : form === ".cts" ? ".cjs" : form === ".ts" ? ".js" : form;
  return `import "./probe${emittedForm}";\nexport {};\n`;
};

const createFixtureRoot = async ({ form, sourceText, resolvablePackage }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "travelos-source-discovery-fixture-"));
  const sourceDirectory = path.join(root, "packages/backend-core/src");
  await mkdir(sourceDirectory, { recursive: true });
  await writeJson(path.join(root, "package.json"), { private: true, type: "module" });
  await writeJson(path.join(root, "packages/backend-core/package.json"), {
    name: "@travelos/backend-core",
    version: "0.0.0",
    type: "module",
    dependencies: resolvablePackage === undefined ? {} : { [resolvablePackage]: "1.0.0" },
  });
  await writeJson(path.join(root, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ["packages/**/*.ts"],
  });
  if (resolvablePackage !== undefined) {
    await installResolvableTypePackage(root, resolvablePackage);
  }
  const fixturePath = `packages/backend-core/src/probe${form}`;
  await writeFile(path.join(root, fixturePath), sourceText, "utf8");
  await writeFile(path.join(sourceDirectory, "index.ts"), entrySourceFor(form), "utf8");
  return { root, fixturePath };
};

const compilerEvidence = ({ root, fixturePath, resolvablePackage }) => {
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  assert.deepEqual(parsed.errors, []);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics,
    [],
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
  const fixtureAbsolutePath = path.join(root, fixturePath);
  const included = program
    .getSourceFiles()
    .some((sourceFile) => path.resolve(sourceFile.fileName) === fixtureAbsolutePath);
  const moduleResolution =
    resolvablePackage === undefined
      ? null
      : ts.resolveModuleName(resolvablePackage, fixtureAbsolutePath, parsed.options, ts.sys)
          .resolvedModule;
  return {
    compilerIncluded: included,
    compilerDiagnostics: diagnostics.length,
    forbiddenModuleResolved:
      resolvablePackage === undefined ? null : moduleResolution !== undefined,
  };
};

const discoverFixtureSources = async (root) =>
  discoverProductionSourceFiles({
    root,
    tsconfigPath: "tsconfig.json",
    units: [backendPolicy],
  });

const architectureCases = [
  {
    name: "backend-mts-better-auth",
    form: ".mts",
    sourceText: `import "${betterAuthPackage}";\nexport const probe = true;\n`,
    resolvablePackage: betterAuthPackage,
    expectedRule: "architecture/external-dependency-not-allowed",
  },
  {
    name: "backend-cts-better-auth",
    form: ".cts",
    sourceText: `declare function require(specifier: string): unknown;\nconst probe = require("${betterAuthPackage}");\nvoid probe;\n`,
    resolvablePackage: betterAuthPackage,
    expectedRule: "architecture/external-dependency-not-allowed",
  },
  {
    name: "backend-declaration-type-better-auth",
    form: ".d.mts",
    sourceText: `import type { Session } from "${betterAuthPackage}";\nexport interface Probe { session: Session }\n`,
    resolvablePackage: betterAuthPackage,
    expectedRule: "architecture/external-dependency-not-allowed",
  },
  {
    name: "backend-safe-ordinary-ts",
    form: ".ts",
    sourceText: "export const probe = true;\n",
  },
  {
    name: "backend-safe-mts",
    form: ".mts",
    sourceText: "export const probe = true;\n",
  },
  {
    name: "backend-safe-cts",
    form: ".cts",
    sourceText: "const probe = true;\nexport = probe;\n",
  },
];

const rejectedTechnologyCases = [
  {
    name: "rejected-prisma-mts",
    form: ".mts",
    sourceText: `import "${prismaClientPackage}";\nexport const probe = true;\n`,
    resolvablePackage: prismaClientPackage,
    expectedCategory: "prisma",
  },
  {
    name: "rejected-next-cts",
    form: ".cts",
    sourceText: `declare function require(specifier: string): unknown;\nconst probe = require("${nextPackage}");\nvoid probe;\n`,
    resolvablePackage: nextPackage,
    expectedCategory: "next",
  },
  {
    name: "rejected-safe-mts",
    form: ".mts",
    sourceText: "export const probe = true;\n",
  },
  {
    name: "rejected-safe-cts",
    form: ".cts",
    sourceText: "const probe = true;\nexport = probe;\n",
  },
];

const runArchitectureCase = async (fixture) => {
  const { root, fixturePath } = await createFixtureRoot(fixture);
  try {
    const compiler = compilerEvidence({ root, fixturePath, ...fixture });
    const discovery = await discoverFixtureSources(root);
    const inspected = discovery.policyInspectedProductionSourceFiles.includes(fixturePath);
    const sourceText = await readFile(path.join(root, fixturePath), "utf8");
    const manifest = {
      dependencies:
        fixture.resolvablePackage === undefined ? {} : { [fixture.resolvablePackage]: "1.0.0" },
    };
    const analysis = analyzeSourceText({
      sourceText,
      filePath: fixturePath,
      unitPolicy: backendPolicy,
      manifest,
      root,
    });
    const expectedNegative = fixture.expectedRule !== undefined;
    assert.equal(discovery.result, "PASS");
    assert.equal(discovery.uncoveredProductionSourceCount, 0);
    assert.equal(compiler.compilerIncluded, true);
    assert.equal(inspected, true);
    assert.equal(compiler.compilerDiagnostics, 0);
    if (expectedNegative) {
      assert.equal(compiler.forbiddenModuleResolved, true);
      assert.equal(analysis.requests.length, 1);
      assert.deepEqual(
        analysis.violations.map(({ rule }) => rule),
        [fixture.expectedRule],
      );
    } else {
      assert.deepEqual(analysis.violations, []);
    }
    return {
      fixture: fixture.name,
      sourceForm: fixture.form,
      compilerIncluded: true,
      policyInspected: true,
      compilerDiagnostics: 0,
      moduleResolved: compiler.forbiddenModuleResolved,
      intendedRule: fixture.expectedRule ?? null,
      violationCount: analysis.violations.length,
      result: expectedNegative ? "REJECTED_AS_EXPECTED" : "PASS",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const runRejectedTechnologyCase = async (fixture) => {
  const { root, fixturePath } = await createFixtureRoot(fixture);
  try {
    const compiler = compilerEvidence({ root, fixturePath, ...fixture });
    const discovery = await discoverFixtureSources(root);
    const inspected = discovery.policyInspectedProductionSourceFiles.includes(fixturePath);
    const scan = await scanRejectedTechnologySourceFiles({
      root,
      sourceFiles: discovery.policyInspectedProductionSourceFiles,
    });
    const fixtureFindings = scan.sourceFindings.filter(({ file }) => file === fixturePath);
    const expectedNegative = fixture.expectedCategory !== undefined;
    assert.equal(discovery.result, "PASS");
    assert.equal(discovery.uncoveredProductionSourceCount, 0);
    assert.equal(compiler.compilerIncluded, true);
    assert.equal(inspected, true);
    assert.equal(compiler.compilerDiagnostics, 0);
    if (expectedNegative) {
      assert.equal(compiler.forbiddenModuleResolved, true);
      assert.equal(
        collectModuleRequests(await readFile(path.join(root, fixturePath), "utf8"), fixturePath)
          .length,
        1,
      );
      assert.equal(fixtureFindings.length, 1);
      assert.equal(fixtureFindings[0].category, fixture.expectedCategory);
      assert.equal(fixtureFindings[0].authority, "normalized-semantic-dependency-universe");
    } else {
      assert.deepEqual(fixtureFindings, []);
    }
    return {
      fixture: fixture.name,
      sourceForm: fixture.form,
      compilerIncluded: true,
      policyInspected: true,
      compilerDiagnostics: 0,
      moduleResolved: compiler.forbiddenModuleResolved,
      intendedCategory: fixture.expectedCategory ?? null,
      semanticFindingCount: fixtureFindings.length,
      result: expectedNegative ? "REJECTED_AS_EXPECTED" : "PASS",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

export const runSourceDiscoveryFixtureSuite = async () => {
  const architectureOutcomes = [];
  for (const fixture of architectureCases) {
    architectureOutcomes.push(await runArchitectureCase(fixture));
  }
  const rejectedTechnologyOutcomes = [];
  for (const fixture of rejectedTechnologyCases) {
    rejectedTechnologyOutcomes.push(await runRejectedTechnologyCase(fixture));
  }
  return {
    schemaVersion: 1,
    result: "PASS",
    architecture: {
      fixtureCount: architectureOutcomes.length,
      rejectedFixtures: architectureOutcomes.filter(
        ({ result }) => result === "REJECTED_AS_EXPECTED",
      ).length,
      acceptedFixtures: architectureOutcomes.filter(({ result }) => result === "PASS").length,
      outcomes: architectureOutcomes,
    },
    rejectedTechnology: {
      fixtureCount: rejectedTechnologyOutcomes.length,
      rejectedFixtures: rejectedTechnologyOutcomes.filter(
        ({ result }) => result === "REJECTED_AS_EXPECTED",
      ).length,
      acceptedFixtures: rejectedTechnologyOutcomes.filter(({ result }) => result === "PASS").length,
      outcomes: rejectedTechnologyOutcomes,
    },
    unexpectedOrUnresolvedFailures: 0,
  };
};
