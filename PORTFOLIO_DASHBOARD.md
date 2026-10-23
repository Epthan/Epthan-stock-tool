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

Positions are opened at the first observation and held throughout. There are no subsequent cash flows, trades, dividends or fees. Consequently the account-value ratio equals time-weighted return for this dataset. Demo holdings are simulated and are not trades.

Equity beta is estimated from 104 stock/benchmark weekly returns, then weighted by end-date equity market values; cash is excluded. Changing the display period does not change the beta estimation window. Changing the benchmark does. Drawdown is calculated from weekly observations and can miss intraweek losses. Allocation uses assets including cash. Period dollar contributions reconcile to the net change in account value.

## Next data integration

Workplace now includes portfolio CRUD and symbol-list management. Names, symbols, and active selection are stored in `stock-tool.portfolios.v1` and `stock-tool.active-portfolio.v1`, shared with the Dashboard. Removing a portfolio requires confirmation and at least one portfolio must remain. Stock lists are independent from watch lists and the trade ledger. Adding a symbol is not a purchase transaction.

Unmodified demo stock lists without recorded trades retain their clearly labelled simulated analytics. Modified or custom portfolios use recorded per-portfolio buy/sell transactions and Yahoo daily close prices through `/api/market/portfolio-analysis`. Dashboard is read-only; transaction editing remains in Workplace.

## Recorded-portfolio analytics

Recorded positions produce securities market value, period P&L, realized/unrealized P&L, allocation, contribution, daily return/drawdown curves and equity beta. Securities without trades are listed as excluded. Prices must cover recorded trading dates and holdings; missing data produces an error and retry state rather than mock values. This version requires securities and SPY/QQQ to use the same currency and does not perform FX conversion.

Daily securities return is `(closing value + sales) / (previous closing value + purchases) - 1`, geometrically linked. Date-only buys are treated as beginning-of-day contributions and sells as end-of-day distributions. This is explicitly labelled an estimate and is not account-level TWR or IRR. Cash, dividends, fees and automatic corporate-action adjustments are excluded. Beta uses matching daily returns over the last two years, requires at least 60 pairs per security and is weighted by current securities value excluding cash; incomplete coverage leaves aggregate beta unavailable.

Actual cash and external funding still require ledger integration before account total assets, cash allocation or account-level performance can be presented.

Add a unified cash/trade/dividend/fee ledger and adjusted historical price adapter before representing this dashboard as real portfolio performance. Handle corporate actions and dividend accounting consistently, validate holdings and cash balances, and calculate daily flow-adjusted returns. Do not value historical holdings using current quotes.

## Unified trade log (2026-10-22)

There is now one trade store: `stock-tool.portfolios.v1` (trades live on each portfolio). `/portfolio` is the Trade Log page for the active portfolio — positions rebuilt with the average-cost method, latest quotes, full trade list with notes, and CSV export. Adding/editing/deleting uses the same trade dialog as Workplace and Dashboard, so all three pages stay in sync.

Legacy migration: on first load, records in the retired `stock-tool.portfolio-trades.v1` key are imported once into a new portfolio "Imported Trade Log" (dates normalised to `YYYY-MM-DD`, symbols upper-cased, notes kept). Records that fail validation (e.g. selling more than held, future dates) are skipped and counted. The legacy key is left untouched as a backup; `stock-tool.legacy-trades-migrated.v1` records the result and prevents re-import.

## Trader analytics (2026-10-22)

Recorded portfolios now compute, server-side in `src/lib/trader-analytics.ts` (called from `analyzePortfolio`):

- **Trade analysis view** (`/dashboard` → 交易分析): each sell is a closed trade (P&L on average cost, holding days FIFO-weighted). Win rate, payoff ratio, profit factor, expectancy, winner vs loser holding period, return histogram, price change 20 trading days after each sell, 5/20-day excess after each buy vs benchmark, monthly activity (trades after losing vs winning months), closed-trade table.
- **Performance & risk**: annualized return/volatility, Sharpe/Sortino (rf 4%, `RISK_FREE_RATE`), Calmar, OLS alpha (annualized, t-stat) and beta, market vs residual return split, up/down capture, rolling 63-day excess and beta, monthly return calendar.
- **Allocation & risk**: risk contribution vs weight (1-year covariance, current weights), correlation heatmap, top-3 weight, HHI / effective positions, weight-vs-contribution scatter.
- **Holdings**: vs cost, risk contribution, distance from 52-week high, days held; beta moved to the symbol tooltip.
- **Overview**: KPIs replaced with value, period P&L, return (excess in note), annualized alpha, Sharpe, max drawdown, profit factor, win rate; cumulative return chart now carries a drawdown pane; "Behind the numbers" is a rule engine (`src/lib/trader-insights.ts`) with minimum sample sizes.
- Demo portfolios show a banner linking to a recorded portfolio when one exists; recorded portfolios sort first in the selector.

Fix: `LanguageProvider` now reads the saved locale via `useSyncExternalStore`, removing the hydration mismatch when the UI language is Chinese.

Not done (needs new data): trade tags and per-tag attribution; sector grouping; backtest overlay on actual trades.


## Cash ledger, account return and broker import

- Each portfolio has a cash ledger (`cash`: deposit, withdrawal, dividend, interest, fee, tax). Buys and sells move cash automatically.
- **Holdings return** (chart, statistics) now books dividends, interest, fees and tax on the day they settle (weekend entries roll to the next trading day). Deposits and withdrawals do not affect it.
- **Account panel** (shown once a deposit is recorded): account value = holdings + cash; time-weighted account return with external flows at the start of the day; money-weighted return via XIRR (annualised once history is at least one year). If the cash balance ever goes negative, account returns are withheld because a deposit is probably missing.
- **CSV import** (`src/lib/csv-import.ts`): header aliases for IBKR, CommSec (`B 100 CBA @ 115.50` details, brokerage implied from the debit), Stake, SelfWealth, Chinese brokers (GBK) and this app's own export. It dedupes against existing records, replays sells against holdings, and saves all-or-nothing.
- Data is stored server-side in `data/store.json` (`/api/store`) and mirrored to localStorage; backup and restore are on the Trade log page.
