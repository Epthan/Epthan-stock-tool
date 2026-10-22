import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market-symbols";
import { getYahooQuotes } from "@/lib/yahoo-finance";
import {
  marketSymbols,
  mockIndexes,
  mockMarketBreadth,
  mockProviderPlan,
  mockWatchlist,
  type QuoteCard,
  type WatchlistRow,
} from "@/lib/mock-market";
import { mapYahooQuote, toYahooQuote } from "@/lib/yahoo-quote";

export async function GET(request: NextRequest) {
  try {
    const symbolsParam = request.nextUrl.searchParams.get("symbols");
    const watchlistSymbols = symbolsParam
      ? symbolsParam
          .split(",")
          .map((symbol) => normalizeSymbol(symbol))
          .filter(Boolean)
      : [...marketSymbols.watchlist];
    const symbols = [...marketSymbols.indexes, ...watchlistSymbols];
    const quotes = await getYahooQuotes([...symbols]);
    const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));

    const indexes = marketSymbols.indexes
      .map((symbol) => mapYahooQuote(symbol, toYahooQuote(quotesBySymbol.get(symbol))))
      .filter(Boolean) as QuoteCard[];

    const watchlist = watchlistSymbols
      .map((symbol) => mapYahooQuote(symbol, toYahooQuote(quotesBySymbol.get(symbol))))
      .filter(Boolean) as WatchlistRow[];

    return NextResponse.json({
      provider: "yahoo",
      mode: "live",
      indexes,
      watchlist,
      marketBreadth: mockMarketBreadth,
      isLive: true,
      message: `Yahoo Finance data refreshed at ${new Date().toISOString()}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Yahoo Finance error";

    return NextResponse.json(
      {
        provider: mockProviderPlan.provider,
        mode: "mock",
        indexes: mockIndexes,
        watchlist: mockWatchlist,
        marketBreadth: mockMarketBreadth,
        isLive: false,
        message,
      },
      { status: 200 },
    );
  }
}
