import type { PortfolioTrade } from "@/lib/portfolio-trades";

/** Annual risk-free rate assumed for Sharpe / Sortino. Shown in the methodology notes. */
export const RISK_FREE_RATE = 0.04;
const TRADING_DAYS = 252;
const ROLLING_WINDOW = 63;

type Price = { date: string; close: number };
type Series = { symbol: string; prices: Price[] };

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
function sampleStd(values: number[]) {
  if (values.length < 2) return NaN;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}
function covariance(left: number[], right: number[]) {
  const n = Math.min(left.length, right.length);
  if (n < 2) return NaN;
  const a = mean(left.slice(0, n));
  const b = mean(right.slice(0, n));
  let sum = 0;
  for (let index = 0; index < n; index++) sum += (left[index] - a) * (right[index] - b);
  return sum / (n - 1);
}
const finite = (value: number) => (Number.isFinite(value) ? value : null);
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/* ------------------------------------------------------------------ */
/* Portfolio-level statistics from the daily return series              */
/* ------------------------------------------------------------------ */

export type DailyReturn = { date: string; portfolio: number; benchmark: number };

export function returnStatistics(returns: DailyReturn[]) {
  const rp = returns.map((row) => row.portfolio);
  const rb = returns.map((row) => row.benchmark);
  const n = returns.length;
  const growth = (values: number[]) => values.reduce((product, value) => product * (1 + value), 1);
  const years = n / TRADING_DAYS;
  const totalPortfolio = growth(rp) - 1;
  const totalBenchmark = growth(rb) - 1;
  const annualized = (total: number) => (years > 0 && total > -1 ? Math.pow(1 + total, 1 / years) - 1 : NaN);
  const volatility = sampleStd(rp) * Math.sqrt(TRADING_DAYS);
  const benchmarkVolatility = sampleStd(rb) * Math.sqrt(TRADING_DAYS);
  const dailyRf = RISK_FREE_RATE / TRADING_DAYS;
  const downside = Math.sqrt(rp.reduce((sum, value) => sum + Math.min(0, value - dailyRf) ** 2, 0) / Math.max(1, n - 1)) * Math.sqrt(TRADING_DAYS);
  const annualReturn = annualized(totalPortfolio);
  let peak = 1;
  let value = 1;
  let maxDrawdown = 0;
  for (const r of rp) { value *= 1 + r; peak = Math.max(peak, value); maxDrawdown = Math.min(maxDrawdown, value / peak - 1); }

  // OLS: rp = alpha + beta * rb
  const varianceB = covariance(rb, rb);
  const beta = covariance(rp, rb) / varianceB;
  const alphaDaily = mean(rp) - beta * mean(rb);
  const residuals = rp.map((value, index) => value - alphaDaily - beta * rb[index]);
  const residualVariance = n > 2 ? residuals.reduce((sum, value) => sum + value * value, 0) / (n - 2) : NaN;
  const sxx = varianceB * (n - 1);
  const alphaStdError = Math.sqrt(residualVariance * (1 / n + mean(rb) ** 2 / sxx));
  const correlation = covariance(rp, rb) / (sampleStd(rp) * sampleStd(rb));

  const up = returns.filter((row) => row.benchmark > 0);
  const down = returns.filter((row) => row.benchmark < 0);
  const capture = (rows: DailyReturn[]) => rows.length >= 5 ? mean(rows.map((row) => row.portfolio)) / mean(rows.map((row) => row.benchmark)) * 100 : NaN;
  const reliable = n >= 40;

  return {
    observations: n,
    totalReturn: totalPortfolio * 100,
    benchmarkReturn: totalBenchmark * 100,
    annualReturn: finite(annualReturn * 100),
    volatility: finite(volatility * 100),
    benchmarkVolatility: finite(benchmarkVolatility * 100),
    sharpe: reliable ? finite((annualReturn - RISK_FREE_RATE) / volatility) : null,
    sortino: reliable ? finite((annualReturn - RISK_FREE_RATE) / downside) : null,
    calmar: reliable && maxDrawdown < 0 ? finite(annualReturn / Math.abs(maxDrawdown)) : null,
    maxDrawdown: maxDrawdown * 100,
    beta: reliable ? finite(beta) : null,
    alphaAnnual: reliable ? finite(alphaDaily * TRADING_DAYS * 100) : null,
    alphaT: reliable ? finite(alphaDaily / alphaStdError) : null,
    correlation: reliable ? finite(correlation) : null,
    rSquared: reliable ? finite(correlation ** 2) : null,
    upCapture: finite(capture(up)),
    downCapture: finite(capture(down)),
    betaComponent: reliable && Number.isFinite(beta) ? beta * totalBenchmark * 100 : null,
  };
}

