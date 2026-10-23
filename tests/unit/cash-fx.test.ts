import { describe, expect, it } from "vitest";
import { cashRevaluation, cashSummary, entriesInBase, validateCashEntries, type CashContext, type CashEntry } from "@/lib/cash-ledger";
import { normalizeCurrency, rateOn } from "@/lib/fx";
import type { PortfolioTrade } from "@/lib/portfolio-trades";

const usdRates: Record<string, number> = { "2024-01-01": 1.5, "2024-03-01": 1.6 };
const context = (mode: "base" | "local"): CashContext => ({
  base: "AUD", mode,
  rate: (currency, date) => currency === "AUD" ? 1 : currency === "USD" ? (date ? (date >= "2024-03-01" ? usdRates["2024-03-01"] : usdRates["2024-01-01"]) : 1.6) : null,
  unit: (symbol) => (symbol.endsWith(".AX") ? { currency: "AUD", divisor: 1 } : symbol.endsWith(".L") ? { currency: "GBP", divisor: 100 } : { currency: "USD", divisor: 1 }),
});

describe("cash summary", () => {
  const trades: PortfolioTrade[] = [{ id: "t1", symbol: "AAPL", side: "buy", tradedAt: "2024-02-01", price: 100, quantity: 10 }];
  const entries: CashEntry[] = [
    { id: "d", kind: "deposit", date: "2024-01-02", amount: 3000 },
    { id: "x", kind: "fx", date: "2024-01-03", amount: 1500, currency: "AUD", toCurrency: "USD", toAmount: 990 },
    { id: "v", kind: "dividend", date: "2024-03-05", amount: 10, currency: "USD", symbol: "AAPL" },
  ];

  it("base mode: trades settle in the ledger currency at the trade-date rate", () => {
    const summary = cashSummary([{ id: "d", kind: "deposit", date: "2024-01-02", amount: 3000 }], trades, context("base"));
    expect(summary.bought).toBeCloseTo(1500);
    expect(summary.balance).toBeCloseTo(1500);
    expect(summary.balances).toEqual({ AUD: 1500 });
  });

  it("local mode: per-currency balances, marked at today's rate, with FX gain", () => {
    const summary = cashSummary(entries, trades, context("local"));
    expect(summary.balances.USD ?? 0).toBeCloseTo(990 - 1000 + 10); // zero balances are dropped
    expect(summary.balances.AUD).toBeCloseTo(1500);
    expect(summary.conversion).toBeCloseTo(990 * 1.5 - 1500); // spread paid
    expect(summary.income).toBeCloseTo(16);
  });

  it("restates entries in the base currency and turns FX into its net cost", () => {
    const restated = entriesInBase(entries, context("local"));
    expect(restated.find((entry) => entry.id === "v")?.amount).toBeCloseTo(16);
    const fx = restated.find((entry) => entry.id === "fx:x");
    expect(fx?.kind).toBe("fee");
    expect(fx?.amount).toBeCloseTo(15);
  });

  it("revalues foreign cash day by day", () => {
    const reval = cashRevaluation([{ id: "d", kind: "deposit", date: "2024-01-02", amount: 100, currency: "USD" }], [], context("local"), ["2024-01-02", "2024-03-01"]);
    expect(reval.get("2024-01-02")).toBeCloseTo(0);
    expect(reval.get("2024-03-01")).toBeCloseTo(10);
  });

  it("validates FX entries", () => {
    expect(() => validateCashEntries([{ id: "a", kind: "fx", date: "2024-01-02", amount: 1, currency: "USD" }])).toThrow("INVALID_FX");
    expect(() => validateCashEntries([{ id: "a", kind: "deposit", date: "2024-01-02", amount: 1, currency: "usd" }])).toThrow("INVALID_CURRENCY");
  });
});

describe("fx helpers", () => {
  it("normalises minor units", () => {
    expect(normalizeCurrency("GBp")).toEqual({ currency: "GBP", divisor: 100 });
    expect(normalizeCurrency("usd")).toEqual({ currency: "USD", divisor: 1 });
  });
  it("uses the last rate on or before a date, else the first", () => {
    const rates = [{ date: "2024-01-02", rate: 1 }, { date: "2024-01-05", rate: 2 }];
    expect(rateOn(rates, "2024-01-04")).toBe(1);
    expect(rateOn(rates, "2024-01-05")).toBe(2);
    expect(rateOn(rates, "2023-12-01")).toBe(1);
    expect(rateOn([], "2024-01-01")).toBeNull();
  });
});
