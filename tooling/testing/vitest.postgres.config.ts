import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const source = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

// Configuration for `pnpm test:postgres`: every tests/integration/*.test.ts file. The runner gives
// each file its own disposable cluster and passes the connection settings through the environment.
export default defineConfig({
  resolve: {
    alias: [
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
        find: "@travelos/contracts/share",
        replacement: source("packages/contracts/src/share/index.ts"),
      },
      { find: "@travelos/database", replacement: source("packages/database/src/index.ts") },
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
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
