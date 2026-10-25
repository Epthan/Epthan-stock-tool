// Cumulative returns in percent, as plotted on the dashboard.
export type ReturnPoint = { date: string; portfolio: number; benchmark: number };

/**
 * Drawdown, time under water and rolling volatility from a cumulative return series.
 * `window` is in observations (20 ≈ one trading month of daily points).
 */
export function buildPerformanceInsights(points: ReturnPoint[], window = 20, periodsPerYear = 252) {
  let portfolioPeak = 1;
  let benchmarkPeak = 1;
  let peakDate = points[0]?.date ?? "";
  let troughDate = peakDate;
  let maxPeakDate = peakDate;
  let maxDrawdown = 0;
  let underwater = 0;
  let longestUnderwater = 0;
  const portfolioReturns: number[] = [];
  const benchmarkReturns: number[] = [];
  function volatility(returns: number[]) {
    if (returns.length < window) return null;
    const sample = returns.slice(-window);
    if (!sample.every(Number.isFinite)) return null;
    const mean = sample.reduce((sum, value) => sum + value, 0) / window;
    return Math.sqrt(sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (window - 1)) * Math.sqrt(periodsPerYear) * 100;
  }
  const series = points.map((point, index) => {
    const value = 1 + point.portfolio / 100;
    const market = 1 + point.benchmark / 100;
    // Small tolerance so a return to the exact previous high counts as a new peak.
    if (value >= portfolioPeak - 1e-12) { portfolioPeak = Math.max(portfolioPeak, value); peakDate = point.date; underwater = 0; }
    else underwater += 1;
    longestUnderwater = Math.max(longestUnderwater, underwater);
    benchmarkPeak = Math.max(benchmarkPeak, market);
    const portfolioDrawdown = (value / portfolioPeak - 1) * 100;
    const benchmarkDrawdown = (market / benchmarkPeak - 1) * 100;
    if (portfolioDrawdown < maxDrawdown) { maxDrawdown = portfolioDrawdown; troughDate = point.date; maxPeakDate = peakDate; }
    if (index > 0) {
      const previous = points[index - 1];
      // A wiped-out account (index <= 0) has no meaningful daily return.
      portfolioReturns.push(1 + previous.portfolio / 100 > 0 ? value / (1 + previous.portfolio / 100) - 1 : NaN);
      benchmarkReturns.push(1 + previous.benchmark / 100 > 0 ? market / (1 + previous.benchmark / 100) - 1 : NaN);
    }
    return { date: point.date, excess: point.portfolio - point.benchmark, portfolioDrawdown, benchmarkDrawdown, portfolioVolatility: volatility(portfolioReturns), benchmarkVolatility: volatility(benchmarkReturns) };
  });
  return { series, maxDrawdown, maxPeakDate, troughDate, currentDrawdown: series.at(-1)?.portfolioDrawdown ?? 0, currentUnderwater: underwater, longestUnderwater, window, periodsPerYear };
}
