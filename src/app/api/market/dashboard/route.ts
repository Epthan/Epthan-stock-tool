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

// GET /api/market/dashboard?symbols=AAPL,MSFT: index cards plus the watch-list rows, in one Yahoo batch.
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
      marketBreadth: mockMarketBreadth, // placeholder; not shown anywhere, kept for the response shape
      isLive: true,
      message: `Yahoo Finance data refreshed at ${new Date().toISOString()}`,
    });
  } catch (error) {
    // The old mock payload is still returned on failure, flagged mode "mock". The client only accepts
    // mode "live" and shows placeholders otherwise, so these numbers never reach the screen.
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
