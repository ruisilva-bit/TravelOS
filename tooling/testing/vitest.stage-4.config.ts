import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const source = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@travelos/auth-adapters",
        replacement: source("packages/auth-adapters/src/index.ts"),
      },
      { find: "@travelos/backend-core", replacement: source("packages/backend-core/src/index.ts") },
      { find: "@travelos/config", replacement: source("packages/config/src/index.ts") },
      { find: "@travelos/database", replacement: source("packages/database/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/integration/stage-4-postgresql.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    fileParallelism: false,
    bail: 1,
    sequence: { concurrent: false },
    restoreMocks: true,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
