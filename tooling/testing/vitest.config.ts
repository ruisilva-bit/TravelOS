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
        find: "@travelos/contracts/portal",
        replacement: source("packages/contracts/src/portal/index.ts"),
      },
      { find: "@travelos/config", replacement: source("packages/config/src/index.ts") },
      {
        find: "@travelos/design-system",
        replacement: source("packages/design-system/src/index.ts"),
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
