import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  analyzeManifestForUnit,
  analyzeSourceText,
  architecturePolicy,
  collectModuleRequests,
} from "./package-boundary-policy.mjs";

const root = process.cwd();
const fixtureDirectory = path.join(root, "tooling/architecture/fixtures/layered-boundaries");
const cases = JSON.parse(await readFile(path.join(fixtureDirectory, "cases.json"), "utf8"));

const parseTypeScriptConfig = () => {
  const configPath = path.join(root, "tsconfig.base.json");
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  }
  return ts.parseJsonConfigFileContent(loaded.config, ts.sys, root).options;
};

const compilerOptions = parseTypeScriptConfig();
const unitFor = (name) =>
  architecturePolicy.units.find((candidate) => candidate.packageName === name);

const verifyLiteralResolution = (sourceText, fixturePath) => {
  const requests = collectModuleRequests(sourceText, fixturePath);
  const unresolved = [];
  const resolved = [];
  for (const request of requests) {
    const specifier = request.specifier;
    if (
      specifier === null ||
      specifier.startsWith(".") ||
      specifier.startsWith("/") ||
      specifier.startsWith("node:")
    ) {
      continue;
    }
    const resolution = ts.resolveModuleName(
      specifier,
      path.join(root, fixturePath),
      compilerOptions,
      ts.sys,
    ).resolvedModule;
    if (resolution === undefined) unresolved.push(specifier);
    else
      resolved.push({ specifier, resolvedFile: path.relative(root, resolution.resolvedFileName) });
  }
  return { unresolved, resolved };
};

const runCase = async (fixtureCase) => {
  const unitPolicy = unitFor(fixtureCase.unit);
  if (unitPolicy === undefined) {
    return { result: "FIXTURE_VALIDATION_ERROR", reason: "unknown-unit", fixtureCase };
  }
  const manifest = {
    name: fixtureCase.unit,
    dependencies: fixtureCase.declaredDependencies,
    exports: Object.fromEntries((unitPolicy.allowedExports ?? []).map((key) => [key, {}])),
  };

  let violations;
  let resolution = { unresolved: [], resolved: [] };
  if (fixtureCase.mode === "manifest") {
    violations = analyzeManifestForUnit({
      unitPolicy,
      manifest,
      manifestPath: `${unitPolicy.root}/package.json`,
    });
  } else if (fixtureCase.mode === "source") {
    const sourceText = await readFile(path.join(root, fixtureCase.file), "utf8");
    resolution = verifyLiteralResolution(sourceText, fixtureCase.file);
    if (resolution.unresolved.length !== 0) {
      return {
        result: "FIXTURE_VALIDATION_ERROR",
        reason: "unresolved-literal-import",
        fixture: fixtureCase.name,
        unresolved: resolution.unresolved,
      };
    }
    violations = analyzeSourceText({
      sourceText,
      filePath: fixtureCase.file,
      unitPolicy,
      manifest,
      root,
    }).violations;
  } else {
    return { result: "FIXTURE_VALIDATION_ERROR", reason: "unknown-mode", fixtureCase };
  }

  if (violations.length !== 1 || violations[0].rule !== fixtureCase.expectedRule) {
    return {
      result: "FIXTURE_VALIDATION_ERROR",
      reason: "unexpected-violation-set",
      fixture: fixtureCase.name,
      expectedRule: fixtureCase.expectedRule,
      violations,
      resolution,
    };
  }
  return {
    schemaVersion: 1,
    result: "REJECTED_AS_EXPECTED",
    fixture: fixtureCase.name,
    mode: fixtureCase.mode,
    unit: fixtureCase.unit,
    intendedRule: fixtureCase.expectedRule,
    violationCount: 1,
    unresolvedLiteralImports: 0,
    resolvedLiteralImports: resolution.resolved,
  };
};

const requestedCase = process.argv.find((argument) => argument.startsWith("--case="))?.slice(7);
if (requestedCase !== undefined) {
  const fixtureCase = cases.find((candidate) => candidate.name === requestedCase);
  if (fixtureCase === undefined) {
    console.error(JSON.stringify({ result: "FIXTURE_VALIDATION_ERROR", reason: "unknown-case" }));
    process.exit(2);
  }
  const result = await runCase(fixtureCase);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.result === "REJECTED_AS_EXPECTED" ? 1 : 2);
}

const outcomes = [];
for (const fixtureCase of cases) {
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), `--case=${fixtureCase.name}`],
    { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  let report;
  try {
    report = JSON.parse(child.stdout);
  } catch {
    throw new Error(
      `Architecture fixture ${fixtureCase.name} did not return JSON: ${child.stderr}`,
    );
  }
  if (
    child.status !== 1 ||
    report.result !== "REJECTED_AS_EXPECTED" ||
    report.intendedRule !== fixtureCase.expectedRule ||
    report.violationCount !== 1 ||
    report.unresolvedLiteralImports !== 0
  ) {
    throw new Error(
      `Architecture fixture ${fixtureCase.name} failed its rejection contract: ${JSON.stringify({
        exitCode: child.status,
        report,
        stderr: child.stderr,
      })}`,
    );
  }
  outcomes.push({
    fixture: report.fixture,
    mode: report.mode,
    unit: report.unit,
    processExitCode: child.status,
    intendedRule: report.intendedRule,
    violationCount: report.violationCount,
    unresolvedLiteralImports: report.unresolvedLiteralImports,
    resolvedLiteralImports: report.resolvedLiteralImports,
  });
}

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      fixtureCount: outcomes.length,
      expectedRejections: outcomes.length,
      unexpectedOrUnresolvedFailures: 0,
      outcomes,
    },
    null,
    2,
  ),
);
