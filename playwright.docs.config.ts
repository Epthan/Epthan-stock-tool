import { defineConfig } from "@playwright/test";
import { browserOptions, testServer } from "./tests/support/servers";

process.env.STOCK_TOOL_TEST_SUITE = "docs";

/** Regenerates the README screenshots in docs/images from mocked market data. Needs `npm run build:test` first. */
export default defineConfig({
  testDir: "tests/docs", timeout: 90_000, workers: 1,
  outputDir: "test-results/pw-docs",
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3400", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...browserOptions },
  webServer: testServer("docs", 3400),
});
