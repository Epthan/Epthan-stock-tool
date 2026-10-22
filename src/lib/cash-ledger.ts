import { tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";

/** Money moving in or out of a portfolio that is not a share trade. Amount is always positive; kind gives the direction. */
export type CashKind = "deposit" | "withdrawal" | "dividend" | "interest" | "fee" | "tax";
export type CashEntry = { id: string; kind: CashKind; date: string; amount: number; symbol?: string; note?: string };

export const CASH_KINDS: CashKind[] = ["deposit", "withdrawal", "dividend", "interest", "fee", "tax"];
export const cashSign: Record<CashKind, 1 | -1> = { deposit: 1, withdrawal: -1, dividend: 1, interest: 1, fee: -1, tax: -1 };
export const cashLabel: Record<CashKind, [string, string]> = {
  deposit: ["Deposit", "入金"], withdrawal: ["Withdrawal", "出金"], dividend: ["Dividend", "分红"],
  interest: ["Interest", "利息"], fee: ["Fee", "费用"], tax: ["Tax", "税费"],
};

export function validateCashEntries(entries: CashEntry[]) {
  const ids = new Set<string>();
  const today = tradeDate(new Date().toISOString());
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id) || !CASH_KINDS.includes(entry.kind)) throw new Error("INVALID_CASH");
    ids.add(entry.id);
    if (!Number.isFinite(entry.amount) || entry.amount <= 0 || entry.amount > 1e12) throw new Error("INVALID_AMOUNT");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.date > today) throw new Error("INVALID_TIME");
  }
}

/** Cash balance and its components. Buys spend cash, sells return it (fees are separate entries). */
export function cashSummary(entries: CashEntry[], trades: PortfolioTrade[]) {
  const total = (kind: CashKind) => entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry.amount, 0);
  const deposits = total("deposit");
  const withdrawals = total("withdrawal");
  const income = total("dividend") + total("interest");
  const costs = total("fee") + total("tax");
  const bought = trades.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
  const sold = trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
  return { deposits, withdrawals, netContributions: deposits - withdrawals, income, costs, bought, sold, balance: deposits - withdrawals + income - costs + sold - bought };
}
