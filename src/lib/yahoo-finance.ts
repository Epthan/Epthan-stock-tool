import YahooFinance from "yahoo-finance2";
import type { TimeframeKey } from "@/lib/mock-market";

const yahooFinance = new YahooFinance();

/* ------------------------------------------------------------------ */
/* In-memory cache: every Yahoo call goes through here.                 */
/* - TTL per data type (quotes are short, fundamentals long)            */
/* - identical requests in flight share one upstream call               */
/* - kept on globalThis so dev-server hot reloads don't drop it         */
/* ------------------------------------------------------------------ */
type CacheEntry = { expires: number; value?: unknown; promise?: Promise<unknown> };
const store: Map<string, CacheEntry> = ((globalThis as { __yahooCache?: Map<string, CacheEntry> }).__yahooCache ??= new Map());
const MAX_ENTRIES = 3000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    if (hit.promise) return hit.promise as Promise<T>;
    return Promise.resolve(hit.value as T);
  }
  const promise = load().then(
    (value) => { store.set(key, { expires: Date.now() + ttl, value }); return value; },
    (error) => { store.delete(key); throw error; },
  );
  store.set(key, { expires: now + ttl, promise });
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
  return promise;
}

const QUOTE_TTL = 20 * SECOND;
const fetchQuotes = (symbols: string[]) => yahooFinance.quote(symbols, { return: "array" });
type QuoteRow = Awaited<ReturnType<typeof fetchQuotes>>[number];

/** Batch quotes; symbols already cached are served locally, the rest fetched in one call. */
export async function getYahooQuotes(symbols: string[]) {
  const now = Date.now();
  const missing = symbols.filter((symbol) => { const hit = store.get(`quote:${symbol}`); return !(hit && hit.expires > now); });
  if (missing.length) {
    const batch = cached(`quotes:${[...missing].sort().join(",")}`, QUOTE_TTL, () => fetchQuotes(missing));
    for (const symbol of missing) store.set(`quote:${symbol}`, { expires: now + QUOTE_TTL, promise: batch.then((rows) => rows.find((row) => row.symbol === symbol)) });
    await batch.catch(() => undefined);
  }
  const rows = await Promise.all(symbols.map((symbol) => cached<QuoteRow | undefined>(`quote:${symbol}`, QUOTE_TTL, async () => (await fetchQuotes([symbol]))[0])));
  return rows.filter((row): row is QuoteRow => !!row);
}

export async function getYahooQuote(symbol: string) {
  return cached(`quote:${symbol}`, QUOTE_TTL, () => yahooFinance.quote(symbol));
}

export async function getYahooQuoteSummary(symbol: string) {
  return cached(`summary:${symbol}`, 6 * HOUR, () => yahooFinance.quoteSummary(symbol, {
    modules: ["price", "summaryDetail", "financialData", "defaultKeyStatistics", "assetProfile"],
  }));
}

/**
 * Daily bars via chart(). yahoo-finance2's historical() is deprecated and throws when Yahoo returns
 * rows with some null fields (e.g. an unfinished current-day bar); chart() returns them and we drop them.
 */
type DailyBar = { date: Date; open: number | null; high: number | null; low: number | null; close: number; volume: number | null };
export type SplitEvent = { date: string; ratio: number };
export type DividendEvent = { date: string; amount: number };
type DailyData = { rows: DailyBar[]; splits: SplitEvent[]; dividends: DividendEvent[] };
const day = (date: Date) => date.toISOString().slice(0, 10);

