import { expect, test } from "@playwright/test";
import { mockMarket, portfolios, resetStore, seed } from "./fixtures";

/** Security. Test titles start with requirement IDs (see tests/requirements.ts). */
test.beforeEach(() => resetStore());

test("G01 notes and tags render as text (no XSS)", async ({ page }) => {
  await seed(page); await mockMarket(page);
  await page.addInitScript(() => {
    const raw = localStorage.getItem("stock-tool.portfolios.v1"); if (!raw || sessionStorage.getItem("xss")) return; sessionStorage.setItem("xss", "1");
    const list = JSON.parse(raw); list[0].trades[0].note = "<img src=x onerror=window.__pwned=1>"; list[0].trades[0].tags = ["<b>x</b>"]; localStorage.setItem("stock-tool.portfolios.v1", JSON.stringify(list));
  });
  await page.goto("/portfolio"); await page.waitForTimeout(1200);
  await expect(page.locator("text=<img src=x onerror=window.__pwned=1>")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});