export function rollingSeries(returns: DailyReturn[], window = ROLLING_WINDOW) {
  return returns.map((row, index) => {
    if (index + 1 < window) return { date: row.date, excess: null, beta: null };
    const slice = returns.slice(index + 1 - window, index + 1);
    const p = slice.reduce((product, item) => product * (1 + item.portfolio), 1);
    const b = slice.reduce((product, item) => product * (1 + item.benchmark), 1);
    const rb = slice.map((item) => item.benchmark);
    const beta = covariance(slice.map((item) => item.portfolio), rb) / covariance(rb, rb);
    return { date: row.date, excess: (p - b) * 100, beta: finite(beta) };
  });
}

export function monthlyReturns(returns: DailyReturn[]) {
  const months = new Map<string, { portfolio: number; benchmark: number; days: number }>();
  for (const row of returns) {
    const key = row.date.slice(0, 7);
    const current = months.get(key) ?? { portfolio: 1, benchmark: 1, days: 0 };
    current.portfolio *= 1 + row.portfolio;
    current.benchmark *= 1 + row.benchmark;
    current.days += 1;
    months.set(key, current);
  }
  return [...months.entries()].map(([month, value]) => ({ month, portfolio: (value.portfolio - 1) * 100, benchmark: (value.benchmark - 1) * 100, days: value.days }));
}

/* ------------------------------------------------------------------ */
/* Trade-level analytics                                                */
/* ------------------------------------------------------------------ */

export type ClosedTrade = {
  id: string; symbol: string; exitDate: string; quantity: number; exitPrice: number; averageCost: number;
  pnl: number; returnPercent: number; holdingDays: number; afterExit20: number | null; note?: string;
};
export type EntryTrade = { id: string; symbol: string; date: string; price: number; after5: number | null; after20: number | null; excess5: number | null; excess20: number | null };

function forwardChange(prices: Price[], date: string, base: number, offset: number) {
  const index = prices.findIndex((price) => price.date === date);
  if (index < 0 || index + offset >= prices.length) return null;
  return (prices[index + offset].close / base - 1) * 100;
}

