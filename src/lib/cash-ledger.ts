import { tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";

/**
 * Money moving in or out of a portfolio that is not a share trade. Amount is always positive; kind gives the direction.
 * `currency` defaults to the portfolio's ledger currency. An "fx" entry converts `amount` of `currency` into `toAmount` of `toCurrency`.
 */
export type CashKind = "deposit" | "withdrawal" | "dividend" | "interest" | "fee" | "tax" | "fx";
export type CashEntry = { id: string; kind: CashKind; date: string; amount: number; currency?: string; toAmount?: number; toCurrency?: string; symbol?: string; note?: string };
/** How trades settle: "base" = the broker converts into the ledger currency (CommSec style); "local" = each currency has its own cash (Stake / IBKR style). */
export type CashMode = "base" | "local";

export const CASH_KINDS: CashKind[] = ["deposit", "withdrawal", "dividend", "interest", "fee", "tax", "fx"];
export const cashSign: Record<CashKind, 1 | -1> = { deposit: 1, withdrawal: -1, dividend: 1, interest: 1, fee: -1, tax: -1, fx: -1 };
export const cashLabel: Record<CashKind, [string, string]> = {
  deposit: ["Deposit", "入金"], withdrawal: ["Withdrawal", "出金"], dividend: ["Dividend", "分红"],
  interest: ["Interest", "利息"], fee: ["Fee", "费用"], tax: ["Tax", "税费"], fx: ["FX conversion", "换汇"],
};

export function validateCashEntries(entries: CashEntry[]) {
  const ids = new Set<string>();
  const today = tradeDate(new Date().toISOString());
  const code = (value: unknown) => value === undefined || (typeof value === "string" && /^[A-Z]{3}$/.test(value));
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id) || !CASH_KINDS.includes(entry.kind)) throw new Error("INVALID_CASH");
    ids.add(entry.id);
    if (!Number.isFinite(entry.amount) || entry.amount <= 0 || entry.amount > 1e12) throw new Error("INVALID_AMOUNT");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.date > today) throw new Error("INVALID_TIME");
    if (!code(entry.currency) || !code(entry.toCurrency)) throw new Error("INVALID_CURRENCY");
    if (entry.kind === "fx" && (!entry.toCurrency || !(Number(entry.toAmount) > 0) || entry.toCurrency === entry.currency)) throw new Error("INVALID_FX");
  }
}

/**
 * Currency context. `rate(currency, date?)` converts one unit into the ledger currency (no date = latest);
 * `unit(symbol)` gives a security's quote currency and minor-unit divisor (GBp → GBP / 100).
 */
export type CashContext = { base: string; mode: CashMode; rate: (currency: string, date?: string) => number | null; unit: (symbol: string) => { currency: string; divisor: number } | null };
const baseOnly = (base = "USD"): CashContext => ({ base, mode: "base", rate: (currency) => (currency === base ? 1 : null), unit: () => ({ currency: base, divisor: 1 }) });

type Flow = { date: string; currency: string; amount: number; costBase: number; kind: "external" | "income" | "cost" | "trade" | "fx" };

/** Every cash movement as a signed amount in its own currency, plus its ledger-currency value on the day it happened. */
export function cashFlows(entries: CashEntry[], trades: PortfolioTrade[], context: CashContext = baseOnly()): Flow[] {
  const { base, mode, rate, unit } = context;
  const at = (currency: string, date: string) => (currency === base ? 1 : rate(currency, date) ?? NaN);
  const flows: Flow[] = [];
  for (const entry of entries) {
    const currency = entry.currency ?? base;
    const signed = cashSign[entry.kind] * entry.amount;
    if (entry.kind === "fx") {
      const to = entry.toCurrency!;
      flows.push({ date: entry.date, currency, amount: -entry.amount, costBase: -entry.amount * at(currency, entry.date), kind: "fx" });
      flows.push({ date: entry.date, currency: to, amount: entry.toAmount!, costBase: entry.toAmount! * at(to, entry.date), kind: "fx" });
      continue;
    }
    const kind = entry.kind === "deposit" || entry.kind === "withdrawal" ? "external" : signed > 0 ? "income" : "cost";
    flows.push({ date: entry.date, currency, amount: signed, costBase: signed * at(currency, entry.date), kind });
  }
  for (const trade of trades) {
    const info = unit(trade.symbol) ?? { currency: base, divisor: 1 };
    const date = tradeDate(trade.tradedAt);
    const local = (trade.side === "sell" ? 1 : -1) * trade.price * trade.quantity / info.divisor;
    const value = local * at(info.currency, date);
    if (mode === "local") flows.push({ date, currency: info.currency, amount: local, costBase: value, kind: "trade" });
    else flows.push({ date, currency: base, amount: value, costBase: value, kind: "trade" });
  }
  return flows.sort((left, right) => left.date.localeCompare(right.date));
}

