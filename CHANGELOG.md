# Changelog

Versions follow `MAJOR.MINOR.PATCH`: a new feature bumps MINOR, a fix bumps PATCH. Each release is a git tag (`v1.0.0`).
The running version shows on the logo tooltip and in Trades → 历史版本.

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
