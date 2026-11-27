/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "browser-fixture-cannot-import-backend-core",
      severity: "error",
      from: { path: "^tooling/architecture/fixtures/invalid-browser-import/" },
      to: { path: "^packages/backend-core/" },
    },
    {
      name: "negative-fixture-has-no-unresolvable-dependencies",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "node", "default"],
      exportsFields: ["exports"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: "specify",
  },
};
