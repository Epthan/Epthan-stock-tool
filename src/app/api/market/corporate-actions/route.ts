import { NextRequest, NextResponse } from "next/server";
import { getYahooCorporateActions } from "@/lib/yahoo-finance";

/** Splits and cash dividends (per share, split-adjusted) for up to 30 symbols since a date. */
export async function GET(request: NextRequest) {
  const symbols = [...new Set((request.nextUrl.searchParams.get("symbols") ?? "").split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9^][A-Z0-9.^=\-]{0,24}$/.test(symbol)))].slice(0, 30);
  const from = request.nextUrl.searchParams.get("from") ?? "";
  if (!symbols.length || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return NextResponse.json({ message: "symbols and from (YYYY-MM-DD) are required." }, { status: 400 });
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const results = await Promise.all(symbols.map(async (symbol) => {
    try { return { symbol, ...(await getYahooCorporateActions(symbol, from, to)) }; }
    catch { return { symbol, splits: [], dividends: [], failed: true }; }
  }));
  return NextResponse.json({
    splits: results.flatMap((result) => result.splits.map((split) => ({ symbol: result.symbol, ...split }))),
    dividends: results.flatMap((result) => result.dividends.map((dividend) => ({ symbol: result.symbol, ...dividend }))),
    failed: results.filter((result) => "failed" in result).map((result) => result.symbol),
  });
}
