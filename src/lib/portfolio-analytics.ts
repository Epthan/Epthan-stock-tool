export type PortfolioRange = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

/** Demo portfolios: fixed share counts (in DEMO_SYMBOLS order) plus cash, analysed with real prices. */
export const DEMO_SYMBOLS = ["AAPL", "MSFT", "NVDA", "JPM", "JNJ", "XOM"] as const;
export const demoPortfolios = [
  { id: "balanced", name: "Core Portfolio", nameZh: "核心组合", initials: "CP", cash: 12000, quantities: [80, 40, 100, 55, 65, 90] },
  { id: "growth", name: "Growth Portfolio", nameZh: "成长组合", initials: "GP", cash: 4500, quantities: [35, 50, 200, 0, 0, 0] },
  { id: "defensive", name: "Defensive Portfolio", nameZh: "防御组合", initials: "DP", cash: 20000, quantities: [0, 0, 0, 70, 110, 120] },
];