/** Cash balance (per currency and in the ledger currency at today's rates) and its components, all in the ledger currency. */
export function cashSummary(entries: CashEntry[], trades: PortfolioTrade[], context: CashContext = baseOnly()) {
  const flows = cashFlows(entries, trades, context);
  const sum = (filter: (flow: Flow) => boolean) => flows.filter(filter).reduce((total, flow) => total + flow.costBase, 0);
  const deposits = sum((flow) => flow.kind === "external" && flow.amount > 0);
  const withdrawals = -sum((flow) => flow.kind === "external" && flow.amount < 0);
  const income = sum((flow) => flow.kind === "income");
  const costs = -sum((flow) => flow.kind === "cost");
  const bought = -sum((flow) => flow.kind === "trade" && flow.amount < 0);
  const sold = sum((flow) => flow.kind === "trade" && flow.amount > 0);
  const conversion = sum((flow) => flow.kind === "fx"); // spread paid (negative) on conversions
  const balances: Record<string, number> = {};
  for (const flow of flows) balances[flow.currency] = (balances[flow.currency] ?? 0) + flow.amount;
  for (const [currency, value] of Object.entries(balances)) if (Math.abs(value) < 0.005 && currency !== context.base) delete balances[currency];
  const costBalance = flows.reduce((total, flow) => total + flow.costBase, 0);
  const balance = Object.entries(balances).reduce((total, [currency, value]) => total + value * (currency === context.base ? 1 : context.rate(currency) ?? NaN), 0);
  return { deposits, withdrawals, netContributions: deposits - withdrawals, income, costs, bought, sold, conversion, balances, balance, fxGain: balance - costBalance, negative: Object.values(balances).some((value) => value < -0.01) };
}

/**
 * Daily FX revaluation of foreign cash in the ledger currency: value at that day's rates minus the
 * value booked when the money moved. Zero in "base" mode unless foreign cash entries exist.
 */
export function cashRevaluation(entries: CashEntry[], trades: PortfolioTrade[], context: CashContext, calendar: string[]) {
  const flows = cashFlows(entries, trades, context).filter((flow) => flow.currency !== context.base);
  const out = new Map<string, number>();
  if (!flows.length) return out;
  const balances = new Map<string, number>();
  let cost = 0;
  let cursor = 0;
  for (const date of calendar) {
    while (cursor < flows.length && flows[cursor].date <= date) {
      const flow = flows[cursor++];
      balances.set(flow.currency, (balances.get(flow.currency) ?? 0) + flow.amount);
      cost += flow.costBase;
    }
    let value = 0;
    for (const [currency, amount] of balances) value += amount * (context.rate(currency, date) ?? NaN);
    out.set(date, Number.isFinite(value) ? value - cost : 0);
  }
  return out;
}

/** Cash entries restated in the ledger currency (for analytics). FX entries become their net conversion cost. */
export function entriesInBase(entries: CashEntry[], context: CashContext): CashEntry[] {
  const at = (currency: string | undefined, date: string) => (!currency || currency === context.base ? 1 : context.rate(currency, date) ?? NaN);
  return entries.flatMap((entry): CashEntry[] => {
    if (entry.kind === "fx") {
      const net = entry.toAmount! * at(entry.toCurrency, entry.date) - entry.amount * at(entry.currency, entry.date);
      if (!Number.isFinite(net) || Math.abs(net) < 0.005) return [];
      return [{ id: `fx:${entry.id}`, kind: net > 0 ? "interest" : "fee", date: entry.date, amount: Math.abs(net), note: "FX conversion" }];
    }
    const amount = entry.amount * at(entry.currency, entry.date);
    return Number.isFinite(amount) ? [{ ...entry, amount, currency: undefined }] : [];
  });
}
