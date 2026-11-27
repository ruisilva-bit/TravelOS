/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable-dependencies",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "backend-core-dependencies-must-be-explicitly-allowed",
      severity: "error",
      from: { path: "^packages/backend-core/src/" },
      to: { path: "^packages/(?!backend-core/)" },
    },
    {
      name: "core-cannot-import-frameworks-or-adapters",
      severity: "error",
      from: { path: "^packages/backend-core/src/" },
      to: {
        path: "^(?:packages/(?:database|auth-adapters|design-system|observability)|apps/)",
      },
    },
    {
      name: "browser-apps-cannot-import-privileged-backend",
      severity: "error",
      from: { path: "^apps/admin-web/src/" },
      to: {
        path: "^(?:apps/|packages/(?:backend-core|config|database|auth-adapters|observability|test-support))/",
      },
    },
    {
      name: "packages-cannot-import-composition-roots",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    ...["admin-web", "admin-api", "worker"].map((app) => ({
      name: `composition-root-${app}-cannot-import-another-root`,
      severity: "error",
      from: { path: `^apps/${app}/` },
      to: { path: `^apps/(?!${app}/)` },
    })),
    {
      name: "production-cannot-import-test-support",
      severity: "error",
      from: { path: "^(?:apps|packages)/.*/src/" },
      to: { path: "^packages/test-support/" },
    },
    {
      name: "production-cannot-import-tests",
      severity: "error",
      from: { path: "^(?:apps|packages)/.*/src/" },
      to: { path: "/(?:test|tests)/|[.](?:spec|test)[.]" },
    },
  ],
  options: {
    combinedDependencies: true,
    doNotFollow: { path: ["node_modules"] },
    exclude: { path: ["(?:^|/)dist/"] },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "node", "default"],
      exportsFields: ["exports"],
      extensions: [
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
        ".json",
      ],
    },
    includeOnly: ["^(?:apps|packages)/"],
    skipAnalysisNotInRules: false,
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: "specify",
  },
};
