import { builtinModules } from "node:module";
import path from "node:path";

import ts from "typescript";

import {
  loadProductionCompilerProgram,
  scriptKindForProductionSource,
} from "./production-source-discovery.mjs";

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

const isStaticCssAssetDependency = ({ kind, specifier }) =>
  kind === "import" && typeof specifier === "string" && /\.css(?:[?#].*)?$/.test(specifier);

const normalizeRelativePath = (root, absolutePath) => {
  const relativePath = path.relative(path.resolve(root), path.resolve(absolutePath));
  if (relativePath === "") return ".";
  return relativePath.split(path.sep).join("/");
};

const sortedUnique = (values) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const literalText = (node) => {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
};

const sourceLocation = (sourceFile, node) => {
  const position = Math.max(0, node?.getStart?.(sourceFile) ?? node?.pos ?? 0);
  const point = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: point.line + 1, column: point.character + 1 };
};

const dependencyKey = ({ file, kind, specifier, line, column }) =>
  `${file}\0${kind}\0${specifier ?? "<computed>"}\0${line}\0${column}`;

const compilerReferenceKey = ({ file, compilerCategory, specifier }) =>
  `${file}\0${compilerCategory}\0${specifier}`;

const containsJsxSyntax = (sourceFile) => {
  let found = false;
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const pragmaValue = (sourceFile, name, argument) => {
  const pragma = sourceFile.pragmas?.get(name);
  const entry = Array.isArray(pragma) ? pragma[0] : pragma;
  const value = entry?.arguments?.[argument];
  return typeof value === "string" ? value : (value?.value ?? null);
};

const moduleRequestKind = (node) => {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent)) {
    return parent.importClause?.isTypeOnly === true ? "import-type" : "import";
  }
  if (ts.isExportDeclaration(parent)) return "export-from";
  if (ts.isExternalModuleReference(parent)) return "import-equals";
  if (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) return "import-type";
  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return "dynamic-import";
  }
  return null;
};

const unwrapExpression = (node) => {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const isDeclarationName = (node) => {
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  return (
    (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) &&
    parent.name === node
  );
};

const collectCreateRequireNames = (sourceFile) => {
  const factoryNames = new Set();
  const visitImports = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      literalText(node.moduleSpecifier) === "node:module" &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === "createRequire") {
          factoryNames.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(sourceFile);

  const loaderNames = new Set();
  const visitLoaders = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        factoryNames.has(initializer.expression.text)
      ) {
        loaderNames.add(node.name.text);
      }
    }
    ts.forEachChild(node, visitLoaders);
  };
  visitLoaders(sourceFile);
  return { factoryNames, loaderNames };
};

