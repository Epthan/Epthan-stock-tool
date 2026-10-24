import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { runBacktest } from "@/lib/backtest";
import { analyzePortfolio } from "@/lib/live-portfolio";
import { buildBreakdowns } from "@/lib/breakdowns";
import type { PortfolioTrade } from "@/lib/portfolio-trades";
import { dataDirFor } from "../support/servers";

/** Deterministic market: 520 weekdays from 2024-01-02, random walks per symbol. */
export const days: string[] = [];
for (const d = new Date("2024-01-02T00:00:00Z"); days.length < 520; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10));
const rnd = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const walk = (seed: number, start: number, drift = 0.0006, vol = 0.018) => { const r = rnd(seed); let p = start; return days.map(() => (p *= 1 + drift + (r() - 0.5) * 2 * vol)); };
export const SYMS = ["AAPL", "MSFT", "NVDA", "AMZN", "JPM", "XOM"];
export const paths: Record<string, number[]> = Object.fromEntries(SYMS.map((s, i) => [s, walk(i + 3, 100 + i * 40)]));
paths.SPY = walk(99, 400, 0.0004, 0.01);
export const at = (s: string, i: number) => Math.round(paths[s][i] * 100) / 100;
export const series = (s: string) => ({ symbol: s, name: s, currency: "USD", prices: days.map((d, i) => ({ date: d, close: paths[s][i] })) });

export const TRADES: PortfolioTrade[] = [
  { id: "t1", symbol: "AAPL", side: "buy", tradedAt: days[20], price: at("AAPL", 20), quantity: 30, tags: ["long-term"], note: "core" },
  { id: "t2", symbol: "NVDA", side: "buy", tradedAt: days[40], price: at("NVDA", 40), quantity: 25, tags: ["momentum"] },
  { id: "t3", symbol: "NVDA", side: "sell", tradedAt: days[200], price: at("NVDA", 200), quantity: 10 },
];
export const PORTFOLIO = { id: "qa", name: "QA Portfolio", initials: "QA", symbols: ["AAPL", "NVDA"], trades: TRADES, cash: [{ id: "c1", kind: "deposit", date: days[10], amount: 20000 }] };

const row = (s: string) => { const p = paths[s] ?? paths.SPY; const last = p.at(-1)!, prev = p.at(-2)!; return { symbol: s, name: `${s} Inc.`, market: "US", exchange: "NMS", currency: "USD", price: last, change: last - prev, changePercent: (last / prev - 1) * 100, volume: 12_000_000, trend: last >= prev ? "up" : "down" }; };
const candles = (s: string) => days.slice(-130).map((d, k) => { const c = (paths[s] ?? paths.SPY)[days.length - 130 + k]; return { time: Date.parse(`${d}T14:30:00Z`) / 1000, open: c * 0.995, high: c * 1.01, low: c * 0.99, close: c, volume: 1e7 }; });

function analysisFor(trades: PortfolioTrade[], cash: unknown[]) {
  const symbols = [...new Set(trades.map((t) => t.symbol))].filter((s) => paths[s]);
  const result = analyzePortfolio(trades, symbols.map(series), series("SPY"), "ALL", cash as never);
  return { result: { ...result, groups: buildBreakdowns(result, Object.fromEntries(symbols.map((s) => [s, { sector: "Technology" }]))) }, benchmark: "SPY" };
}

