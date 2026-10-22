import { getTradePosition, type PortfolioTrade } from "@/lib/portfolio-trades";
import type { PortfolioRange } from "@/lib/portfolio-analytics";

export type DailyPrice = { date: string; close: number };
export type SecurityHistory = { symbol: string; name: string; currency: string; prices: DailyPrice[] };

export function analyzePortfolio(trades: PortfolioTrade[], securities: SecurityHistory[], benchmark: SecurityHistory, range: PortfolioRange) {
  const ordered = [...trades].sort((left, right) => left.tradedAt.localeCompare(right.tradedAt));
  const firstTrade = ordered[0]?.tradedAt;
  if (!firstTrade) throw new Error("No trades recorded.");
  const priceMaps = new Map(securities.map((security) => [security.symbol, new Map(security.prices.map((price) => [price.date, price.close]))]));
  const benchmarkDates = benchmark.prices.map((price) => price.date).sort();
  const end = benchmarkDates[benchmarkDates.length - 1];
  if (ordered.some((trade) => trade.tradedAt > end)) throw new Error("The latest trade does not yet have a completed daily price. Try again after market close.");
  for (const trade of ordered) if (!priceMaps.get(trade.symbol)?.has(trade.tradedAt)) throw new Error(`No daily price for ${trade.symbol} on ${trade.tradedAt}. Check the trade date (weekends and holidays are not trading days).`);
  const dates = benchmarkDates.filter((date) => date >= firstTrade);
  if (!dates.length) throw new Error("No historical prices for the recorded period.");
  const quantities = new Map<string, number>();
  const previousPrices = new Map<string, number>();
  const rows: { date: string; value: number; pnl: number; index: number; benchmarkIndex: number; contributions: Record<string, number> }[] = [];
  let growth = 1;
  let totalPnl = 0;
  const totals: Record<string, number> = {};
  const benchMap = new Map(benchmark.prices.map((price) => [price.date, price.close]));
  const initialBaselineDate = benchmarkDates.filter((date) => date < dates[0]).at(-1);
  const benchInitial = benchMap.get(initialBaselineDate ?? dates[0])!;
  let cursor = 0;
  for (const date of dates) {
    let startValue = 0;
    let purchases = 0;
    let sales = 0;
    const before = new Map(quantities);
    const dailyTrades: PortfolioTrade[] = [];
    for (const [symbol, quantity] of before) startValue += quantity * (previousPrices.get(symbol) ?? 0);
    while (cursor < ordered.length && ordered[cursor].tradedAt === date) {
      const trade = ordered[cursor++];
      dailyTrades.push(trade);
      quantities.set(trade.symbol, (quantities.get(trade.symbol) ?? 0) + (trade.side === "buy" ? trade.quantity : -trade.quantity));
      if (trade.side === "buy") purchases += trade.price * trade.quantity;
      else sales += trade.price * trade.quantity;
    }
    let value = 0;
    for (const security of securities) {
      const quantity = quantities.get(security.symbol) ?? 0;
      const previousQuantity = before.get(security.symbol) ?? 0;
      const close = priceMaps.get(security.symbol)!.get(date);
      if (close == null && (quantity > 1e-8 || previousQuantity > 1e-8)) throw new Error(`Historical prices incomplete for ${security.symbol} on ${date}.`);
      if (close == null) continue;
      const related = dailyTrades.filter((trade) => trade.symbol === security.symbol);
      const buys = related.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
      const sells = related.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
      const contribution = quantity * close - previousQuantity * (previousPrices.get(security.symbol) ?? close) + sells - buys;
      totals[security.symbol] = (totals[security.symbol] ?? 0) + contribution;
      value += quantity * close;
      previousPrices.set(security.symbol, close);
    }
    const dailyPnl = value + sales - startValue - purchases;
    totalPnl += dailyPnl;
    const denominator = startValue + purchases;
    if (denominator > 0) growth *= (value + sales) / denominator;
    rows.push({ date, value, pnl: totalPnl, index: growth, benchmarkIndex: benchMap.get(date)! / benchInitial, contributions: { ...totals } });
  }
  const threshold = new Date(`${end}T00:00:00Z`);
  if (range === "YTD") threshold.setUTCMonth(0, 1);
  else if (range === "1Y") threshold.setUTCFullYear(threshold.getUTCFullYear() - 1);
  else if (range !== "ALL") threshold.setUTCMonth(threshold.getUTCMonth() - ({ "1M": 1, "3M": 3, "6M": 6 }[range]));
  const cutoff = range === "ALL" ? firstTrade : threshold.toISOString().slice(0, 10);
  const firstIndex = Math.max(0, rows.findIndex((row) => row.date >= cutoff));
  const baseline = rows[firstIndex - 1];
  let peak = 1;
  const points = rows.slice(firstIndex).map((row) => {
    const netIndex = row.index / (baseline?.index ?? 1);
    peak = Math.max(peak, netIndex);
    return { date: row.date, portfolio: (netIndex - 1) * 100, benchmark: (row.benchmarkIndex / (baseline?.benchmarkIndex ?? 1) - 1) * 100, drawdown: (netIndex / peak - 1) * 100, pnl: row.pnl - (baseline?.pnl ?? 0) };
  });
  const baselineDate = baseline?.date ?? initialBaselineDate;
  if (baselineDate) points.unshift({ date: baselineDate, portfolio: 0, benchmark: 0, drawdown: 0, pnl: 0 });
  const last = rows[rows.length - 1];
  const holdings = securities.map((security) => {
    const position = getTradePosition(ordered, security.symbol);
    const price = security.prices.filter((row) => row.date <= end).at(-1)?.close ?? null;
    const value = position.quantity * (price ?? 0);
    const pairs: { stock: number; market: number }[] = [];
    const betaStart = new Date(`${end}T00:00:00Z`);
    betaStart.setUTCFullYear(betaStart.getUTCFullYear() - 2);
    const betaDate = betaStart.toISOString().slice(0, 10);
    const history = security.prices;
    for (let index = 1; index < history.length; index++) {
      const current = history[index];
      const previous = history[index - 1];
      const marketNow = benchMap.get(current.date);
      const marketBefore = benchMap.get(previous.date);
      if (current.date >= betaDate && marketNow && marketBefore) pairs.push({ stock: current.close / previous.close - 1, market: marketNow / marketBefore - 1 });
    }
    const averageStock = pairs.reduce((sum, pair) => sum + pair.stock, 0) / pairs.length;
    const averageMarket = pairs.reduce((sum, pair) => sum + pair.market, 0) / pairs.length;
    const variance = pairs.reduce((sum, pair) => sum + (pair.market - averageMarket) ** 2, 0);
    const beta = pairs.length >= 60 && variance > 0 ? pairs.reduce((sum, pair) => sum + (pair.stock - averageStock) * (pair.market - averageMarket), 0) / variance : null;
    return { symbol: security.symbol, name: security.name, ...position, price, value, weight: last.value > 0 ? value / last.value * 100 : 0, unrealized: position.averageCost == null ? 0 : position.quantity * ((price ?? 0) - position.averageCost), contribution: (last.contributions[security.symbol] ?? 0) - (baseline?.contributions[security.symbol] ?? 0), beta, betaSamples: pairs.length };
  });
  const covered = holdings.filter((holding) => holding.beta != null).reduce((sum, holding) => sum + holding.value, 0);
  return { points, holdings, currency: benchmark.currency, start: points[0].date, end, value: last.value, pnl: last.pnl - (baseline?.pnl ?? 0), realized: holdings.reduce((sum, holding) => sum + holding.realized, 0), unrealized: holdings.reduce((sum, holding) => sum + holding.unrealized, 0), beta: covered > 0 && Math.abs(covered - last.value) < 0.01 ? holdings.reduce((sum, holding) => sum + holding.value / covered * (holding.beta ?? 0), 0) : null, betaCoverage: last.value > 0 ? covered / last.value * 100 : 0, returnPercent: points.at(-1)!.portfolio, excess: points.at(-1)!.portfolio - points.at(-1)!.benchmark, maxDrawdown: Math.min(...points.map((point) => point.drawdown)) };
}

export type LivePortfolioAnalysis = ReturnType<typeof analyzePortfolio>;
