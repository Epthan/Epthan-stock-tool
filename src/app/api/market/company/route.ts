import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market-symbols";
import { getYahooQuoteSummary } from "@/lib/yahoo-finance";

// GET /api/market/company?symbol=AAPL: company facts for the research panel.
// Yahoo spreads these over several quoteSummary modules; take whichever one has the field.
export async function GET(request: NextRequest) {
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol") ?? "");

  if (!symbol) {
    return NextResponse.json({ message: "Missing symbol" }, { status: 400 });
  }

  try {
    const summary = await getYahooQuoteSummary(symbol);
    const price = summary.price;
    const detail = summary.summaryDetail;
    const financial = summary.financialData;
    const stats = summary.defaultKeyStatistics;
    const profile = summary.assetProfile;

    return NextResponse.json({
      symbol,
      company: {
        shortName: price?.shortName ?? price?.longName ?? symbol,
        sector: profile?.sectorDisp ?? profile?.sector ?? "N/A",
        industry: profile?.industryDisp ?? profile?.industry ?? "N/A",
        marketCap: detail?.marketCap ?? null,
        trailingPE: detail?.trailingPE ?? null,
        forwardPE: detail?.forwardPE ?? stats?.forwardPE ?? null,
        dividendYield: detail?.dividendYield ?? null,
        beta: detail?.beta ?? stats?.beta ?? null,
        averageVolume: detail?.averageVolume ?? detail?.averageVolume10days ?? null,
        fiftyTwoWeekLow: detail?.fiftyTwoWeekLow ?? null,
        fiftyTwoWeekHigh: detail?.fiftyTwoWeekHigh ?? null,
        fiftyDayAverage: detail?.fiftyDayAverage ?? null,
        twoHundredDayAverage: detail?.twoHundredDayAverage ?? null,
        targetMeanPrice: financial?.targetMeanPrice ?? null,
        recommendationKey: financial?.recommendationKey ?? "n/a",
        recommendationMean: financial?.recommendationMean ?? null,
        analystCount: financial?.numberOfAnalystOpinions ?? null,
        earningsGrowth: financial?.earningsGrowth ?? stats?.earningsQuarterlyGrowth ?? null,
        revenueGrowth: financial?.revenueGrowth ?? null,
        profitMargins: financial?.profitMargins ?? stats?.profitMargins ?? null,
        returnOnEquity: financial?.returnOnEquity ?? null,
        debtToEquity: financial?.debtToEquity ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Yahoo Finance error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
