import { NextRequest, NextResponse } from "next/server";
import { getYahooCorporateActions, getYahooHistorical, getYahooQuoteSummary, getYahooQuotes } from "@/lib/yahoo-finance";
import { buildBreakdowns, type SectorInfo } from "@/lib/breakdowns";
import { applySplits, type StockSplit } from "@/lib/corporate-actions";
import { fxSymbol, normalizeCurrency, rateOn, type RatePoint } from "@/lib/fx";
import { analyzePortfolio, type SecurityHistory } from "@/lib/live-portfolio";
import { validatePortfolioTrades, tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";
import type { PortfolioRange } from "@/lib/portfolio-analytics";
import { cashRevaluation, entriesInBase, validateCashEntries, type CashContext, type CashEntry } from "@/lib/cash-ledger";

// POST /api/market/portfolio-analysis: the full dashboard analysis for one portfolio.
// The browser sends its trades and cash; nothing is read from the server store here.
// Steps: daily prices and splits → split restatement → FX into the ledger currency → analyzePortfolio → breakdowns.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.trades) || !body.trades.length || body.trades.length > 2000) throw new Error("Record at least one buy transaction to calculate portfolio analytics.");
    const recorded: PortfolioTrade[] = body.trades.map((trade: PortfolioTrade) => ({ ...trade, tradedAt: tradeDate(trade.tradedAt) }));
    let cash: CashEntry[] = Array.isArray(body.cash) ? body.cash.slice(0, 5000) : [];
    validateCashEntries(cash);
    const benchmark = ["QQQ", "^AXJO"].includes(body.benchmark) ? body.benchmark as string : "SPY";
    const base = typeof body.baseCurrency === "string" && /^[A-Z]{3}$/.test(body.baseCurrency) ? body.baseCurrency : "USD";
    const range: PortfolioRange = ["1M", "3M", "6M", "YTD", "1Y", "ALL"].includes(body.range) ? body.range : "YTD";
    const symbols = [...new Set([...recorded.map((trade) => trade.symbol), benchmark])];
    if (symbols.length > 30) throw new Error("This version supports up to 29 securities per portfolio.");
    const first = [...recorded].sort((left, right) => left.tradedAt.localeCompare(right.tradedAt))[0].tradedAt;
    const end = new Date();
    const betaStart = new Date(end); betaStart.setUTCFullYear(betaStart.getUTCFullYear() - 2);
    const firstCash = cash.reduce((min, entry) => (entry.date < min ? entry.date : min), first);
    // Start a week before the first trade or cash entry (so day one has a previous close),
    // and at least two years back so per-holding beta has enough history.
    const begin = new Date(Math.min(Date.parse(first) - 7 * 86400000, Date.parse(firstCash) - 7 * 86400000, betaStart.getTime())).toISOString().slice(0, 10);
    // period2 is exclusive; tomorrow makes sure today's finished bar is included.
    const tomorrow = new Date(end.getTime() + 86400000).toISOString().slice(0, 10);
    const [quotes, histories] = await Promise.all([
      getYahooQuotes(symbols),
      Promise.all(symbols.map(async (symbol) => ({ symbol, data: await getYahooHistorical(symbol, begin, tomorrow) }))),
    ]);
    // Prices are split-adjusted, so restate pre-split trades onto today's share basis before anything else.
    const splits: StockSplit[] = (await Promise.all(symbols.filter((symbol) => symbol !== benchmark || recorded.some((trade) => trade.symbol === symbol)).map(async (symbol) => (await getYahooCorporateActions(symbol, begin, tomorrow)).splits.map((split) => ({ symbol, ...split }))))).flat();
    let adjusted = applySplits(recorded, splits);
    validatePortfolioTrades(adjusted);

    // Local-currency histories (minor units such as GBp normalised to GBP).
    const local = histories.map(({ symbol, data }) => {
      const quote = quotes.find((item) => item.symbol === symbol);
      if (!quote?.currency && !symbol.startsWith("^")) throw new Error(`Currency unavailable for ${symbol}.`);
      const { currency, divisor } = normalizeCurrency(quote?.currency ?? (symbol === "^AXJO" ? "AUD" : "USD"));
      return { symbol, name: quote?.longName ?? quote?.shortName ?? symbol, currency, divisor, prices: data.map((row) => ({ date: row.day, close: row.close / divisor })).sort((left, right) => left.date.localeCompare(right.date)) };
    });
    // Demo portfolios: buy at the first real close on/after the requested date, funded by one deposit (+ demo cash).
    if (body.demo === true) {
      adjusted = adjusted.map((trade) => {
        const info = local.find((item) => item.symbol === trade.symbol);
        const bar = info?.prices.find((price) => price.date >= trade.tradedAt);
        if (!info || !bar) throw new Error(`No price history for ${trade.symbol}.`);
        return { ...trade, tradedAt: bar.date, price: Math.round(bar.close * info.divisor * 100) / 100 };
      });
    }
    // FX into the base currency, one daily series per foreign currency.
    const foreign = [...new Set([...local.map((item) => item.currency), ...cash.flatMap((entry) => [entry.currency, entry.toCurrency]).filter((code): code is string => !!code)].filter((currency) => currency !== base))];
    const fx = new Map<string, RatePoint[]>(await Promise.all(foreign.map(async (currency) => {
      const series = (await getYahooHistorical(fxSymbol(currency, base), begin, tomorrow)).map((bar) => ({ date: bar.day, rate: bar.close }));
      if (!series.length) throw new Error(`No FX rates for ${currency}/${base}.`);
      return [currency, series] as [string, RatePoint[]];
    })));
    const toBase = (currency: string, date: string) => (currency === base ? 1 : rateOn(fx.get(currency), date) ?? NaN);

    // One calendar for every market (an ASX holding trades on US holidays and vice versa). Stop at the last
    // date every series has, and carry closes forward over days a market was shut.
    const commonEnd = local.reduce((min, item) => { const last = item.prices.at(-1)?.date ?? ""; return last < min ? last : min; }, "9999-12-31");
    const calendar = [...new Set(local.flatMap((item) => item.prices.map((price) => price.date)))].filter((date) => date <= commonEnd).sort();
    const securities: SecurityHistory[] = local.map((item) => {
      const map = new Map(item.prices.map((price) => [price.date, price.close]));
      const firstDate = item.prices[0]?.date;
      let previous: number | undefined;
      const prices: { date: string; close: number }[] = [];
      for (const date of calendar) {
        // Carry forward only after the first real price; before listing there is no value at all.
        const close = map.get(date) ?? (firstDate && date > firstDate ? previous : undefined);
        if (close == null) continue;
        previous = close;
        const converted = close * toBase(item.currency, date);
        if (Number.isFinite(converted)) prices.push({ date, close: converted });
      }
      return { symbol: item.symbol, name: item.name, currency: item.currency, prices };
    });
    // Trades are typed in the security's quote unit; convert at that day's rate (settled in the base currency).
    const unit = new Map(local.map((item) => [item.symbol, item]));
    const trades = adjusted.map((trade) => {
      const info = unit.get(trade.symbol)!;
      return { ...trade, price: trade.price / info.divisor * toBase(info.currency, trade.tradedAt) };
    });
    const bench = securities.find((security) => security.symbol === benchmark)!;
    if (body.demo === true && adjusted.length) {
      const first = adjusted.reduce((min, trade) => (trade.tradedAt < min ? trade.tradedAt : min), adjusted[0].tradedAt);
      const cost = trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
      cash = [{ id: "demo-deposit", kind: "deposit", date: first, amount: Math.round((cost + (Number(body.demoCash) || 0)) * 100) / 100 }];
    }
    // Cash: entries restated in the base currency; foreign cash (multi-currency accounts) revalued daily.
    const context: CashContext = { base, mode: body.cashMode === "local" ? "local" : "base", rate: (currency, date) => (currency === base ? 1 : date ? rateOn(fx.get(currency), date) : fx.get(currency)?.at(-1)?.rate ?? null), unit: (symbol) => { const info = unit.get(symbol); return info ? { currency: info.currency, divisor: info.divisor } : null; } };
    const revaluation = cashRevaluation(cash, adjusted, context, calendar);
    const result = { ...analyzePortfolio(trades, securities.filter((security) => trades.some((trade) => trade.symbol === security.symbol)), { ...bench, currency: base }, range, entriesInBase(cash, context), revaluation), currency: base };
    // Sector from Yahoo's company profile (cached 6h); funds are grouped as ETF / fund.
    const sectorEntries = await Promise.all([...new Set(recorded.map((trade) => trade.symbol))].map(async (symbol): Promise<[string, SectorInfo]> => {
      try {
        const summary = await getYahooQuoteSummary(symbol);
        const type = summary.price?.quoteType;
        if (type === "ETF" || type === "MUTUALFUND") return [symbol, { sector: "ETF / Fund" }];
        return [symbol, { sector: summary.assetProfile?.sector || "Unknown", industry: summary.assetProfile?.industry }];
      } catch { return [symbol, { sector: "Unknown" }]; }
    }));
    const sectors = Object.fromEntries(sectorEntries);
    const groups = buildBreakdowns(result, sectors);
    const currencies = Object.fromEntries(local.map((item) => [item.symbol, item.currency]));
    return NextResponse.json({ result: { ...result, groups, sectors }, benchmark, splits, baseCurrency: base, currencies, fxConverted: foreign, source: "Yahoo Finance daily close", retrievedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Market data unavailable. Please retry." }, { status: 400 });
  }
}
