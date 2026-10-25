import { expect, test } from "@playwright/test";
import { mockMarket, resetStore, seed, watchErrors } from "./fixtures";

/** Market data down, empty states. Test titles start with requirement IDs (see tests/requirements.mjs). */
test.beforeEach(async ({ request }) => { await resetStore(request); });

test("D01 Yahoo down: every page degrades gracefully", async ({ page }) => {
  const errors = watchErrors(page);
  await seed(page); await mockMarket(page, { down: true });
  for (const path of ["/", "/dashboard", "/portfolio", "/compare", "/treemap"]) {
    await page.goto(path); await page.waitForTimeout(1500);
    await expect(page.locator("text=这个页面出错了")).toHaveCount(0);
  }
  await page.goto("/"); await page.waitForTimeout(1500);
  await expect(page.locator(".wpx-index-note")).toContainText("暂不可用");
  await page.goto("/dashboard"); await page.waitForTimeout(2500);
  await expect(page.locator(".ui-state-error")).toBeVisible();
  expect(errors).toEqual([]);
});

test("D03 empty states", async ({ page }) => {
  await seed(page, { portfolio: false }); await mockMarket(page);
  await page.goto("/portfolio"); await page.waitForTimeout(1000);
  await expect(page.locator(".tl-empty")).toBeVisible();
  await page.goto("/compare"); await page.waitForTimeout(800);
});
