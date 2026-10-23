import { defineConfig } from "@playwright/test";
/** Full QA suite (mocked market data, real store API). Run `npm run build` first; it starts `next start` on port 3200. */
export default defineConfig({
  testDir: "tests/e2e", timeout: 90_000, workers: 1, reporter: [["list"], ["json", { outputFile: "test-results/qa.json" }]],
  use: { baseURL: "http://127.0.0.1:3200", acceptDownloads: true, ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}) },
  webServer: { command: "npx next start -p 3200 -H 127.0.0.1", url: "http://127.0.0.1:3200", reuseExistingServer: false, timeout: 90_000 },
});
