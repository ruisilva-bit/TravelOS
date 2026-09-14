import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  collectNormalizedSourceDependencies,
  dependencyUniverseSummary,
  discoverProductionDependencyUniverse,
} from "./dependency-universe.mjs";
import { discoverProductionSourceFiles } from "./production-source-discovery.mjs";

export { collectModuleRequests } from "./dependency-universe.mjs";

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

const unit = ({
  packageName,
  root,
  layer,
  workspace = [],
  external = [],
  builtins: allowedBuiltins = [],
  development = [],
  exports: allowedExports,
}) => ({
  packageName,
  root,
  layer,
  allowedWorkspaceSpecifiers: workspace,
  allowedExternalPackages: external,
  allowedBuiltinSpecifiers: allowedBuiltins,
  allowedDevelopmentPackages: development,
  allowedExports,
  forbidComputedModuleSpecifiers: true,
});

export const architecturePolicy = {
  schemaVersion: 1,
  dependencyRule: "domain <- application <- adapters <- composition root",
  units: [
    unit({
      packageName: "@travelos/admin-web",
      root: "apps/admin-web",
      layer: "browser-composition-root",
      workspace: [
        "@travelos/contracts/admin",
        "@travelos/design-system",
        "@travelos/design-system/*",
      ],
      external: ["react", "react-dom"],
      development: ["@tailwindcss/vite", "@vitejs/plugin-react", "vite"],
    }),
    unit({
      packageName: "@travelos/portal-web",
      root: "apps/portal-web",
      layer: "browser-composition-root",
      workspace: [
        "@travelos/contracts/portal",
        "@travelos/design-system",
        "@travelos/design-system/*",
      ],
      external: ["react", "react-dom"],
      development: ["@tailwindcss/vite", "@vitejs/plugin-react", "vite"],
    }),
    unit({
      packageName: "@travelos/admin-api",
      root: "apps/admin-api",
      layer: "server-composition-root",
      workspace: [
        "@travelos/auth-adapters",
        "@travelos/backend-core",
        "@travelos/config",
        "@travelos/contracts/admin",
        "@travelos/database",
        "@travelos/observability",
      ],
      external: [
        "@nestjs/common",
        "@nestjs/core",
        "@nestjs/platform-express",
        "reflect-metadata",
        "rxjs",
      ],
    }),
    unit({
      packageName: "@travelos/portal-api",
      root: "apps/portal-api",
      layer: "portal-server-composition-root",
      workspace: [
        "@travelos/auth-adapters",
        "@travelos/config",
        "@travelos/contracts/portal",
        "@travelos/observability",
        "@travelos/portal-safe-core/customer-presentation",
        "@travelos/portal-safe-core/documents",
        "@travelos/portal-safe-core/portal-access",
      ],
      external: [
        "@nestjs/common",
        "@nestjs/core",
        "@nestjs/platform-express",
        "reflect-metadata",
        "rxjs",
      ],
    }),
    unit({
      packageName: "@travelos/worker",
      root: "apps/worker",
      layer: "worker-composition-root",
      workspace: [
        "@travelos/backend-core",
        "@travelos/config",
        "@travelos/database",
        "@travelos/observability",
      ],
      external: [],
    }),
    unit({
      packageName: "@travelos/backend-core",
      root: "packages/backend-core",
      layer: "domain-application-core",
      workspace: [],
      external: [],
      builtins: [],
      exports: ["."],
    }),
    unit({
      packageName: "@travelos/portal-safe-core",
      root: "packages/portal-safe-core",
      layer: "portal-domain-application-core",
      workspace: ["@travelos/contracts/portal"],
      external: ["zod"],
      builtins: [],
      exports: ["./customer-presentation", "./documents", "./portal-access"],
    }),
    unit({
      packageName: "@travelos/contracts",
      root: "packages/contracts",
      layer: "external-contracts",
      workspace: [],
      external: ["zod"],
      builtins: [],
      exports: ["./admin", "./portal"],
    }),
    unit({
      packageName: "@travelos/config",
      root: "packages/config",
      layer: "configuration-adapter",
      workspace: [],
      external: ["zod"],
      builtins: ["node:fs/promises"],
      exports: ["."],
    }),
    unit({
      packageName: "@travelos/database",
      root: "packages/database",
      layer: "database-adapter",
      workspace: ["@travelos/backend-core"],
      external: ["kysely", "pg"],
      builtins: [],
      exports: ["."],
    }),
    unit({
      packageName: "@travelos/auth-adapters",
      root: "packages/auth-adapters",
      layer: "authentication-adapter",
      workspace: ["@travelos/backend-core", "@travelos/portal-safe-core/portal-access"],
      external: ["better-auth", "zod"],
      builtins: [],
      exports: ["."],
    }),
    unit({
      packageName: "@travelos/design-system",
      root: "packages/design-system",
      layer: "browser-ui-adapter",
      workspace: [],
      external: ["react", "react-dom"],
      builtins: [],
      exports: [".", "./styles.css"],
    }),
    unit({
      packageName: "@travelos/observability",
      root: "packages/observability",
      layer: "observability-adapter",
      workspace: [],
      external: ["nestjs-pino", "pino", "pino-http"],
      builtins: [],
      exports: ["."],
    }),
    unit({
      packageName: "@travelos/test-support",
      root: "packages/test-support",
      layer: "test-adapter",
      workspace: [
        "@travelos/auth-adapters",
        "@travelos/backend-core",
        "@travelos/config",
        "@travelos/contracts/admin",
        "@travelos/contracts/portal",
        "@travelos/database",
        "@travelos/observability",
        "@travelos/portal-safe-core/customer-presentation",
        "@travelos/portal-safe-core/documents",
        "@travelos/portal-safe-core/portal-access",
      ],
      external: ["fast-check", "supertest", "vitest"],
      builtins: [],
      exports: ["."],
    }),
  ],
};

