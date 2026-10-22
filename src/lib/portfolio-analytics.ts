export type PortfolioRange = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";
export type Benchmark = "SPY" | "QQQ";

const securities = [
  { symbol: "AAPL", name: "Apple", sector: "Technology", quantity: 80, initialPrice: 170, sensitivity: 1.12, color: "#14b8a6" },
  { symbol: "MSFT", name: "Microsoft", sector: "Technology", quantity: 40, initialPrice: 340, sensitivity: 1.02, color: "#60a5fa" },
  { symbol: "NVDA", name: "NVIDIA", sector: "Technology", quantity: 100, initialPrice: 85, sensitivity: 1.75, color: "#a78bfa" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials", quantity: 55, initialPrice: 155, sensitivity: 0.95, color: "#fbbf24" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", quantity: 65, initialPrice: 150, sensitivity: 0.48, color: "#fb7185" },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", quantity: 90, initialPrice: 100, sensitivity: 0.72, color: "#38bdf8" },
];

export const demoPortfolios = [
  { id: "balanced", name: "Core Portfolio", nameZh: "核心组合", initials: "CP", cash: 12000, quantities: [80, 40, 100, 55, 65, 90] },
  { id: "growth", name: "Growth Portfolio", nameZh: "成长组合", initials: "GP", cash: 4500, quantities: [35, 50, 200, 0, 0, 0] },
  { id: "defensive", name: "Defensive Portfolio", nameZh: "防御组合", initials: "DP", cash: 20000, quantities: [0, 0, 0, 70, 110, 120] },
];
const weeklyHistory = Array.from({ length: 105 }, (_, index) => {
  const marketReturn = index === 0 ? 0 : 0.0018 + Math.sin(index * 1.73) * 0.016 + Math.cos(index * 0.39) * 0.012;
  return {
    date: new Date(Date.UTC(2024, 9, 18 + index * 7)).toISOString().slice(0, 10),
    marketReturn,
    growthReturn: index === 0 ? 0 : marketReturn * 1.24 + Math.sin(index * 0.81) * 0.007,
  };
});

const prices = securities.map((security, securityIndex) => {
  let price = security.initialPrice;
  return weeklyHistory.map((week, index) => {
    if (index > 0) {
      price *= 1 + week.marketReturn * security.sensitivity + 0.0005 + Math.sin(index * 0.91 + securityIndex * 2) * 0.009;
    }
    return price;
  });
});

function beta(returns: number[], benchmark: number[]) {
  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const meanBenchmark = benchmark.reduce((sum, value) => sum + value, 0) / benchmark.length;
  const covariance = returns.reduce((sum, value, index) => sum + (value - meanReturn) * (benchmark[index] - meanBenchmark), 0);
  const variance = benchmark.reduce((sum, value) => sum + (value - meanBenchmark) ** 2, 0);
  return variance > 0 ? covariance / variance : null;
}

export function getPortfolioAnalytics(range: PortfolioRange, benchmark: Benchmark, portfolioId = "balanced") {
  const portfolio = demoPortfolios.find((item) => item.id === portfolioId) ?? demoPortfolios[0];
  const cash = portfolio.cash;
  const positions = securities.map((security, index) => ({ ...security, quantity: portfolio.quantities[index], prices: prices[index] })).filter((security) => security.quantity > 0);
  const endIndex = weeklyHistory.length - 1;
  const yearStart = weeklyHistory.findIndex((week) => week.date >= "2026-01-01");
  const startIndex = range === "ALL" ? 0 : range === "YTD" ? Math.max(0, yearStart - 1) : Math.max(0, endIndex - ({ "1M": 4, "3M": 13, "6M": 26, "1Y": 52 }[range]));
  const benchmarkReturns = weeklyHistory.slice(1).map((week) => benchmark === "SPY" ? week.marketReturn : week.growthReturn);
  const startValue = cash + positions.reduce((sum, security) => sum + security.quantity * security.prices[startIndex], 0);
  const holdings = positions.map(({ prices: securityPrices, ...security }) => {
    const price = securityPrices[endIndex];
    const marketValue = price * security.quantity;
    const returns = securityPrices.slice(1).map((value, priceIndex) => value / securityPrices[priceIndex] - 1);
    return { ...security, price, marketValue, averageCost: security.initialPrice, pnl: (price - securityPrices[startIndex]) * security.quantity, unrealized: (price - security.initialPrice) * security.quantity, beta: beta(returns, benchmarkReturns) };
  });
  const equityValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const totalValue = equityValue + cash;
  let benchmarkIndex = 1;
  let peak = 1;
  const points = weeklyHistory.slice(startIndex).map((week, index) => {
    const value = cash + positions.reduce((sum, security) => sum + security.quantity * security.prices[startIndex + index], 0);
    if (index > 0) benchmarkIndex *= 1 + (benchmark === "SPY" ? week.marketReturn : week.growthReturn);
    const portfolioIndex = value / startValue;
    peak = Math.max(peak, portfolioIndex);
    return { date: week.date, portfolio: (portfolioIndex - 1) * 100, benchmark: (benchmarkIndex - 1) * 100, drawdown: (portfolioIndex / peak - 1) * 100 };
  });
  const last = points[points.length - 1];
  const equityBeta = holdings.reduce((sum, holding) => sum + holding.marketValue / equityValue * (holding.beta ?? 0), 0);
  return { holdings, points, cash, totalValue, equityValue, pnl: totalValue - startValue, returnPercent: last.portfolio, benchmarkReturn: last.benchmark, excess: last.portfolio - last.benchmark, maxDrawdown: Math.min(...points.map((point) => point.drawdown)), equityBeta, largestWeight: Math.max(...holdings.map((holding) => holding.marketValue / totalValue * 100)), cashWeight: cash / totalValue * 100, startDate: points[0].date, endDate: last.date };
}

export type PortfolioAnalytics = ReturnType<typeof getPortfolioAnalytics>;
