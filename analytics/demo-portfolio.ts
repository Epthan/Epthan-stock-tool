import type { PortfolioTrade } from "@/lib/portfolio-trades";
import type { CashEntry } from "@/lib/cash-ledger";
import { FEE_SCHEDULES, marketOf } from "@/lib/brokerage";

/**
 * A made-up but realistic portfolio for the Power BI dataset: an Australian investor with an AUD ledger,
 * holding US and ASX shares over three financial years (FY2024–FY2026).
 *
 * Prices and FX are seeded random walks, so every run produces exactly the same numbers. Nothing here
 * comes from a real account or from Yahoo. The trades exercise the cases worth showing: partial sells
 * across several parcels, gains held both under and over 12 months, losses, dividends (franked ASX,
 * US with 15% withholding), brokerage, deposits and one withdrawal.
 */
export type SecurityInfo = { symbol: string; name: string; sector: string; market: "US" | "ASX"; currency: "USD" | "AUD" };
export type DemoMarket = {
  days: string[];
  securities: SecurityInfo[];
  benchmarks: SecurityInfo[];
  /** Local-currency closes by symbol, aligned with `days`. */
  closes: Record<string, number[]>;
  /** AUD per 1 USD, aligned with `days`. */
  usdAud: number[];
};
export type DemoPortfolio = DemoMarket & { trades: PortfolioTrade[]; cash: CashEntry[] };

export const SECURITIES: SecurityInfo[] = [
  { symbol: "AAPL", name: "Apple", sector: "Technology", market: "US", currency: "USD" },
  { symbol: "MSFT", name: "Microsoft", sector: "Technology", market: "US", currency: "USD" },
  { symbol: "NVDA", name: "NVIDIA", sector: "Technology", market: "US", currency: "USD" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials", market: "US", currency: "USD" },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", market: "US", currency: "USD" },
  { symbol: "CBA.AX", name: "Commonwealth Bank", sector: "Financials", market: "ASX", currency: "AUD" },
  { symbol: "BHP.AX", name: "BHP Group", sector: "Materials", market: "ASX", currency: "AUD" },
  { symbol: "CSL.AX", name: "CSL", sector: "Health Care", market: "ASX", currency: "AUD" },
];
export const BENCHMARKS: SecurityInfo[] = [
  { symbol: "^AXJO", name: "S&P/ASX 200", sector: "Index", market: "ASX", currency: "AUD" },
  { symbol: "SPY", name: "S&P 500 ETF", sector: "Index", market: "US", currency: "USD" },
];

// start price, daily drift, daily volatility, seed
const WALKS: Record<string, [number, number, number, number]> = {
  AAPL: [190, 0.0005, 0.015, 11], MSFT: [340, 0.0006, 0.014, 12], NVDA: [42, 0.0018, 0.03, 13], JPM: [145, 0.0005, 0.013, 14],
  XOM: [105, -0.0001, 0.015, 15], "CBA.AX": [102, 0.0006, 0.011, 16], "BHP.AX": [46, -0.0002, 0.016, 17], "CSL.AX": [295, -0.0003, 0.014, 18],
  "^AXJO": [7200, 0.0003, 0.008, 19], SPY: [440, 0.0005, 0.009, 20],
};

/** Park–Miller generator: tiny, deterministic, good enough for test prices. */
function random(seed: number) {
  let state = seed;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}
function walk([start, drift, volatility, seed]: [number, number, number, number], length: number) {
  const next = random(seed);
  const out: number[] = [];
  let price = start;
  for (let index = 0; index < length; index++) {
    out.push(Math.round(price * 100) / 100);
    price *= 1 + drift + (next() - 0.5) * 2 * volatility;
  }
  return out;
}

export function demoMarket(): DemoMarket {
  // Weekdays across three Australian financial years. Market holidays are ignored: every weekday trades.
  const days: string[] = [];
  for (const date = new Date("2023-07-03T00:00:00Z"); date <= new Date("2026-06-30T00:00:00Z"); date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() % 6) days.push(date.toISOString().slice(0, 10));
  }
  const closes = Object.fromEntries(Object.entries(WALKS).map(([symbol, spec]) => [symbol, walk(spec, days.length)]));
  const audUsd = walk([0.67, 0, 0.004, 21], days.length);
  return { days, securities: SECURITIES, benchmarks: BENCHMARKS, closes, usdAud: audUsd.map((rate) => Math.round((1 / rate) * 10000) / 10000) };
}