/** Daily bars plus split / dividend events, cached 30 minutes. A cached wider range for the same symbol serves narrower requests. */
const dailyCover: Map<string, { from: string; to: string; expires: number; data: Promise<DailyData> }> = ((globalThis as { __yahooDaily2?: Map<string, { from: string; to: string; expires: number; data: Promise<DailyData> }> }).__yahooDaily2 ??= new Map());
async function getDaily(symbol: string, period1: string, period2: string): Promise<DailyData> {
  const now = Date.now();
  const cover = dailyCover.get(symbol);
  const within = (date: string) => date >= period1 && date < period2;
  if (cover && cover.expires > now && cover.from <= period1 && cover.to >= period2) {
    const data = await cover.data;
    return { rows: data.rows.filter((row) => within(day(row.date))), splits: data.splits.filter((item) => within(item.date)), dividends: data.dividends.filter((item) => within(item.date)) };
  }
  const data = cached(`daily:${symbol}:${period1}:${period2}`, 30 * MINUTE, async (): Promise<DailyData> => {
    const chart = await yahooFinance.chart(symbol, { period1, period2, interval: "1d", includePrePost: false, events: "div|split" });
    return {
      rows: chart.quotes
        .filter((row) => row.close != null && Number.isFinite(row.close) && row.close > 0)
        .map((row): DailyBar => ({ date: row.date, open: row.open ?? null, high: row.high ?? null, low: row.low ?? null, close: row.close as number, volume: row.volume ?? null })),
      splits: (chart.events?.splits ?? []).filter((item) => item.numerator > 0 && item.denominator > 0).map((item) => ({ date: day(item.date), ratio: item.numerator / item.denominator })).sort((a, b) => a.date.localeCompare(b.date)),
      dividends: (chart.events?.dividends ?? []).filter((item) => item.amount > 0).map((item) => ({ date: day(item.date), amount: item.amount })).sort((a, b) => a.date.localeCompare(b.date)),
    };
  });
  const widest = !cover || cover.expires <= now || (period1 <= cover.from && period2 >= cover.to);
  if (widest) dailyCover.set(symbol, { from: period1, to: period2, expires: now + 30 * MINUTE, data });
  data.catch(() => { if (dailyCover.get(symbol)?.data === data) dailyCover.delete(symbol); });
  return data;
}
export async function getYahooHistorical(symbol: string, period1: string, period2: string) {
  return (await getDaily(symbol, period1, period2)).rows;
}
export async function getYahooCorporateActions(symbol: string, period1: string, period2: string) {
  const { splits, dividends } = await getDaily(symbol, period1, period2);
  return { splits, dividends };
}

export async function searchYahooSymbols(query: string) {
  return cached(`search:${query.toLowerCase()}`, 10 * MINUTE, () => yahooFinance.search(query, {
    quotesCount: 16,
    newsCount: 0,
    enableFuzzyQuery: true,
  }));
}

function getStartDate(now: Date, timeframe: TimeframeKey) {
  const start = new Date(now);

  switch (timeframe) {
    case "1D":
      start.setDate(start.getDate() - 1);
      break;
    case "2D":
      start.setDate(start.getDate() - 2);
      break;
    case "5D":
      start.setDate(start.getDate() - 5);
      break;
    case "1W":
      start.setDate(start.getDate() - 7);
      break;
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1Y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "5Y":
      start.setFullYear(start.getFullYear() - 5);
      break;
    case "10Y":
      start.setFullYear(start.getFullYear() - 10);
      break;
    case "MAX":
      start.setFullYear(start.getFullYear() - 50);
      break;
  }

  return start;
}

function getChartInterval(timeframe: TimeframeKey) {
  switch (timeframe) {
    case "1D":
    case "2D":
      return "5m" as const;
    case "5D":
      return "15m" as const;
    case "1W":
      return "30m" as const;
    case "1M":
    case "3M":
    case "6M":
      return "1d" as const;
    case "1Y":
      return "1wk" as const;
    case "5Y":
      return "1wk" as const;
    case "10Y":
    case "MAX":
      return "1mo" as const;
  }
}

export async function getYahooChart(symbol: string, timeframe: TimeframeKey) {
  const period2 = new Date();
  const period1 = getStartDate(period2, timeframe);
  const interval = getChartInterval(timeframe);

  const intraday = interval.endsWith("m");
  // Bucket the window start so repeated calls share a cache entry.
  const bucket = Math.floor(period2.getTime() / (intraday ? MINUTE : 15 * MINUTE));
  return cached(`chart:${symbol}:${timeframe}:${bucket}`, intraday ? MINUTE : 15 * MINUTE, () => yahooFinance.chart(symbol, {
    period1,
    period2,
    interval,
    includePrePost: false,
  }));
}

export async function getYahooSparklines(symbols: string[], timeframe: TimeframeKey) {
  const responses = await Promise.all(
    symbols.map(async (symbol) => {
      const chart = await getYahooChart(symbol, timeframe);
      return [symbol, chart] as const;
    }),
  );

  return new Map(responses);
}
