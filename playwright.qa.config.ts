import { defineConfig } from "@playwright/test";
import { browserOptions, testServer } from "./tests/support/servers";

process.env.STOCK_TOOL_TEST_SUITE = "e2e";

/** Functional end-to-end suite: mocked market data, real store API, isolated data folder. Needs `npm run build:test` first. */
export default defineConfig({
  testDir: "tests/e2e", timeout: 90_000, workers: 1,
  outputDir: "test-results/pw-e2e", // Playwright empties its output folder on start: keep it away from the other results
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  use: { baseURL: "http://127.0.0.1:3200", acceptDownloads: true, ...browserOptions },
  globalSetup: "./tests/support/global-setup.ts",
  globalTeardown: "./tests/support/global-teardown.ts",
  webServer: testServer("e2e", 3200),
});
