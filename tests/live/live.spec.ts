import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Live checks against real Yahoo Finance (needs internet). Read-only: nothing is written to your portfolios;
 * the server runs on its own data folder (test-results/data-live). Values are sanity checks, not exact numbers.
 */
const get = async (request: APIRequestContext, url: string) => {
  const started = Date.now();
  const response = await request.get(url);
  return { status: response.status(), body: await response.json(), ms: Date.now() - started };
};

test("L01 quotes: US stock, ASX stock, index", async ({ request }) => {
  for (const [symbol, currency] of [["AAPL", "USD"], ["BHP.AX", "AUD"], ["^GSPC", "USD"]]) {
    const { status, body } = await get(request, `/api/market/quote?symbol=${encodeURIComponent(symbol)}`);
    expect(status, symbol).toBe(200);
    expect(body.quote.price, symbol).toBeGreaterThan(0);
    expect(body.quote.currency, symbol).toBe(currency);
  }
});

test("L02 daily bars: increasing dates, no weekends, no future bar (US and ASX)", async ({ request }) => {
  for (const symbol of ["MSFT", "CBA.AX"]) {
    const { status, body } = await get(request, `/api/market/candles?symbol=${symbol}&timeframe=6M`);
    expect(status, symbol).toBe(200);
    const candles = body.candles as { time: number; close: number }[];
    expect(candles.length, symbol).toBeGreaterThan(100);
    for (let index = 1; index < candles.length; index++) expect(candles[index].time).toBeGreaterThan(candles[index - 1].time);
    expect(candles.every((candle) => candle.close > 0)).toBe(true);
    expect(candles.at(-1)!.time * 1000).toBeLessThanOrEqual(Date.now());
  }
  // ASX bars must fall on Monday–Friday in Sydney time (bars are stamped in UTC, the day before for Asia-Pacific).
  const asx = await get(request, "/api/market/candles?symbol=CBA.AX&timeframe=6M");
  const weekday = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short" });
  expect((asx.body.candles as { time: number }[]).filter((candle) => ["Sat", "Sun"].includes(weekday.format(candle.time * 1000)))).toEqual([]);
});

test("L03 market overview: broad indexes, 11 sectors, macro", async ({ request }) => {
  const { status, body } = await get(request, "/api/market/overview");
  expect(status).toBe(200);
  const group = (id: string) => (body.groups as { id: string; items: { price: number | null }[] }[]).find((item) => item.id === id)!;
  expect(group("broad").items.filter((item) => (item.price ?? 0) > 0).length).toBeGreaterThanOrEqual(6);
  expect(group("sectors").items.filter((item) => (item.price ?? 0) > 0).length).toBe(11);
  expect(group("macro").items.filter((item) => (item.price ?? 0) > 0).length).toBeGreaterThanOrEqual(6);
});

test("L04 heatmap constituents: S&P 100 and Nasdaq-100", async ({ request }) => {
  for (const index of ["sp100", "nasdaq100"]) {
    const { status, body } = await get(request, `/api/market/treemap?index=${index}&timeframe=1D`);
    expect(status, index).toBe(200);
    expect(body.items.length, index).toBeGreaterThanOrEqual(90);
    expect(new Set(body.items.map((item: { sector: string }) => item.sector)).size, index).toBeGreaterThanOrEqual(6);
  }
});

test("L05 FX series USD/AUD", async ({ request }) => {
  const { status, body } = await get(request, "/api/market/fx?pairs=USD:AUD&from=2024-01-01");
  expect(status).toBe(200);
  const series = body.rates["USD:AUD"] as { date: string; rate: number }[];
  expect(series.length).toBeGreaterThan(400);
  expect(series.every((row) => row.rate > 1.1 && row.rate < 2)).toBe(true);
  expect(series.at(-1)!.date >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)).toBe(true);
});

