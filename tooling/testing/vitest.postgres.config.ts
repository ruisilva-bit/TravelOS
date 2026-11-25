import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const source = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
const { adaptStage9Regression } = await import(
  new URL("../ci/stage-9/postgres-regression-adapter.mjs", import.meta.url).href
);

const chainAnchor = `const productionChain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
};`;
// Stage 3/4/5 suites assert their own stage's migration head, so the runner hands them the
// checksummed prefix of the authoritative chain that ends at that head. Assertions are untouched.
const adaptPrefixChain = (code: string): string => {
  if (code.split(chainAnchor).length !== 2) throw new Error("Predecessor chain anchor drift");
  return code.replace(
    chainAnchor,
    `const productionChain: MigrationChain = {
  directory: path.join(process.env["TRAVELOS_POSTGRES_PREFIX_CHAIN_DIR"]!),
  checksumManifestPath: path.join(process.env["TRAVELOS_POSTGRES_PREFIX_CHAIN_DIR"]!, "checksums.json"),
};`,
  );
};

// Stage 7/8/9 suites pin the Stage 9 head (0016) for their production-chain assertions. They run
// against the checksummed prefix of the authoritative chain ending at 0016; the current head is
// covered by the M2 suite and by the packaged-migrator check in the Stage 6 suite.
const adaptStage9PrefixChain = (code: string, directory: string, manifest: string): string => {
  for (const [before, after] of [
    [directory, 'directory: path.join(process.env["TRAVELOS_POSTGRES_PREFIX_CHAIN_DIR"]!),'],
    [
      manifest,
      'checksumManifestPath: path.join(process.env["TRAVELOS_POSTGRES_PREFIX_CHAIN_DIR"]!, "checksums.json"),',
    ],
  ] as const) {
    if (code.split(before).length !== 2) throw new Error(`Stage 9 chain anchor drift: ${before}`);
    code = code.replace(before, () => after);
  }
  return code;
};
const joinedChain = [
  'directory: path.join(repositoryRoot, "migrations"),',
  'checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),',
] as const;

// The Stage 3 suite deliberately exercises emitted ESM whose packages resolve each other natively,
// so the runner disables the source aliases for that one file (as its own historical config did).
const useSourceAliases = process.env["TRAVELOS_POSTGRES_NO_SOURCE_ALIASES"] !== "1";

// Unified configuration for `pnpm test:postgres`: every tests/integration/*.test.ts file.
// Suites 6/7/8 carry predecessor migration-head assertions that the cumulative adapter updates.
export default defineConfig({
  plugins: [
    {
      name: "postgres-cumulative-regressions",
      enforce: "pre",
      transform(code, id) {
        if (/\/tests\/integration\/stage-[345]-postgresql\.test\.ts$/u.test(id))
          return adaptPrefixChain(code);
        if (id.endsWith("/tests/integration/stage-6-publication-postgresql.test.ts")) {
          // The Stage 9 adapter stops at the Stage 8 head; extend to the current Stage 9 head
          // exactly as the Stage 10 qualification config does.
          const adapted: string = adaptStage9Regression(code, 6);
          const before = 'expect(migration.currentVersion).toBe("0014_stage8_worker_activity")';
          if (adapted.split(before).length !== 2) throw new Error("Stage 6 head anchor drift");
          return adapted.replace(
            before,
            'expect(migration.currentVersion).toBe("0017_m2_sales_lead")',
          );
        }
        if (id.endsWith("/tests/integration/stage-7-postgresql.test.ts"))
          return adaptStage9PrefixChain(adaptStage9Regression(code, 7), ...joinedChain);
        if (id.endsWith("/tests/integration/stage-8-postgresql.test.ts"))
          return adaptStage9PrefixChain(
            adaptStage9Regression(code, 8),
            'directory: path.resolve("migrations"),',
            'checksumManifestPath: path.resolve("migrations/checksums.json"),',
          );
        if (id.endsWith("/tests/integration/stage-9-staff-invitations-postgresql.test.ts"))
          return adaptStage9PrefixChain(code, ...joinedChain);
        return null;
      },
    },
  ],
  resolve: {
    alias: !useSourceAliases
      ? []
      : [
          {
            find: "@travelos/auth-adapters/portal",
            replacement: source("packages/auth-adapters/src/portal.ts"),
          },
          {
            find: /^@travelos\/auth-adapters$/u,
            replacement: source("packages/auth-adapters/src/index.ts"),
          },
          {
            find: "@travelos/backend-core",
            replacement: source("packages/backend-core/src/index.ts"),
          },
          { find: "@travelos/config", replacement: source("packages/config/src/index.ts") },
          {
            find: "@travelos/observability",
            replacement: source("packages/observability/src/index.ts"),
          },
          {
            find: "@travelos/contracts/portal",
            replacement: source("packages/contracts/src/portal/index.ts"),
          },
          { find: "@travelos/database", replacement: source("packages/database/src/index.ts") },
          {
            find: "@travelos/portal-safe-core/customer-presentation",
            replacement: source("packages/portal-safe-core/src/customer-presentation/index.ts"),
          },
          {
            find: "@travelos/portal-safe-core/portal-access",
            replacement: source("packages/portal-safe-core/src/portal-access/index.ts"),
          },
        ],
  },
  test: {
    environment: "node",
    include: ["tests/integration/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    fileParallelism: false,
    bail: 1,
    sequence: { concurrent: false },
    restoreMocks: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