export function tradeAnalytics(trades: PortfolioTrade[], securities: Series[], benchmark: Series, cutoff: string) {
  const priceBySymbol = new Map(securities.map((security) => [security.symbol, security.prices]));
  const ordered = [...trades].sort((left, right) => left.tradedAt.localeCompare(right.tradedAt));
  const closed: ClosedTrade[] = [];
  const entries: EntryTrade[] = [];
  const state = new Map<string, { quantity: number; cost: number; lots: { date: string; quantity: number }[] }>();
  for (const trade of ordered) {
    const position = state.get(trade.symbol) ?? { quantity: 0, cost: 0, lots: [] };
    const prices = priceBySymbol.get(trade.symbol) ?? [];
    if (trade.side === "buy") {
      position.quantity += trade.quantity;
      position.cost += trade.quantity * trade.price;
      position.lots.push({ date: trade.tradedAt, quantity: trade.quantity });
      if (trade.tradedAt >= cutoff) {
        const after5 = forwardChange(prices, trade.tradedAt, trade.price, 5);
        const after20 = forwardChange(prices, trade.tradedAt, trade.price, 20);
        const benchClose = benchmark.prices.find((price) => price.date === trade.tradedAt)?.close;
        const bench5 = benchClose ? forwardChange(benchmark.prices, trade.tradedAt, benchClose, 5) : null;
        const bench20 = benchClose ? forwardChange(benchmark.prices, trade.tradedAt, benchClose, 20) : null;
        entries.push({ id: trade.id, symbol: trade.symbol, date: trade.tradedAt, price: trade.price, after5, after20, excess5: after5 != null && bench5 != null ? after5 - bench5 : null, excess20: after20 != null && bench20 != null ? after20 - bench20 : null });
      }
    } else {
      const averageCost = position.quantity > 0 ? position.cost / position.quantity : trade.price;
      // FIFO lot matching only for holding-period measurement; P&L stays on average cost.
      let remaining = trade.quantity;
      let weightedDays = 0;
      while (remaining > 1e-9 && position.lots.length) {
        const lot = position.lots[0];
        const used = Math.min(lot.quantity, remaining);
        weightedDays += used * days(lot.date, trade.tradedAt);
        lot.quantity -= used;
        remaining -= used;
        if (lot.quantity <= 1e-9) position.lots.shift();
      }
      position.cost -= averageCost * trade.quantity;
      position.quantity -= trade.quantity;
      if (position.quantity <= 1e-8) { position.quantity = 0; position.cost = 0; position.lots = []; }
      if (trade.tradedAt >= cutoff) {
        closed.push({
          id: trade.id, symbol: trade.symbol, exitDate: trade.tradedAt, quantity: trade.quantity, exitPrice: trade.price, averageCost,
          pnl: trade.quantity * (trade.price - averageCost), returnPercent: (trade.price / averageCost - 1) * 100,
          holdingDays: weightedDays / trade.quantity, afterExit20: forwardChange(prices, trade.tradedAt, trade.price, 20), note: trade.note,
        });
      }
    }
    state.set(trade.symbol, position);
  }

  const wins = closed.filter((trade) => trade.pnl > 0);
  const losses = closed.filter((trade) => trade.pnl < 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const averageWin = wins.length ? grossWin / wins.length : null;
  const averageLoss = losses.length ? grossLoss / losses.length : null;
  const afterExit = closed.map((trade) => trade.afterExit20).filter((value): value is number => value != null);
  const entry20 = entries.map((entry) => entry.excess20).filter((value): value is number => value != null);
  const entry5 = entries.map((entry) => entry.excess5).filter((value): value is number => value != null);
  const avg = (values: number[]) => values.length ? mean(values) : null;

  return {
    closed,
    entries,
    stats: {
      closedCount: closed.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: closed.length ? wins.length / closed.length * 100 : null,
      averageWin,
      averageLoss,
      payoffRatio: averageWin != null && averageLoss ? averageWin / averageLoss : null,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
      expectancy: closed.length ? closed.reduce((sum, trade) => sum + trade.pnl, 0) / closed.length : null,
      expectancyPercent: avg(closed.map((trade) => trade.returnPercent)),
      realized: closed.reduce((sum, trade) => sum + trade.pnl, 0),
      winHoldingDays: avg(wins.map((trade) => trade.holdingDays)),
      lossHoldingDays: avg(losses.map((trade) => trade.holdingDays)),
      afterExitAverage: avg(afterExit),
      afterExitRoseShare: afterExit.length ? afterExit.filter((value) => value > 0).length / afterExit.length * 100 : null,
      afterExitSamples: afterExit.length,
      entryExcess5: avg(entry5),
      entryExcess20: avg(entry20),
      entryBeatShare: entry20.length ? entry20.filter((value) => value > 0).length / entry20.length * 100 : null,
      entrySamples: entry20.length,
    },
  };
}

export function returnHistogram(values: number[], width = 5, limit = 30) {
  const bins: { from: number; to: number; count: number }[] = [];
  for (let from = -limit - width; from < limit + width; from += width) bins.push({ from, to: from + width, count: 0 });
  for (const value of values) {
    const clamped = Math.max(-limit - width / 2, Math.min(limit + width / 2, value));
    const bin = bins.find((item) => clamped >= item.from && clamped < item.to) ?? bins[bins.length - 1];
    bin.count += 1;
  }
  return bins;
}

export function monthlyActivity(trades: PortfolioTrade[], months: { month: string; portfolio: number }[]) {
  const counts = new Map<string, number>();
  for (const trade of trades) counts.set(trade.tradedAt.slice(0, 7), (counts.get(trade.tradedAt.slice(0, 7)) ?? 0) + 1);
  const rows = months.map((month) => ({ month: month.month, trades: counts.get(month.month) ?? 0, portfolio: month.portfolio }));
  const afterLoss: number[] = [];
  const afterGain: number[] = [];
  rows.forEach((row, index) => { if (index > 0) (rows[index - 1].portfolio < 0 ? afterLoss : afterGain).push(row.trades); });
  return { rows, tradesAfterLoss: afterLoss.length ? mean(afterLoss) : null, tradesAfterGain: afterGain.length ? mean(afterGain) : null };
}

/* ------------------------------------------------------------------ */
/* Current-position risk                                                */
/* ------------------------------------------------------------------ */

export function positionRisk(holdings: { symbol: string; value: number }[], securities: Series[], end: string) {
  const open = holdings.filter((holding) => holding.value > 0);
  const total = open.reduce((sum, holding) => sum + holding.value, 0);
  const weights = open.map((holding) => holding.value / total);
  const sortedWeights = [...weights].sort((left, right) => right - left);
  const hhi = weights.reduce((sum, weight) => sum + weight * weight, 0);
  const concentration = { top3: sortedWeights.slice(0, 3).reduce((sum, weight) => sum + weight, 0) * 100, hhi: hhi * 10000, effectiveCount: hhi > 0 ? 1 / hhi : 0, positions: open.length };

  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const from = start.toISOString().slice(0, 10);
  const maps = open.map((holding) => new Map((securities.find((security) => security.symbol === holding.symbol)?.prices ?? []).map((price) => [price.date, price.close])));
  const reference = securities.find((security) => security.symbol === open[0]?.symbol)?.prices.filter((price) => price.date >= from && price.date <= end).map((price) => price.date) ?? [];
  const dates = reference.filter((date) => maps.every((map) => map.has(date)));
  const returns = open.map((_, column) => dates.slice(1).map((date, index) => maps[column].get(date)! / maps[column].get(dates[index])! - 1));
  const n = dates.length - 1;
  if (open.length === 0 || n < 40) return { concentration, contributions: open.map((holding, index) => ({ symbol: holding.symbol, weight: weights[index] * 100, risk: null as number | null, volatility: null as number | null })), correlation: null as null | { symbols: string[]; matrix: number[][] }, volatility: null as number | null, observations: Math.max(0, n) };
  const cov = returns.map((left) => returns.map((right) => covariance(left, right)));
  const sigmaW = cov.map((row) => row.reduce((sum, value, index) => sum + value * weights[index], 0));
  const variance = weights.reduce((sum, weight, index) => sum + weight * sigmaW[index], 0);
  const contributions = open.map((holding, index) => ({ symbol: holding.symbol, weight: weights[index] * 100, risk: variance > 0 ? weights[index] * sigmaW[index] / variance * 100 : null, volatility: Math.sqrt(cov[index][index] * TRADING_DAYS) * 100 }));
  const matrix = cov.map((row, i) => row.map((value, j) => value / Math.sqrt(cov[i][i] * cov[j][j])));
  return { concentration, contributions, correlation: { symbols: open.map((holding) => holding.symbol), matrix }, volatility: Math.sqrt(variance * TRADING_DAYS) * 100, observations: n };
}

export function priceContext(prices: Price[], end: string, since: string | null) {
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const from = start.toISOString().slice(0, 10);
  const year = prices.filter((price) => price.date >= from && price.date <= end);
  const high = year.length ? Math.max(...year.map((price) => price.close)) : null;
  const last = prices.filter((price) => price.date <= end).at(-1)?.close ?? null;
  return { fromHigh: high && last ? (last / high - 1) * 100 : null, holdingDays: since ? days(since, end) : null };
}
