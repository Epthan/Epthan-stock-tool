import { NextResponse } from "next/server";
import { getYahooQuotes } from "@/lib/yahoo-finance";
import { OVERVIEW_GROUPS } from "@/lib/market-overview";

/** All overview quotes in one batched Yahoo call (cached ~20 s server-side). */
export async function GET() {
  try {
    const symbols = [...new Set(OVERVIEW_GROUPS.flatMap((group) => group.items.map((item) => item.symbol)))];
    const quotes = await getYahooQuotes(symbols);
    const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    const groups = OVERVIEW_GROUPS.map((group) => ({ id: group.id, items: group.items.flatMap((item) => {
      const quote = bySymbol.get(item.symbol);
      const price = quote?.regularMarketPrice;
      const previous = quote?.regularMarketPreviousClose;
      if (!price || !previous) return [];
      const change = quote?.regularMarketChange ?? price - previous;
      return [{ symbol: item.symbol, price, change, changePercent: quote?.regularMarketChangePercent ?? (change / previous) * 100, marketState: quote?.marketState ?? null }];
    }) }));
    return NextResponse.json({ groups, updatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Market overview unavailable." }, { status: 502 });
  }
}
