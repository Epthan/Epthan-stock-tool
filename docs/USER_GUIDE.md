# User guide

This guide walks through the app page by page. For how the numbers are calculated, see
[METHODOLOGY.md](METHODOLOGY.md); for the tax rules, see [TAX.md](TAX.md).

- [First run](#first-run)
- [Market](#market)
- [Portfolio](#portfolio)
- [Trades](#trades)
- [Tax](#tax)
- [Compare and Heatmap](#compare-and-heatmap)
- [Using several devices](#using-several-devices)
- [Troubleshooting](#troubleshooting)

## First run

1. Install Node.js 22.13 or newer.
2. Start the app with `start-localhost.bat` (Windows) or `npm install && npm run dev`, then open <http://localhost:3000>.
3. Pick a skin (Auto, Light, Gold, Night) and the language (EN / 中文) in the top bar. Both choices are remembered.
4. The app starts with demo portfolios. Demo portfolios have no trades: the dashboard pretends their fixed share
   counts were bought two years ago at the real closing price, so you can explore every view straight away. Record
   your own trades in a new portfolio (see [Trades](#trades)). Recorded portfolios sort first in the selector.

## Market

The Market page has three tabs, and it remembers the last one you used.

**Markets.** This tab shows the major indices, the 11 S&P sector ETFs and macro instruments (VIX, Treasury yields,
the dollar index, gold, oil, copper, bitcoin). Click a row to open it in Research.

**Research** gives you:

- **Watch lists.** Create, rename and delete lists. Search a symbol or company name in the top bar and add it with
  **+**. Lists are filterable and sortable.
- **Chart.** Choose a range (1D to 1Y, plus more ranges) and a type: Auto, Line or Candles. Under **Indicators** you
  can add moving averages and volume. **⤢** opens the chart full-screen.
- **Drawing tools.** Trend line, ray, horizontal line, rectangle and Fibonacci retracement.
  - Drag on the chart, or click two points, to draw.
  - **Magnet** snaps to the open, high, low or close of the bar under the pointer.
  - Click a drawing to select it. Then drag its handles to adjust it, or press **Delete** to remove it. **Esc**
    cancels the current tool.
  - Drawings are anchored to a date and a price, so they stay in place when you change the range or chart type.
  - Drawings are **temporary**: they are cleared when you switch stock or leave the page. Nothing is saved.
- **Company facts.** Valuation, growth and profitability, the 52-week range, and analyst ratings and targets.
- **Your position.** If the active portfolio holds the stock, you see its return, size and average cost.

**Backtest.** This tab runs a simple moving-average crossover strategy (short SMA crosses the long SMA) on daily
data and compares it with buy-and-hold.

- You set the dates, the two SMA lengths, the initial capital, a fee per side in % and slippage in %.
- A signal on day *t* fills at the open of day *t + 1*.
- Your real trades in that stock are overlaid on the chart, so you can compare what you did with the rule.

## Portfolio

Choose a portfolio, a period (1M, 3M, 6M, YTD, 1Y, ALL) and a benchmark (SPY, QQQ or the ASX 200).

| View | Highlights |
| --- | --- |
| Overview | Securities value; period gain against the benchmark; realised and unrealised P&L; key findings; account panel (holdings plus cash, net contributions, TWR, money-weighted return, cash share); cumulative return with drawdown; risk and return KPIs |
| Trade analysis | Each sale is a closed trade. Shows win rate, payoff ratio, profit factor, expectancy, holding period of winners vs losers, return histogram, what the price did 20 days after each sale, excess return 5 and 20 days after each buy, and activity after winning vs losing months |
| Performance & risk | Annualised return and volatility, Sharpe, Sortino, Calmar, alpha and beta (with t-stat), up / down capture, rolling excess return and beta, monthly return calendar |
| Allocation & risk | Weights vs risk contribution, correlation heatmap, concentration (top-3 weight, effective number of positions), breakdown by sector, holding period and tag |
| Holdings | Sortable table with cost, value, P&L, risk contribution, distance from the 52-week high and days held. CSV export |
| Data & methodology | The data sources and conventions behind every figure |

The account panel appears once at least one deposit is recorded in the cash ledger. If the cash balance ever goes
negative, account returns are withheld, because a deposit is probably missing.

## Trades

### Recording trades

Click **+ Add trade** and enter:

- the symbol, buy or sell, the date, the price in the security's own currency, and the quantity;
- optionally, the brokerage and its currency, a note, and tags (for example `long-term` or `momentum`).

Tags drive the attribution in Portfolio → Allocation & risk.

Validation rejects:

- selling more than you hold on that date;
- dates in the future;
- duplicate IDs.

Positions and realised P&L use **parcels, first-in first-out**. These are the same parcels the tax report uses.

Brokerage entered with a trade is stored as a linked fee entry in the cash ledger. It is added to the parcel's cost
base, or deducted from the sale proceeds. Deleting the trade also deletes its brokerage.

### Splits

Splits are detected automatically from Yahoo. Trades before a split are restated to today's share count (quantity ×
ratio, price ÷ ratio) for every calculation. The records stay exactly as you typed them, and the trade log shows the
restated figures under each affected row.

### Cash ledger

The cash ledger records deposits, withdrawals, FX conversions, dividends, interest, fees and tax. Buys and sells move
cash automatically.

- **Ledger currency.** Each portfolio has one, for example AUD. Foreign trades and prices are converted at each day's
  exchange rate.
- **Cash settlement.** This can be *ledger currency* (CommSec style: everything settles in the ledger currency) or
  *per currency* (Stake / IBKR style: separate USD and AUD balances, moved with FX conversions).
- **Dividends.**
  - For Australian shares, enter the franked percentage. The franking credit can be left blank: it is then calculated
    at the 30% company rate.
  - For foreign shares, enter the tax withheld.
- **Possibly missed dividends.** The app compares Yahoo's dividend history with what you held on each ex-date and
  suggests entries. Add one, or all of them. Nothing is added automatically.

### Importing from a broker

**Import CSV** recognises these formats:

- IBKR;
- CommSec, including contract details such as `B 100 CBA @ 115.50`, where brokerage is implied from the debit;
- Stake;
- SelfWealth;
- Chinese brokers (GBK-encoded files);
- this app's own export.

Before importing, you can adjust the column mapping, the date format and a symbol suffix (for example `.AX`).
Duplicates of existing trades are skipped. Sells are replayed against your holdings. If any row fails validation,
nothing is saved.

### Filling in missing brokerage

**Fill brokerage** finds every trade without brokerage. Pick a fee schedule or a custom rule:

| Schedule | Rule |
| --- | --- |
| IBKR fixed (US only) | US$0.005 per share, minimum US$1, maximum 1% of trade value |
| Stake (ASX / US) | A$3 / US$3 up to $30,000, then 0.01% of trade value |
| CommSec (ASX, CDIA settled) | $5 up to $1k, $10 up to $3k, $19.95 up to $10k, $29.95 up to $25k, 0.12% above |
| Custom | Fixed amount + % of value, with a minimum, in any currency |

Review the preview, untick any trades you want to skip, and save. Each schedule shows the date it was last checked.
Fees change, so confirm against your contract notes. The whole fill can be undone from **History**.

### Backup, restore and history

- **Back up** downloads all data as one JSON file.
- **Restore** replaces all current data with a backup. The current state is saved to History first, so a restore
  can itself be undone.
- **History** lists earlier versions: automatic snapshots (at most one every 10 minutes while you edit), snapshots
  taken before restores, and refused edits from a conflict. You can download or restore any of them.

## Tax

Choose the portfolio and the financial year (1 July – 30 June). The page shows:

- **Summary.** Net capital gain (18A), capital losses carried forward (18V), dividends with franking credits, and
  foreign income with the tax offset.
- **Brokerage notice.** Shown when some trades have no brokerage recorded, with a shortcut to **Fill in by fee
  schedule**.
- **myTax reference.** The amount for each label: 18H, 18A, 18V, 11S, 11T, 11U, 20E / 20M, 20O and 10L.
- **How the net capital gain is worked out.** Gross gains split into discountable and non-discountable, losses used,
  the discount, and losses left over.
- **CGT schedule.** Each sale by parcel: acquired date, cost base, proceeds, gain or loss, and eligibility for the
  discount.
- **Dividends** for the year.
- **Open parcels.** Your unrealised gain if sold today, and the date each parcel becomes eligible for the discount.
  This is useful for timing sales.
- **Export CSV for accountant.** Downloads the summary, the CGT schedule and income in one file.

Everything is in AUD, using the exchange rate on each trade date. Rules and limitations: [TAX.md](TAX.md).

## Compare and Heatmap

**Compare** rebases several symbols to 0% at the start of the period, so their performance can be read on one
chart. The side-by-side table shows each symbol's window return, annualised volatility, max drawdown, distance from the high and range position. Symbols can come from
a watch list or your holdings.

**Heatmap** shows the S&P 100, the Nasdaq-100, a watch list or your holdings. Colour is the day's change; size is
market cap or position value. Hover a tile for details.

## Using several devices

All devices share the data on the computer that runs the app.

- To use a phone on the same Wi-Fi, start `start-phone.bat` and open the address it prints.
- Windows may ask to allow Node.js through the firewall; allow it on private networks only.
- If two devices edit at the same time, the second save is refused instead of overwriting the first. That device
  loads the newer data and shows a banner. The refused edit is kept in History, so nothing is lost.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| "Market data unavailable" | Yahoo is down or rate-limiting. The page retries transient failures automatically, and archived prices are used where possible |
| `Module not found` after an update | Close the old server window and start `start-localhost.bat` again. It reinstalls dependencies when needed |
| Warning about the Node version | Install Node.js 22.13 or newer. Older versions work without history or the price archive |
| Account return not shown | Record at least one deposit. Check the cash balance never goes negative |
| A sell is rejected | The quantity is more than you held on that date. Check for a missing buy or a split |