export const packageRoot = (specifier) => {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
};

const matchesSpecifier = (specifier, allowed) =>
  allowed.some((candidate) =>
    candidate.endsWith("/*")
      ? specifier.startsWith(candidate.slice(0, -1))
      : specifier === candidate,
  );

const unitByResolvedPath = (root, resolvedPath, units) => {
  const absolute = path.resolve(root, resolvedPath);
  return units.find((candidate) => {
    const candidateRoot = path.resolve(root, candidate.root);
    return absolute === candidateRoot || absolute.startsWith(`${candidateRoot}${path.sep}`);
  });
};

const runtimeManifestDependencies = (manifest) => ({
  ...(manifest.dependencies ?? {}),
  ...(manifest.optionalDependencies ?? {}),
  ...(manifest.peerDependencies ?? {}),
});

const sortedUnique = (values) => [...new Set(values)].sort();

export const analyzeDependenciesForUnit = ({
  dependencies,
  unsupportedDependencyConstructs = [],
  filePath,
  unitPolicy,
  manifest,
  root,
  units = architecturePolicy.units,
}) => {
  const violations = [];
  const declaredRuntime = runtimeManifestDependencies(manifest);

  for (const finding of unsupportedDependencyConstructs) {
    violations.push({
      ...finding,
      file: filePath,
      layer: unitPolicy.layer,
      unit: unitPolicy.packageName,
    });
  }

  for (const request of dependencies) {
    const base = {
      file: filePath,
      line: request.line,
      column: request.column,
      requestKind: request.kind,
      layer: unitPolicy.layer,
      unit: unitPolicy.packageName,
    };
    if (request.computed) {
      if (unitPolicy.forbidComputedModuleSpecifiers) {
        violations.push({
          ...base,
          rule: "architecture/computed-module-specifier-forbidden",
          message: "Production module specifiers must be statically determinable",
        });
      }
      continue;
    }

    const specifier = request.specifier;
    if (specifier === null) continue;
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const resolved = path.resolve(root, path.dirname(filePath), specifier);
      const targetUnit = unitByResolvedPath(root, resolved, units);
      if (targetUnit && targetUnit.packageName !== unitPolicy.packageName) {
        violations.push({
          ...base,
          rule: "architecture/cross-package-source-import-forbidden",
          specifier,
          targetUnit: targetUnit.packageName,
          message: "Cross-package source paths bypass package exports",
        });
      } else if (!targetUnit) {
        violations.push({
          ...base,
          rule: "architecture/relative-import-outside-unit-forbidden",
          specifier,
          message: "Relative production imports must stay inside their architectural unit",
        });
      }
      continue;
    }

    if (builtins.has(specifier) || specifier.startsWith("node:")) {
      if (!unitPolicy.allowedBuiltinSpecifiers.includes(specifier)) {
        violations.push({
          ...base,
          rule: "architecture/builtin-dependency-not-allowed",
          specifier,
          message: `Builtin capability ${specifier} is not allowed for ${unitPolicy.packageName}`,
        });
      }
      continue;
    }

    const dependencyName = packageRoot(specifier);
    if (dependencyName.startsWith("@travelos/")) {
      if (!matchesSpecifier(specifier, unitPolicy.allowedWorkspaceSpecifiers)) {
        violations.push({
          ...base,
          rule: "architecture/workspace-dependency-not-allowed",
          specifier,
          message: `${unitPolicy.packageName} is not allowed to depend on ${specifier}`,
        });
      }
    } else if (!unitPolicy.allowedExternalPackages.includes(dependencyName)) {
      violations.push({
        ...base,
        rule: "architecture/external-dependency-not-allowed",
        specifier,
        message: `${unitPolicy.packageName} has no capability allowing ${dependencyName}`,
      });
    }

    if (!(dependencyName in declaredRuntime)) {
      violations.push({
        ...base,
        rule: "architecture/source-dependency-not-declared",
        specifier,
        message: `${dependencyName} is imported by production source but not declared as a runtime dependency`,
      });
    }
  }

  return { requests: dependencies, violations };
};

