import { defineConfig } from "@playwright/test";
import { browserOptions, testServer } from "./tests/support/servers";

process.env.STOCK_TOOL_TEST_SUITE = "live";

/**
 * Live suite: real Yahoo Finance data, read-only checks on the API routes and pages (needs internet).
 * Uses its own data folder; never writes your portfolios. Needs `npm run build:test` first.
 */
export default defineConfig({
  testDir: "tests/live", timeout: 120_000, workers: 1, retries: 1,
  outputDir: "test-results/pw-live", // Playwright empties its output folder on start: keep it away from the other results
  reporter: [["list"], ["json", { outputFile: "test-results/live.json" }]],
  use: { baseURL: "http://127.0.0.1:3300", ...browserOptions },
  globalSetup: "./tests/support/global-setup.ts",
  globalTeardown: "./tests/support/global-teardown.ts",
  webServer: testServer("live", 3300),
});
