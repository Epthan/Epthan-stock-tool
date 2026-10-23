import { getTradePosition, type PortfolioTrade } from "@/lib/portfolio-trades";
import type { PortfolioRange } from "@/lib/portfolio-analytics";
import { cashSign, type CashEntry } from "@/lib/cash-ledger";
import { monthlyActivity, monthlyReturns, positionRisk, priceContext, returnStatistics, rollingSeries, tradeAnalytics, type DailyReturn } from "@/lib/trader-analytics";

export type DailyPrice = { date: string; close: number };
export type SecurityHistory = { symbol: string; name: string; currency: string; prices: DailyPrice[] };

/** Annualised money-weighted return (XIRR). flows: negative = money put in, positive = money taken out / final value. */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  const t0 = Date.parse(flows[0].date);
  const years = flows.map((flow) => (Date.parse(flow.date) - t0) / (365.25 * 86400000));
  const npv = (rate: number) => flows.reduce((sum, flow, index) => sum + flow.amount / (1 + rate) ** years[index], 0);
  let low = -0.9999, high = 10;
  if (npv(low) * npv(high) > 0) return null;
  for (let step = 0; step < 200; step++) {
    const mid = (low + high) / 2;
    if (npv(low) * npv(mid) <= 0) high = mid; else low = mid;
    if (high - low < 1e-9) break;
  }
  return (low + high) / 2;
}