test("L06 portfolio analysis end to end: NVDA split restated, AUD ledger, contributions reconcile; F01 first analysis < 5s", async ({ request }) => {
  const trades = [
    { id: "n1", symbol: "NVDA", side: "buy", tradedAt: "2024-01-03", price: 475.69, quantity: 10 }, // before the 10:1 split of 2024-06-10
    { id: "b1", symbol: "BHP.AX", side: "buy", tradedAt: "2024-03-04", price: 44, quantity: 50 },
    { id: "n2", symbol: "NVDA", side: "sell", tradedAt: "2025-02-03", price: 116.66, quantity: 30 },
  ];
  const started = Date.now();
  const response = await request.post("/api/market/portfolio-analysis", { data: { trades, cash: [{ id: "d", kind: "deposit", date: "2024-01-02", amount: 20000 }], benchmark: "SPY", baseCurrency: "AUD", range: "ALL" } });
  const elapsed = Date.now() - started;
  expect(response.status()).toBe(200);
  const { result, splits } = await response.json();
  expect(splits.some((split: { symbol: string; date: string; ratio: number }) => split.symbol === "NVDA" && split.date === "2024-06-10" && split.ratio === 10)).toBe(true);
  const nvda = result.holdings.find((holding: { symbol: string }) => holding.symbol === "NVDA");
  expect(nvda.quantity).toBe(70); // 10 × 10 − 30
  expect(result.currency).toBe("AUD");
  const contributions = result.holdings.reduce((sum: number, holding: { contribution: number }) => sum + holding.contribution, 0) + result.otherContribution;
  expect(Math.abs(contributions - result.pnl)).toBeLessThan(0.01);
  expect(result.account).not.toBeNull();
  expect(elapsed, `first analysis took ${elapsed} ms`).toBeLessThan(5000);
});

test("L07 company profile, search, corporate actions", async ({ request }) => {
  const company = await get(request, "/api/market/company?symbol=MSFT");
  expect(company.status).toBe(200);
  expect(JSON.stringify(company.body)).toContain("Technology");
  const search = await get(request, "/api/market/search?q=apple");
  expect(search.body.results.some((row: { symbol: string }) => row.symbol === "AAPL")).toBe(true);
  const actions = await get(request, "/api/market/corporate-actions?symbols=NVDA,AAPL&from=2024-01-01");
  expect(actions.body.splits.some((split: { symbol: string; ratio: number }) => split.symbol === "NVDA" && split.ratio === 10)).toBe(true);
  expect(actions.body.dividends.filter((dividend: { symbol: string }) => dividend.symbol === "AAPL").length).toBeGreaterThanOrEqual(4);
});

test("F01 cached market APIs answer in under 300 ms", async ({ request }) => {
  for (const url of ["/api/market/quote?symbol=AAPL", "/api/market/candles?symbol=MSFT&timeframe=6M", "/api/market/overview", "/api/market/fx?pairs=USD:AUD&from=2024-01-01"]) {
    await get(request, url); // warm
    const { ms } = await get(request, url);
    expect(ms, `${url} took ${ms} ms`).toBeLessThan(300);
  }
});

test("L08/F02 every page opens on real data without errors, main content in under 3 s", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => { if (!sessionStorage.getItem("live")) { sessionStorage.setItem("live", "1"); localStorage.setItem("stock-tool.locale.v1", "zh"); } });
  const pages: [string, string][] = [["/", ".wpx-tools"], ["/dashboard", "main"], ["/portfolio", ".trade-ledger"], ["/tax", ".tax-report"], ["/compare", "main"], ["/treemap", "main"]];
  for (const [url] of pages) { await page.goto(url); await page.waitForLoadState("networkidle").catch(() => undefined); } // warm caches
  for (const [url, selector] of pages) {
    const started = Date.now();
    await page.goto(url);
    await page.locator(selector).first().waitFor({ state: "visible" });
    const ms = Date.now() - started;
    expect(ms, `${url} took ${ms} ms`).toBeLessThan(3000);
  }
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
