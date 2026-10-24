# Changelog

Versions follow `MAJOR.MINOR.PATCH`: a new feature bumps MINOR, a fix bumps PATCH. Each release is a git tag (`v1.0.0`).
The running version shows on the logo tooltip and in Trades → 历史版本.

## 1.3.0 — 2026-10-25

- **Test framework**: one command (`run-tests.bat` / `npm run test:full`) runs lint, type-check (incl. tests), unit tests
  with coverage, dependency audit, an isolated production build, smoke, end-to-end and live-data suites, and writes
  `test-results/report.html`. 73 requirements in `tests/requirements.mjs`, each traced to its tests.
- Test runs are isolated: own build folder, ports and data folders; a guard checks your `data/` folder is untouched.
  (Before, the end-to-end suite deleted `./data` — harmless in CI, dangerous on your PC.)
- New live suite against real Yahoo data; new unit tests for the backtest, risk statistics (vs an independent
  implementation), watch lists, overview formatting, browser cache retries, CSS colour hygiene.
- Fix: "fetch failed" from the server (Yahoo unreachable) now shows as a network problem with automatic retry, not as a
  generic error.
- Security: dependency audit fixes; yahoo-finance2 3.15 → 4.0.5 (its old bundled zod had a high-severity advisory).
  Runtime dependencies now have no known vulnerabilities.

## 1.2.0 — 2026-10-25

- **Drawing on the research chart** (and the full-screen chart): trend line, ray, horizontal line, rectangle,
  Fibonacci retracement; magnet snap to open / high / low / close; select a line to drag its handles or delete it
  (Delete key), undo, clear. Lines are anchored to date and price, so they stay put when you scroll, zoom, change
  timeframe or chart type. They are temporary: changing stock, leaving the page or reloading clears them.

## 1.1.0 — 2026-10-25

- **Fill in missing brokerage** (Trades → 补佣金, or from the notice on the Tax page): pick a broker fee schedule —
  IBKR fixed (US), Stake (ASX / US), CommSec (ASX) — or a custom rule (fixed + % with a minimum, any currency),
  preview the fee for every trade without brokerage, untick any you want to skip, and save them in one go as linked
  fee entries. One step to undo via History.

## 1.0.0 — 2026-10-25

First stable version. Everything below is in this release.

**Market** — watch lists, line / candle chart with moving averages, company facts, your position in the stock;
US market overview (broad indexes, 11 sectors, rates, dollar, commodities, VIX); strategy backtest with your real
trades overlaid.

**Portfolio** — holdings and account returns (time-weighted and money-weighted / XIRR), benchmark comparison,
contribution by holding, risk (volatility, drawdown, β, risk contribution), trade analytics (win rate, payoff,
holding period, after-exit moves), P&L by sector, holding period and strategy tag; demo portfolios on real prices.

**Trades** — trade log with brokerage and tags, parcel (FIFO) cost and realised P&L, cash ledger (deposits,
dividends with franking / withholding, fees, FX conversions), multi-currency ledgers, automatic share splits,
missing-dividend suggestions, CSV import (IBKR, CommSec, Stake, SelfWealth, Chinese brokers) and export.

**Tax (Australia)** — per financial year: CGT schedule by parcel, 12-month discount, loss ordering and carry-forward,
franked / unfranked dividends and franking credits, foreign income and tax offset, myTax labels, CSV for an accountant,
parcels approaching the 12-month mark.

**Compare / Heatmap** — rebased multi-symbol chart and table; S&P 100 / Nasdaq-100 / watch list / holdings heatmap.

**Data** — SQLite store (`data/store.db`) shared by every device on the network, automatic history with restore,
refusal of stale writes from another device, backup / restore files, local daily-price archive (`data/prices.db`).

**Quality** — 49 unit tests, 32 end-to-end tests, 3 smoke tests; calculations cross-checked against an independent
Python implementation; Next.js 16.4.2.
