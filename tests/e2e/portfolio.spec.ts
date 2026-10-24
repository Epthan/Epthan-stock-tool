import { expect, test } from "@playwright/test";
import { open, resetStore, watchErrors } from "./fixtures";

/** Portfolio analytics, compare, heatmap. Test titles start with requirement IDs (see tests/requirements.ts). */
test.beforeEach(() => resetStore());

test("C06 dashboard: 6 views × ranges × benchmark, no errors", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/dashboard");
  await expect(page.locator(".rd-hero")).toBeVisible();
  await expect(page.locator(".rd-account")).toBeVisible();
  const views = page.locator(".pd-topbar nav button");
  for (let v = 0; v < 6; v++) {
    await views.nth(v).click();
    for (const range of ["1M", "1Y", "ALL"]) { await page.locator(".pd-segments button", { hasText: range }).click(); await page.waitForTimeout(150); }
    await expect(page.locator(".pd-content")).not.toContainText("这个页面出错了");
  }
  await page.locator(".pd-benchmark select").selectOption("^AXJO");
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test("C12 compare: rebased chart and table, view switch", async ({ page }) => {
  await open(page, "/compare");
  await expect(page.locator(".cmp-chart svg path").first()).toBeVisible();
  const returns = await page.locator(".pg-table tbody tr td:nth-child(4)").allTextContents();
  const values = returns.map((t) => parseFloat(t.replace("−", "-").replace("%", "")));
  expect([...values].sort((a, b) => b - a)).toEqual(values);
  await page.locator(".pg-seg button", { hasText: "分图" }).click();
  await expect(page.locator(".cmp-card")).toHaveCount(6);
});

test("C13 heatmap: index, holdings sizing, tooltip", async ({ page }) => {
  await open(page, "/treemap");
  await expect(page.locator(".tm-tile")).toHaveCount(6);
  await page.locator(".tm-tile").first().hover();
  await expect(page.locator(".tm-tip")).toBeVisible();
  await page.locator(".pg-field select").first().selectOption("portfolio:qa");
  await expect(page.locator(".pg-field select").nth(1)).toHaveValue("holding");
});
