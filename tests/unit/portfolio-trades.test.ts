import { describe, expect, it } from "vitest";
import { getTradePosition, importLegacyTrades, normalizeTags, validatePortfolioTrades, type PortfolioTrade } from "@/lib/portfolio-trades";
import { applySplits, splitFactor } from "@/lib/corporate-actions";

const buy = (id: string, tradedAt: string, price: number, quantity: number, symbol = "AAA"): PortfolioTrade => ({ id, symbol, side: "buy", tradedAt, price, quantity });
const sell = (id: string, tradedAt: string, price: number, quantity: number, symbol = "AAA"): PortfolioTrade => ({ id, symbol, side: "sell", tradedAt, price, quantity });

describe("[A01] parcel (FIFO) position", () => {
  it("sells the oldest parcel first; cost of what remains drives average cost", () => {
    const trades = [buy("1", "2024-01-02", 10, 100), buy("2", "2024-01-03", 20, 100), sell("3", "2024-01-04", 30, 50)];
    const position = getTradePosition(trades, "AAA");
    expect(position.quantity).toBe(150);
    expect(position.averageCost).toBeCloseTo((50 * 10 + 100 * 20) / 150);
    expect(position.realized).toBeCloseTo(50 * (30 - 10));
  });

  it("spans parcels when a sale is larger than the oldest parcel", () => {
    const trades = [buy("1", "2024-01-02", 10, 100), buy("2", "2024-01-03", 20, 100), sell("3", "2024-01-04", 30, 150)];
    const position = getTradePosition(trades, "AAA");
    expect(position.quantity).toBe(50);
    expect(position.averageCost).toBeCloseTo(20);
    expect(position.realized).toBeCloseTo(100 * 20 + 50 * 10);
  });

  it("handles a same-day round trip regardless of entry order", () => {
    const position = getTradePosition([sell("2", "2024-01-02", 11, 5), buy("1", "2024-01-02", 10, 5)], "AAA");
    expect(position.quantity).toBe(0);
    expect(position.realized).toBeCloseTo(5);
  });

  it("resets cost when fully closed", () => {
    const position = getTradePosition([buy("1", "2024-01-02", 10, 10), sell("2", "2024-01-03", 12, 10)], "AAA");
    expect(position.quantity).toBe(0);
    expect(position.averageCost).toBeNull();
    expect(position.realized).toBeCloseTo(20);
  });
});

describe("[B01] validation", () => {
  it("rejects selling more than held at that date", () => {
    expect(() => validatePortfolioTrades([sell("1", "2024-01-02", 10, 1), buy("2", "2024-01-03", 10, 1)])).toThrow("INSUFFICIENT_SHARES");
  });
  it("rejects future dates and duplicate ids", () => {
    expect(() => validatePortfolioTrades([buy("1", "2999-01-01", 10, 1)])).toThrow("INVALID_TIME");
    expect(() => validatePortfolioTrades([buy("1", "2024-01-02", 10, 1), buy("1", "2024-01-03", 10, 1)])).toThrow("INVALID_TRADE");
  });
  it("accepts post-split sells once the split is known", () => {
    const trades = [buy("1", "2024-01-05", 500, 10, "NVDA"), sell("2", "2024-07-01", 120, 50, "NVDA")];
    const splits = [{ symbol: "NVDA", date: "2024-06-10", ratio: 10 }];
    expect(() => validatePortfolioTrades(trades)).toThrow("INSUFFICIENT_SHARES");
    expect(() => validatePortfolioTrades(trades, splits)).not.toThrow();
    const position = getTradePosition(trades, "NVDA", splits);
    expect(position.quantity).toBe(50);
    expect(position.averageCost).toBeCloseTo(50);
    expect(position.realized).toBeCloseTo(50 * 70);
  });
});

describe("[A07] splits", () => {
  it("restates only trades before the split date, compounding multiple splits", () => {
    const splits = [{ symbol: "X", date: "2024-03-01", ratio: 2 }, { symbol: "X", date: "2024-06-01", ratio: 3 }, { symbol: "Y", date: "2024-01-01", ratio: 4 }];
    expect(splitFactor(splits, "X", "2024-02-01")).toBe(6);
    expect(splitFactor(splits, "X", "2024-03-01")).toBe(3);
    expect(splitFactor(splits, "X", "2024-07-01")).toBe(1);
    const [restated] = applySplits([buy("1", "2024-02-01", 60, 10, "X")], splits);
    expect(restated.quantity).toBe(60);
    expect(restated.price).toBeCloseTo(10);
  });
});

describe("[B05] legacy import and tags", () => {
  it("skips invalid legacy records and keeps the rest", () => {
    const result = importLegacyTrades([
      { symbol: "aaa", side: "buy", tradedAt: "2024-01-02", price: 10, quantity: 5 },
      { symbol: "AAA", side: "sell", tradedAt: "2024-01-03", price: 11, quantity: 50 },
      { symbol: "", side: "buy", tradedAt: "2024-01-03", price: 1, quantity: 1 },
    ]);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].symbol).toBe("AAA");
    expect(result.skipped).toBe(2);
  });
  it("normalises tags from text or arrays", () => {
    expect(normalizeTags("breakout, dip；dip #long-term")).toEqual(["breakout", "dip", "long-term"]);
    expect(normalizeTags([])).toBeUndefined();
  });
});
