import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market-symbols";
import { getYahooSparklines } from "@/lib/yahoo-finance";
import { mockSparklines, type SparklinePoint } from "@/lib/mock-market";
import { normalizeTimeframe } from "@/lib/timeframes";

function toSparkline(points: { close?: number | null; date?: Date }[]): SparklinePoint[] {
  return points
    .filter(
      (point): point is { close: number; date: Date } =>
        point.close !== null && point.close !== undefined && point.date instanceof Date,
    )
    .map((point) => ({
      time: Math.floor(point.date.getTime() / 1000),
      close: point.close,
    }));
}

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  const timeframe = normalizeTimeframe(request.nextUrl.searchParams.get("timeframe"), "1M");
  const symbols = symbolsParam
    ? symbolsParam
        .split(",")
        .map((symbol) => normalizeSymbol(symbol))
        .filter(Boolean)
    : [];

  try {
    const charts = await getYahooSparklines(symbols, timeframe);
    const sparklines = Object.fromEntries(
      symbols.map((symbol) => {
        const chart = charts.get(symbol);
        return [symbol, toSparkline(chart?.quotes ?? [])];
      }),
    );

    return NextResponse.json({
      provider: "yahoo",
      mode: "live",
      timeframe,
      sparklines,
      isLive: true,
      message: `Loaded ${symbols.length} sparklines for ${timeframe}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Yahoo Finance error";
    const sparklines = Object.fromEntries(
      symbols.map((symbol) => [symbol, mockSparklines[symbol] ?? []]),
    );

    return NextResponse.json({
      provider: "mock",
      mode: "mock",
      timeframe,
      sparklines,
      isLive: false,
      message,
    });
  }
}
