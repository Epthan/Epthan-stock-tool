import { test } from "@playwright/test";
import { open, resetStore } from "../e2e/fixtures";

/**
 * README screenshots. Every number comes from the deterministic mocked market in tests/e2e/fixtures.ts —
 * never from real portfolios. Run: npm run build:test && npm run docs:screenshots
 */
const SHOTS: { file: string; url: string; skin?: string; prepare?: (page: import("@playwright/test").Page) => Promise<void> }[] = [
  { file: "market.png", url: "/" },
  { file: "portfolio.png", url: "/dashboard" },
  { file: "trades.png", url: "/portfolio" },
  { file: "tax.png", url: "/tax" },
  { file: "compare.png", url: "/compare" },
  { file: "heatmap.png", url: "/treemap", skin: "night" },
];

test.beforeEach(async ({ request }) => { await resetStore(request); });

for (const shot of SHOTS) {
  test(`screenshot ${shot.file}`, async ({ page }) => {
    await open(page, shot.url, { locale: "en", skin: shot.skin ?? "gray" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `docs/images/${shot.file}` });
  });
}
