import { readdir } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const sortedUnique = (values) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

export const productionSourceForms = Object.freeze([
  ".d.mts",
  ".d.cts",
  ".d.ts",
  ".mts",
  ".cts",
  ".tsx",
  ".ts",
  ".mjs",
  ".cjs",
  ".jsx",
  ".js",
]);

export const dependencyCruiserResolverExtensions = Object.freeze([
  ...productionSourceForms,
  ".json",
]);

const sourceFormsBySpecificity = [...productionSourceForms].sort(
  (left, right) => right.length - left.length || left.localeCompare(right),
);
const skippedDirectoryNames = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);

export const classifyProductionSourcePath = (filePath) => {
  const form = sourceFormsBySpecificity.find((candidate) => filePath.endsWith(candidate));
  if (form === undefined) return null;
  return {
    form,
    declaration: form.startsWith(".d."),
    language: form.includes("js") ? "javascript" : "typescript",
  };
};

export const isProductionSourcePath = (filePath) => classifyProductionSourcePath(filePath) !== null;

export const scriptKindForProductionSource = (filePath) => {
  const source = classifyProductionSourcePath(filePath);
  if (source === null) {
    throw new Error(`Unsupported architecture/security source form: ${filePath}`);
  }
  if (source.form === ".tsx") return ts.ScriptKind.TSX;
  if (source.form === ".jsx") return ts.ScriptKind.JSX;
  if (source.language === "javascript") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

export const evaluateProductionSourceDiscoveryCoverage = ({
  uncoveredCompilerResolvedProductionFiles,
  unsupportedCompilerResolvedProductionFiles,
}) => {
  const gaps = [
    ...uncoveredCompilerResolvedProductionFiles.map((filePath) => ({
      kind: "COMPILER_SOURCE_NOT_INSPECTED",
      path: filePath,
    })),
    ...unsupportedCompilerResolvedProductionFiles.map((filePath) => ({
      kind: "COMPILER_SOURCE_FORM_UNSUPPORTED",
      path: filePath,
    })),
  ].sort((left, right) => `${left.path}:${left.kind}`.localeCompare(`${right.path}:${right.kind}`));
  return { result: gaps.length === 0 ? "PASS" : "FAIL", gaps };
};

const normalizeRelativePath = (root, absolutePath) => {
  const relativePath = path.relative(path.resolve(root), path.resolve(absolutePath));
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    return null;
  }
  return relativePath.split(path.sep).join("/");
};

const isWithin = (candidate, directory) =>
  candidate === directory || candidate.startsWith(`${directory}/`);

const sourceUnit = (relativePath, units) =>
  units.find((unit) => isWithin(relativePath, path.posix.join(unit.root, "src"))) ?? null;

const collectDirectorySources = async ({ root, relativeDirectory, required }) => {
  const files = [];
  const walk = async (directory) => {
    let entries;
    try {
      entries = await readdir(path.join(root, directory), { withFileTypes: true });
    } catch (error) {
      if (!required && error?.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Production-source discovery may not follow symbolic links: ${relativePath}`,
        );
      }
      if (entry.isDirectory()) {
        if (!skippedDirectoryNames.has(entry.name)) await walk(relativePath);
      } else if (isProductionSourcePath(relativePath)) {
        files.push(relativePath);
      }
    }
  };
  await walk(relativeDirectory);
  return files;
};

const formatDiagnostics = (diagnostics) =>
  ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });

export const loadProductionCompilerProgram = ({ root, tsconfigPath }) => {
  const absoluteConfigPath = path.resolve(root, tsconfigPath);
  const config = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(
      `TypeScript project configuration could not be read:\n${formatDiagnostics([config.error])}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(absoluteConfigPath),
    undefined,
    absoluteConfigPath,
  );
  if (parsed.errors.length !== 0) {
    throw new Error(
      `TypeScript project configuration is invalid:\n${formatDiagnostics(parsed.errors)}`,
    );
  }
  return {
    parsed,
    program: ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      projectReferences: parsed.projectReferences,
    }),
  };
};

