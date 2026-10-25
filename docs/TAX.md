# Australian tax report

The Tax page (`/tax`) prepares the figures an Australian resident individual needs for shares held as an investment
(on capital account). Use it to check your broker's annual tax statement, or to hand a CSV to your tax agent.

> **This is not tax advice.** The report applies the general rules below to the trades and cash entries you recorded.
> It cannot know your full tax position. Check every figure against your contract notes and dividend statements, and
> ask a registered tax agent when in doubt.

The implementation is `src/lib/au-tax.ts`, with parcels in `src/lib/lots.ts`. The unit tests in
`tests/unit/au-tax.test.ts` check it against worked examples and an independent recomputation.

## Financial year

A financial year runs from 1 July to 30 June and is named by the year it ends. FY 2025 (shown as "2024–25") covers
1 July 2024 to 30 June 2025. A CGT event happens on the **contract (trade) date**, not the settlement date.

## Currency

Everything is reported in **AUD**.

- Trades in foreign shares are converted at the exchange rate on the trade date. This applies separately to the
  purchase (cost base) and to the sale (proceeds), as the ATO requires.
- Dividends and fees are converted at the rate on their payment date.
- Rates are Yahoo's daily reference rates. Your broker's statement may use slightly different rates.

## Capital gains

### Parcels

- Each buy creates a **parcel**.
- Each sale closes parcels **first-in, first-out**. One sale can close several parcels and produce several CGT events.
- For each parcel:

```
cost base        = purchase price × shares + that parcel's share of the buy brokerage
capital proceeds = sale price × shares − that parcel's share of the sell brokerage
gain / loss      = capital proceeds − cost base
```

Brokerage comes from fee entries linked to the trade. It is entered with the trade, or filled in with **Fill
brokerage**. Older fee entries without a link are matched only when they name the symbol and fall on the trade date,
and exactly one trade of that symbol (and of that side, when the note says "Buy …" or "Sell …") happened that day. If
brokerage can't be matched, the report doesn't guess: it shows a notice counting the trades without brokerage.

Splits are applied before matching. A split does not reset the acquisition date.

### The 12-month discount

A gain gets the 50% CGT discount when the parcel was owned for **at least 12 months, not counting the day of
acquisition and the day of sale**. In practice, the first eligible sale date is the acquisition date + 12 months +
1 day.

| Bought | First sale date with the discount |
| --- | --- |
| 15 Mar 2024 | 16 Mar 2025 |
| 29 Feb 2024 | 1 Mar 2025 (12 months ends on 28 Feb, plus 1 day) |

The **Open parcels** table shows this date for every parcel you still hold, so you can see what waiting would save.

### Netting losses

For each financial year:

1. Add the capital losses made this year to the net capital losses carried forward from earlier years.
2. Apply those losses first to gains that **don't** qualify for the discount, then to gains that do.
3. Halve whatever discountable gain remains.
4. Net capital gain = remaining non-discountable gains + remaining discountable gains − discount.
5. Losses that are still unused carry forward to the next year, with no time limit.

Capital losses can only offset capital gains, never other income. That is why the loss is kept and carried forward.

**Example.** In one year you have a $1,000 gain on a parcel held 2 years, a $600 gain on a parcel held 3 months, and
a $900 loss.

| Step | Non-discountable | Discountable |
| --- | --- | --- |
| Gross gains | 600 | 1,000 |
| Apply the $900 loss | 600 − 600 = 0 | 1,000 − 300 = 700 |
| 50% discount | — | 700 − 350 = 350 |
| **Net capital gain (18A)** | | **350** |

## Investment income

| Item | Rule |
| --- | --- |
| Franked dividends | Australian dividend × franked %. Enter the franked share from the dividend statement |
| Unfranked dividends | The rest of the Australian dividend |
| Franking credits | As on the statement. If left blank, the credit is worked out at the 30% company tax rate: franked amount × 30/70 |
| Foreign dividends | Grossed up by the tax withheld: assessable = cash received + withheld. The withheld amount becomes the foreign income tax offset |
| Interest | Gross interest entries in the cash ledger |

A dividend counts as foreign when the security is quoted in a currency other than AUD. An entry without a symbol
counts as foreign when it was received in a currency other than AUD.

## myTax labels

| Label | Shown as |
| --- | --- |
| 18H | Total current year capital gains, before losses and the discount |
| 18A | Net capital gain |
| 18V | Net capital losses carried forward to later income years |
| 11S | Unfranked amount |
| 11T | Franked amount |
| 11U | Franking credit |
| 20E / 20M | Assessable foreign source income (dividends grossed up for tax withheld) |
| 20O | Foreign income tax offset |
| 10L | Gross interest |

Check the label numbers against the current year's myTax screens before lodging. The ATO occasionally renames or
renumbers them.

## CSV for your accountant

**Export CSV for accountant** writes one file per financial year with three parts:

- the summary, with the label for each line;
- the CGT schedule: symbol, acquired, disposed, quantity, cost base, proceeds, gain or loss, days held, discount
  eligibility;
- the dividend list: date, symbol, type, cash, franked, unfranked, franking credit, tax withheld, assessable.

## Not covered

- Only first-in first-out parcel matching. You can't choose specific parcels for a sale.
- The 45-day holding rule for franking credits is not checked.
- Only individuals. Companies, trusts and SMSFs have different discount rates and rules.
- Shares held as trading stock (a share trader on revenue account) are not covered.
- Corporate actions other than splits: DRP (dividend reinvestment creates new parcels; record each one as a buy),
  rights issues, demergers and spin-offs, takeovers and scrip-for-scrip rollover, returns of capital, cost base
  adjustments in AMIT statements.
- Wash sales. The ATO can deny a loss from selling and quickly repurchasing; the app does not flag this.
- Foreign residents, temporary residents, and personal CGT exemptions.
- Your marginal tax rate. The report gives you income and gains, not tax payable.
