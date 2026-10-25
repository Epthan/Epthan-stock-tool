// Heatmap data: index membership scraped from Wikipedia, prices and market caps from Yahoo.
import * as cheerio from "cheerio";
import { getYahooChart, getYahooQuote, getYahooQuoteSummary, getYahooQuotes } from "@/lib/yahoo-finance";
import type { TimeframeKey } from "@/lib/mock-market";

export type TreemapIndexKey = "sp100" | "nasdaq100";

type Constituent = {
  symbol: string;
  name: string;
  sector: string;
};

type TreemapItem = Constituent & {
  changePercent: number;
  magnitude: number;
  price: number;
  marketCap?: number;
  currency?: string;
};

/** One batched quote call adds market cap (tile size) and currency to every tile. */
async function withMarketCaps(items: TreemapItem[]) {
  try {
    const quotes = await getYahooQuotes(items.map((item) => item.symbol));
    const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    return items.map((item) => { const quote = bySymbol.get(item.symbol); return { ...item, name: item.name === item.symbol ? quote?.shortName ?? quote?.longName ?? item.name : item.name, marketCap: quote?.marketCap ?? undefined, currency: quote?.currency ?? undefined }; });
  } catch {
    return items;
  }
}

type CacheValue = {
  expiresAt: number;
  items: TreemapItem[];
};

// Finished tiles per index + range. 15 minutes is plenty for a heatmap.
const cache = new Map<string, CacheValue>();
const ttlMs = 15 * 60 * 1000;

const sources: Record<TreemapIndexKey, string> = {
  sp100: "https://en.wikipedia.org/wiki/S%26P_100",
  nasdaq100: "https://en.wikipedia.org/wiki/Nasdaq-100",
};

// Strip footnote markers like "[3]" and collapse whitespace.
function textOf(value: string) {
  return value.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Built-in Nasdaq-100 membership (≈ mid-2026) used when the Wikipedia table cannot be read — Wikipedia's
 * Nasdaq-100 article no longer carries the components table. Names are filled from Yahoo quotes.
 */
export const NASDAQ100_FALLBACK: Constituent[] = [
  ...("AAPL MSFT NVDA AVGO ASML CSCO AMD INTU TXN QCOM ADBE AMAT ARM PANW MU APP LRCX KLAC ADI INTC CRWD MSTR SNPS CDNS FTNT MRVL WDAY ADSK ROP NXPI DDOG ZS CTSH TEAM CDW ON GFS MDB SHOP PLTR TTD").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Technology" })),
  ...("META GOOGL GOOG NFLX TMUS CMCSA CHTR EA TTWO WBD").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Communication Services" })),
  ...("AMZN TSLA BKNG PDD SBUX MELI DASH ORLY MAR ABNB ROST LULU").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Consumer Discretionary" })),
  ...("COST PEP MDLZ MNST KDP CCEP KHC").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Consumer Staples" })),
  ...("ISRG AMGN AZN GILD VRTX REGN IDXX DXCM GEHC BIIB").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Health Care" })),
  ...("HON ADP CTAS CSX AXON PAYX FAST PCAR CPRT VRSK ODFL").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Industrials" })),
  ...("CEG AEP EXC XEL").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Utilities" })),
  ...("FANG BKR").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Energy" })),
  ...("LIN").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Materials" })),
  ...("PYPL").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Financials" })),
  ...("CSGP").split(" ").map((symbol) => ({ symbol, name: symbol, sector: "Real Estate" })),
];

/** Index membership changes a few times a year: keep it for a day instead of re-scraping Wikipedia every 15 minutes. */
const constituentCache = new Map<TreemapIndexKey, { expiresAt: number; items: Promise<Constituent[]> }>();
function fetchConstituents(index: TreemapIndexKey) {
  const hit = constituentCache.get(index);
  if (hit && hit.expiresAt > Date.now()) return hit.items;
  const items = scrapeConstituents(index).catch((error) => { if (index === "nasdaq100") return NASDAQ100_FALLBACK; throw error; });
  constituentCache.set(index, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, items });
  items.catch(() => constituentCache.delete(index));
  return items;
}