export const discoverProductionSourceFiles = async ({
  root = process.cwd(),
  tsconfigPath = "tooling/ci/tsconfig.typecheck.json",
  units,
}) => {
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error("Production-source discovery requires at least one architecture unit");
  }
  const normalizedUnits = units.map(({ packageName, root: unitRoot }) => ({
    packageName,
    root: unitRoot.split(path.sep).join("/"),
  }));
  if (
    new Set(normalizedUnits.map(({ packageName }) => packageName)).size !==
      normalizedUnits.length ||
    new Set(normalizedUnits.map(({ root: unitRoot }) => unitRoot)).size !== normalizedUnits.length
  ) {
    throw new Error("Production-source discovery requires unique unit names and roots");
  }

  const physicalFiles = [];
  for (const unit of normalizedUnits) {
    physicalFiles.push(
      ...(await collectDirectorySources({
        root,
        relativeDirectory: path.posix.join(unit.root, "src"),
        required: true,
      })),
    );
  }
  const policyInspectedProductionSourceFiles = sortedUnique(physicalFiles);

  const { parsed, program } = loadProductionCompilerProgram({ root, tsconfigPath });
  const compilerResolvedFiles = [];
  const explicitCompilerResourceExclusions = [];
  const unsupportedCompilerResolvedProductionFiles = [];
  for (const sourceFile of program.getSourceFiles()) {
    const relativePath = normalizeRelativePath(root, sourceFile.fileName);
    if (relativePath === null || sourceUnit(relativePath, normalizedUnits) === null) continue;
    const classification = classifyProductionSourcePath(relativePath);
    if (classification !== null) {
      compilerResolvedFiles.push(relativePath);
    } else if (relativePath.endsWith(".json")) {
      explicitCompilerResourceExclusions.push({
        path: relativePath,
        reason: "JSON modules are typed data resources and cannot introduce module declarations",
      });
    } else {
      unsupportedCompilerResolvedProductionFiles.push(relativePath);
    }
  }

  const compilerResolvedProductionSourceFiles = sortedUnique(compilerResolvedFiles);
  const policyFileSet = new Set(policyInspectedProductionSourceFiles);
  const uncoveredCompilerResolvedProductionFiles = compilerResolvedProductionSourceFiles.filter(
    (filePath) => !policyFileSet.has(filePath),
  );
  const compilerFileSet = new Set(compilerResolvedProductionSourceFiles);
  const policyOnlyProductionSourceFiles = policyInspectedProductionSourceFiles.filter(
    (filePath) => !compilerFileSet.has(filePath),
  );
  const filesByUnit = Object.fromEntries(
    normalizedUnits.map((unit) => [
      unit.packageName,
      policyInspectedProductionSourceFiles.filter(
        (filePath) => sourceUnit(filePath, normalizedUnits)?.packageName === unit.packageName,
      ),
    ]),
  );
  const coverage = evaluateProductionSourceDiscoveryCoverage({
    uncoveredCompilerResolvedProductionFiles,
    unsupportedCompilerResolvedProductionFiles,
  });

  return {
    schemaVersion: 1,
    result: coverage.result,
    authority:
      "TypeScript compiler-program inclusion cross-checked against one repository-owned source classifier",
    tsconfigPath,
    compilerProjectRootFiles: parsed.fileNames.length,
    compilerResolvedProductionSourceCount: compilerResolvedProductionSourceFiles.length,
    policyInspectedProductionSourceCount: policyInspectedProductionSourceFiles.length,
    uncoveredProductionSourceCount: uncoveredCompilerResolvedProductionFiles.length,
    compilerResolvedProductionSourceFiles,
    policyInspectedProductionSourceFiles,
    uncoveredCompilerResolvedProductionFiles,
    unsupportedCompilerResolvedProductionFiles,
    coverageGaps: coverage.gaps,
    policyOnlyProductionSourceFiles,
    explicitCompilerResourceExclusions,
    supportedSourceForms: [...productionSourceForms],
    filesByUnit,
  };
};

export const discoverRepositoryPolicySourceFiles = async ({
  root = process.cwd(),
  tsconfigPath = "tooling/ci/tsconfig.typecheck.json",
  units,
  additionalDirectories = ["apps", "packages", "tooling"],
  includeRootFiles = true,
}) => {
  const production = await discoverProductionSourceFiles({ root, tsconfigPath, units });
  const additionalFiles = [];
  for (const relativeDirectory of additionalDirectories) {
    additionalFiles.push(
      ...(await collectDirectorySources({ root, relativeDirectory, required: false })),
    );
  }
  if (includeRootFiles) {
    const rootEntries = await readdir(root, { withFileTypes: true });
    rootEntries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of rootEntries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && isProductionSourcePath(entry.name)) additionalFiles.push(entry.name);
    }
  }
  const sourceFiles = sortedUnique([
    ...production.policyInspectedProductionSourceFiles,
    ...additionalFiles,
  ]);
  const productionSet = new Set(production.policyInspectedProductionSourceFiles);
  return {
    schemaVersion: 1,
    result: production.result,
    production,
    sourceFiles,
    supplementalPolicySourceFiles: sourceFiles.filter((filePath) => !productionSet.has(filePath)),
  };
};
