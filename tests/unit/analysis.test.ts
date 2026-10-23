import { describe, expect, it } from "vitest";
import { analyzePortfolio, xirr } from "@/lib/live-portfolio";
import { buildBreakdowns } from "@/lib/breakdowns";
import type { PortfolioTrade } from "@/lib/portfolio-trades";
import { series, tradingDays } from "./fixtures";

const days = tradingDays(60);
const flatBench = series("SPY", days, () => 400);

describe("holdings return", () => {
  it("is the price return when holding a single position", () => {
    const stock = series("AAA", days, (index) => 100 * (1 + index / 100));
    const result = analyzePortfolio([{ id: "1", symbol: "AAA", side: "buy", tradedAt: days[0], price: 100, quantity: 10 }], [stock], flatBench, "ALL");
    expect(result.returnPercent).toBeCloseTo((stock.prices.at(-1)!.close / 100 - 1) * 100, 6);
    expect(result.points.at(-1)!.benchmark).toBeCloseTo(0);
  });

  it("is not moved by adding money: buying more at the same price leaves TWR unchanged", () => {
    const stock = series("AAA", days, (index) => (index < 30 ? 100 : 110));
    const once = analyzePortfolio([{ id: "1", symbol: "AAA", side: "buy", tradedAt: days[0], price: 100, quantity: 10 }], [stock], flatBench, "ALL");
    const twice = analyzePortfolio([
      { id: "1", symbol: "AAA", side: "buy", tradedAt: days[0], price: 100, quantity: 10 },
      { id: "2", symbol: "AAA", side: "buy", tradedAt: days[10], price: 100, quantity: 90 },
    ], [stock], flatBench, "ALL");
    expect(twice.returnPercent).toBeCloseTo(once.returnPercent, 6);
    expect(twice.pnl).toBeCloseTo(100 * 10); // 100 shares × +10
  });

  it("reconciles per-symbol contributions to the period P&L", () => {
    const a = series("AAA", days, (index) => 100 + index);
    const b = series("BBB", days, (index) => 50 - index / 4);
    const trades: PortfolioTrade[] = [
      { id: "1", symbol: "AAA", side: "buy", tradedAt: days[0], price: 100, quantity: 10 },
      { id: "2", symbol: "BBB", side: "buy", tradedAt: days[3], price: 49.25, quantity: 20 },
      { id: "3", symbol: "AAA", side: "sell", tradedAt: days[40], price: 140, quantity: 4 },
    ];
    const cash = [{ id: "d", kind: "dividend" as const, date: days[20], amount: 7, symbol: "AAA" }, { id: "f", kind: "fee" as const, date: days[0], amount: 3 }];
    const result = analyzePortfolio(trades, [a, b], flatBench, "ALL", cash);
    const total = result.holdings.reduce((sum, holding) => sum + holding.contribution, 0) + result.otherContribution;
    expect(total).toBeCloseTo(result.pnl, 6);
    expect(result.otherContribution).toBeCloseTo(-3);
  });

  it("books dividends into the holdings return", () => {
    const stock = series("AAA", days, () => 100);
    const trades: PortfolioTrade[] = [{ id: "1", symbol: "AAA", side: "buy", tradedAt: days[0], price: 100, quantity: 10 }];
    const result = analyzePortfolio(trades, [stock], flatBench, "ALL", [{ id: "d", kind: "dividend", date: days[5], amount: 10, symbol: "AAA" }]);
    expect(result.returnPercent).toBeCloseTo(1, 6); // 10 on 1000
  });
});

describe("account level", () => {
  it("includes idle cash in TWR and computes money-weighted return", () => {
    const stock = series("AAA", days, (index) => (index < 1 ? 100 : 110));
    const trades: PortfolioTrade[] = [{ id: "1", symbol: "AAA", side: "buy", tradedAt: days[0], price: 100, quantity: 10 }];
    const result = analyzePortfolio(trades, [stock], flatBench, "ALL", [{ id: "d", kind: "deposit", date: days[0], amount: 2000 }]);
    expect(result.account?.value).toBeCloseTo(2100);
    expect(result.account?.cash).toBeCloseTo(1000);
    expect(result.account?.sinceInception).toBeCloseTo(5, 6); // +100 on 2000
    expect(result.returnPercent).toBeCloseTo(10, 6); // holdings only
    expect(result.account?.negativeCash).toBe(false);
  });

  it("withholds account returns when cash goes negative", () => {
    const stock = series("AAA", days, () => 100);
    const result = analyzePortfolio([{ id: "1", symbol: "AAA", side: "buy", tradedAt: days[0], price: 100, quantity: 10 }], [stock], flatBench, "ALL", [{ id: "d", kind: "deposit", date: days[0], amount: 100 }]);
    expect(result.account?.negativeCash).toBe(true);
    expect(result.account?.periodReturn).toBeNull();
  });

  it("xirr: doubling in a year ≈ 100%", () => {
    expect(xirr([{ date: "2023-01-01", amount: -100 }, { date: "2024-01-01", amount: 200 }])!).toBeCloseTo(1, 2);
    expect(xirr([{ date: "2023-01-01", amount: -100 }])).toBeNull();
  });
});

describe("breakdowns", () => {
  it("splits realized P&L across FIFO entry tags and keeps open lots as unrealized", () => {
    const stock = series("AAA", days, (index) => 100 + index * (20 / 30));
    const trades: PortfolioTrade[] = [
      { id: "1", symbol: "AAA", side: "buy", tradedAt: days[0], price: 100, quantity: 10, tags: ["breakout"] },
      { id: "2", symbol: "AAA", side: "buy", tradedAt: days[5], price: 100, quantity: 10, tags: ["dip"] },
      { id: "3", symbol: "AAA", side: "sell", tradedAt: days[30], price: 120, quantity: 15 },
    ];
    const result = analyzePortfolio(trades, [stock], flatBench, "ALL");
    const groups = buildBreakdowns(result, { AAA: { sector: "Technology" } });
    const tag = (key: string) => groups.byTag.find((row) => row.key === key)!;
    expect(tag("breakout").realized).toBeCloseTo(200);
    expect(tag("dip").realized).toBeCloseTo(100);
    expect(tag("dip").unrealized).toBeCloseTo(5 * (stock.prices.at(-1)!.close - 100), 4);
    expect(groups.bySector[0].key).toBe("Technology");
    expect(groups.byHolding.reduce((sum, row) => sum + row.count, 0)).toBe(1);
  });
});
