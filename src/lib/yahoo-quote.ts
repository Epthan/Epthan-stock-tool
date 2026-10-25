import { getMarketFromSymbol } from "@/lib/market-symbols";
import { symbolMeta, type QuoteCard, type WatchlistRow } from "@/lib/mock-market";

// The handful of quote fields we read. yahoo-finance2 returns far more, and its types change between versions.
export type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  volume?: number;
  fullExchangeName?: string;
  exchange?: string;
  currency?: string;
};

// Narrow an unknown Yahoo result without validating every field.
export function toYahooQuote(quote: unknown): YahooQuote | undefined {
  if (!quote || typeof quote !== "object") {
    return undefined;
  }

  return quote as YahooQuote;
}

// Returns null when Yahoo has no price or previous close (delisted, halted, bad symbol)
// so callers can show "no data" instead of a zero.
export function mapYahooQuote(symbol: string, quote?: YahooQuote): QuoteCard | WatchlistRow | null {
  const price = quote?.regularMarketPrice;
  const previousClose = quote?.regularMarketPreviousClose;

  if (!price || !previousClose) {
    return null;
  }

  // Prefer Yahoo's own change figures; they account for things like ex-dividend adjustments.
  const change = quote?.regularMarketChange ?? price - previousClose;
  const changePercent =
    quote?.regularMarketChangePercent ?? (previousClose === 0 ? 0 : (change / previousClose) * 100);
  const trend = change >= 0 ? "up" : "down";

  return {
    symbol,
    name: quote?.shortName ?? quote?.longName ?? symbolMeta[symbol] ?? symbol,
    market: getMarketFromSymbol(symbol),
    exchange: quote?.fullExchangeName ?? quote?.exchange ?? "",
    currency: quote?.currency ?? "",
    price,
    change,
    changePercent,
    volume: quote?.regularMarketVolume ?? quote?.volume ?? 0,
    trend,
  };
}
