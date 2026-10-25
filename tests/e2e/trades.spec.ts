import { expect, test } from "@playwright/test";
import { at, open, portfolios, resetStore, watchErrors } from "./fixtures";

/** Trade log, cash ledger, ledger currency, brokerage, dividends. Test titles start with requirement IDs (see tests/requirements.mjs). */
test.beforeEach(async ({ request }) => { await resetStore(request); });

test("C08 trades: add with tags, edit, delete", async ({ page }) => {
  await open(page, "/portfolio");
  await page.getByRole("button", { name: /交易 · 1/ }).first().click(); // AAPL
  const dialog = page.locator("dialog.pm-trades-dialog");
  await dialog.locator('input[type="date"]').fill("2025-03-03");
  await dialog.locator('input[type="number"]').nth(0).fill("150");
  await dialog.locator('input[type="number"]').nth(1).fill("5");
  await dialog.locator(".pm-trade-tags button", { hasText: "抄底" }).click();
  await dialog.getByRole("button", { name: "保存交易" }).click();
  await expect(dialog.locator(".pm-trade-status")).toContainText("已保存");
  await dialog.getByRole("button", { name: "编辑", exact: true }).first().click();
  await dialog.locator('input[type="number"]').nth(1).fill("6");
  await dialog.getByRole("button", { name: "保存交易" }).click();
  await expect(dialog.locator(".pm-trade-status")).toContainText("已更新");
  await page.waitForTimeout(900);
  let trades = (await portfolios(page))[0].trades;
  expect(trades).toHaveLength(4);
  expect(trades.find((t: { quantity: number }) => t.quantity === 6).tags).toEqual(["dip"]);
  await dialog.getByRole("button", { name: "删除", exact: true }).first().click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await page.waitForTimeout(900);
  trades = (await portfolios(page))[0].trades;
  expect(trades).toHaveLength(3);
});

test("C09/C11 cash: deposit, FX, dividend suggestions", async ({ page }) => {
  await open(page, "/portfolio");
  const form = page.locator(".cl-form");
  await form.locator("select").first().selectOption("dividend");
  await form.locator('input[type="date"]').fill("2025-01-02");
  await form.locator('input[type="number"]').first().fill("12.5");
  await form.getByRole("button", { name: "添加" }).click();
  await expect(page.locator(".tl-metrics-cash")).toContainText("12.50");
  // dividend suggestion from mocked corporate actions
  await expect(page.locator(".cl-suggest")).toBeVisible();
  await page.locator(".cl-suggest").getByRole("button", { name: "全部添加" }).click();
  await expect(page.locator(".cl-suggest")).toHaveCount(0);
  // switch to per-currency and add an FX conversion
  await page.locator(".tl-section-heading select").selectOption("local");
  await form.locator("select").first().selectOption("fx");
  await form.locator('input[type="number"]').nth(0).fill("1000");
  await form.locator(".cl-money").nth(1).locator("select").selectOption("AUD");
  await form.locator('input[type="number"]').nth(1).fill("1500");
  await form.getByRole("button", { name: "添加" }).click();
  await expect(page.locator(".tl-metrics-cash article").first()).toContainText("AUD 1,500.00");
});

test("C10 ledger currency switch", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "/portfolio");
  await page.locator(".tl-select-small select").first().selectOption("AUD");
  await expect(page.locator(".tl-metrics").first()).toContainText("AUD");
  await expect(page.locator(".trade-ledger table").first()).toContainText("市值 AUD");
  expect(errors).toEqual([]);
});

test("T07 brokerage on a trade: linked fee entry, cost base / proceeds adjusted", async ({ page }) => {
  await open(page, "/portfolio");
  await page.getByRole("button", { name: /交易 · 2/ }).first().click();
  const dialog = page.locator("dialog.pm-trades-dialog");
  await dialog.locator("tr", { hasText: "卖出" }).getByRole("button", { name: "编辑" }).click();
  await dialog.getByLabel("佣金币种").selectOption("USD");
  await dialog.locator(".cl-money input").fill("9.50");
  await dialog.getByRole("button", { name: "保存交易" }).click();
  await expect(dialog.locator(".pm-fee")).toContainText("9.50");
  await page.waitForTimeout(1500);
  const fee = (await portfolios(page))[0].cash.find((entry: { tradeId?: string }) => entry.tradeId === "t3");
  expect(fee).toMatchObject({ kind: "fee", amount: 9.5, symbol: "NVDA" });
  await page.goto("/tax"); await page.waitForTimeout(1500);
  const proceeds = Math.round((10 * at("NVDA", 200) - 9.5) * 1.5 * 100) / 100;
  await expect(page.locator("tr", { hasText: "NVDA" }).first()).toContainText(proceeds.toLocaleString("en-AU", { minimumFractionDigits: 2 }));
  // Deleting the trade removes its brokerage too.
  await page.goto("/portfolio"); await page.waitForTimeout(800);
  await page.getByRole("button", { name: /交易 · 2/ }).first().click();
  await dialog.locator("tr", { hasText: "卖出" }).getByRole("button", { name: "删除" }).click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await page.waitForTimeout(1500);
  expect((await portfolios(page))[0].cash.some((entry: { tradeId?: string }) => entry.tradeId === "t3")).toBe(false);
});

test("T09 dividend franking / withholding fields are stored", async ({ page }) => {
  await open(page, "/portfolio");
  const form = page.locator("form.cl-form");
  await form.locator("select").first().selectOption("dividend");
  await form.locator('input[type="date"]').fill("2024-11-15");
  await form.locator(".cl-money input").fill("85");
  await form.getByLabel("代码（可选）").fill("AAPL");
  await form.getByLabel("预扣税").fill("15");
  await form.getByRole("button", { name: "添加" }).click();
  await page.waitForTimeout(1500);
  expect((await portfolios(page))[0].cash.find((entry: { kind: string }) => entry.kind === "dividend")).toMatchObject({ amount: 85, withheld: 15, symbol: "AAPL" });
  await page.goto("/tax"); await page.waitForTimeout(1500);
  await expect(page.locator(".tax-labels tr", { hasText: "20O" })).toContainText("22.50"); // 15 USD × 1.5
});

test("T08 fill missing brokerage from a fee schedule (IBKR fixed)", async ({ page }) => {
  await open(page, "/portfolio");
  await page.getByRole("button", { name: "补佣金" }).click();
  const dialog = page.locator("dialog.bf-dialog");
  await dialog.locator("select").first().selectOption("ibkr-fixed");
  await expect(dialog.locator(".ci-counts")).toContainText("3 笔将补上");
  await dialog.getByRole("button", { name: "补上 3 笔" }).click();
  await expect(page.locator(".tl-notice", { hasText: "已为 3 笔交易补上佣金" })).toBeVisible();
  await page.waitForTimeout(1500);
  const fees = (await portfolios(page))[0].cash.filter((entry: { kind: string; tradeId?: string }) => entry.kind === "fee" && entry.tradeId);
  expect(fees.map((fee: { tradeId: string; amount: number; currency?: string }) => [fee.tradeId, fee.amount, fee.currency ?? "USD"]).sort()).toEqual([["t1", 1, "USD"], ["t2", 1, "USD"], ["t3", 1, "USD"]]);
  await page.goto("/tax"); await page.waitForTimeout(1500);
  await expect(page.locator(".tl-notice", { hasText: "没有记录佣金" })).toHaveCount(0);
});