export const analyzeSourceText = ({
  sourceText,
  filePath,
  unitPolicy,
  manifest,
  root,
  units = architecturePolicy.units,
}) => {
  const normalized = collectNormalizedSourceDependencies({ sourceText, fileName: filePath });
  return analyzeDependenciesForUnit({
    dependencies: normalized.dependencies,
    unsupportedDependencyConstructs: normalized.unsupportedDependencyConstructs,
    filePath,
    unitPolicy,
    manifest,
    root,
    units,
  });
};

const manifestViolations = (unitPolicy, manifest, manifestPath) => {
  const violations = [];
  const allowedWorkspaceRoots = sortedUnique(
    unitPolicy.allowedWorkspaceSpecifiers.map(packageRoot),
  );
  const allowedRuntime = new Set([...allowedWorkspaceRoots, ...unitPolicy.allowedExternalPackages]);
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const dependencyName of Object.keys(manifest[section] ?? {})) {
      if (!allowedRuntime.has(dependencyName)) {
        violations.push({
          rule: "architecture/manifest-dependency-not-allowed",
          file: manifestPath,
          unit: unitPolicy.packageName,
          layer: unitPolicy.layer,
          section,
          dependency: dependencyName,
          message: `${dependencyName} is outside the explicit capability set for ${unitPolicy.packageName}`,
        });
      }
    }
  }
  for (const dependencyName of Object.keys(manifest.devDependencies ?? {})) {
    if (!unitPolicy.allowedDevelopmentPackages.includes(dependencyName)) {
      violations.push({
        rule: "architecture/manifest-development-dependency-not-allowed",
        file: manifestPath,
        unit: unitPolicy.packageName,
        layer: unitPolicy.layer,
        section: "devDependencies",
        dependency: dependencyName,
        message: `${dependencyName} is outside the explicit development capability set for ${unitPolicy.packageName}`,
      });
    }
  }

  if (unitPolicy.allowedExports !== undefined) {
    const actualExports = Object.keys(manifest.exports ?? {}).sort();
    const expectedExports = [...unitPolicy.allowedExports].sort();
    if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
      violations.push({
        rule: "architecture/package-export-surface-mismatch",
        file: manifestPath,
        unit: unitPolicy.packageName,
        layer: unitPolicy.layer,
        expectedExports,
        actualExports,
        message: `Published exports differ from the reviewed surface for ${unitPolicy.packageName}`,
      });
    }
  }
  return violations;
};

export const analyzeManifestForUnit = ({ unitPolicy, manifest, manifestPath }) =>
  manifestViolations(unitPolicy, manifest, manifestPath);

