import { defineConfig } from "@playwright/test";
import { browserOptions, testServer } from "./tests/support/servers";

process.env.STOCK_TOOL_TEST_SUITE = "smoke";

/** Smoke: every page opens with the market APIs mocked (fast sanity check). Needs `npm run build:test` first. */
export default defineConfig({
  testDir: "tests/smoke", timeout: 60_000, workers: 1,
  outputDir: "test-results/pw-smoke", // Playwright empties its output folder on start: keep it away from the other results
  reporter: [["list"], ["json", { outputFile: "test-results/smoke.json" }]],
  use: { baseURL: "http://127.0.0.1:3100", ...browserOptions },
  globalSetup: "./tests/support/global-setup.ts",
  globalTeardown: "./tests/support/global-teardown.ts",
  webServer: testServer("smoke", 3100),
});
