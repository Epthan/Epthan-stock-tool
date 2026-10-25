import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market-symbols";
import { getYahooQuote } from "@/lib/yahoo-finance";
import { mapYahooQuote, type YahooQuote } from "@/lib/yahoo-quote";

// GET /api/market/quote?symbol=AAPL: a single quote. 404 when Yahoo has no price for the symbol.
export async function GET(request: NextRequest) {
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol") ?? "");

  if (!symbol) {
    return NextResponse.json({ message: "Missing symbol" }, { status: 400 });
  }

  try {
    const quote = (await getYahooQuote(symbol)) as YahooQuote;
    const mapped = mapYahooQuote(symbol, quote);

    if (!mapped) {
      return NextResponse.json({ message: `No quote data for ${symbol}` }, { status: 404 });
    }

    return NextResponse.json({
      provider: "yahoo",
      mode: "live",
      quote: mapped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Yahoo Finance error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