export const checkRepositoryPackageBoundaries = async (rootOrOptions = process.cwd()) => {
  const options =
    typeof rootOrOptions === "string" ? { root: rootOrOptions } : { ...rootOrOptions };
  const root = options.root ?? process.cwd();
  const units = options.units ?? architecturePolicy.units;
  const sourceDiscovery =
    options.sourceDiscovery ?? (await discoverProductionSourceFiles({ root, units }));
  const dependencyUniverse =
    options.dependencyUniverse ??
    (await discoverProductionDependencyUniverse({
      root,
      tsconfigPath: options.tsconfigPath,
      sourceDiscovery,
    }));
  const violations = [];
  for (const filePath of sourceDiscovery.uncoveredCompilerResolvedProductionFiles) {
    violations.push({
      rule: "architecture/compiler-source-not-inspected",
      file: filePath,
      message: "A compiler-resolved production source file is absent from policy inspection",
    });
  }
  for (const filePath of sourceDiscovery.unsupportedCompilerResolvedProductionFiles) {
    violations.push({
      rule: "architecture/compiler-source-form-unsupported",
      file: filePath,
      message: "A compiler-resolved production source form is unsupported by policy parsing",
    });
  }
  for (const filePath of dependencyUniverse.missingCompilerSourceFiles) {
    violations.push({
      rule: "architecture/compiler-source-not-available-to-dependency-policy",
      file: filePath,
      message: "A policy source file is unavailable in the compiler dependency program",
    });
  }
  for (const reference of dependencyUniverse.unexplainedCompilerDependencyReferences) {
    violations.push({
      ...reference,
      rule: "architecture/compiler-dependency-not-normalized",
      message: "A compiler-known dependency is absent from the normalized dependency universe",
    });
  }
  if (dependencyUniverse.compilerDiagnosticCount !== 0) {
    violations.push({
      rule: "architecture/compiler-program-diagnostics",
      file:
        dependencyUniverse.missingCompilerSourceFiles[0] ?? "tooling/ci/tsconfig.typecheck.json",
      count: dependencyUniverse.compilerDiagnosticCount,
      message: "The compiler dependency program must have zero diagnostics",
    });
  }
  for (const finding of dependencyUniverse.unsupportedDependencyConstructs) {
    const unitPolicy = units.find(({ root: unitRoot }) =>
      finding.file.startsWith(`${unitRoot}/src/`),
    );
    violations.push({
      ...finding,
      unit: unitPolicy?.packageName ?? null,
      layer: unitPolicy?.layer ?? null,
    });
  }
  let moduleRequestCount = 0;
  for (const unitPolicy of units) {
    const manifestPath = path.posix.join(unitPolicy.root, "package.json");
    const manifest = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
    if (manifest.name !== unitPolicy.packageName) {
      violations.push({
        rule: "architecture/package-identity-mismatch",
        file: manifestPath,
        unit: unitPolicy.packageName,
        actualName: manifest.name ?? null,
        message: "Manifest package name does not match the architecture policy unit",
      });
    }
    violations.push(...manifestViolations(unitPolicy, manifest, manifestPath));
    const sourceFiles = sourceDiscovery.filesByUnit[unitPolicy.packageName] ?? [];
    for (const filePath of sourceFiles) {
      const dependencies = dependencyUniverse.dependenciesByFile[filePath] ?? [];
      const analysis = analyzeDependenciesForUnit({
        dependencies,
        filePath,
        unitPolicy,
        manifest,
        root,
        units,
      });
      moduleRequestCount += analysis.requests.length;
      violations.push(...analysis.violations);
    }
  }

  violations.sort((left, right) =>
    `${left.file ?? ""}:${left.line ?? 0}:${left.rule}`.localeCompare(
      `${right.file ?? ""}:${right.line ?? 0}:${right.rule}`,
    ),
  );
  return {
    schemaVersion: 1,
    result: violations.length === 0 ? "PASS" : "FAIL",
    dependencyModel: architecturePolicy.dependencyRule,
    unitsChecked: units.length,
    sourceFilesChecked: sourceDiscovery.policyInspectedProductionSourceCount,
    moduleRequestsChecked: moduleRequestCount,
    computedModuleSpecifiersAllowed: false,
    sourceDiscovery,
    dependencyUniverse: dependencyUniverseSummary(dependencyUniverse),
    violations,
  };
};