const collectUnsupportedLoaderConstructs = ({
  sourceFile,
  filePath,
  factoryNames,
  loaderNames,
}) => {
  const unsupported = [];
  const add = (node, construct, message) => {
    unsupported.push({
      file: filePath,
      ...sourceLocation(sourceFile, node),
      rule: "architecture/unsupported-module-loader-alias",
      construct,
      message,
    });
  };

  const supportedLoaderReference = (node) => {
    const parent = node.parent;
    if (isDeclarationName(node)) return true;
    if (ts.isTypeOfExpression(parent)) return true;
    if (ts.isCallExpression(parent) && parent.expression === node) return true;
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === node &&
      parent.name.text === "resolve" &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.expression === parent
    ) {
      return true;
    }
    return false;
  };

  const supportedFactoryReference = (node) => {
    if (isDeclarationName(node)) return true;
    const parent = node.parent;
    return ts.isCallExpression(parent) && parent.expression === node;
  };

  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      if (factoryNames.has(node.text) && !supportedFactoryReference(node)) {
        add(
          node,
          "create-require-factory-alias",
          "createRequire may only be invoked directly; aliasing or exporting the factory is unsupported",
        );
      } else if (node.text === "require" && !supportedLoaderReference(node)) {
        const parent = node.parent;
        const construct =
          ts.isPropertyAccessExpression(parent) && parent.name.text === "resolve"
            ? "require-resolve-alias"
            : "require-alias";
        add(
          node,
          construct,
          "The runtime module loader may only be called directly; aliases and derived values fail closed",
        );
      } else if (loaderNames.has(node.text) && !supportedLoaderReference(node)) {
        const parent = node.parent;
        const construct =
          ts.isPropertyAccessExpression(parent) && parent.name.text === "resolve"
            ? "create-require-resolve-alias"
            : "create-require-loader-alias";
        add(
          node,
          construct,
          "A createRequire-derived loader may only be called directly; aliases and derived values fail closed",
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const expression = unwrapExpression(node.expression);
      if (
        ts.isIdentifier(expression) &&
        factoryNames.has(expression.text) &&
        !(
          ts.isVariableDeclaration(node.parent) &&
          ts.isIdentifier(node.parent.name) &&
          node.parent.initializer === node
        )
      ) {
        add(
          node,
          "unsupported-create-require-result",
          "createRequire results must be bound once to a direct identifier before use",
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const seen = new Set();
  return unsupported.filter((finding) => {
    const key = `${finding.file}:${finding.line}:${finding.column}:${finding.construct}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const collectSyntacticDependenciesFromSourceFile = ({ sourceFile, filePath }) => {
  const dependencies = [];
  const { factoryNames, loaderNames } = collectCreateRequireNames(sourceFile);
  const add = ({ node, kind, argument, compilerCategory = "module", mechanism }) => {
    const specifier = literalText(argument);
    dependencies.push({
      file: filePath,
      kind,
      category: mechanism,
      mechanism,
      compilerCategory,
      specifier,
      computed: specifier === null,
      ...sourceLocation(sourceFile, node),
      _node: argument,
    });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      add({
        node,
        kind: node.importClause?.isTypeOnly === true ? "import-type" : "import",
        argument: node.moduleSpecifier,
        mechanism: "compiler-module-resolution",
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add({
        node,
        kind: "export-from",
        argument: node.moduleSpecifier,
        mechanism: "compiler-module-resolution",
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      add({
        node,
        kind: "import-equals",
        argument: node.moduleReference.expression,
        mechanism: "compiler-module-resolution",
      });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add({
        node,
        kind: "import-type",
        argument: node.argument.literal,
        mechanism: "type-declaration-dependency",
      });
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add({
          node,
          kind: "dynamic-import",
          argument: node.arguments[0] ?? node.expression,
          mechanism: "compiler-module-resolution",
        });
      } else if (
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "require" || loaderNames.has(node.expression.text))
      ) {
        add({
          node,
          kind: node.expression.text === "require" ? "require" : "create-require",
          argument: node.arguments[0] ?? node.expression,
          compilerCategory: null,
          mechanism: "runtime-loader-dependency",
        });
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        (node.expression.expression.text === "require" ||
          loaderNames.has(node.expression.expression.text)) &&
        node.expression.name.text === "resolve"
      ) {
        add({
          node,
          kind:
            node.expression.expression.text === "require"
              ? "require-resolve"
              : "create-require-resolve",
          argument: node.arguments[0] ?? node.expression,
          compilerCategory: null,
          mechanism: "runtime-loader-dependency",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const reference of sourceFile.typeReferenceDirectives ?? []) {
    dependencies.push({
      file: filePath,
      kind: "type-reference-directive",
      category: "type-declaration-dependency",
      mechanism: "type-declaration-dependency",
      compilerCategory: "type-reference",
      specifier: reference.fileName,
      computed: false,
      ...sourceLocation(sourceFile, reference),
      _node: reference,
    });
  }
  for (const reference of sourceFile.referencedFiles ?? []) {
    dependencies.push({
      file: filePath,
      kind: "path-reference-directive",
      category: "type-declaration-dependency",
      mechanism: "type-declaration-dependency",
      compilerCategory: "path-reference",
      specifier: reference.fileName,
      computed: false,
      ...sourceLocation(sourceFile, reference),
      _node: reference,
    });
  }
  for (const augmentation of sourceFile.moduleAugmentations ?? []) {
    dependencies.push({
      file: filePath,
      kind: "external-module-augmentation",
      category: "type-declaration-dependency",
      mechanism: "type-declaration-dependency",
      compilerCategory: "module",
      specifier: augmentation.text,
      computed: false,
      ...sourceLocation(sourceFile, augmentation),
      _node: augmentation,
    });
  }

  const unique = new Map();
  for (const dependency of dependencies) unique.set(dependencyKey(dependency), dependency);
  return {
    dependencies: [...unique.values()],
    unsupportedDependencyConstructs: collectUnsupportedLoaderConstructs({
      sourceFile,
      filePath,
      factoryNames,
      loaderNames,
    }),
  };
};

const resolveModule = ({ program, sourceFile, specifier }) => {
  if (builtins.has(specifier) || specifier.startsWith("node:")) {
    return { resolutionStatus: "BUILTIN", resolvedFile: null, resolvedPackage: null };
  }
  const resolution = ts.resolveModuleName(
    specifier,
    sourceFile.fileName,
    program.getCompilerOptions(),
    ts.sys,
    program.getModuleResolutionCache(),
  ).resolvedModule;
  return resolution === undefined
    ? { resolutionStatus: "UNRESOLVED", resolvedFile: null, resolvedPackage: null }
    : {
        resolutionStatus: "RESOLVED",
        resolvedFile: resolution.resolvedFileName,
        resolvedPackage: resolution.packageId?.name ?? null,
      };
};

const resolveTypeReference = ({ program, sourceFile, specifier }) => {
  const resolution = ts.resolveTypeReferenceDirective(
    specifier,
    sourceFile.fileName,
    program.getCompilerOptions(),
    ts.sys,
  ).resolvedTypeReferenceDirective;
  return resolution === undefined
    ? { resolutionStatus: "UNRESOLVED", resolvedFile: null, resolvedPackage: null }
    : {
        resolutionStatus: "RESOLVED",
        resolvedFile: resolution.resolvedFileName,
        resolvedPackage: resolution.packageId?.name ?? null,
      };
};

const resolvePathReference = ({ program, sourceFile, specifier }) => {
  const resolvedFileName = ts.resolveTripleslashReference(specifier, sourceFile.fileName);
  return program.getSourceFile(resolvedFileName) === undefined
    ? { resolutionStatus: "UNRESOLVED", resolvedFile: null, resolvedPackage: null }
    : { resolutionStatus: "RESOLVED", resolvedFile: resolvedFileName, resolvedPackage: null };
};

const resolveDependency = ({ root, program, sourceFile, dependency }) => {
  if (dependency.specifier === null) {
    return { ...dependency, resolutionStatus: "COMPUTED", resolvedFile: null };
  }
  const resolution =
    dependency.kind === "type-reference-directive"
      ? resolveTypeReference({ program, sourceFile, specifier: dependency.specifier })
      : dependency.kind === "path-reference-directive"
        ? resolvePathReference({ program, sourceFile, specifier: dependency.specifier })
        : resolveModule({ program, sourceFile, specifier: dependency.specifier });
  const classifiedResolution =
    resolution.resolutionStatus === "UNRESOLVED" && isStaticCssAssetDependency(dependency)
      ? {
          ...resolution,
          resolutionStatus: "NON_TYPESCRIPT_ASSET",
          assetKind: "css",
          classification:
            "Static CSS asset import: visible to architecture policy but not a TypeScript-resolved TS/JS module edge",
        }
      : resolution;
  return {
    ...dependency,
    ...(classifiedResolution.resolutionStatus === "NON_TYPESCRIPT_ASSET"
      ? { category: "non-typescript-asset-dependency" }
      : {}),
    ...classifiedResolution,
    resolvedFile:
      classifiedResolution.resolvedFile === null
        ? null
        : normalizeRelativePath(root, classifiedResolution.resolvedFile),
  };
};

const compilerResolutionSummary = (resolution) => {
  const resolved = resolution?.resolvedModule ?? resolution?.resolvedTypeReferenceDirective;
  if (resolved === undefined) {
    return { resolutionStatus: "UNRESOLVED", resolvedFile: null, resolvedPackage: null };
  }
  return {
    resolutionStatus: "RESOLVED",
    resolvedFile: resolved.resolvedFileName,
    resolvedPackage: resolved.packageId?.name ?? null,
  };
};

const collectCompilerReferences = ({
  root,
  program,
  sourceFile,
  filePath,
  dependencies,
  hasJsx,
}) => {
  const references = [];
  const exclusions = [];
  const syntacticModuleSpecifiers = new Set(
    dependencies
      .filter(({ compilerCategory }) => compilerCategory === "module")
      .map(({ specifier }) => specifier)
      .filter((specifier) => specifier !== null),
  );
  const syntheticModuleSpecifiers = new Set(
    (sourceFile.imports ?? [])
      .filter((moduleSpecifier) => moduleSpecifier.pos < 0)
      .map(({ text }) => text),
  );

  program.forEachResolvedModule((resolution, specifier) => {
    if (
      syntheticModuleSpecifiers.has(specifier) &&
      !hasJsx &&
      !syntacticModuleSpecifiers.has(specifier)
    ) {
      exclusions.push({
        file: filePath,
        compilerCategory: "module",
        specifier,
        reason:
          "TypeScript caches an automatic JSX runtime candidate for this non-JSX source; no emitted/source dependency exists",
      });
      return;
    }
    const summary = compilerResolutionSummary(resolution);
    references.push({
      file: filePath,
      compilerCategory: "module",
      specifier,
      ...summary,
      resolvedFile:
        summary.resolvedFile === null ? null : normalizeRelativePath(root, summary.resolvedFile),
    });
  }, sourceFile);

  program.forEachResolvedTypeReferenceDirective((resolution, specifier) => {
    const summary = compilerResolutionSummary(resolution);
    references.push({
      file: filePath,
      compilerCategory: "type-reference",
      specifier,
      ...summary,
      resolvedFile:
        summary.resolvedFile === null ? null : normalizeRelativePath(root, summary.resolvedFile),
    });
  }, sourceFile);

  for (const dependency of dependencies) {
    if (
      (dependency.kind === "external-module-augmentation" ||
        dependency.kind === "path-reference-directive") &&
      dependency.specifier !== null
    ) {
      references.push({
        file: filePath,
        compilerCategory: dependency.compilerCategory,
        specifier: dependency.specifier,
        resolutionStatus: dependency.resolutionStatus,
        resolvedFile: dependency.resolvedFile,
        resolvedPackage: dependency.resolvedPackage ?? null,
      });
    }
  }

  const uniqueReferences = new Map();
  for (const reference of references) {
    uniqueReferences.set(compilerReferenceKey(reference), reference);
  }
  const uniqueExclusions = new Map();
  for (const exclusion of exclusions) {
    uniqueExclusions.set(compilerReferenceKey(exclusion), exclusion);
  }
  return {
    references: [...uniqueReferences.values()],
    exclusions: [...uniqueExclusions.values()],
  };
};

const collectProgramSourceDependencies = ({ root, program, sourceFile, filePath }) => {
  const syntax = collectSyntacticDependenciesFromSourceFile({ sourceFile, filePath });
  const hasJsx = containsJsxSyntax(sourceFile);
  const dependencies = [...syntax.dependencies];
  if (hasJsx) {
    const implicitModules = (sourceFile.imports ?? []).filter(
      (moduleSpecifier) => moduleSpecifier.pos < 0,
    );
    for (const moduleSpecifier of implicitModules) {
      dependencies.push({
        file: filePath,
        kind: "implicit-jsx-runtime",
        category: "implicit-compiler-generated-dependency",
        mechanism: "implicit-compiler-generated-dependency",
        compilerCategory: "module",
        specifier: moduleSpecifier.text,
        computed: false,
        line: 1,
        column: 1,
        jsxImportSource: pragmaValue(sourceFile, "jsximportsource", "factory"),
        _node: moduleSpecifier,
      });
    }
  }

  const resolvedDependencies = dependencies.map((dependency) =>
    resolveDependency({ root, program, sourceFile, dependency }),
  );
  const compiler = collectCompilerReferences({
    root,
    program,
    sourceFile,
    filePath,
    dependencies: resolvedDependencies,
    hasJsx,
  });
  const compilerKeys = new Set(compiler.references.map(compilerReferenceKey));
  const publicDependencies = resolvedDependencies.map(({ _node: _ignored, ...dependency }) => ({
    ...dependency,
    compilerKnown:
      dependency.specifier !== null &&
      dependency.compilerCategory !== null &&
      compilerKeys.has(compilerReferenceKey(dependency)),
  }));
  return {
    dependencies: publicDependencies,
    unsupportedDependencyConstructs: syntax.unsupportedDependencyConstructs,
    compilerReferences: compiler.references,
    compilerExclusions: compiler.exclusions,
  };
};

export const collectNormalizedSourceDependencies = ({
  sourceText,
  fileName,
  compilerOptions = {},
}) => {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForProductionSource(fileName),
  );
  const syntax = collectSyntacticDependenciesFromSourceFile({
    sourceFile,
    filePath: fileName,
  });
  const dependencies = syntax.dependencies.map(({ _node: _ignored, ...dependency }) => dependency);
  return {
    dependencies,
    unsupportedDependencyConstructs: syntax.unsupportedDependencyConstructs,
    parserDiagnosticCount: sourceFile.parseDiagnostics?.length ?? 0,
    compilerOptionsUsed: {
      jsx: compilerOptions.jsx ?? null,
      jsxImportSource: compilerOptions.jsxImportSource ?? null,
    },
  };
};

export const collectModuleRequests = (sourceText, fileName) =>
  collectNormalizedSourceDependencies({ sourceText, fileName }).dependencies;

export const evaluateDependencyCoverage = ({
  compilerReferences,
  normalizedDependencies,
  unsupportedDependencyConstructs,
  parserDiagnosticCount = 0,
}) => {
  const normalizedCompilerKeys = new Set(
    normalizedDependencies
      .filter(({ specifier, compilerCategory }) => specifier !== null && compilerCategory !== null)
      .map(compilerReferenceKey),
  );
  const unexplainedCompilerDependencyReferences = compilerReferences.filter(
    (reference) => !normalizedCompilerKeys.has(compilerReferenceKey(reference)),
  );
  const result =
    unexplainedCompilerDependencyReferences.length === 0 &&
    unsupportedDependencyConstructs.length === 0 &&
    parserDiagnosticCount === 0
      ? "PASS"
      : "FAIL";
  return { result, unexplainedCompilerDependencyReferences };
};

export const discoverProductionDependencyUniverse = async ({
  root = process.cwd(),
  tsconfigPath = "tooling/ci/tsconfig.typecheck.json",
  sourceDiscovery,
}) => {
  if (sourceDiscovery === undefined) {
    throw new Error("Dependency discovery requires authoritative production-source discovery");
  }
  const { program } = loadProductionCompilerProgram({ root, tsconfigPath });
  const compilerDiagnostics = ts.getPreEmitDiagnostics(program);
  const normalizedDependencies = [];
  const unsupportedDependencyConstructs = [];
  const compilerReferences = [];
  const compilerDependencyExclusions = [];
  const missingCompilerSourceFiles = [];

  for (const filePath of sourceDiscovery.policyInspectedProductionSourceFiles) {
    const sourceFile = program.getSourceFile(path.resolve(root, filePath));
    if (sourceFile === undefined) {
      missingCompilerSourceFiles.push(filePath);
      continue;
    }
    const collected = collectProgramSourceDependencies({
      root,
      program,
      sourceFile,
      filePath,
    });
    normalizedDependencies.push(...collected.dependencies);
    unsupportedDependencyConstructs.push(...collected.unsupportedDependencyConstructs);
    compilerReferences.push(...collected.compilerReferences);
    compilerDependencyExclusions.push(...collected.compilerExclusions);
  }

  const uniqueCompilerReferences = new Map();
  for (const reference of compilerReferences) {
    uniqueCompilerReferences.set(compilerReferenceKey(reference), reference);
  }
  const coverage = evaluateDependencyCoverage({
    compilerReferences: [...uniqueCompilerReferences.values()],
    normalizedDependencies,
    unsupportedDependencyConstructs,
    parserDiagnosticCount: missingCompilerSourceFiles.length,
  });
  const result =
    sourceDiscovery.result === "PASS" &&
    compilerDiagnostics.length === 0 &&
    missingCompilerSourceFiles.length === 0 &&
    coverage.result === "PASS"
      ? "PASS"
      : "FAIL";

  const dependenciesByFile = Object.fromEntries(
    sourceDiscovery.policyInspectedProductionSourceFiles.map((filePath) => [
      filePath,
      normalizedDependencies.filter((dependency) => dependency.file === filePath),
    ]),
  );

  return {
    schemaVersion: 1,
    result,
    authority:
      "TypeScript Program resolution cross-checked against one normalized repository-owned dependency universe",
    supportedDependencyForms: [
      "import",
      "export-from",
      "import-type",
      "import-equals",
      "dynamic-import",
      "direct-require",
      "direct-require-resolve",
      "direct-create-require",
      "direct-create-require-resolve",
      "automatic-jsx-runtime",
      "jsx-import-source",
      "type-reference-directive",
      "path-reference-directive",
      "external-module-augmentation",
      "static-css-asset-import",
    ],
    unsupportedDependencyPolicy:
      "Unsupported or aliased runtime module-loader mechanisms fail closed",
    assetDependencyPolicy:
      "Only static imports ending in .css are classified as non-TypeScript assets; they remain normalized and are evaluated by package-boundary policy",
    compilerDiagnosticCount: compilerDiagnostics.length,
    compilerDiagnostics: compilerDiagnostics.map((diagnostic) => ({
      file:
        diagnostic.file === undefined
          ? null
          : normalizeRelativePath(root, diagnostic.file.fileName),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    })),
    compilerProductionSourceCount: sourceDiscovery.compilerResolvedProductionSourceCount,
    policyProductionSourceCount: sourceDiscovery.policyInspectedProductionSourceCount,
    uncoveredProductionSourceCount: sourceDiscovery.uncoveredProductionSourceCount,
    compilerKnownArchitecturalDependencyCount: uniqueCompilerReferences.size,
    normalizedPolicyDependencyCount: normalizedDependencies.length,
    unexplainedCompilerDependencyReferenceCount:
      coverage.unexplainedCompilerDependencyReferences.length,
    unsupportedDependencyConstructCount: unsupportedDependencyConstructs.length,
    unresolvedNormalizedDependencyCount: normalizedDependencies.filter(
      ({ resolutionStatus }) => resolutionStatus === "UNRESOLVED",
    ).length,
    nonTypeScriptAssetDependencyCount: normalizedDependencies.filter(
      ({ resolutionStatus }) => resolutionStatus === "NON_TYPESCRIPT_ASSET",
    ).length,
    missingCompilerSourceFiles,
    compilerKnownDependencyReferences: [...uniqueCompilerReferences.values()],
    normalizedDependencies,
    nonTypeScriptAssetDependencies: normalizedDependencies.filter(
      ({ resolutionStatus }) => resolutionStatus === "NON_TYPESCRIPT_ASSET",
    ),
    dependenciesByFile,
    compilerDependencyExclusions,
    unexplainedCompilerDependencyReferences: coverage.unexplainedCompilerDependencyReferences,
    unsupportedDependencyConstructs,
  };
};

export const dependencyUniverseSummary = (universe) => ({
  schemaVersion: universe.schemaVersion,
  result: universe.result,
  authority: universe.authority,
  compilerDiagnosticCount: universe.compilerDiagnosticCount,
  compilerProductionSourceCount: universe.compilerProductionSourceCount,
  policyProductionSourceCount: universe.policyProductionSourceCount,
  uncoveredProductionSourceCount: universe.uncoveredProductionSourceCount,
  compilerKnownArchitecturalDependencyCount: universe.compilerKnownArchitecturalDependencyCount,
  normalizedPolicyDependencyCount: universe.normalizedPolicyDependencyCount,
  unexplainedCompilerDependencyReferenceCount: universe.unexplainedCompilerDependencyReferenceCount,
  unsupportedDependencyConstructCount: universe.unsupportedDependencyConstructCount,
  unresolvedNormalizedDependencyCount: universe.unresolvedNormalizedDependencyCount,
  nonTypeScriptAssetDependencyCount: universe.nonTypeScriptAssetDependencyCount,
  compilerDependencyExclusionCount: universe.compilerDependencyExclusions.length,
  supportedDependencyForms: universe.supportedDependencyForms,
  unsupportedDependencyPolicy: universe.unsupportedDependencyPolicy,
  assetDependencyPolicy: universe.assetDependencyPolicy,
});

export const dependencyRequestKindForCompilerLiteral = moduleRequestKind;
export const uniqueDependencySpecifiers = (dependencies) =>
  sortedUnique(
    dependencies.map(({ specifier }) => specifier).filter((specifier) => specifier !== null),
  );
