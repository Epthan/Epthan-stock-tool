import { describe, expect, it } from "vitest";
import { auTaxReport, brokerageByTrade, discountDate, financialYear, restateInAud, taxCsv } from "@/lib/au-tax";
import type { CashEntry } from "@/lib/cash-ledger";
import type { PortfolioTrade } from "@/lib/portfolio-trades";

const t = (id: string, side: "buy" | "sell", tradedAt: string, price: number, quantity: number, symbol = "BHP.AX"): PortfolioTrade => ({ id, symbol, side, tradedAt, price, quantity });
const fee = (id: string, date: string, amount: number, extra: Partial<CashEntry> = {}): CashEntry => ({ id, kind: "fee", date, amount, ...extra });
const domestic = (symbol: string) => !symbol.endsWith(".AX");

describe("dates", () => {
  it("financial year runs 1 July – 30 June, named by the end year", () => {
    expect(financialYear("2024-06-30")).toBe(2024);
    expect(financialYear("2024-07-01")).toBe(2025);
  });
  it("discount needs 12 months excluding the buy and sell days", () => {
    expect(discountDate("2024-01-01")).toBe("2025-01-02");
    expect(discountDate("2024-02-29")).toBe("2025-03-01");
  });
});

describe("capital gains", () => {
  it("applies the 50% discount only to parcels held long enough, FIFO across parcels", () => {
    const trades = [t("b1", "buy", "2023-01-10", 10, 100), t("b2", "buy", "2024-03-01", 20, 100), t("s1", "sell", "2024-09-02", 30, 150)];
    const report = auTaxReport({ trades, cash: [], isForeign: domestic, today: "2024-10-01" });
    expect(report.events).toHaveLength(2);
    const [first, second] = report.events;
    expect(first).toMatchObject({ buyId: "b1", quantity: 100, gain: 2000, discountable: true });
    expect(second).toMatchObject({ buyId: "b2", quantity: 50, gain: 500, discountable: false });
    const year = report.years.find((item) => item.fy === 2025)!;
    expect(year.gains).toEqual({ discountable: 2000, other: 500, total: 2500 });
    expect(year.netCapitalGain).toBeCloseTo(500 + 1000);
    expect(report.parcels).toMatchObject([{ tradeId: "b2", quantity: 50, discountFrom: "2025-03-02" }]);
  });

  it("puts brokerage into the cost base and off the proceeds", () => {
    const trades = [t("b1", "buy", "2024-01-10", 10, 100), t("s1", "sell", "2024-02-10", 12, 100)];
    const cash = [fee("f1", "2024-01-10", 9.5, { tradeId: "b1" }), fee("f2", "2024-02-10", 9.5, { symbol: "BHP.AX", note: "Sell BHP.AX brokerage" })];
    const report = auTaxReport({ trades, cash, isForeign: domestic });
    expect(report.events[0].costBase).toBeCloseTo(1009.5);
    expect(report.events[0].proceeds).toBeCloseTo(1190.5);
    expect(report.events[0].gain).toBeCloseTo(181);
    expect(report.tradesWithoutBrokerage).toBe(0);
  });

  it("does not guess an unlinked fee when two trades share the date", () => {
    const trades = [t("b1", "buy", "2024-01-10", 10, 100), t("b2", "buy", "2024-01-10", 11, 10)];
    expect(brokerageByTrade(trades, [fee("f", "2024-01-10", 10, { symbol: "BHP.AX" })]).size).toBe(0);
  });

  it("offsets losses against non-discount gains first, then discount gains, and carries the rest forward", () => {
    const trades = [
      t("a1", "buy", "2020-01-10", 10, 100, "AAA.AX"), t("a2", "sell", "2023-08-01", 30, 100, "AAA.AX"), // +2000 discountable, FY24
      t("b1", "buy", "2023-07-03", 10, 100, "BBB.AX"), t("b2", "sell", "2023-09-01", 15, 100, "BBB.AX"), // +500 other, FY24
      t("c1", "buy", "2023-07-03", 50, 100, "CCC.AX"), t("c2", "sell", "2023-10-02", 40, 100, "CCC.AX"), // −1000 loss, FY24
      t("d1", "buy", "2024-07-02", 50, 100, "DDD.AX"), t("d2", "sell", "2024-08-01", 10, 100, "DDD.AX"), // −4000 loss, FY25
      t("e1", "buy", "2024-07-02", 10, 100, "EEE.AX"), t("e2", "sell", "2025-08-01", 40, 100, "EEE.AX"), // +3000 discountable, FY26
    ];
    const report = auTaxReport({ trades, cash: [], isForeign: domestic });
    const [fy24, fy25, fy26] = report.years;
    expect(fy24).toMatchObject({ fy: 2024, losses: 1000, lossesUsed: 1000, discount: 750, netCapitalGain: 750, carriedForward: 0 });
    expect(fy25).toMatchObject({ fy: 2025, losses: 4000, netCapitalGain: 0, carriedForward: 4000 });
    expect(fy26).toMatchObject({ fy: 2026, priorLosses: 4000, lossesUsed: 3000, discount: 0, netCapitalGain: 0, carriedForward: 1000 });
  });
});

describe("dividends and currency", () => {
  it("splits franked / unfranked, grosses up foreign dividends and flags missing data", () => {
    const cash: CashEntry[] = [
      { id: "d1", kind: "dividend", date: "2024-09-20", amount: 700, symbol: "BHP.AX", franked: 700, frankingCredit: 300 },
      { id: "d2", kind: "dividend", date: "2024-11-15", amount: 85, symbol: "AAPL", withheld: 15 },
      { id: "d3", kind: "dividend", date: "2024-12-01", amount: 50, symbol: "MSFT" },
      { id: "i1", kind: "interest", date: "2025-01-31", amount: 12.34 },
    ];
    const report = auTaxReport({ trades: [], cash, isForeign: (symbol) => !symbol.endsWith(".AX") });
    const year = report.years[0];
    expect(year.dividends).toMatchObject({ franked: 700, unfranked: 0, frankingCredits: 300, foreignGross: 150, foreignTax: 15, count: 3 });
    expect(year.interest).toBeCloseTo(12.34);
    expect(report.dividends.find((row) => row.id === "d3")?.flag).toBe("withholding");
    expect(taxCsv(report, 2025, "Test")).toContain("Franking credits (11U),300.00");
  });

  it("restates USD trades at the trade-date rate and keeps the gain in AUD", () => {
    const rates: Record<string, number> = { "2024-01-10": 1.5, "2024-06-10": 1.6 };
    const { trades } = restateInAud([t("b", "buy", "2024-01-10", 100, 10, "AAPL"), t("s", "sell", "2024-06-10", 100, 10, "AAPL")], [], "AUD", (_, date) => rates[date] ?? null, () => ({ currency: "USD", divisor: 1 }));
    const report = auTaxReport({ trades, cash: [], isForeign: () => true });
    expect(report.events[0].costBase).toBeCloseTo(1500);
    expect(report.events[0].gain).toBeCloseTo(100); // FX movement is part of the capital gain
  });
});
