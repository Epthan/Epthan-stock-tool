import { NextRequest, NextResponse } from "next/server";
import { getYahooHistorical } from "@/lib/yahoo-finance";
import { fxSymbol } from "@/lib/fx";

/** Daily FX closes: /api/market/fx?pairs=USD:AUD,HKD:AUD&from=2024-01-01 → { rates: { "USD:AUD": [{ date, rate }] } } */
export async function GET(request: NextRequest) {
  const pairs = [...new Set((request.nextUrl.searchParams.get("pairs") ?? "").split(",").filter((pair) => /^[A-Z]{3}:[A-Z]{3}$/.test(pair)))].slice(0, 12);
  const from = request.nextUrl.searchParams.get("from") ?? "";
  if (!pairs.length || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return NextResponse.json({ message: "pairs and from are required." }, { status: 400 });
  const start = new Date(Date.parse(from) - 10 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const rates: Record<string, { date: string; rate: number }[]> = {};
  const failed: string[] = [];
  await Promise.all(pairs.map(async (pair) => {
    const [base, quote] = pair.split(":");
    try { rates[pair] = (await getYahooHistorical(fxSymbol(base, quote), start, end)).map((bar) => ({ date: bar.day, rate: bar.close })); }
    catch { failed.push(pair); }
  }));
  return NextResponse.json({ rates, failed });
}
