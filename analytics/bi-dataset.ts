import { analyzePortfolio, type SecurityHistory } from "@/lib/live-portfolio";
import { auTaxReport, financialYear, fyLabel, restateInAud } from "@/lib/au-tax";
import { cashSign } from "@/lib/cash-ledger";
import { chronological } from "@/lib/lots";
import type { PortfolioTrade } from "@/lib/portfolio-trades";
import { demoPortfolio, type DemoPortfolio } from "./demo-portfolio";

/**
 * Turns the demo portfolio into a star schema for Power BI. Everything is in AUD (the ledger currency).
 *
 * The daily fact tables carry the raw components (opening value, purchases, sales, income, closing value)
 * rather than finished returns, so the report computes TWR, contribution and drawdown itself in DAX.
 * `expected` holds the app's own answers from lib/ for the same data; tests/unit/bi-dataset.test.ts
 * recomputes the DAX logic from these tables and checks it against them.
 */
export type Row = Record<string, string | number | null>;
export type Dataset = { tables: Record<string, Row[]>; expected: Record<string, unknown> };

// Fixed names rather than toLocaleString: ICU versions disagree ("Sep" vs "Sept"), which would make the CSVs machine-dependent.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

export function buildDataset(demo: DemoPortfolio = demoPortfolio()): Dataset {
  const { days, securities, benchmarks, closes, usdAud } = demo;
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const info = new Map([...securities, ...benchmarks].map((item) => [item.symbol, item]));
  const fx = (symbol: string, day: string) => (info.get(symbol)!.currency === "USD" ? usdAud[dayIndex.get(day)!] : 1);
  const closeAud = (symbol: string, day: string) => closes[symbol][dayIndex.get(day)!] * fx(symbol, day);

  // ---- Same inputs the app's analysis route would build: AUD prices, AUD trade prices, AUD cash.
  const history = (symbol: string): SecurityHistory => ({ symbol, name: info.get(symbol)!.name, currency: "AUD", prices: days.map((day) => ({ date: day, close: closeAud(symbol, day) })) });
  const tradesAud: PortfolioTrade[] = demo.trades.map((trade) => ({ ...trade, price: trade.price * fx(trade.symbol, trade.tradedAt) }));
  const held = [...new Set(demo.trades.map((trade) => trade.symbol))];
  const analysis = Object.fromEntries(benchmarks.map((bench) => [bench.symbol, analyzePortfolio(tradesAud, held.map(history), history(bench.symbol), "ALL", demo.cash)]));
  const app = analysis["^AXJO"];

  const restated = restateInAud(demo.trades, demo.cash, "AUD", (currency, day) => (currency === "USD" ? usdAud[dayIndex.get(day)!] : null), (symbol) => ({ currency: info.get(symbol)!.currency, divisor: 1 }));
  const tax = auTaxReport({ trades: restated.trades, cash: restated.cash, isForeign: (symbol) => info.get(symbol)!.currency !== "AUD", today: days.at(-1) });

  // ---- Dimensions
  const dimDate: Row[] = [];
  for (const date = new Date(`${days[0]}T00:00:00Z`); date <= new Date(`${days.at(-1)}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    const fy = financialYear(day);
    const month = date.getUTCMonth() + 1;
    dimDate.push({ date: day, year: date.getUTCFullYear(), month, month_name: MONTHS[month - 1], year_month: day.slice(0, 7),
      fy, fy_label: `FY ${fyLabel(fy)}`, fy_quarter: `Q${Math.floor(((month + 5) % 12) / 3) + 1}`, is_trading_day: dayIndex.has(day) ? 1 : 0 });
  }
  const dimFy: Row[] = [...new Set(dimDate.map((row) => row.fy as number))].map((fy) => ({ fy, fy_label: `FY ${fyLabel(fy)}`, start_date: `${fy - 1}-07-01`, end_date: `${fy}-06-30` }));
  const dimSecurity: Row[] = [...securities, ...benchmarks].map((item) => ({ symbol: item.symbol, name: item.name, sector: item.sector, market: item.market, currency: item.currency, is_benchmark: benchmarks.includes(item) ? 1 : 0 }));

  // ---- Prices and FX
  const factPrices: Row[] = [];
  for (const item of [...securities, ...benchmarks]) for (const day of days) factPrices.push({ date: day, symbol: item.symbol, close_local: closes[item.symbol][dayIndex.get(day)!], fx_to_aud: fx(item.symbol, day), close_aud: round(closeAud(item.symbol, day), 4) });

  // ---- Trades, tags, cash
  const brokerage = new Map(demo.cash.filter((entry) => entry.kind === "fee" && entry.tradeId).map((entry) => [entry.tradeId!, entry.amount]));
  const factTrades: Row[] = demo.trades.map((trade) => ({
    trade_id: trade.id, date: trade.tradedAt, symbol: trade.symbol, side: trade.side, quantity: trade.quantity, price_local: trade.price,
    fx_to_aud: fx(trade.symbol, trade.tradedAt), value_aud: round(trade.price * trade.quantity * fx(trade.symbol, trade.tradedAt), 2), brokerage_aud: brokerage.get(trade.id) ?? 0,
  }));
  const bridgeTradeTag: Row[] = demo.trades.filter((trade) => trade.side === "buy").flatMap((trade) => (trade.tags?.length ? trade.tags : ["(untagged)"]).map((tag) => ({ trade_id: trade.id, tag })));
  const factCash: Row[] = demo.cash.map((entry) => ({
    entry_id: entry.id, date: entry.date, kind: entry.kind, symbol: entry.symbol ?? null, trade_id: entry.tradeId ?? null,
    amount_aud: cashSign[entry.kind] * entry.amount, external_flow_aud: entry.kind === "deposit" ? entry.amount : entry.kind === "withdrawal" ? -entry.amount : 0,
    franked_aud: entry.franked ?? null, franking_credit_aud: entry.frankingCredit ?? null, withheld_aud: entry.withheld ?? null,
  }));

  // ---- Daily holdings and portfolio, mirroring analyzePortfolio's loop (lib/live-portfolio.ts)
  const ordered = chronological(tradesAud);
  const firstTrade = ordered[0].tradedAt;
  const quantities = new Map<string, number>();
  const previousClose = new Map<string, number>();
  const factHoldings: Row[] = [];
  const factPortfolio: Row[] = [];
  const factAccount: Row[] = [];
  let cashBalance = 0;
  let previousAccount = 0;
  let previousValue = 0;
  for (const day of days) {
    const todays = ordered.filter((trade) => trade.tradedAt === day);
    const entries = demo.cash.filter((entry) => entry.date === day);
    let purchases = 0, sales = 0, income = 0, value = 0;
    for (const symbol of held) {
      const before = quantities.get(symbol) ?? 0;
      const buys = todays.filter((trade) => trade.symbol === symbol && trade.side === "buy").reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
      const sells = todays.filter((trade) => trade.symbol === symbol && trade.side === "sell").reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
      const after = before + todays.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + (trade.side === "buy" ? trade.quantity : -trade.quantity), 0);
      const close = closeAud(symbol, day);
      const symbolIncome = entries.filter((entry) => entry.symbol === symbol && !["deposit", "withdrawal", "fx"].includes(entry.kind)).reduce((sum, entry) => sum + cashSign[entry.kind] * entry.amount, 0);
      quantities.set(symbol, after);
      const open = before * (previousClose.get(symbol) ?? close);
      previousClose.set(symbol, close);
      purchases += buys; sales += sells; value += after * close;
      if (day >= firstTrade && (before > 1e-9 || after > 1e-9 || symbolIncome)) {
        factHoldings.push({ date: day, symbol, quantity: after, close_aud: round(close, 4), value_open_aud: round(open, 4), buys_aud: round(buys, 4), sells_aud: round(sells, 4), income_aud: round(symbolIncome, 4), value_close_aud: round(after * close, 4), pnl_aud: round(after * close - open + sells - buys + symbolIncome, 4) });
      }
    }
    // Income on the holdings' side: every cash entry except deposits, withdrawals and FX conversions.
    income = entries.filter((entry) => !["deposit", "withdrawal", "fx"].includes(entry.kind)).reduce((sum, entry) => sum + cashSign[entry.kind] * entry.amount, 0);
    const external = entries.reduce((sum, entry) => sum + (entry.kind === "deposit" ? entry.amount : entry.kind === "withdrawal" ? -entry.amount : 0), 0);
    if (day >= firstTrade) {
      factPortfolio.push({ date: day, value_open_aud: round(previousValue, 4), purchases_aud: round(purchases, 4), sales_aud: round(sales, 4), income_aud: round(income, 4), value_close_aud: round(value, 4) });
    }
    previousValue = value;
    cashBalance += entries.reduce((sum, entry) => sum + cashSign[entry.kind] * entry.amount, 0) + sales - purchases;
    const account = value + cashBalance;
    factAccount.push({ date: day, account_open_aud: round(previousAccount, 4), external_flow_aud: round(external, 4), holdings_aud: round(value, 4), cash_aud: round(cashBalance, 4), account_close_aud: round(account, 4) });
    previousAccount = account;
  }
  const factBenchmark: Row[] = benchmarks.flatMap((bench) => days.map((day) => ({ date: day, benchmark: bench.symbol, close_aud: round(closeAud(bench.symbol, day), 4) })));

  // ---- Closed trades (FIFO) and tax, straight from lib
  const factClosed: Row[] = app.trading.closed.map((trade) => ({ sale_id: trade.id, symbol: trade.symbol, exit_date: trade.exitDate, quantity: trade.quantity, exit_price_aud: round(trade.exitPrice, 4), average_cost_aud: round(trade.averageCost, 4), pnl_aud: round(trade.pnl, 2), return_pct: round(trade.returnPercent, 4), holding_days: round(trade.holdingDays, 1) }));
  const bridgeClosedTag: Row[] = app.trading.closed.flatMap((trade) => trade.tagShares.map((item) => ({ sale_id: trade.id, tag: item.tag === "__untagged" ? "(untagged)" : item.tag, share: round(item.share, 6), pnl_aud: round(trade.pnl * item.share, 2) })));
  const factCgt: Row[] = tax.events.map((event) => ({ fy: event.fy, fy_label: `FY ${fyLabel(event.fy)}`, symbol: event.symbol, sale_id: event.saleId, buy_id: event.buyId, acquired: event.acquiredAt, disposed: event.disposedAt, quantity: event.quantity, cost_base_aud: round(event.costBase, 2), proceeds_aud: round(event.proceeds, 2), gain_aud: round(event.gain, 2), days_held: event.days, discount_eligible: event.discountable ? 1 : 0 }));
  const factTaxYear: Row[] = tax.years.map((year) => ({ fy: year.fy, fy_label: `FY ${year.label}`, gains_discountable: round(year.gains.discountable, 2), gains_other: round(year.gains.other, 2), label_18H: round(year.gains.total, 2), losses: round(year.losses, 2), losses_brought_forward: round(year.priorLosses, 2), losses_used: round(year.lossesUsed, 2), discount: round(year.discount, 2), label_18A: round(year.netCapitalGain, 2), label_18V: round(year.carriedForward, 2), label_11S: round(year.dividends.unfranked, 2), label_11T: round(year.dividends.franked, 2), label_11U: round(year.dividends.frankingCredits, 2), label_20E: round(year.dividends.foreignGross, 2), label_20O: round(year.dividends.foreignTax, 2) }));
  const factDividends: Row[] = tax.dividends.map((row) => ({ fy: row.fy, date: row.date, symbol: row.symbol, type: row.foreign ? "Foreign" : "Australian", cash_aud: round(row.cash, 2), franked_aud: round(row.franked, 2), unfranked_aud: round(row.unfranked, 2), franking_credit_aud: round(row.frankingCredit, 2), withheld_aud: round(row.withheld, 2), assessable_aud: round(row.assessable, 2) }));

  const expected = {
    note: "Answers from the app's own calculation code (src/lib) for this dataset. The Power BI measures should match these.",
    period: { from: app.start, to: app.end },
    holdings_twr_pct: { "^AXJO": app.statistics.totalReturn, SPY: analysis.SPY.statistics.totalReturn },
    benchmark_return_pct: { "^AXJO": app.statistics.benchmarkReturn, SPY: analysis.SPY.statistics.benchmarkReturn },
    period_pnl_aud: app.pnl,
    contribution_aud: Object.fromEntries(app.holdings.map((holding) => [holding.symbol, holding.contribution])),
    other_contribution_aud: app.otherContribution,
    max_drawdown_pct: app.statistics.maxDrawdown,
    account: app.account && { since_inception_twr_pct: app.account.sinceInception, xirr_annual_pct: app.account.mwrAnnual, value_aud: app.account.value, net_contributions_aud: app.account.netContributions },
    closed_trades: { count: app.trading.stats.closedCount, win_rate_pct: app.trading.stats.winRate, profit_factor: app.trading.stats.profitFactor, realized_aud: app.trading.stats.realized },
    tax_years: Object.fromEntries(tax.years.map((year) => [`FY ${year.label}`, { "18H": year.gains.total, "18A": year.netCapitalGain, "18V": year.carriedForward, "11T": year.dividends.franked, "11U": year.dividends.frankingCredits, "20E": year.dividends.foreignGross, "20O": year.dividends.foreignTax }])),
  };

  return {
    tables: {
      dim_date: dimDate, dim_financial_year: dimFy, dim_security: dimSecurity, fact_prices: factPrices, fact_benchmark: factBenchmark,
      fact_trades: factTrades, bridge_trade_tag: bridgeTradeTag, fact_cash: factCash,
      fact_daily_holdings: factHoldings, fact_daily_portfolio: factPortfolio, fact_daily_account: factAccount,
      fact_closed_trades: factClosed, bridge_closed_trade_tag: bridgeClosedTag,
      fact_cgt_events: factCgt, fact_tax_year: factTaxYear, fact_dividends: factDividends,
    },
    expected,
  };
}

/** RFC 4180 CSV, ISO dates, "." decimals — Power BI reads it without locale surprises. */
export function toCsv(rows: Row[]) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const cell = (value: string | number | null) => (value == null ? "" : typeof value === "number" ? String(value) : /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column] ?? null)).join(","))].join("\n") + "\n";
}
