# Methodology

This page explains how the Portfolio page calculates its figures. Most of the code lives in `src/lib/live-portfolio.ts`
(returns), `src/lib/trader-analytics.ts` (statistics, risk and trades), `src/lib/breakdowns.ts` (attribution) and
`src/lib/lots.ts` (parcels). The server route `/api/market/portfolio-analysis` runs the whole pipeline.

## Pipeline

1. **Validate.** Check trades and cash entries. Load daily bars and split / dividend events for every symbol. Bars
   carry the exchange-local date, and a bar for a session that has not closed yet is dropped.
2. **Restate splits.** Trades before a split are restated onto today's share basis (quantity × ratio, price ÷ ratio).
   Holdings are then validated: no sale may exceed the shares held on its date.
3. **Convert currencies.**
   - Minor units are normalised to the major currency: GBp → GBP, ZAc → ZAR, ILA → ILS.
   - FX series are loaded, and one calendar is built across all markets. On a market holiday, the last close carries
     forward.
   - Prices, trades and the benchmark are converted into the portfolio's ledger currency.
4. **Analyse.** Holdings return, contributions, account return, trade analytics and risk.
5. **Break down.** By sector (from the Yahoo profile), holding period and tag.

Demo portfolios go through the same code. Their fixed share counts are treated as bought two years ago at the real
close.

## Prices and currencies

- Valuations use daily **closing** prices. Intraday moves are not modelled, so a drawdown measured on closes can miss
  an intraday low.
- A trade is entered in the security's quote currency. It is converted at the **trade-date** FX rate. Holdings are
  valued at **each day's** rate, so unrealised P&L includes currency movements.
- The FX rate used for a date is the last published rate on or before that date. Trades before the series starts use
  the first rate after.
- Cash settlement:
  - *ledger currency* mode settles every trade in the ledger currency;
  - *per currency* mode keeps a separate balance for each currency and marks foreign cash at today's rate.

## Holdings return (time-weighted)

For each trading day *t*:

```
r_t = (V_t + S_t + I_t) / (V_{t-1} + P_t) − 1
```

| Symbol | Meaning |
| --- | --- |
| V | Market value of the holdings at the close |
| P | Purchases made that day, treated as made at the start of the day |
| S | Sales made that day, treated as made at the end of the day |
| I | Dividends, interest, fees and tax booked in the cash ledger that day |

- Daily returns are linked geometrically.
- Cash entries dated on a weekend or holiday settle on the next trading day.
- Deposits and withdrawals do not affect this return.
- An FX conversion spread is an account-level cost, not a holdings cost.

**Period P&L** is `V_end − V_start + sales + income − purchases`.

**Contribution by holding** splits the period P&L by symbol. Each holding's contribution is the change in its value,
plus its sales and income, minus its purchases. The contributions always add up to the period P&L.

## Account return

The account panel appears once a deposit is recorded.

- **Account value** = holdings + cash.
- **Time-weighted account return.** External flows (deposits and withdrawals) are applied at the start of the day:
  `r_t = A_t / (A_{t−1} + F_t) − 1`, where A is the account value and F the external flow.
- **Money-weighted return (XIRR)** is the annual rate that makes the present value of all external flows plus today's
  value equal to zero. This return reflects the timing of your deposits. It is annualised once the history covers at
  least one year.
- If the cash balance goes negative on any day, both account returns are withheld, because a deposit is probably
  missing.

## Cost and realised P&L

Positions use **parcels, first-in first-out** (`src/lib/lots.ts`):

- A buy opens a parcel.
- A sale closes the oldest parcels first.
- On the same day, buys are processed before sells.

Average cost is the cost of the shares still open divided by the shares held. The tax report uses the same parcels.

## Statistics

The figures below are calculated from daily holdings returns over the selected period. 252 trading days count as
one year.

| Figure | Definition |
| --- | --- |
| Annualised return | `(1 + total)^(1/years) − 1` |
| Volatility | Sample standard deviation of daily returns × √252 |
| Sharpe | `(annualised return − rf) / volatility`, with rf = 4% a year (`RISK_FREE_RATE`) |
| Sortino | As Sharpe, but divided by downside deviation below the daily rf |
| Max drawdown | Largest fall from a running peak of the growth index |
| Calmar | Annualised return / abs(max drawdown) |
| Beta, alpha | OLS regression of portfolio on benchmark daily returns. Alpha is annualised (daily alpha × 252), with its t-statistic |
| Up / down capture | Average portfolio return on benchmark up days (or down days) / the benchmark's average on those days |
| Market vs residual | Beta × benchmark return, against everything else |
| Rolling | 63-day rolling excess return and beta |

Ratios need at least 40 daily observations. Below that they show "—". Capture ratios need at least 5 up days or
5 down days.

Per-holding beta uses up to two years of matching daily returns against the benchmark, and needs at least 60 pairs.

## Risk and concentration

- **Risk contribution.**
  - Uses current weights and a one-year daily covariance matrix Σ.
  - A holding's share of portfolio variance is `w_i (Σw)_i / wᵀΣw`.
  - It needs at least 40 common days.
- **Correlation heatmap.** Pairwise correlations taken from the same covariance matrix.
- **Concentration.** Weight of the top three positions, and the Herfindahl index `HHI = Σ w²`. The effective number of
  positions is `1 / HHI`.

## Trade analytics

- Each sale is a **closed trade**, valued against the cost of the parcels it closed.
- **Holding days** are the average across those parcels, weighted by shares.
- Each closed trade inherits the **tags** of its entry parcels, in proportion to their shares. This drives the tag
  attribution.
- Metrics:
  - win rate;
  - payoff ratio (average win / average loss);
  - profit factor (gross wins / gross losses);
  - expectancy per trade;
  - holding period of winners vs losers.
- **After the trade:**
  - the price change 20 trading days after each sale (did you sell too early?);
  - the excess return over the benchmark 5 and 20 days after each buy.
- **Behaviour.** The number of trades in the month after a losing month vs after a winning month.
- **Key findings** come from a rule engine (`src/lib/trader-insights.ts`) with minimum sample sizes. A finding is only
  shown when there is enough data behind it.

## Missed dividends

For each dividend Yahoo reports, the app multiplies the per-share amount by the shares held before the ex-date. The
amount is gross, converted at the ex-date rate. These amounts are suggestions only; you add them yourself, and you
enter any withholding tax.

## Backtest

`src/lib/backtest.ts` runs a moving-average crossover strategy on daily bars:

- It needs a full warm-up of the long SMA before the start date, and `1 ≤ short < long ≤ 250`.
- When the short SMA crosses above the long SMA at the close, the strategy buys at the **next open**, all in. When it
  crosses below, it sells at the next open. Any position still open is closed at the final close.
- Slippage and a percentage fee apply on each side. The buy-and-hold comparison pays the same costs.
- Dividends and taxes are not modelled.

## Limitations

- Corporate actions other than splits (DRP, rights issues, spin-offs, mergers, returns of capital) are not modelled.
- FX uses Yahoo's daily reference rates, not your broker's actual conversion rates.
- Yahoo data can contain gaps or restatements. The price archive re-downloads history when a new split appears or a
  stored close differs by more than 2% (see [DATA.md](DATA.md)).
