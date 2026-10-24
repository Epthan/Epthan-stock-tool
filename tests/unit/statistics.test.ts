import { describe, expect, it } from "vitest";
import { RISK_FREE_RATE, returnStatistics, type DailyReturn } from "@/lib/trader-analytics";

/** Independent re-implementation (sums instead of the app's helpers) to cross-check the risk statistics. */
function reference(rows: DailyReturn[]) {
  const n = rows.length, p = rows.map((row) => row.portfolio), b = rows.map((row) => row.benchmark);
  const total = p.reduce((product, value) => product * (1 + value), 1) - 1;
  const annual = (1 + total) ** (252 / n) - 1;
  const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);
  const meanP = sum(p) / n, meanB = sum(b) / n;
  const volatility = Math.sqrt(sum(p.map((value) => (value - meanP) ** 2)) / (n - 1)) * Math.sqrt(252);
  const downside = Math.sqrt(sum(p.map((value) => Math.min(0, value - RISK_FREE_RATE / 252) ** 2)) / (n - 1)) * Math.sqrt(252);
  const sxy = sum(p.map((value, index) => value * b[index])) - n * meanP * meanB;
  const sxx = sum(b.map((value) => value * value)) - n * meanB * meanB;
  const syy = sum(p.map((value) => value * value)) - n * meanP * meanP;
  let peak = 1, level = 1, drawdown = 0;
  for (const value of p) { level *= 1 + value; peak = Math.max(peak, level); drawdown = Math.min(drawdown, level / peak - 1); }
  return { total: total * 100, annual: annual * 100, volatility: volatility * 100, sharpe: (annual - RISK_FREE_RATE) / volatility, sortino: (annual - RISK_FREE_RATE) / downside, beta: sxy / sxx, correlation: sxy / Math.sqrt(sxx * syy), maxDrawdown: drawdown * 100 };
}

describe("[A10] risk statistics match an independent implementation", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const rows: DailyReturn[] = Array.from({ length: 300 }, (_, index) => {
    const market = random() * 0.02 + 0.0003;
    return { date: `d${index}`, benchmark: market, portfolio: 1.3 * market + random() * 0.01 };
  });
  const app = returnStatistics(rows);
  const ref = reference(rows);
  it.each([
    ["total return", app.totalReturn, ref.total], ["annual return", app.annualReturn, ref.annual], ["volatility", app.volatility, ref.volatility],
    ["Sharpe", app.sharpe, ref.sharpe], ["Sortino", app.sortino, ref.sortino], ["beta", app.beta, ref.beta],
    ["correlation", app.correlation, ref.correlation], ["max drawdown", app.maxDrawdown, ref.maxDrawdown],
  ])("%s", (_name, actual, expected) => {
    expect(actual).not.toBeNull();
    expect(Math.abs((actual as number) - expected)).toBeLessThan(Math.abs(expected) * 1e-9 + 1e-12);
  });
});
