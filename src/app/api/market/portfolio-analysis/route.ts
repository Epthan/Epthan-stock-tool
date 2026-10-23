import { NextRequest, NextResponse } from "next/server";
import { getYahooCorporateActions, getYahooHistorical, getYahooQuotes } from "@/lib/yahoo-finance";
import { applySplits, type StockSplit } from "@/lib/corporate-actions";
import { analyzePortfolio, type SecurityHistory } from "@/lib/live-portfolio";
import { validatePortfolioTrades, tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";
import type { PortfolioRange } from "@/lib/portfolio-analytics";
import { validateCashEntries, type CashEntry } from "@/lib/cash-ledger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.trades) || !body.trades.length || body.trades.length > 2000) throw new Error("Record at least one buy transaction to calculate portfolio analytics.");
    const recorded: PortfolioTrade[] = body.trades.map((trade: PortfolioTrade) => ({ ...trade, tradedAt: tradeDate(trade.tradedAt) }));
    const cash: CashEntry[] = Array.isArray(body.cash) ? body.cash.slice(0, 5000) : [];
    validateCashEntries(cash);
    const benchmark = body.benchmark === "QQQ" ? "QQQ" : "SPY";
    const range: PortfolioRange = ["1M", "3M", "6M", "YTD", "1Y", "ALL"].includes(body.range) ? body.range : "YTD";
    const symbols = [...new Set([...recorded.map((trade) => trade.symbol), benchmark])];
    if (symbols.length > 30) throw new Error("This version supports up to 29 securities per portfolio.");
    const first = [...recorded].sort((left, right) => left.tradedAt.localeCompare(right.tradedAt))[0].tradedAt;
    const end = new Date();
    const betaStart = new Date(end); betaStart.setUTCFullYear(betaStart.getUTCFullYear() - 2);
    const firstCash = cash.reduce((min, entry) => (entry.date < min ? entry.date : min), first);
    const begin = new Date(Math.min(Date.parse(first) - 7 * 86400000, Date.parse(firstCash) - 7 * 86400000, betaStart.getTime())).toISOString().slice(0, 10);
    const tomorrow = new Date(end.getTime() + 86400000).toISOString().slice(0, 10);
    const today = end.toISOString().slice(0, 10);
    const [quotes, histories] = await Promise.all([
      getYahooQuotes(symbols),
      Promise.all(symbols.map(async (symbol) => ({ symbol, data: await getYahooHistorical(symbol, begin, tomorrow) }))),
    ]);
    // Prices are split-adjusted, so restate pre-split trades onto today's share basis before anything else.
    const splits: StockSplit[] = (await Promise.all(symbols.filter((symbol) => symbol !== benchmark || recorded.some((trade) => trade.symbol === symbol)).map(async (symbol) => (await getYahooCorporateActions(symbol, begin, tomorrow)).splits.map((split) => ({ symbol, ...split }))))).flat();
    const trades = applySplits(recorded, splits);
    validatePortfolioTrades(trades);
    const securities: SecurityHistory[] = histories.map(({ symbol, data }) => {
      const quote = quotes.find((item) => item.symbol === symbol);
      if (!quote?.currency) throw new Error(`Currency unavailable for ${symbol}.`);
      return { symbol, name: quote.longName ?? quote.shortName ?? symbol, currency: quote.currency, prices: data.filter((row) => row.close != null && row.close > 0 && row.date.toISOString().slice(0, 10) < today).map((row) => ({ date: row.date.toISOString().slice(0, 10), close: row.close! })).sort((left, right) => left.date.localeCompare(right.date)) };
    });
    // Yahoo publishes closes at slightly different times per symbol. Stop at the last date every security has,
    // and carry a close forward over isolated gaps so one missing row does not block the whole analysis.
    const commonEnd = securities.reduce((min, security) => { const last = security.prices.at(-1)?.date ?? ""; return last < min ? last : min; }, "9999-12-31");
    const benchDates = securities.find((security) => security.symbol === benchmark)!.prices.map((price) => price.date).filter((date) => date <= commonEnd);
    for (const security of securities) {
      const map = new Map(security.prices.map((price) => [price.date, price.close]));
      const first = security.prices[0]?.date;
      let previous: number | undefined;
      const filled: { date: string; close: number }[] = [];
      for (const date of benchDates) {
        const close = map.get(date) ?? (first && date > first ? previous : undefined);
        if (close != null) { filled.push({ date, close }); previous = close; }
      }
      security.prices = filled;
    }
    const bench = securities.find((security) => security.symbol === benchmark)!;
    if (securities.some((security) => security.currency !== bench.currency)) throw new Error("Mixed currencies require FX conversion. This version supports a single USD portfolio with SPY/QQQ benchmarks.");
    const result = analyzePortfolio(trades, securities.filter((security) => trades.some((trade) => trade.symbol === security.symbol)), bench, range, cash);
    return NextResponse.json({ result, benchmark, splits, source: "Yahoo Finance daily close", retrievedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Market data unavailable. Please retry." }, { status: 400 });
  }
}
