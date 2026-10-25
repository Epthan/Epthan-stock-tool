export type BacktestBar = { date: string; open: number; close: number };
export type BacktestSettings = { start: string; end: string; short: number; long: number; capital: number; commission: number; slippage: number };
export type BacktestTrade = { entry: string; exit: string; quantity: number; entryPrice: number; exitPrice: number; fees: number; pnl: number; reason: "signal" | "end" };

/**
 * Long-only moving-average crossover on daily bars.
 * A crossover seen at the close is traded at the next day's open, so the test never uses a price
 * it could not have traded at. Fully invested or fully in cash; fees and slippage apply to each side.
 */
export function runBacktest(history: BacktestBar[], settings: BacktestSettings) {
  if (!Number.isInteger(settings.short) || !Number.isInteger(settings.long) || settings.short < 1 || settings.long <= settings.short || settings.long > 250) throw new Error("Require 1 ≤ short SMA < long SMA ≤ 250.");
  if (![settings.capital, settings.commission, settings.slippage].every(Number.isFinite) || settings.capital <= 0 || settings.capital > 1e9 || settings.commission < 0 || settings.commission > 5 || settings.slippage < 0 || settings.slippage > 5) throw new Error("Invalid capital or transaction costs (0–5%).");
  const bars = [...history].sort((left, right) => left.date.localeCompare(right.date));
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || !Number.isFinite(bar.close) || bar.open <= 0 || bar.close <= 0 || (index > 0 && bar.date === bars[index - 1].date))) throw new Error("Invalid or duplicate historical prices.");
  // Bars before `start` are only there to warm up the long average.
  const first = bars.findIndex((bar) => bar.date >= settings.start);
  const last = bars.findLastIndex((bar) => bar.date <= settings.end);
  if (first < settings.long || last <= first) throw new Error("Insufficient history: need a full SMA warm-up and at least two trading days in the selected period.");
  const feeRate = settings.commission / 100;
  const slip = settings.slippage / 100;
  let cash = settings.capital;
  let quantity = 0;
  let pending: "buy" | "sell" | null = null;
  let entry = { date: "", price: 0, cost: 0, fee: 0 };
  const trades: BacktestTrade[] = [];
  const points: { date: string; equity: number; benchmark: number; drawdown: number }[] = [];
  // Prefix sums make each SMA lookup O(1).
  const prefix = [0];
  for (const bar of bars) prefix.push(prefix[prefix.length - 1] + bar.close);
  const average = (index: number, period: number) => (prefix[index + 1] - prefix[index + 1 - period]) / period;
  // Buy and hold pays the same entry costs, so the comparison is fair.
  const benchmarkPrice = bars[first].open * (1 + slip);
  const benchmarkQuantity = settings.capital / (benchmarkPrice * (1 + feeRate));
  let peak = settings.capital;
  function sell(bar: BacktestBar, rawPrice: number, reason: "signal" | "end") {
    const price = rawPrice * (1 - slip);
    const proceeds = quantity * price;
    const fee = proceeds * feeRate;
    cash += proceeds - fee;
    trades.push({ entry: entry.date, exit: bar.date, quantity, entryPrice: entry.price, exitPrice: price, fees: entry.fee + fee, pnl: proceeds - fee - entry.cost, reason });
    quantity = 0;
  }
  for (let index = first; index <= last; index++) {
    const bar = bars[index];
    // Execute yesterday's signal at today's open.
    if (pending === "buy" && quantity === 0) {
      const price = bar.open * (1 + slip);
      quantity = cash / (price * (1 + feeRate));
      entry = { date: bar.date, price, cost: cash, fee: quantity * price * feeRate };
      cash = 0;
    } else if (pending === "sell" && quantity > 0) sell(bar, bar.open, "signal");
    pending = null;
    // Close out on the final day so the result is realised, not marked to market.
    if (index === last && quantity > 0) sell(bar, bar.close, "end");
    const equity = cash + quantity * bar.close;
    // On the last day buy and hold also pays exit costs, like the strategy.
    const benchmark = benchmarkQuantity * bar.close * (index === last ? (1 - slip) * (1 - feeRate) : 1);
    peak = Math.max(peak, equity);
    points.push({ date: bar.date, equity, benchmark, drawdown: (equity / peak - 1) * 100 });
    // Signal at today's close; traded tomorrow (see the top of the loop).
    if (index < last) {
      const above = average(index, settings.short) > average(index, settings.long);
      const previouslyAbove = average(index - 1, settings.short) > average(index - 1, settings.long);
      if (above && !previouslyAbove && quantity === 0) pending = "buy";
      if (!above && previouslyAbove && quantity > 0) pending = "sell";
    }
  }
  const final = points[points.length - 1];
  const years = (Date.parse(final.date) - Date.parse(points[0].date)) / (365.25 * 86400000);
  return { points, trades, returnPercent: (final.equity / settings.capital - 1) * 100, benchmarkReturn: (final.benchmark / settings.capital - 1) * 100, annualizedReturn: (Math.pow(final.equity / settings.capital, 1 / years) - 1) * 100, maxDrawdown: Math.min(...points.map((point) => point.drawdown)), winRate: trades.length ? trades.filter((trade) => trade.pnl > 0).length / trades.length * 100 : null, finalEquity: final.equity, fees: trades.reduce((sum, trade) => sum + trade.fees, 0), start: points[0].date, end: final.date };
}

export type BacktestResult = ReturnType<typeof runBacktest>;
