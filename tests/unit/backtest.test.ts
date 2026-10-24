import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestBar } from "@/lib/backtest";
import { realTradeCurve } from "@/lib/real-vs-backtest";
import { tradingDays } from "./fixtures";

const days = tradingDays(60);
// Flat, rally, sell-off, recovery: the 3/5-day SMAs cross up, down, then up again.
const closes = days.map((_, i) => (i < 20 ? 100 : i < 32 ? 100 + (i - 19) * 3 : i < 44 ? 136 - (i - 31) * 4 : 88 + (i - 43) * 2));
const bars: BacktestBar[] = days.map((date, i) => ({ date, open: i ? closes[i - 1] : closes[0], close: closes[i] }));
const settings = { start: days[10], end: days.at(-1)!, short: 3, long: 5, capital: 10000, commission: 0, slippage: 0 };

/** Independent simulation: signal on today's close, fill at tomorrow's open, force-close on the last day. */
function reference(costRate = 0) {
  const sma = (i: number, n: number) => closes.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n;
  let cash = settings.capital, shares = 0, pending: string | null = null, trades = 0;
  const first = days.indexOf(settings.start), last = days.length - 1;
  for (let i = first; i <= last; i++) {
    if (pending === "buy" && !shares) { shares = cash / (bars[i].open * (1 + costRate)); cash = 0; }
    else if (pending === "sell" && shares) { cash = shares * bars[i].open * (1 - costRate); shares = 0; trades++; }
    pending = null;
    if (i === last && shares) { cash = shares * bars[i].close * (1 - costRate); shares = 0; trades++; }
    if (i < last) {
      const up = sma(i, 3) > sma(i, 5), wasUp = sma(i - 1, 3) > sma(i - 1, 5);
      if (up && !wasUp && !shares) pending = "buy";
      if (!up && wasUp && shares) pending = "sell";
    }
  }
  return { equity: cash, trades };
}

describe("[A12] strategy backtest", () => {
  it("matches an independent SMA-cross simulation without costs", () => {
    const result = runBacktest(bars, settings);
    const ref = reference();
    expect(result.finalEquity).toBeCloseTo(ref.equity, 6);
    expect(result.trades.length).toBe(ref.trades);
    expect(result.returnPercent).toBeCloseTo((ref.equity / settings.capital - 1) * 100, 6);
    expect(result.trades.every((trade) => days.indexOf(trade.entry) > days.indexOf(settings.start))).toBe(true); // fills the day after the signal
  });
  it("charges commission on both legs and reports drawdown ≤ 0", () => {
    const withCost = runBacktest(bars, { ...settings, commission: 0.1 });
    expect(withCost.finalEquity).toBeLessThan(runBacktest(bars, settings).finalEquity);
    expect(withCost.fees).toBeGreaterThan(0);
    expect(withCost.maxDrawdown).toBeLessThanOrEqual(0);
    expect(withCost.benchmarkReturn).toBeCloseTo(((closes.at(-1)! / bars[10].open) * (1 - 0.001) / (1 + 0.001) - 1) * 100, 6);
  });
  it("rejects bad settings and too little history", () => {
    expect(() => runBacktest(bars, { ...settings, short: 5, long: 3 })).toThrow();
    expect(() => runBacktest(bars, { ...settings, start: days[1] })).toThrow(/warm-up/);
    expect(() => runBacktest(bars, { ...settings, commission: 9 })).toThrow();
  });
});

describe("[A12] your real trades on the backtest's footing", () => {
  it("marks P&L to market and scales to the backtest capital by peak exposure", () => {
    const prices = days.slice(0, 5).map((date, i) => ({ date, close: 100 + i * 2.5 }));
    const curve = realTradeCurve([{ id: "b", symbol: "X", side: "buy", tradedAt: days[0], price: 100, quantity: 10 }], prices, 1000)!;
    expect(curve.pnl).toBeCloseTo(100);
    expect(curve.maxExposure).toBeCloseTo(1100);
    expect(curve.points.at(-1)!.equity).toBeCloseTo(1000 + 100 * (1000 / 1100));
    expect(realTradeCurve([], prices, 1000)).toBeNull();
  });
});
