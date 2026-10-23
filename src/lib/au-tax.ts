import type { CashEntry } from "@/lib/cash-ledger";
import { buildLots } from "@/lib/lots";
import { tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";

/**
 * Australian tax report for an individual investor (shares held on capital account, Australian resident).
 *
 * Capital gains (CGT): each sale closes parcels first-in, first-out. Per parcel:
 *   cost base       = purchase price × shares + that parcel's share of the buy brokerage
 *   capital proceeds = sale price × shares − that parcel's share of the sell brokerage
 * The CGT event date is the contract (trade) date. A gain qualifies for the 50% discount when the parcel
 * was owned for at least 12 months, not counting the acquisition day and the sale day.
 * Each financial year (1 July – 30 June): current-year losses, then losses carried forward, are applied to
 * non-discountable gains first and then to discountable gains; the 50% discount applies to what remains.
 * Unused losses carry forward.
 *
 * Income: Australian dividends split into franked / unfranked amounts plus franking credits; foreign
 * dividends are grossed up by the tax withheld, which becomes the foreign income tax offset.
 *
 * Everything here is in AUD: convert trades and cash with `restateInAud` first.
 */

export const DISCOUNT_RATE = 0.5;

/** Financial year a date falls in, named by the year it ends (2025 = 1 Jul 2024 – 30 Jun 2025). */
export function financialYear(date: string) {
  const year = Number(date.slice(0, 4));
  return date.slice(5) >= "07-01" ? year + 1 : year;
}
export const fyLabel = (fy: number) => `${fy - 1}–${String(fy).slice(2)}`;
export const fyRange = (fy: number) => ({ from: `${fy - 1}-07-01`, to: `${fy}-06-30` });

/** First sale date that qualifies for the CGT discount: acquisition date + 12 months + 1 day. */
export function discountDate(acquiredAt: string) {
  const date = new Date(`${acquiredAt}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  if (date.getUTCDate() !== day) date.setUTCDate(0); // 29 Feb + 1 year → 28 Feb
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * Brokerage per trade id. A fee entry belongs to a trade when it carries `tradeId`; older fee entries
 * without a link are matched when they name the symbol and fall on the trade date and exactly one trade
 * of that symbol (and side, if the note says "Buy …" / "Sell …") happened that day.
 */
export function brokerageByTrade(trades: PortfolioTrade[], cash: CashEntry[]) {
  const out = new Map<string, number>();
  for (const entry of cash) {
    const tradeId = feeTradeId(entry, trades);
    if (tradeId) out.set(tradeId, (out.get(tradeId) ?? 0) + entry.amount);
  }
  return out;
}
/** The trade a fee entry belongs to (see brokerageByTrade), or undefined. */
export function feeTradeId(entry: CashEntry, trades: PortfolioTrade[]) {
  if (entry.kind !== "fee") return undefined;
  if (entry.tradeId) return trades.some((trade) => trade.id === entry.tradeId) ? entry.tradeId : undefined;
  if (!entry.symbol) return undefined;
  const side = /^buy\b/i.test(entry.note ?? "") ? "buy" : /^sell\b/i.test(entry.note ?? "") ? "sell" : null;
  const candidates = trades.filter((trade) => trade.symbol === entry.symbol && tradeDate(trade.tradedAt) === entry.date && (!side || trade.side === side));
  return candidates.length === 1 ? candidates[0].id : undefined;
}

/**
 * Restate trades (per-share prices) and cash entries in AUD. `rate(currency, date)` converts one unit into AUD;
 * `unit(symbol)` gives a security's currency and minor-unit divisor. Returns null when a rate is missing.
 */
export function restateInAud(
  trades: PortfolioTrade[], cash: CashEntry[], ledgerCurrency: string,
  rate: (currency: string, date: string) => number | null, unit: (symbol: string) => { currency: string; divisor: number } | null,
) {
  const missing = new Set<string>();
  const at = (currency: string, date: string) => { if (currency === "AUD") return 1; const value = rate(currency, date); if (value == null) missing.add(currency); return value ?? NaN; };
  const audTrades = trades.map((trade) => {
    const info = unit(trade.symbol) ?? { currency: "USD", divisor: 1 };
    if (!unit(trade.symbol)) missing.add(trade.symbol);
    return { ...trade, price: trade.price / info.divisor * at(info.currency, tradeDate(trade.tradedAt)) };
  });
  const audCash = cash.filter((entry) => entry.kind !== "fx").map((entry) => {
    const factor = at(entry.currency ?? ledgerCurrency, entry.date);
    const scale = (value?: number) => (value == null ? undefined : value * factor);
    return { ...entry, currency: "AUD", amount: entry.amount * factor, franked: scale(entry.franked), frankingCredit: scale(entry.frankingCredit), withheld: scale(entry.withheld), sourceCurrency: entry.currency ?? ledgerCurrency };
  });
  return { trades: audTrades, cash: audCash, missing: [...missing] };
}

export type CgtEvent = {
  fy: number; symbol: string; saleId: string; buyId: string; acquiredAt: string; disposedAt: string; quantity: number;
  costBase: number; proceeds: number; gain: number; days: number; discountable: boolean;
};
export type DividendRow = {
  fy: number; id: string; date: string; symbol: string; foreign: boolean; cash: number; franked: number; unfranked: number;
  frankingCredit: number; withheld: number; assessable: number; sourceCurrency?: string; flag?: "withholding" | "franking";
};
export type YearSummary = {
  fy: number; label: string; events: number;
  gains: { discountable: number; other: number; total: number };
  losses: number; priorLosses: number; lossesUsed: number; discount: number; netCapitalGain: number; carriedForward: number;
  dividends: { franked: number; unfranked: number; frankingCredits: number; foreignGross: number; foreignTax: number; count: number };
  interest: number;
};

export function auTaxReport(input: { trades: PortfolioTrade[]; cash: (CashEntry & { sourceCurrency?: string })[]; isForeign: (symbol: string) => boolean; today?: string }) {
  const { trades, cash, isForeign } = input;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const brokerage = brokerageByTrade(trades, cash);
  // Brokerage folded into the per-share price: buys cost more, sells bring in less.
  const adjusted = trades.map((trade) => {
    const fee = brokerage.get(trade.id) ?? 0;
    return { ...trade, price: trade.price + (trade.side === "buy" ? 1 : -1) * fee / trade.quantity };
  });
  const { openLots, disposals } = buildLots(adjusted);

  const events: CgtEvent[] = disposals.flatMap((disposal) => disposal.matches.map((match) => {
    const proceeds = match.quantity * disposal.price;
    const costBase = match.quantity * match.unitCost;
    const gain = proceeds - costBase;
    return {
      fy: financialYear(disposal.disposedAt), symbol: disposal.symbol, saleId: disposal.tradeId, buyId: match.tradeId, acquiredAt: match.acquiredAt, disposedAt: disposal.disposedAt,
      quantity: match.quantity, costBase, proceeds, gain, days: daysBetween(match.acquiredAt, disposal.disposedAt), discountable: gain > 0 && disposal.disposedAt >= discountDate(match.acquiredAt),
    };
  }));

  const dividends: DividendRow[] = cash.filter((entry) => entry.kind === "dividend").map((entry) => {
    const symbol = entry.symbol ?? "";
    const foreign = symbol ? isForeign(symbol) : (entry.sourceCurrency ?? "AUD") !== "AUD";
    const withheld = entry.withheld ?? 0;
    if (foreign) return { fy: financialYear(entry.date), id: entry.id, date: entry.date, symbol, foreign, cash: entry.amount, franked: 0, unfranked: 0, frankingCredit: 0, withheld, assessable: entry.amount + withheld, sourceCurrency: entry.sourceCurrency, flag: entry.withheld == null ? "withholding" as const : undefined };
    const franked = Math.min(entry.amount, entry.franked ?? 0);
    const frankingCredit = entry.frankingCredit ?? 0;
    return { fy: financialYear(entry.date), id: entry.id, date: entry.date, symbol, foreign, cash: entry.amount, franked, unfranked: entry.amount - franked, frankingCredit, withheld, assessable: entry.amount + frankingCredit + withheld, sourceCurrency: entry.sourceCurrency, flag: entry.franked == null && entry.frankingCredit == null ? "franking" as const : undefined };
  });
  const interest = cash.filter((entry) => entry.kind === "interest");

  const years = [...new Set([...events.map((event) => event.fy), ...dividends.map((row) => row.fy), ...interest.map((entry) => financialYear(entry.date))])].sort((a, b) => a - b);
  let carry = 0;
  const summaries: YearSummary[] = [];
  if (years.length) for (let fy = years[0]; fy <= years[years.length - 1]; fy++) {
    const yearEvents = events.filter((event) => event.fy === fy);
    const discountable = yearEvents.filter((event) => event.discountable).reduce((sum, event) => sum + event.gain, 0);
    const other = yearEvents.filter((event) => event.gain > 0 && !event.discountable).reduce((sum, event) => sum + event.gain, 0);
    const losses = -yearEvents.filter((event) => event.gain < 0).reduce((sum, event) => sum + event.gain, 0);
    const available = losses + carry;
    const onOther = Math.min(available, other);
    const onDiscountable = Math.min(available - onOther, discountable);
    const discount = (discountable - onDiscountable) * DISCOUNT_RATE;
    const netCapitalGain = other - onOther + discountable - onDiscountable - discount;
    const yearDividends = dividends.filter((row) => row.fy === fy);
    const sum = (rows: DividendRow[], pick: (row: DividendRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
    const domestic = yearDividends.filter((row) => !row.foreign);
    const foreign = yearDividends.filter((row) => row.foreign);
    const priorLosses = carry;
    carry = available - onOther - onDiscountable;
    if (!yearEvents.length && !yearDividends.length && !interest.some((entry) => financialYear(entry.date) === fy) && !priorLosses) continue;
    summaries.push({
      fy, label: fyLabel(fy), events: yearEvents.length,
      gains: { discountable, other, total: discountable + other }, losses, priorLosses, lossesUsed: onOther + onDiscountable, discount, netCapitalGain, carriedForward: carry,
      dividends: { franked: sum(domestic, (row) => row.franked), unfranked: sum(domestic, (row) => row.unfranked), frankingCredits: sum(domestic, (row) => row.frankingCredit), foreignGross: sum(foreign, (row) => row.assessable), foreignTax: sum(foreign, (row) => row.withheld), count: yearDividends.length },
      interest: interest.filter((entry) => financialYear(entry.date) === fy).reduce((total, entry) => total + entry.amount, 0),
    });
  }

  const parcels = openLots.map((lot) => {
    const from = discountDate(lot.acquiredAt);
    return { symbol: lot.symbol, tradeId: lot.tradeId, acquiredAt: lot.acquiredAt, quantity: lot.quantity, costBase: lot.quantity * lot.unitCost, unitCost: lot.unitCost, discountFrom: from, daysToDiscount: Math.max(0, daysBetween(today, from)) };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.acquiredAt.localeCompare(b.acquiredAt));

  const tradesWithoutBrokerage = trades.filter((trade) => !brokerage.has(trade.id)).length;
  return { events, dividends, years: summaries, parcels, tradesWithoutBrokerage };
}

export type AuTaxReport = ReturnType<typeof auTaxReport>;

/** CSV for an accountant: summary, CGT schedule and income for one financial year. */
export function taxCsv(report: AuTaxReport, fy: number, portfolioName: string) {
  const cell = (value: string | number) => { const text = typeof value === "number" ? value.toFixed(2) : value; return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const year = report.years.find((item) => item.fy === fy);
  const lines: (string | number)[][] = [[`Stock Tool tax report — ${portfolioName} — FY ${fyLabel(fy)} (AUD)`], []];
  if (year) {
    lines.push(["Summary", "AUD"],
      ["Total current year capital gains (18H)", year.gains.total], ["Capital losses this year", year.losses], ["Capital losses brought forward", year.priorLosses],
      ["CGT discount applied", year.discount], ["Net capital gain (18A)", year.netCapitalGain], ["Net capital losses carried forward (18V)", year.carriedForward],
      ["Unfranked dividends (11S)", year.dividends.unfranked], ["Franked dividends (11T)", year.dividends.franked], ["Franking credits (11U)", year.dividends.frankingCredits],
      ["Assessable foreign income (20E/20M)", year.dividends.foreignGross], ["Foreign income tax offset (20O)", year.dividends.foreignTax], ["Gross interest (10L)", year.interest], []);
  }
  lines.push(["CGT schedule"], ["Symbol", "Acquired", "Disposed", "Quantity", "Cost base", "Capital proceeds", "Gain / loss", "Days held", "Discount eligible"]);
  for (const event of report.events.filter((item) => item.fy === fy)) lines.push([event.symbol, event.acquiredAt, event.disposedAt, String(+event.quantity.toFixed(8)), event.costBase, event.proceeds, event.gain, String(event.days), event.discountable ? "yes" : "no"]);
  lines.push([], ["Dividends"], ["Date", "Symbol", "Type", "Cash received", "Franked", "Unfranked", "Franking credit", "Tax withheld", "Assessable"]);
  for (const row of report.dividends.filter((item) => item.fy === fy)) lines.push([row.date, row.symbol, row.foreign ? "foreign" : "Australian", row.cash, row.franked, row.unfranked, row.frankingCredit, row.withheld, row.assessable]);
  return lines.map((row) => row.map(cell).join(",")).join("\n");
}
