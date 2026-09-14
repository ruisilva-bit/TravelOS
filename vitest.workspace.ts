import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["tooling/testing/vitest.config.ts"],
  },
});
