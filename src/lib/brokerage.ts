import type { PortfolioTrade } from "@/lib/portfolio-trades";

/**
 * Broker fee schedules for filling in missing brokerage. Fees are worked out on the trade as recorded
 * (price × quantity in the security's currency, before any split restatement) and rounded to cents.
 * Schedules change — the date each preset was checked is kept with it and shown in the UI.
 */
export type Market = "ASX" | "US" | "other";
export type FeeQuote = { amount: number; currency: string } | null;
export type FeeSchedule = { id: string; label: [string, string]; checked: string; note: [string, string]; fee: (market: Market, value: number, quantity: number) => FeeQuote };
export type CustomFee = { fixed: number; percent: number; minimum: number; currency: string };

export const marketOf = (symbol: string): Market => (symbol.endsWith(".AX") ? "ASX" : /^[A-Z][A-Z0-9-]{0,9}$/.test(symbol) ? "US" : "other");
const cents = (value: number) => Math.round(value * 100) / 100;

export const FEE_SCHEDULES: FeeSchedule[] = [
  {
    id: "ibkr-fixed", label: ["Interactive Brokers — fixed", "IBKR 固定费率"], checked: "2026-10",
    note: ["US: US$0.005 per share, min US$1, max 1% of trade value. ASX not included.", "美股：每股 US$0.005，每单最低 US$1，最高为成交额的 1%。不含澳股。"],
    fee: (market, value, quantity) => (market === "US" ? { amount: cents(Math.min(Math.max(0.005 * quantity, 1), 0.01 * value)), currency: "USD" } : null),
  },
  {
    id: "stake", label: ["Stake", "Stake"], checked: "2026-10",
    note: ["ASX: A$3 up to A$30,000, then 0.01%. US: US$3 up to US$30,000, then 0.01%.", "澳股：3 万澳元以内每笔 A$3，超过按 0.01%。美股：3 万美元以内每笔 US$3，超过按 0.01%。"],
    fee: (market, value) => (market === "other" ? null : { amount: cents(value <= 30000 ? 3 : value * 0.0001), currency: market === "ASX" ? "AUD" : "USD" }),
  },
  {
    id: "commsec-asx", label: ["CommSec — ASX", "CommSec 澳股"], checked: "2026-10",
    note: ["ASX (CDIA settled): $5 to $1k, $10 to $3k, $19.95 to $10k, $29.95 to $25k, 0.12% above. US not included.", "澳股（CDIA 结算）：1 千以内 $5，3 千以内 $10，1 万以内 $19.95，2.5 万以内 $29.95，以上 0.12%。不含美股。"],
    fee: (market, value) => {
      if (market !== "ASX") return null;
      const amount = value <= 1000 ? 5 : value <= 3000 ? 10 : value <= 10000 ? 19.95 : value <= 25000 ? 29.95 : value * 0.0012;
      return { amount: cents(amount), currency: "AUD" };
    },
  },
];

export function customFee(rule: CustomFee): FeeSchedule["fee"] {
  return (_market, value) => {
    const amount = Math.max(rule.minimum, rule.fixed + value * rule.percent / 100);
    return amount > 0 ? { amount: cents(amount), currency: rule.currency } : null;
  };
}

/** Proposed brokerage for each trade (null when the schedule does not cover that market). */
export function proposeBrokerage(trades: PortfolioTrade[], fee: FeeSchedule["fee"]) {
  return trades.map((trade) => {
    const market = marketOf(trade.symbol);
    const value = trade.price * trade.quantity;
    return { trade, market, value, fee: fee(market, value, trade.quantity) };
  });
}