// [day index, side, symbol, quantity, tags]
const SCRIPT: [number, "buy" | "sell", string, number, string[]?][] = [
  [5, "buy", "AAPL", 40, ["long-term"]], [5, "buy", "CBA.AX", 120, ["dividend"]], [6, "buy", "BHP.AX", 300, ["value"]],
  [8, "buy", "MSFT", 25, ["long-term"]], [30, "buy", "NVDA", 150, ["momentum"]], [60, "buy", "JPM", 50, ["value"]],
  [90, "buy", "CSL.AX", 40, ["long-term"]], [140, "buy", "XOM", 80, ["swing"]], [180, "sell", "NVDA", 70],
  [230, "sell", "XOM", 80], [255, "buy", "AAPL", 20, ["dip"]], [300, "sell", "BHP.AX", 150], [330, "sell", "NVDA", 40],
  [400, "sell", "AAPL", 30], [420, "buy", "NVDA", 60, ["breakout"]], [460, "sell", "JPM", 50], [500, "buy", "XOM", 60, ["dip"]],
  [525, "buy", "MSFT", 15, ["long-term"]], [560, "sell", "CSL.AX", 40], [610, "sell", "XOM", 30], [650, "sell", "MSFT", 10],
  [690, "buy", "CBA.AX", 60, ["dividend"]], [720, "sell", "NVDA", 50], [750, "sell", "BHP.AX", 150],
];
const DEPOSITS: [number, "deposit" | "withdrawal", number][] = [[0, "deposit", 100000], [250, "deposit", 15000], [520, "deposit", 10000], [700, "withdrawal", 8000]];
// Dividend per share (local currency) and franked share (ASX) every `every` trading days.
const DIVIDENDS: Record<string, { perShare: number; every: number; offset: number; franked?: number }> = {
  AAPL: { perShare: 0.25, every: 63, offset: 40 }, MSFT: { perShare: 0.75, every: 63, offset: 45 }, JPM: { perShare: 1.15, every: 63, offset: 50 },
  XOM: { perShare: 0.95, every: 63, offset: 55 }, "CBA.AX": { perShare: 2.4, every: 126, offset: 60, franked: 1 },
  "BHP.AX": { perShare: 1.1, every: 126, offset: 70, franked: 1 }, "CSL.AX": { perShare: 1.8, every: 126, offset: 80, franked: 0.1 },
};
const US_WITHHOLDING = 0.15;
const cents = (value: number) => Math.round(value * 100) / 100;

export function demoPortfolio(): DemoPortfolio {
  const market = demoMarket();
  const { days, closes, usdAud } = market;
  const currencyOf = (symbol: string) => SECURITIES.find((item) => item.symbol === symbol)!.currency;
  const toAud = (symbol: string, day: number) => (currencyOf(symbol) === "USD" ? usdAud[day] : 1);

  const trades: PortfolioTrade[] = SCRIPT.map(([day, side, symbol, quantity, tags], index) => ({
    id: `T${String(index + 1).padStart(3, "0")}`, symbol, side, tradedAt: days[day], price: closes[symbol][day], quantity, ...(tags ? { tags } : {}),
  }));

  const cash: CashEntry[] = DEPOSITS.map(([day, kind, amount], index) => ({ id: `C${String(index + 1).padStart(3, "0")}`, kind, date: days[day], amount }));

  // Brokerage: IBKR fixed for US trades (converted to AUD on the trade date), CommSec for ASX.
  const ibkr = FEE_SCHEDULES.find((item) => item.id === "ibkr-fixed")!.fee;
  const commsec = FEE_SCHEDULES.find((item) => item.id === "commsec-asx")!.fee;
  for (const trade of trades) {
    const day = days.indexOf(trade.tradedAt);
    const market = marketOf(trade.symbol);
    const quote = (market === "US" ? ibkr : commsec)(market, trade.price * trade.quantity, trade.quantity)!;
    cash.push({ id: `F${trade.id.slice(1)}`, kind: "fee", date: trade.tradedAt, amount: cents(quote.amount * toAud(trade.symbol, day)), tradeId: trade.id, symbol: trade.symbol, note: `Brokerage ${trade.side} ${trade.symbol}` });
  }

  // Dividends on whatever was held at the close before the payment day.
  let dividendId = 1;
  for (const [symbol, rule] of Object.entries(DIVIDENDS)) {
    for (let day = rule.offset; day < days.length; day += rule.every) {
      const held = trades.filter((trade) => trade.symbol === symbol && trade.tradedAt < days[day]).reduce((sum, trade) => sum + (trade.side === "buy" ? trade.quantity : -trade.quantity), 0);
      if (held <= 0) continue;
      const gross = held * rule.perShare * toAud(symbol, day);
      const id = `D${String(dividendId++).padStart(3, "0")}`;
      if (currencyOf(symbol) === "USD") {
        cash.push({ id, kind: "dividend", date: days[day], symbol, amount: cents(gross * (1 - US_WITHHOLDING)), withheld: cents(gross * US_WITHHOLDING) });
      } else {
        const franked = cents(gross * (rule.franked ?? 0));
        cash.push({ id, kind: "dividend", date: days[day], symbol, amount: cents(gross), franked, frankingCredit: cents(franked * 30 / 70) });
      }
    }
  }
  cash.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  return { ...market, trades, cash };
}
