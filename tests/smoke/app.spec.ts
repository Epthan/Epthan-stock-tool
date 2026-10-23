import { expect, test, type Page } from "@playwright/test";
import { analyzePortfolio } from "@/lib/live-portfolio";
import { buildBreakdowns } from "@/lib/breakdowns";
import type { PortfolioTrade } from "@/lib/portfolio-trades";

// ---- fixtures -------------------------------------------------------------
const days: string[] = [];
for (const date = new Date("2024-01-02T00:00:00Z"); days.length < 260; date.setUTCDate(date.getUTCDate() + 1)) if (date.getUTCDay() % 6) days.push(date.toISOString().slice(0, 10));
const series = (symbol: string, f: (i: number) => number) => ({ symbol, name: symbol, currency: "USD", prices: days.map((d, i) => ({ date: d, close: f(i) })) });
const trades: PortfolioTrade[] = [
  { id: "t1", symbol: "AAA", side: "buy", tradedAt: days[5], price: 100 + 5 * 0.2, quantity: 20, tags: ["breakout"], note: "smoke" },
  { id: "t2", symbol: "BBB", side: "buy", tradedAt: days[10], price: 50, quantity: 40, tags: ["dip"] },
  { id: "t3", symbol: "AAA", side: "sell", tradedAt: days[200], price: 100 + 200 * 0.2, quantity: 10 },
];
const cash = [{ id: "c1", kind: "deposit" as const, date: days[0], amount: 10000 }];
const portfolio = { id: "smoke", name: "Smoke Test", initials: "ST", symbols: ["AAA", "BBB"], trades, cash };
const store = { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", data: { "stock-tool.portfolios.v1": JSON.stringify([portfolio]), "stock-tool.active-portfolio.v1": "smoke" } };

function analysis() {
  const result = analyzePortfolio(trades, [series("AAA", (i) => 100 + i * 0.2), series("BBB", (i) => 50 + Math.sin(i / 9) * 3)], series("SPY", (i) => 400 + i * 0.3), "ALL", cash);
  return { ...result, groups: buildBreakdowns(result, { AAA: { sector: "Technology" }, BBB: { sector: "Energy" } }) };
}

/** Market APIs: Yahoo "down" (503) unless a handler is given. The store never touches disk. */
async function mockApis(page: Page, handlers: Record<string, () => unknown> = {}) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/store") return route.fulfill({ json: route.request().method() === "GET" ? store : { updatedAt: store.updatedAt, keys: [] } });
    const handler = Object.entries(handlers).find(([path]) => url.pathname.startsWith(path))?.[1];
    if (handler) return route.fulfill({ json: handler() });
    return route.fulfill({ status: 503, json: { message: "Market data unavailable (smoke test)" } });
  });
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|503/.test(message.text())) errors.push(message.text()); });
  return errors;
}

// ---- tests ----------------------------------------------------------------
test("every page survives market data being down", async ({ page }) => {
  const errors = watchErrors(page);
  await mockApis(page);
  for (const path of ["/", "/dashboard", "/portfolio", "/compare", "/treemap"]) {
    await page.goto(path);
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator("text=This page hit an error")).toHaveCount(0);
    await expect(page.locator("text=这个页面出错了")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("dashboard renders analysis, account panel and breakdowns", async ({ page }) => {
  const errors = watchErrors(page);
  const data = analysis();
  await mockApis(page, { "/api/market/portfolio-analysis": () => ({ result: data, benchmark: "SPY" }), "/api/market/corporate-actions": () => ({ splits: [], dividends: [], failed: [] }) });
  await page.goto("/dashboard");
  await expect(page.locator(".rd-hero")).toBeVisible();
  await expect(page.locator(".rd-account")).toBeVisible();
  await page.locator(".pd-topbar nav button").nth(1).click();
  await expect(page.locator(".bd-table").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("trade log shows positions, tags and the cash ledger", async ({ page }) => {
  const errors = watchErrors(page);
  await mockApis(page, {
    "/api/market/quote": () => ({ quote: { symbol: "AAA", price: 150, currency: "USD" } }),
    "/api/market/corporate-actions": () => ({ splits: [], dividends: [], failed: [] }),
  });
  await page.goto("/portfolio");
  await expect(page.locator(".tl-metrics").first()).toBeVisible();
  await expect(page.locator(".tl-tags i").first()).toBeVisible();
  await expect(page.locator(".tl-metrics-cash")).toBeVisible();
  expect(errors).toEqual([]);
});