async function scrapeConstituents(index: TreemapIndexKey) {
  const response = await fetch(sources[index], { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to fetch constituents for ${index}`);
  }

  const html = await response.text();
  return parseConstituentTable(html, index);
}

/**
 * Find the constituents table by its header row (works whether or not it has the "wikitable" class, and whether the
 * ticker cell is a <td> or a row-header <th>), then read ticker / company / sector by column position.
 */
export function parseConstituentTable(html: string, index: TreemapIndexKey): Constituent[] {
  const $ = cheerio.load(html);
  const headerOf = (table: Parameters<typeof $>[0]) => $(table).find("tr").first().find("th, td").toArray().map((cell) => textOf($(cell).text()).toLowerCase());
  for (const table of $("table").toArray()) {
    const headers = headerOf(table);
    const ticker = headers.findIndex((header) => /^(ticker|symbol)/.test(header));
    const company = headers.findIndex((header) => /^(company|name|security)/.test(header));
    const sector = headers.findIndex((header) => /sector|industry/.test(header));
    if (ticker < 0 || company < 0) continue;
    const rows = $(table).find("tr").toArray().slice(1).map((row) => {
      const cells = $(row).find("th, td").toArray().map((cell) => textOf($(cell).text()));
      // Wikipedia writes BRK.B, Yahoo wants BRK-B.
      const symbol = (cells[ticker] ?? "").replace(".", "-").toUpperCase();
      return /^[A-Z][A-Z0-9-]{0,9}$/.test(symbol) ? { symbol, name: cells[company] ?? symbol, sector: (sector >= 0 ? cells[sector] : "") || "Other" } : null;
    }).filter(Boolean) as Constituent[];
    // Small tables on the page (recent changes etc.) also have ticker columns; the real one is long.
    if (rows.length >= 50) return rows;
  }
  throw new Error(`Could not locate ${index === "sp100" ? "S&P 100" : "Nasdaq-100"} constituents table`);
}

async function mapConstituentChange(item: Constituent, timeframe: TimeframeKey) {
  try {
    if (timeframe === "1D") {
      const quote = await getYahooQuote(item.symbol);
      const price = quote.regularMarketPrice ?? 0;
      const changePercent = quote.regularMarketChangePercent ?? 0;

      return {
        ...item,
        price,
        changePercent,
        magnitude: Math.max(Math.abs(changePercent), 0.05),
      };
    }

    // Longer ranges: first to last close of the chart.
    const chart = await getYahooChart(item.symbol, timeframe);
    const bars = chart.quotes.filter((bar) => bar.close !== null);

    if (bars.length < 2) {
      return null;
    }

    const first = bars[0].close ?? 0;
    const last = bars[bars.length - 1].close ?? 0;

    if (!first || !last) {
      return null;
    }

    const changePercent = ((last - first) / first) * 100;

    return {
      ...item,
      price: last,
      changePercent,
      magnitude: Math.max(Math.abs(changePercent), 0.05),
    };
  } catch {
    return null;
  }
}

// Watch-list and holdings maps have no membership table, so look up name and sector per symbol.
async function resolveCustomConstituent(symbol: string) {
  try {
    const [quote, summary] = await Promise.all([
      getYahooQuote(symbol),
      getYahooQuoteSummary(symbol),
    ]);

    return {
      symbol,
      name: quote.shortName ?? quote.longName ?? summary.price?.shortName ?? symbol,
      sector: summary.assetProfile?.sector ?? "Other",
    } satisfies Constituent;
  } catch {
    return {
      symbol,
      name: symbol,
      sector: "Other",
    } satisfies Constituent;
  }
}

async function mapInBatches(items: Constituent[], timeframe: TimeframeKey, batchSize: number) {
  const results: TreemapItem[] = [];
  // One-day moves come straight from a single batched quote call (was one request per symbol).
  if (timeframe === "1D") {
    const quotes = await getYahooQuotes(items.map((item) => item.symbol));
    const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    for (const item of items) {
      const quote = bySymbol.get(item.symbol);
      const price = quote?.regularMarketPrice ?? 0;
      if (!price) continue;
      const changePercent = quote?.regularMarketChangePercent ?? 0;
      results.push({ ...item, name: item.name === item.symbol ? quote?.shortName ?? item.name : item.name, price, changePercent, magnitude: Math.max(Math.abs(changePercent), 0.05), marketCap: quote?.marketCap ?? undefined, currency: quote?.currency ?? undefined });
    }
    return results;
  }

  // Chart requests are per symbol; batching keeps us under Yahoo's rate limits.
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const resolved = await Promise.all(batch.map((item) => mapConstituentChange(item, timeframe)));
    results.push(...(resolved.filter(Boolean) as TreemapItem[]));
  }

  return results;
}

export async function getTreemapItems(index: TreemapIndexKey, timeframe: TimeframeKey) {
  const cacheKey = `${index}:${timeframe}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const constituents = await fetchConstituents(index);
  const items = await withMarketCaps(await mapInBatches(constituents, timeframe, 25));

  cache.set(cacheKey, {
    items,
    expiresAt: Date.now() + ttlMs,
  });

  return items;
}

export async function getTreemapItemsForSymbols(symbols: string[], timeframe: TimeframeKey) {
  const normalizedSymbols = Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  const cacheKey = `custom:${timeframe}:${normalizedSymbols.join(",")}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const constituents = await Promise.all(normalizedSymbols.map((symbol) => resolveCustomConstituent(symbol)));
  const items = await withMarketCaps(await mapInBatches(constituents, timeframe, 8));

  cache.set(cacheKey, {
    items,
    expiresAt: Date.now() + ttlMs,
  });

  return items;
}
