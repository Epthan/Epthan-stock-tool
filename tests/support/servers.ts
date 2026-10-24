import path from "node:path";

/**
 * Test servers never touch your real data or the dev server:
 * - production build goes to `.next-test` (not `.next`, which `npm run dev` uses)
 * - each suite has its own data folder under test-results/, wiped before every test
 */
export const TEST_DIST_DIR = ".next-test";
export const dataDirFor = (suite: "e2e" | "smoke" | "live") => path.join(process.cwd(), "test-results", `data-${suite}`);

export function testServer(suite: "e2e" | "smoke" | "live", port: number) {
  return {
    command: `npx next start -p ${port} -H 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_DIST_DIR: TEST_DIST_DIR, STOCK_TOOL_DATA_DIR: dataDirFor(suite) },
  };
}

/** Use a specific Chromium (CI / sandbox) when PW_CHROMIUM is set; otherwise Playwright's own. */
export const browserOptions = process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {};
