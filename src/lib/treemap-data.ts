import * as cheerio from "cheerio";
import { getYahooChart, getYahooQuote, getYahooQuoteSummary } from "@/lib/yahoo-finance";
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
};

type CacheValue = {
  expiresAt: number;
  items: TreemapItem[];
};

const cache = new Map<string, CacheValue>();
const ttlMs = 15 * 60 * 1000;

const sources: Record<TreemapIndexKey, string> = {
  sp100: "https://en.wikipedia.org/wiki/S%26P_100",
  nasdaq100: "https://en.wikipedia.org/wiki/Nasdaq-100",
};

function textOf(value: string) {
  return value.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
}

async function fetchConstituents(index: TreemapIndexKey) {
  const response = await fetch(sources[index], { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to fetch constituents for ${index}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  if (index === "sp100") {
    const table = $("table.wikitable")
      .toArray()
      .find((candidate) => {
        const headerText = $(candidate)
          .find("th")
          .toArray()
          .map((node) => textOf($(node).text()).toLowerCase())
          .join(" | ");

        return (
          headerText.includes("symbol") &&
          headerText.includes("sector") &&
          (headerText.includes("company") || headerText.includes("name"))
        );
      });

    if (!table) {
      throw new Error("Could not locate S&P 100 constituents table");
    }

    return $(table)
      .find("tbody tr")
      .toArray()
      .map((row) => {
        const cells = $(row).find("td");
        const symbol = textOf($(cells[0]).text()).replace(".", "-");
        const name = textOf($(cells[1]).text());
        const sector = textOf($(cells[2]).text()) || "Other";

        return symbol ? { symbol, name, sector } : null;
      })
      .filter(Boolean) as Constituent[];
  }

  const table = $("table.wikitable")
    .toArray()
    .find((candidate) => {
      const headerText = $(candidate).find("th").toArray().map((node) => textOf($(node).text()).toLowerCase()).join(" | ");
      return headerText.includes("ticker") && headerText.includes("company");
    });

  if (!table) {
    throw new Error("Could not locate Nasdaq-100 constituents table");
  }

  const rows = $(table).find("tbody tr").toArray();
  return rows
    .map((row) => {
      const cells = $(row).find("td");
      const symbol = textOf($(cells[0]).text()).replace(".", "-");
      const name = textOf($(cells[1]).text());
      const sector = textOf($(cells[2]).text()) || "Other";
      return symbol ? { symbol, name, sector } : null;
    })
    .filter(Boolean) as Constituent[];
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
  const items = await mapInBatches(constituents, timeframe, index === "sp100" ? 10 : 12);

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
  const items = await mapInBatches(constituents, timeframe, 8);

  cache.set(cacheKey, {
    items,
    expiresAt: Date.now() + ttlMs,
  });

  return items;
}
