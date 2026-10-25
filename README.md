# Stock Tool

A self-hosted trading workstation for individual investors: market research, a trade and cash ledger, portfolio
analytics, and an Australian tax report. It answers questions like *"am I actually beating the index?"*, *"which of my
approaches makes money?"* and *"what goes into myTax this year?"*.

It runs on your own computer. Your trades stay in a local database; market data comes from Yahoo Finance.

![Market page with chart, drawing tools and company facts](docs/images/market.png)

> Screenshots use the deterministic mock data from the test suite, not real portfolios.

## How the numbers are built

Most of the work in this project is data work, not UI:

- **Ingestion** – daily prices, FX rates, splits and dividends from Yahoo Finance for US, ASX, Hong Kong, China A-share and Korean listings. Price history is archived in SQLite and updated incrementally.
- **Cleaning** – trades are restated for stock splits, minor currency units (e.g. GBp) are normalised, and all markets are aligned to one trading calendar with holidays forward-filled.
- **Metrics** – time-weighted return, money-weighted return (XIRR), contribution by holding, benchmark comparison and risk measures. Per-holding contributions reconcile exactly to the period P&L.
- **Attribution** – returns broken down by sector, holding period and user-defined tags.
- **Tax** – Australian CGT per financial year: FIFO parcels, loss ordering, the 50% discount and franking credits, with CSV export.
- **Testing** – calculations are covered by unit tests (Vitest) and every page and user flow by smoke and end-to-end tests (Playwright), all running on fixed mock data.

Formulas and conventions are documented in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) and [`docs/TAX.md`](docs/TAX.md).

## Features

| Page | Route | What it does |
| --- | --- | --- |
| **Market** | `/` | Watch lists; line / candle chart with moving averages; temporary drawings (trend line, ray, horizontal line, rectangle, Fibonacci retracement); company facts and analyst view; your position in the stock; moving-average crossover backtest overlaid with your real trades |
| **Portfolio** | `/dashboard` | Holdings and account returns (time-weighted and money-weighted / XIRR), benchmark comparison, contribution by holding, risk (volatility, drawdown, beta, risk contribution, correlation), trade analytics (win rate, payoff, profit factor, holding periods, tag attribution), rule-based key findings |
| **Trades** | `/portfolio` | Trade log per portfolio with brokerage and tags; parcel (FIFO) cost and realised P&L; cash ledger (deposits, withdrawals, FX conversions, dividends with franking / withholding, interest, fees, tax); broker CSV import; bulk brokerage fill from a fee schedule; backup, restore and version history |
| **Tax** | `/tax` | Australian tax report per financial year: CGT schedule by parcel, 12-month discount, loss ordering and carry-forward, franked / unfranked dividends and franking credits, foreign income and tax offset, myTax labels, CSV for your accountant |
| **Compare** | `/compare` | Several symbols rebased to 0% on one chart, plus a side-by-side table |
| **Heatmap** | `/treemap` | S&P 100, Nasdaq-100, a watch list or your holdings, sized by market cap or position value |

Also: three skins (Light, Gold, Night) plus Auto, an English / Chinese interface, a phone layout, and multi-device
use on your home network with conflict detection.

<table>
<tr><td><img src="docs/images/portfolio.png" alt="Portfolio overview"></td><td><img src="docs/images/tax.png" alt="Tax report"></td></tr>
<tr><td><img src="docs/images/trades.png" alt="Trade log"></td><td><img src="docs/images/heatmap.png" alt="Heatmap, night skin"></td></tr>
</table>

## Quick start

**Requirements:** [Node.js](https://nodejs.org) **22.13 or newer** (22 LTS recommended). Node 22.13+ has SQLite
built in; older versions fall back to a JSON file without history or a price archive.

| Goal | Windows | Any OS |
| --- | --- | --- |
| Use it on this computer | double-click `start-localhost.bat` | `npm install` then `npm run dev` |
| Use it from your phone on the same Wi-Fi | double-click `start-phone.bat` | `npm run build` then `npx next start -H 0.0.0.0 -p 3001` |
| Run every check | double-click `run-tests.bat` | `npm run test:all` (add `--live` via `npm run test:full`) |

Then open <http://localhost:3000> (or the address `start-phone.bat` prints, e.g. `http://192.168.1.20:3001`).

The batch files install or update dependencies automatically when `package-lock.json` changes.

The app has no login. Read [SECURITY.md](SECURITY.md) before exposing it to a network.

## Your data

- Portfolios, trades, cash entries and watch lists live in `data/store.db` (SQLite) in the project folder. They are
  mirrored in the browser, so every device that opens the app sees the same data.
- Earlier versions are kept automatically and can be restored from **Trades → History**. Two devices editing at once
  cannot overwrite each other: a save made from stale data is refused and kept in History.
- **Trades → Back up** downloads everything as JSON. **Restore** replaces all data with a backup.
- Daily prices are archived in `data/prices.db`, so history survives restarts and Yahoo outages. You can delete it at
  any time; it rebuilds itself.
- `data/` is git-ignored, so your trades never end up in version control.

Details: [docs/DATA.md](docs/DATA.md).

## Important notes

- **Not financial or tax advice.** The tax report follows the ATO rules described in [docs/TAX.md](docs/TAX.md) for an
  Australian resident individual holding shares on capital account. Check every figure against your broker's
  statements, and ask a registered tax agent when in doubt.
- **Market data.** Yahoo Finance via the unofficial [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2)
  library is fine for personal use, not for production or redistribution. Quotes may be delayed. The app never shows
  simulated prices as real ones.
- Supported symbols include US (`AAPL`), ASX (`BHP.AX`), Hong Kong (`0700.HK`), China A-shares (`600519.SS`,
  `000001.SZ`), Korea (`005930.KS`) and other markets Yahoo covers.

## Documentation

| Document | Contents |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Page-by-page walkthrough: recording trades, importing CSVs, brokerage, dividends, tax, drawings, backtest |
| [Methodology](docs/METHODOLOGY.md) | How every number is calculated: returns, risk, trade analytics, splits, currencies |
| [Australian tax](docs/TAX.md) | CGT, discount, loss ordering, dividends, foreign income, myTax labels, limitations |
| [Data & storage](docs/DATA.md) | Store, history and conflicts, backups, price archive, CSV formats |
| [Architecture](docs/ARCHITECTURE.md) | Stack, data flow, data model, file map, caching and failure handling |
| [Testing](docs/TESTING.md) | Test runner, requirement catalog, test layers, isolation, CI |
| [Contributing](CONTRIBUTING.md) | Development workflow, conventions, releases |
| [Security](SECURITY.md) | Threat model and safe deployment |
| [Changelog](CHANGELOG.md) | Release history |

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · lightweight-charts 5 · d3-hierarchy ·
yahoo-finance2 4 · `node:sqlite` · Vitest · Playwright.

## Status

Version **1.4.0**. This is a personal project, built and tested for one investor's workflow (AUD ledger, US and ASX
shares, IBKR / Stake / CommSec). Issues and suggestions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

No licence has been chosen yet, so all rights are reserved by the author.
