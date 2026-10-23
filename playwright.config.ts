import { defineConfig } from "@playwright/test";

/**
 * Smoke tests: start the production build on port 3100 and open every page with the market APIs mocked
 * (no Yahoo access needed, nothing written to data/store.json). Run `npm run build` first.
 */
export default defineConfig({
  testDir: "tests/smoke",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: { command: "npx next start -p 3100 -H 127.0.0.1", url: "http://127.0.0.1:3100", reuseExistingServer: true, timeout: 60_000 },
});