export type MockOptions = { down?: boolean; mockStore?: boolean };
/** Mock every /api/market/* route (Yahoo). The real /api/store runs unless mockStore is set. */
export async function mockMarket(page: Page, options: MockOptions = {}) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname, q = url.searchParams;
    if (p.startsWith("/api/store") && !options.mockStore) return route.continue();
    if (p === "/api/store") return route.fulfill({ json: route.request().method() === "GET" ? { version: 1, updatedAt: null, data: {} } : { updatedAt: "x", keys: [] } });
    if (options.down) return route.fulfill({ status: 503, json: { message: "HTTP 503 Service Unavailable (test)" } });
    const json = (body: unknown) => route.fulfill({ json: body });
    const sym = (q.get("symbol") ?? "AAPL").toUpperCase();
    if (p.startsWith("/api/market/dashboard")) return json({ mode: "live", provider: "yahoo", indexes: ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "^TNX"].map((s) => ({ ...row("SPY"), symbol: s })), watchlist: (q.get("symbols") ?? SYMS.join(",")).split(",").map(row), message: "ok", isLive: true });
    if (p.startsWith("/api/market/quote")) return json({ mode: "live", provider: "yahoo", quote: row(sym) });
    if (p.startsWith("/api/market/candles")) return json({ mode: "live", provider: "yahoo", symbol: sym, candles: candles(sym), message: "ok" });
    if (p.startsWith("/api/market/company")) return json({ symbol: sym, company: { shortName: `${sym} Inc.`, sector: "Technology", industry: "Software", marketCap: 3.1e12, trailingPE: 31.2, forwardPE: 27.4, dividendYield: 0.005, beta: 1.2, averageVolume: 5.4e7, fiftyTwoWeekLow: 60, fiftyTwoWeekHigh: 400, fiftyDayAverage: 230, twoHundredDayAverage: 210, targetMeanPrice: 255, recommendationKey: "buy", recommendationMean: 2, analystCount: 38, earningsGrowth: 0.11, revenueGrowth: 0.06, profitMargins: 0.25, returnOnEquity: 1.4, debtToEquity: 150 } });
    if (p.startsWith("/api/market/search")) { const term = (q.get("q") ?? "").toUpperCase(); return json({ results: SYMS.filter((s) => s.includes(term)).map((s) => ({ symbol: s, name: `${s} Inc.`, exchange: "NMS", type: "EQUITY", market: "US", marketLabel: "US" })) }); }
    if (p.startsWith("/api/market/portfolio-analysis")) { const body = JSON.parse(route.request().postData() ?? "{}"); try { return json(analysisFor(body.trades, body.cash ?? [])); } catch (error) { return route.fulfill({ status: 400, json: { message: (error as Error).message } }); } }
    if (p.startsWith("/api/market/corporate-actions")) return json({ splits: [], dividends: [{ symbol: "AAPL", date: days[300], amount: 0.25 }], failed: [] });
    if (p.startsWith("/api/market/fx")) return json({ rates: Object.fromEntries((q.get("pairs") ?? "").split(",").filter(Boolean).map((pair) => [pair, days.map((d) => ({ date: d, rate: 1.5 }))])), failed: [] });
    if (p.startsWith("/api/market/backtest")) { const bars = days.map((d, i) => ({ date: d, open: paths.AAPL[i] * 0.997, close: paths.AAPL[i] })); const settings = JSON.parse(route.request().postData() ?? "{}").settings; const s = { ...settings, start: days[260], end: days.at(-1) }; return json({ symbol: "AAPL", currency: "USD", settings, result: runBacktest(bars, s), prices: bars.slice(260).map((b) => ({ date: b.date, close: b.close })), source: "mock", retrievedAt: "" }); }
    if (p.startsWith("/api/market/treemap")) return json({ items: SYMS.map((s, i) => ({ symbol: s, name: s, sector: i < 4 ? "Technology" : "Energy", changePercent: (i - 2.5) * 0.9, magnitude: 1, price: paths[s].at(-1), marketCap: (6 - i) * 4e11, currency: "USD" })) });
    if (p.startsWith("/api/market/overview")) return json({ groups: [
      { id: "broad", items: ["^GSPC", "^DJI", "^IXIC", "^RUT", "^NDX", "^NYA", "^SP400", "RSP", "IWD", "IWF"].map((s, i) => ({ symbol: s, price: 1000 + i * 900, change: (i % 3 - 1) * 12, changePercent: (i % 3 - 1) * 0.8 })) },
      { id: "sectors", items: ["XLK", "XLC", "XLY", "XLP", "XLV", "XLF", "XLI", "XLE", "XLB", "XLRE", "XLU"].map((s, i) => ({ symbol: s, price: 80 + i, change: (i - 5) * 0.2, changePercent: (i - 5) * 0.35 })) },
      { id: "macro", items: ["^VIX", "^IRX", "^FVX", "^TNX", "^TYX", "DX-Y.NYB", "GC=F", "CL=F", "HG=F", "BTC-USD"].map((s, i) => ({ symbol: s, price: 4 + i, change: (i % 2 ? 1 : -1) * 0.03, changePercent: (i % 2 ? 1 : -1) * 0.6 })) },
    ] });
    return route.fulfill({ status: 404, json: { message: `unmocked ${p}` } });
  });
}

/** Fresh state: empty server store, browser seeded once per test (not on every navigation). */
/** Wipes only the e2e server's own data folder (test-results/data-e2e), never ./data. */
export function resetStore() { fs.rmSync(dataDirFor("e2e"), { recursive: true, force: true }); }
export async function seed(page: Page, { locale = "zh", skin = "gray", portfolio = true }: { locale?: string; skin?: string; portfolio?: boolean } = {}) {
  await page.addInitScript(({ locale, skin, data }) => {
    if (sessionStorage.getItem("qa-seeded")) return;
    sessionStorage.setItem("qa-seeded", "1");
    localStorage.clear();
    localStorage.setItem("stock-tool.locale.v1", locale);
    localStorage.setItem("stock-tool.theme-choice.v1", skin);
    if (data) { localStorage.setItem("stock-tool.portfolios.v1", JSON.stringify([data])); localStorage.setItem("stock-tool.active-portfolio.v1", data.id); }
  }, { locale, skin, data: portfolio ? PORTFOLIO : null });
}

export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|503|404/.test(message.text())) errors.push(message.text()); });
  return errors;
}

/** Seed the browser, mock the market, open a page and let it settle. */
export async function open(page: Page, url: string, opts: Parameters<typeof seed>[1] = {}, mock: MockOptions = {}) {
  await seed(page, opts);
  await mockMarket(page, mock);
  await page.goto(url);
  await page.waitForTimeout(1200);
}
export const store = async (page: Page) => (await (await page.request.get("/api/store")).json()) as { updatedAt: string | null; data: Record<string, string>; revs: Record<string, number> };
export const portfolios = async (page: Page) => JSON.parse((await store(page)).data["stock-tool.portfolios.v1"] ?? "[]");
export const audSigned = (value: number) => `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
