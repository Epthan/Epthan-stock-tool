import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDataset, toCsv, type Row } from "../../analytics/bi-dataset";

/**
 * The Power BI report computes its numbers in DAX from the exported tables. These tests apply the same
 * formulas as analytics/powerbi/measures.dax to the tables and check them against the app's own results
 * (src/lib), so a figure in the report means the same as the figure in the app.
 */
const { tables, expected } = buildDataset();
const num = (row: Row, column: string) => Number(row[column] ?? 0);
const close = (actual: number, target: number, digits = 6) => expect(actual).toBeCloseTo(target, digits);

describe("[B10] Power BI dataset reconciles with the app", () => {
  it("holdings TWR = PRODUCTX of daily (close + sales + income) / (open + purchases)", () => {
    let growth = 1;
    for (const row of tables.fact_daily_portfolio) {
      const denominator = num(row, "value_open_aud") + num(row, "purchases_aud");
      if (denominator > 0) growth *= Math.max(0, num(row, "value_close_aud") + num(row, "sales_aud") + num(row, "income_aud")) / denominator;
    }
    close((growth - 1) * 100, (expected.holdings_twr_pct as Record<string, number>)["^AXJO"], 3);
  });

  it("period P&L and per-holding contribution are plain sums, and they agree", () => {
    const pnl = tables.fact_daily_portfolio.reduce((sum, row) => sum + num(row, "value_close_aud") + num(row, "sales_aud") + num(row, "income_aud") - num(row, "value_open_aud") - num(row, "purchases_aud"), 0);
    close(pnl, expected.period_pnl_aud as number, 1);
    const bySymbol: Record<string, number> = {};
    for (const row of tables.fact_daily_holdings) bySymbol[row.symbol as string] = (bySymbol[row.symbol as string] ?? 0) + num(row, "pnl_aud");
    for (const [symbol, value] of Object.entries(expected.contribution_aud as Record<string, number>)) close(bySymbol[symbol], value, 1);
    close(Object.values(bySymbol).reduce((sum, value) => sum + value, 0), pnl, 1);
  });

  it("benchmark return = last close / close on the trading day before the period − 1", () => {
    const first = tables.fact_daily_portfolio[0].date as string;
    for (const [symbol, target] of Object.entries(expected.benchmark_return_pct as Record<string, number>)) {
      const rows = tables.fact_benchmark.filter((row) => row.benchmark === symbol);
      const base = rows.filter((row) => (row.date as string) < first).at(-1)!;
      close((num(rows.at(-1)!, "close_aud") / num(base, "close_aud") - 1) * 100, target, 3);
    }
  });

  it("max drawdown from the running growth index", () => {
    let growth = 1, peak = 1, worst = 0;
    for (const row of tables.fact_daily_portfolio) {
      const denominator = num(row, "value_open_aud") + num(row, "purchases_aud");
      if (denominator > 0) growth *= Math.max(0, num(row, "value_close_aud") + num(row, "sales_aud") + num(row, "income_aud")) / denominator;
      peak = Math.max(peak, growth);
      worst = Math.min(worst, growth / peak - 1);
    }
    close(worst * 100, expected.max_drawdown_pct as number, 3);
  });

  it("account TWR and XIRR from fact_daily_account", () => {
    const account = expected.account as Record<string, number>;
    let index = 1;
    for (const row of tables.fact_daily_account) {
      const base = num(row, "account_open_aud") + num(row, "external_flow_aud");
      if (base > 0) index *= num(row, "account_close_aud") / base;
    }
    close((index - 1) * 100, account.since_inception_twr_pct, 3);
    // XIRR: external flows as investor cash flows (money in negative) plus the closing value. Same as DAX XIRR().
    const flows = tables.fact_daily_account.filter((row) => num(row, "external_flow_aud") !== 0).map((row) => ({ date: row.date as string, amount: -num(row, "external_flow_aud") }));
    const last = tables.fact_daily_account.at(-1)!;
    flows.push({ date: last.date as string, amount: num(last, "account_close_aud") });
    const t0 = Date.parse(flows[0].date);
    const npv = (rate: number) => flows.reduce((sum, flow) => sum + flow.amount / (1 + rate) ** ((Date.parse(flow.date) - t0) / (365 * 86400000)), 0);
    let low = -0.99, high = 10;
    for (let step = 0; step < 200; step++) { const mid = (low + high) / 2; if (npv(low) * npv(mid) <= 0) high = mid; else low = mid; }
    // DAX XIRR uses 365-day years, the app 365.25; the difference stays within a few basis points.
    expect(Math.abs(low * 100 - account.xirr_annual_pct)).toBeLessThan(0.05);
  });

  it("tax: 18H = sum of gains per FY; 18A and 18V come from fact_tax_year", () => {
    for (const [label, year] of Object.entries(expected.tax_years as Record<string, Record<string, number>>)) {
      const gains = tables.fact_cgt_events.filter((row) => row.fy_label === label && num(row, "gain_aud") > 0).reduce((sum, row) => sum + num(row, "gain_aud"), 0);
      close(gains, year["18H"], 1);
      const summary = tables.fact_tax_year.find((row) => row.fy_label === label)!;
      close(num(summary, "label_18A"), year["18A"], 2);
      close(num(summary, "label_18V"), year["18V"], 2);
    }
  });

  it("closed trades: realised P&L and win rate", () => {
    const stats = expected.closed_trades as Record<string, number>;
    close(tables.fact_closed_trades.reduce((sum, row) => sum + num(row, "pnl_aud"), 0), stats.realized_aud, 1);
    close(tables.fact_closed_trades.filter((row) => num(row, "pnl_aud") > 0).length / tables.fact_closed_trades.length * 100, stats.win_rate_pct, 6);
    close(tables.bridge_closed_trade_tag.reduce((sum, row) => sum + num(row, "pnl_aud"), 0), stats.realized_aud, 0);
  });

  it("the committed CSVs are up to date (run npm run bi:export after changing the demo)", () => {
    const folder = path.join(process.cwd(), "analytics", "data");
    for (const [name, rows] of Object.entries(tables)) expect(fs.readFileSync(path.join(folder, `${name}.csv`), "utf8"), name).toBe(toCsv(rows));
  });
});
