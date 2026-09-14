import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tooling/testing/playwright",
  forbidOnly: true,
  retries: 0,
  workers: 1,
});
