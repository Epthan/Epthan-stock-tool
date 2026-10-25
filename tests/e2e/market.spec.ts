import { expect, test } from "@playwright/test";
import { open, resetStore, watchErrors } from "./fixtures";

/** Market page: tabs, search, watch lists, chart, backtest, drawings. Test titles start with requirement IDs (see tests/requirements.mjs). */
test.beforeEach(async ({ request }) => { await resetStore(request); });

test("C01/C02 market tabs remembered; index click opens research", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/");
  await page.locator(".wpx-tools > div > nav button", { hasText: "市场概览" }).click();
  await expect(page.locator(".mo-panel")).toBeVisible();
  await page.reload(); await page.waitForTimeout(1000);
  await expect(page.locator(".mo-panel")).toBeVisible();
  await page.locator(".mo-tile").first().click();
  await expect(page.locator(".wpx-tools > div > nav button[aria-pressed=true]")).toHaveText("个股研究");
  await expect(page.locator(".wpx-quote-title h2")).toHaveText("^GSPC");
  await page.locator("button.wpx-index").nth(1).click();
  await expect(page.locator(".wpx-quote-title h2")).toHaveText("^DJI");
  expect(errors).toEqual([]);
});

test("C03 search adds symbol; watch list add/remove persists", async ({ page }) => {
  await open(page, "/", { portfolio: false });
  const search = page.locator(".shell-search input, header input").first();
  await search.fill("JPM"); await search.press("Enter");
  await expect(page.locator(".wpx-quote-title h2")).toHaveText("JPM");
  await page.locator('summary[aria-label="添加到自选列表"]').click();
  await page.locator(".wp-watchlist-menu button").first().click();
  await expect(page.locator(".wpx-watch-symbol", { hasText: "JPM" })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.reload(); await page.waitForTimeout(1500);
  await expect(page.locator(".wpx-watch-symbol", { hasText: "JPM" })).toBeVisible();
  await page.locator(".wpx-watch-row", { hasText: "JPM" }).locator(".wpx-watch-remove").click({ force: true });
  await expect(page.locator(".wpx-watch-symbol", { hasText: "JPM" })).toHaveCount(0);
});

test("C04 chart range / type / indicators", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/");
  for (const label of ["1Y", "1M", "6M"]) await page.locator(".wpx-research button", { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.locator(".wpx-research button", { hasText: /^折线$/ }).click();
  await page.locator(".wpx-research button", { hasText: /^K 线$|^K线$/ }).first().click();
  await expect(page.locator(".wpx-research canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("C05 backtest with real trades overlay", async ({ page }) => {
  await open(page, "/");
  await page.locator(".wpx-tools > div > nav button", { hasText: "策略回测" }).click();
  await page.locator(".bt-run").click();
  await expect(page.locator(".bt-metrics")).toContainText("你的实际交易");
  await expect(page.locator(".bt-real")).toBeVisible(); // your equity line legend (shares held from before the window)
  await expect(page.locator(".bt-marker-legend small").nth(1)).toContainText("区间开始前已持有");
});

test("C15 chart drawings: draw, keep across timeframe, clear on symbol change and page change", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/");
  await page.locator(".wpx-tools > div > nav button", { hasText: "个股研究" }).click();
  const search = page.locator(".shell-search input, header input").first();
  await search.fill("AAPL"); await search.press("Enter");
  await expect(page.locator(".wpx-quote-title h2")).toHaveText("AAPL");
  const host = page.locator(".wpx-chart .cd-host");
  await expect(host.locator("canvas").first()).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await host.scrollIntoViewIfNeeded();
  const box = (await host.boundingBox())!;
  // Trend line by dragging
  await page.locator(".wpx-chart .cd-toolbar button", { hasText: "趋势线" }).click();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.3, { steps: 6 }); await page.mouse.up();
  // Horizontal line by one click
  await page.locator(".wpx-chart .cd-toolbar button", { hasText: "水平线" }).click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await expect(host.locator(".cd-line")).toHaveCount(2);
  // Another timeframe: still drawn
  await page.locator(".wpx-research button", { hasText: /^1Y$/ }).first().click();
  await page.waitForTimeout(500);
  await expect(host.locator(".cd-line")).toHaveCount(2);
  // Select + delete via keyboard
  await host.locator(".cd-hit").first().click({ force: true });
  await page.keyboard.press("Delete");
  await expect(host.locator(".cd-line")).toHaveCount(1);
  // Change stock: gone
  await search.fill("MSFT"); await search.press("Enter");
  await expect(page.locator(".wpx-quote-title h2")).toHaveText("MSFT");
  await expect(host.locator(".cd-line")).toHaveCount(0);
  await host.scrollIntoViewIfNeeded();
  const again = (await host.boundingBox())!;
  Object.assign(box, again);
  // Draw again, then leave the page and come back: gone
  await page.locator(".wpx-chart .cd-toolbar button", { hasText: "水平线" }).click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await expect(host.locator(".cd-line")).toHaveCount(1);
  await page.locator(".shell-rail a", { hasText: "交易" }).click(); await page.waitForURL("**/portfolio");
  await page.locator(".shell-rail a", { hasText: "行情" }).click(); await page.waitForURL(/\/$/); await page.waitForTimeout(1200);
  await expect(page.locator(".wpx-chart .cd-line")).toHaveCount(0);
  expect(errors).toEqual([]);
});
