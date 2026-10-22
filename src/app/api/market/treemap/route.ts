import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market-symbols";
import { getTreemapItems, getTreemapItemsForSymbols, type TreemapIndexKey } from "@/lib/treemap-data";
import { normalizeTimeframe } from "@/lib/timeframes";

function normalizeIndex(value: string | null): TreemapIndexKey {
  if (value === "nasdaq100") {
    return "nasdaq100";
  }

  return "sp100";
}

export async function GET(request: NextRequest) {
  const index = normalizeIndex(request.nextUrl.searchParams.get("index"));
  const timeframe = normalizeTimeframe(request.nextUrl.searchParams.get("timeframe"), "1D");
  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);

  try {
    const items =
      symbols.length > 0
        ? await getTreemapItemsForSymbols(symbols, timeframe)
        : await getTreemapItems(index, timeframe);
    return NextResponse.json({
      index,
      timeframe,
      symbols,
      items,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown treemap error";
    return NextResponse.json({ index, timeframe, items: [], message }, { status: 200 });
  }
}
