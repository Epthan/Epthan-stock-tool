import { NextRequest, NextResponse } from "next/server";
import { getMarketFromSymbol, getMarketLabel, normalizeSymbol } from "@/lib/market-symbols";
import { searchYahooSymbols } from "@/lib/yahoo-finance";

// Fields we use from Yahoo's search results (not covered by yahoo-finance2's types).
type YahooSearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
  typeDisp?: string;
  isYahooFinance?: boolean;
  exchangeDataDelayedBy?: number;
};

// GET /api/market/search?q=apple: up to 8 symbols for the search box.
export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();

  if (query.length < 1) {
    return NextResponse.json({ query, results: [] });
  }

  try {
    const response = await searchYahooSymbols(query);
    const results = response.quotes
      .filter((quote) => {
        const item = quote as YahooSearchQuote;
        // Yahoo also returns news-only and third-party entries that have no quote page.
        return item.isYahooFinance !== false && Boolean(item.symbol);
      })
      .map((quote) => {
        const item = quote as YahooSearchQuote;
        const symbol = normalizeSymbol(item.symbol ?? "");
        const market = getMarketFromSymbol(symbol);

        return {
          symbol,
          name: item.shortname ?? item.longname ?? symbol,
          market,
          marketLabel: getMarketLabel(market),
          exchange: item.exchDisp ?? item.exchange ?? "",
          type: item.typeDisp ?? item.quoteType ?? "",
          delayedByMinutes: item.exchangeDataDelayedBy ?? null,
        };
      })
      .filter((quote) => quote.symbol)
      // The same listing sometimes comes back twice (e.g. once per exchange alias).
      .filter((quote, index, current) => current.findIndex((item) => item.symbol === quote.symbol) === index)
      .slice(0, 8);

    return NextResponse.json({ query, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Yahoo Finance error";
    // An empty result list is a better experience in the search box than an error.
    return NextResponse.json({ query, results: [], message }, { status: 200 });
  }
}
