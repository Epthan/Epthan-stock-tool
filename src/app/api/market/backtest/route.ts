import { NextRequest, NextResponse } from "next/server";
import { getYahooHistorical, getYahooQuote } from "@/lib/yahoo-finance";
import { runBacktest, type BacktestSettings } from "@/lib/backtest";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
    const settings: BacktestSettings = body.settings;
    if (!/^[A-Z0-9^][A-Z0-9.^=\-]{0,24}$/.test(symbol) || !settings || !/^\d{4}-\d{2}-\d{2}$/.test(settings.start) || !/^\d{4}-\d{2}-\d{2}$/.test(settings.end)) return NextResponse.json({ message: "Invalid symbol or date." }, { status: 400 });
    const start = Date.parse(settings.start);
    const end = Date.parse(settings.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > Date.now() || end - start > 10 * 366 * 86400000 || !Number.isInteger(settings.long) || settings.long > 250 || settings.long < 2) return NextResponse.json({ message: "Choose a valid past date range up to 10 years and long SMA between 2 and 250." }, { status: 400 });
    const warmup = new Date(start - (settings.long * 3 + 30) * 86400000).toISOString().slice(0, 10);
    const exclusiveEnd = new Date(end + 86400000).toISOString().slice(0, 10);
    let history;
    let quote;
    try {
      [history, quote] = await Promise.all([getYahooHistorical(symbol, warmup, exclusiveEnd), getYahooQuote(symbol)]);
    } catch {
      return NextResponse.json({ message: "Historical market data unavailable. Please try again; no simulated data was substituted." }, { status: 502 });
    }
    const bars = history.filter((bar) => bar.open != null && bar.close != null).map((bar) => ({ date: bar.date.toISOString().slice(0, 10), open: bar.open!, close: bar.close! }));
    const result = runBacktest(bars, settings);
    return NextResponse.json({ symbol, currency: quote.currency ?? "", settings, result, source: "Yahoo Finance daily OHLC", retrievedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to run backtest." }, { status: 400 });
  }
}
