# Portfolio Dashboard

Open `/dashboard`. The existing market workplace stays at `/`, and the independent trade log stays at `/portfolio`.

## Implemented

- Shared navbar, search, locale and day/night theme; responsive portfolio sidebar.
- Overview, performance/risk, allocation/drivers, holdings, and methodology views.
- Eight KPIs, selectable periods, SPY/QQQ comparison, cumulative returns and weekly drawdown.
- Securities/sector allocation including cash, dollar P&L contribution, searchable/sortable holdings, CSV export.
- Stock links open the existing Workplace with the selected symbol.

## Data contract

This first version uses deterministic simulated weekly prices from 2024-10-18 to 2026-10-16. Benchmark series are also simulated; neither they nor the displayed holdings represent actual market observations. Dates and demo status are displayed in the interface.

The sidebar portfolio selector switches between three demo accounts: Core (six holdings, $12,000 cash), Growth (three holdings, $4,500 cash), and Defensive (three holdings, $20,000 cash). The selection persists locally. Each account has independent quantities and cash, using the same underlying simulated security price history. These are demonstration portfolios, not authenticated user accounts.

Positions are opened at the first observation and held throughout. There are no subsequent cash flows, trades, dividends or fees. Consequently the account-value ratio equals time-weighted return for this dataset. Existing browser trade records are not read or modified.

Equity beta is estimated from 104 stock/benchmark weekly returns, then weighted by end-date equity market values; cash is excluded. Changing the display period does not change the beta estimation window. Changing the benchmark does. Drawdown is calculated from weekly observations and can miss intraweek losses. Allocation uses assets including cash. Period dollar contributions reconcile to the net change in account value.

## Next data integration

Workplace now includes portfolio CRUD and symbol-list management. Names, symbols, and active selection are stored in `stock-tool.portfolios.v1` and `stock-tool.active-portfolio.v1`, shared with the Dashboard. Removing a portfolio requires confirmation and at least one portfolio must remain. Stock lists are independent from watch lists and the trade ledger. Adding a symbol is not a purchase transaction.

Unmodified demo stock lists without recorded trades retain their clearly labelled simulated analytics. Modified or custom portfolios use recorded per-portfolio buy/sell transactions and Yahoo daily close prices through `/api/market/portfolio-analysis`. Dashboard is read-only; transaction editing remains in Workplace.

## Recorded-portfolio analytics

Recorded positions produce securities market value, period P&L, realized/unrealized P&L, allocation, contribution, daily return/drawdown curves and equity beta. Securities without trades are listed as excluded. Prices must cover recorded trading dates and holdings; missing data produces an error and retry state rather than mock values. This version requires securities and SPY/QQQ to use the same currency and does not perform FX conversion.

Daily securities return is `(closing value + sales) / (previous closing value + purchases) - 1`, geometrically linked. Date-only buys are treated as beginning-of-day contributions and sells as end-of-day distributions. This is explicitly labelled an estimate and is not account-level TWR or IRR. Cash, dividends, fees and automatic corporate-action adjustments are excluded. Beta uses matching daily returns over the last two years, requires at least 60 pairs per security and is weighted by current securities value excluding cash; incomplete coverage leaves aggregate beta unavailable.

Actual cash and external funding still require ledger integration before account total assets, cash allocation or account-level performance can be presented.

Add a unified cash/trade/dividend/fee ledger and adjusted historical price adapter before representing this dashboard as real portfolio performance. Handle corporate actions and dividend accounting consistently, validate holdings and cash balances, and calculate daily flow-adjusted returns. Do not value historical holdings using current quotes.