export function analyzePortfolio(trades: PortfolioTrade[], securities: SecurityHistory[], benchmark: SecurityHistory, range: PortfolioRange, cash: CashEntry[] = []) {
  const ordered = [...trades].sort((left, right) => left.tradedAt.localeCompare(right.tradedAt));
  const firstTrade = ordered[0]?.tradedAt;
  if (!firstTrade) throw new Error("No trades recorded.");
  const priceMaps = new Map(securities.map((security) => [security.symbol, new Map(security.prices.map((price) => [price.date, price.close]))]));
  const benchmarkDates = benchmark.prices.map((price) => price.date).sort();
  const end = benchmarkDates[benchmarkDates.length - 1];
  if (ordered.some((trade) => trade.tradedAt > end)) throw new Error("The latest trade does not yet have a completed daily price. Try again after market close.");
  for (const trade of ordered) if (!priceMaps.get(trade.symbol)?.has(trade.tradedAt)) throw new Error(`No daily price for ${trade.symbol} on ${trade.tradedAt}. Check the trade date (weekends and holidays are not trading days).`);
  // Cash entries on weekends / holidays settle on the next trading day; entries after the last close wait.
  const tradingDay = (date: string) => benchmarkDates.find((day) => day >= date);
  const cashByDay = new Map<string, CashEntry[]>();
  let pendingCash = 0;
  for (const entry of cash) {
    const day = tradingDay(entry.date);
    if (!day) { pendingCash += 1; continue; }
    cashByDay.set(day, [...(cashByDay.get(day) ?? []), entry]);
  }
  const symbolSet = new Set(securities.map((security) => security.symbol));
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
    // Dividends, interest, fees and tax are part of the holdings' return; deposits / withdrawals are not.
    let income = 0;
    for (const entry of cashByDay.get(date) ?? []) {
      if (entry.kind === "deposit" || entry.kind === "withdrawal") continue;
      const amount = cashSign[entry.kind] * entry.amount;
      income += amount;
      const key = entry.symbol && symbolSet.has(entry.symbol) ? entry.symbol : "__other";
      totals[key] = (totals[key] ?? 0) + amount;
    }
    const dailyPnl = value + sales + income - startValue - purchases;
    totalPnl += dailyPnl;
    const denominator = startValue + purchases;
    if (denominator > 0) growth *= Math.max(0, value + sales + income) / denominator;
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
  // ---- Trader analytics -------------------------------------------------
  const allReturns: DailyReturn[] = rows.map((row, index) => {
    const previousIndex = index ? rows[index - 1].index : 1;
    const previousBench = index ? rows[index - 1].benchmarkIndex : 1;
    return { date: row.date, portfolio: previousIndex > 0 ? row.index / previousIndex - 1 : 0, benchmark: row.benchmarkIndex / previousBench - 1 };
  });
  const periodReturns = allReturns.filter((row) => row.date >= rows[firstIndex].date);
  const statistics = returnStatistics(periodReturns);
  const rolling = rollingSeries(allReturns).filter((row) => row.date >= rows[firstIndex].date);
  const months = monthlyReturns(allReturns);
  const trading = tradeAnalytics(ordered, securities, benchmark, cutoff);
  const activity = monthlyActivity(ordered, months);
  const risk = positionRisk(holdings.map((holding) => ({ symbol: holding.symbol, value: holding.value })), securities, end);
  const openedSince = new Map<string, string | null>();
  const running = new Map<string, number>();
  for (const trade of ordered) {
    const before = running.get(trade.symbol) ?? 0;
    const after = before + (trade.side === "buy" ? trade.quantity : -trade.quantity);
    if (before <= 1e-8 && after > 1e-8) openedSince.set(trade.symbol, trade.tradedAt);
    if (after <= 1e-8) openedSince.set(trade.symbol, null);
    running.set(trade.symbol, Math.max(0, after));
  }
  const enriched = holdings.map((holding) => {
    const context = priceContext(securities.find((security) => security.symbol === holding.symbol)?.prices ?? [], end, holding.quantity > 1e-8 ? openedSince.get(holding.symbol) ?? null : null);
    return { ...holding, ...context, vsCost: holding.averageCost && holding.price ? (holding.price / holding.averageCost - 1) * 100 : null, riskContribution: risk.contributions.find((item) => item.symbol === holding.symbol)?.risk ?? null };
  });
  // ---- Account level (holdings + cash), only when deposits are recorded --------------
  const account = (() => {
    if (!cash.some((entry) => entry.kind === "deposit")) return null;
    const valueByDate = new Map(rows.map((row) => [row.date, row.value]));
    const tradeCash = new Map<string, number>();
    for (const trade of ordered) tradeCash.set(trade.tradedAt, (tradeCash.get(trade.tradedAt) ?? 0) + (trade.side === "sell" ? 1 : -1) * trade.price * trade.quantity);
    const firstCash = [...cashByDay.keys()].sort()[0];
    const startDate = firstCash && firstCash < firstTrade ? firstCash : firstTrade;
    let balance = 0, previous = 0, index = 1, negative = false;
    let deposits = 0, withdrawals = 0, income = 0, costs = 0;
    const series: { date: string; index: number; value: number }[] = [];
    const flows: { date: string; amount: number }[] = [];
    for (const date of benchmarkDates.filter((day) => day >= startDate)) {
      let external = 0;
      for (const entry of cashByDay.get(date) ?? []) {
        const amount = cashSign[entry.kind] * entry.amount;
        if (entry.kind === "deposit") { external += amount; deposits += entry.amount; }
        else if (entry.kind === "withdrawal") { external += amount; withdrawals += entry.amount; }
        else if (amount > 0) income += amount; else costs -= amount;
        balance += amount;
      }
      balance += tradeCash.get(date) ?? 0;
      if (external) flows.push({ date, amount: -external });
      const value = (date >= firstTrade ? valueByDate.get(date) ?? 0 : 0) + balance;
      if (balance < -0.01) negative = true;
      const base = previous + external; // flows land at the start of the day
      if (base > 0 && value >= 0) index *= value / base;
      series.push({ date, index, value });
      previous = value;
    }
    const lastPoint = series.at(-1)!;
    const before = series.filter((row) => row.date < cutoff).at(-1);
    const netContributions = deposits - withdrawals;
    const mwr = negative ? null : xirr([...flows, { date: lastPoint.date, amount: lastPoint.value }]);
    const years = (Date.parse(lastPoint.date) - Date.parse(series[0].date)) / (365.25 * 86400000);
    return {
      value: lastPoint.value, cash: balance, cashWeight: lastPoint.value > 0 ? balance / lastPoint.value * 100 : null,
      deposits, withdrawals, netContributions, income, costs, gain: lastPoint.value - netContributions,
      periodReturn: negative ? null : (lastPoint.index / (before?.index ?? 1) - 1) * 100,
      sinceInception: negative ? null : (lastPoint.index - 1) * 100,
      mwrAnnual: mwr == null ? null : mwr * 100, mwrCumulative: mwr == null ? null : ((1 + mwr) ** years - 1) * 100, years, since: series[0].date, negativeCash: negative, pendingCash,
    };
  })();
  const otherContribution = (last.contributions.__other ?? 0) - (baseline?.contributions.__other ?? 0);
  const covered = holdings.filter((holding) => holding.beta != null).reduce((sum, holding) => sum + holding.value, 0);
  return { account, otherContribution, points, holdings: enriched, statistics, rolling, months, trading, activity, risk, currency: benchmark.currency, start: points[0].date, end, value: last.value, pnl: last.pnl - (baseline?.pnl ?? 0), realized: holdings.reduce((sum, holding) => sum + holding.realized, 0), unrealized: holdings.reduce((sum, holding) => sum + holding.unrealized, 0), beta: covered > 0 && Math.abs(covered - last.value) < 0.01 ? holdings.reduce((sum, holding) => sum + holding.value / covered * (holding.beta ?? 0), 0) : null, betaCoverage: last.value > 0 ? covered / last.value * 100 : 0, returnPercent: points.at(-1)!.portfolio, excess: points.at(-1)!.portfolio - points.at(-1)!.benchmark, maxDrawdown: Math.min(...points.map((point) => point.drawdown)) };
}

export type LivePortfolioAnalysis = ReturnType<typeof analyzePortfolio>;
