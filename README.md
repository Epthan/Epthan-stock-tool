# Stock Tool

A personal trading workstation: market research, a trade and cash ledger, and portfolio analytics that answer
"am I actually beating the index, and which of my approaches makes money?". Runs locally; data comes from Yahoo Finance.

**Version 1.3.2** — see [CHANGELOG.md](CHANGELOG.md). This folder is the working copy: every change is made here,
committed with git and released as a new version (tag `vX.Y.Z`). The full git history of each release is in
`releases/stock-tool-vX.Y.Z.bundle`; with git installed, `git clone releases\stock-tool-v1.0.0.bundle stock-tool-git` restores it.

## Start

| What | How |
|---|---|
| Use it on this PC | double-click `start-localhost.bat` → <http://localhost:3000> |
| Use it on your phone (same Wi-Fi) | double-click `start-phone.bat` → it builds, prints the address, e.g. `http://192.168.1.20:3001` |
| From a terminal | `npm install` once, then `npm run dev` |

`start-phone.bat` exposes the app to everyone on the same network. Only run it on a network you trust.

## Pages

| Page | Route | What it is for |
|---|---|---|
| Market | `/` | Watch lists, chart (line / candles, MAs, temporary drawings: trend / ray / horizontal / rectangle / Fibonacci), company facts, your position in the stock, strategy backtest overlaid with your real trades |
| Portfolio | `/dashboard` | Overview, trade analysis, performance & risk, allocation & risk, holdings, methodology |
| Trades | `/portfolio` | Trade log per portfolio (with brokerage), cash ledger (franking / withholding on dividends), CSV import, backup / restore / history, ledger currency |
| Tax | `/tax` | Australian tax report per financial year: CGT schedule by parcel (FIFO, 50% discount, losses carried forward), dividends with franking credits and foreign tax, myTax labels, CSV for your accountant, parcels close to the 12-month mark |
| Compare | `/compare` | Watch list or holdings rebased to 0% on one chart, plus a side-by-side table |
| Heatmap | `/treemap` | S&P 100 / Nasdaq 100 / watch list / holdings, sized by market cap or position value |

Three skins (灰白 gray, 黑金 gold, 夜间 night) and Chinese / English are switched in the top bar.

## Your data

- Portfolios, trades, cash entries, splits and watch lists are saved in **`data/store.db`** (SQLite, built into Node 22.13+) in this folder and mirrored in the browser. Every device that opens the app sees the same data. On older Node it falls back to `data/store.json` (no history, no price archive). An old `store.json` is migrated once and kept as `store.json.bak`.
- **History**: the server keeps earlier versions automatically (at most every 10 minutes while you edit, always before a restore). Trades page → 历史版本 restores or downloads any of them.
- **Two devices editing at once**: a save based on stale data is refused instead of overwriting; the browser loads the newer data and your refused edit is kept in History.
- **Back up**: Trades page → 备份数据 downloads a JSON file. **Restore**: 恢复备份 replaces everything with a backup.
- **Price archive**: daily prices are kept in `data/prices.db`. After the first download only the last two weeks are fetched, and archived prices are used when Yahoo is down. Safe to delete; it rebuilds.
- `data/` is git-ignored so trades never end up in version control.

## What the numbers include

- **Holdings return** — time-weighted, daily closes, includes dividends, interest, fees and tax from the cash ledger.
- **Account return** — holdings + cash (shown once a deposit is recorded): time-weighted and money-weighted (XIRR).
- **Cost and realised P&L** use parcels, first-in first-out (the same parcels as the tax report). Brokerage entered with a trade goes into the parcel's cost base / off the sale proceeds for tax.
- **Splits** are detected automatically; trades before a split are restated to today's share count (records stay as typed).
- **Currencies** — each portfolio has a ledger currency; foreign prices and trades are converted at the day's FX rate. Cash can settle in the ledger currency (CommSec style) or per currency (Stake / IBKR style).
- Full formulas: [PORTFOLIO_DASHBOARD.md](PORTFOLIO_DASHBOARD.md). Architecture and file map: [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md).

## Importing from a broker

Trades page → 导入 CSV. Recognises IBKR, CommSec (incl. "B 100 CBA @ 115.50" details), Stake, SelfWealth, Chinese brokers
(GBK files), and this app's own export. You can fix the column mapping, date format and symbol suffix (e.g. `.AX`) before importing;
duplicates are skipped and nothing is saved if validation fails.

## Checks

Double-click **`run-tests.bat`** (or `npm run test:full`): lint, types, unit tests with coverage, dependency audit, smoke,
end-to-end and live-data tests, then the report opens (`test-results/report.html`). Your data and a running app are not
touched. Details: [tests/README.md](tests/README.md).

## Notes

- Yahoo Finance via `yahoo-finance2` is fine for personal use, not for production market data. Requests are cached, retried with
  backoff on rate limits, and the last good value is served if Yahoo is down. No simulated prices are ever shown as real.
- Supported symbols: US (`AAPL`), ASX (`BHP.AX`), Hong Kong (`0700.HK`), China A-shares (`600519.SS`, `000001.SZ`), Korea (`005930.KS`) and others Yahoo covers.
