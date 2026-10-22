import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market-symbols";
import { getYahooChart } from "@/lib/yahoo-finance";
import { mockCandles } from "@/lib/mock-market";
import { normalizeTimeframe } from "@/lib/timeframes";

function toUnixTime(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

export async function GET(request: NextRequest) {
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol") ?? "AAPL");
  const timeframe = normalizeTimeframe(request.nextUrl.searchParams.get("timeframe"), "6M");

  try {
    const response = await getYahooChart(symbol, timeframe);
    const candles = response.quotes
      .filter((bar) => bar.open !== null && bar.high !== null && bar.low !== null && bar.close !== null)
      .map((bar) => ({
        time: toUnixTime(bar.date),
        open: bar.open ?? 0,
        high: bar.high ?? 0,
        low: bar.low ?? 0,
        close: bar.close ?? 0,
        volume: bar.volume ?? 0,
      }));

    return NextResponse.json({
      provider: "yahoo",
      mode: "live",
      symbol,
      timeframe,
      candles,
      isLive: true,
      message: `Loaded ${candles.length} candles for ${timeframe}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Yahoo Finance error";

    return NextResponse.json({
      provider: "mock",
      mode: "mock",
      symbol,
      timeframe,
      candles: mockCandles,
      isLive: false,
      message,
    });
  }
}
