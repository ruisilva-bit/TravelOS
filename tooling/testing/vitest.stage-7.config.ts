import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const source = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@travelos/auth-adapters/portal",
        replacement: source("packages/auth-adapters/src/portal.ts"),
      },
      { find: "@travelos/backend-core", replacement: source("packages/backend-core/src/index.ts") },
      { find: "@travelos/config", replacement: source("packages/config/src/index.ts") },
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
    include: ["tests/integration/stage-7-postgresql.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    fileParallelism: false,
    bail: 1,
    sequence: { concurrent: false },
    restoreMocks: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
