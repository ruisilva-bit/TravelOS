import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const source = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@travelos/contracts/admin",
        replacement: source("packages/contracts/src/admin/index.ts"),
      },
      {
        find: "@travelos/backend-core",
        replacement: source("packages/backend-core/src/index.ts"),
      },
      {
        find: "@travelos/contracts/share",
        replacement: source("packages/contracts/src/share/index.ts"),
      },
      { find: "@travelos/config", replacement: source("packages/config/src/index.ts") },
      {
        find: "@travelos/observability",
        replacement: source("packages/observability/src/index.ts"),
      },
      {
        find: "@travelos/design-system",
        replacement: source("packages/design-system/src/index.ts"),
      },
      // Exact-match aliases so unit tests resolve workspace source without a prior build.
      {
        find: /^@travelos\/auth-adapters$/u,
        replacement: source("packages/auth-adapters/src/index.ts"),
      },
      { find: /^@travelos\/database$/u, replacement: source("packages/database/src/index.ts") },
      {
        find: /^@travelos\/test-support$/u,
        replacement: source("packages/test-support/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["apps/**/test/**/*.test.{ts,tsx}", "packages/**/test/**/*.test.{ts,tsx}"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
