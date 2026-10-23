# Stock Tool — handoff

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 4 · lightweight-charts 5 · d3-hierarchy · yahoo-finance2 3.
Everything runs on one machine; the browser talks only to this app's `/api/*` routes, which talk to Yahoo.

## 1. Architecture in one picture

```
Browser (React)                          Next.js server (route handlers)                Yahoo Finance
──────────────────────────────           ─────────────────────────────────              ─────────────
localStorage  ⇄  DataSync  ⇄  /api/store  →  data/store.json
fetchCached (client cache, SWR, retry) → /api/market/*  →  lib/yahoo-finance.ts  (cache, retry, stale-if-error) → quote / chart / quoteSummary
                                         /api/market/portfolio-analysis → lib/live-portfolio.ts (+ trader-analytics, breakdowns, cash-ledger, fx, corporate-actions)
```

## 2. Data model (`src/hooks/use-portfolios.ts`, `src/lib/*`)

| Type | Where | Notes |
|---|---|---|
| `ManagedPortfolio` | `use-portfolios.ts` | `trades`, `cash`, `splits`, `baseCurrency`, `cashMode`, `demoId` |
| `PortfolioTrade` | `lib/portfolio-trades.ts` | price in the security's quote unit; optional `note`, `tags` |
| `CashEntry` | `lib/cash-ledger.ts` | deposit / withdrawal / dividend / interest / fee / tax / fx; optional `currency` |
| `StockSplit` | `lib/corporate-actions.ts` | auto-detected by `CorporateActionSync`; trades restated with `applySplits` |
| Watch lists | `lib/watchlists.ts` | `stock-tool.watchlists.v2` |

Storage keys synced to the server are listed in `lib/synced-keys.ts`. `DataSync` (mounted in `AppShell`) uploads on first run,
then the server wins on load / focus / every 30 s; local writes are pushed (debounced). Restore replaces the store.

Demo portfolios (`lib/portfolio-analytics.ts`) have no trades; the dashboard buys their fixed share counts two years ago and the
analysis route fills in the real close (`demo: true`), so demo and recorded portfolios use the same code and layout.

## 3. Analysis pipeline (`/api/market/portfolio-analysis/route.ts`)

1. Validate trades and cash; fetch daily bars + split events for every symbol (exchange-local dates, unfinished bars dropped).
2. Restate trades for splits; validate holdings.
3. Normalise minor currency units, fetch FX series, build one calendar across markets (forward-fill holidays), convert prices and trades to the ledger currency.
4. `analyzePortfolio` (`lib/live-portfolio.ts`): holdings TWR incl. income/costs, contributions, account TWR + XIRR, trade analytics (FIFO holding days, tags), risk.
5. `buildBreakdowns` (`lib/breakdowns.ts`): sector (Yahoo profile), holding period, tag attribution.

Formulas and conventions: `PORTFOLIO_DASHBOARD.md`.

## 4. File map

| Area | Files |
|---|---|
| Shell, theme, language | `components/app-shell.tsx`, `theme-provider.tsx`, `language-provider.tsx`, `app/layout.tsx` |
| Market page | `components/stock-dashboard.tsx`, `stock-chart.tsx`, `chart-lightbox.tsx`, `symbol-search-box.tsx`, `portfolio-manager.tsx` |
| Backtest | `components/backtest-panel.tsx`, `lib/backtest.ts`, `lib/real-vs-backtest.ts`, `api/market/backtest` |
| Portfolio dashboard | `components/portfolio-dashboard.tsx` (shell + demo), `live-portfolio-dashboard.tsx`, `trade-analysis.tsx`, `trader-charts.tsx`, `performance-insights.tsx`, `breakdown-table.tsx` |
| Trades page | `components/trade-ledger-view.tsx`, `portfolio-trades-dialog.tsx`, `csv-import-dialog.tsx`, `data-sync.tsx` |
| Compare / Heatmap | `components/compare-view.tsx`, `treemap-view.tsx`, `lib/treemap-data.ts` |
| States | `components/state-panel.tsx` (`StatePanel`, `ErrorState` with auto-retry), `lib/friendly-error.ts`, `app/error.tsx` |
| Calculations | `lib/live-portfolio.ts`, `trader-analytics.ts`, `trader-insights.ts`, `breakdowns.ts`, `cash-ledger.ts`, `fx.ts`, `corporate-actions.ts`, `csv-import.ts`, `portfolio-trades.ts` |
| Data access | `lib/yahoo-finance.ts` (server cache), `lib/client-cache.ts` (browser cache) |

API routes (`src/app/api`): `store`, `market/{dashboard,quote,candles,company,search,treemap,portfolio-analysis,corporate-actions,fx,backtest}`.

## 5. Styles

| File | Contents |
|---|---|
| `app/theme.css` | `--ui-*` tokens for the three skins (`html[data-skin=gray|gold|night]`), app shell, native form controls |
| `app/components.css` | Dashboard / dialogs / Market / backtest / trade-log component styles (merged from six legacy files, tokens only) |
| `app/redesign.css` | Redesigned Dashboard and Market layouts, frosted glass, mobile rules, breakdowns, states |
| `app/pages.css` | Compare and Heatmap pages, shared `pg-*` page scaffold |

Rule: colours only via `--ui-*` tokens; SVG colours through `style={{ stroke: "var(--…)" }}`. The legacy files
`portfolio-dashboard.css`, `portfolio-manager.css`, `product-refinement.css`, `backtest.css`, `trade-ledger.css`,
`trader-analytics.css`, `components/app-nav.tsx` and `api/market/sparklines` are no longer used and can be deleted.

## 6. Caching and failure handling

- Server (`lib/yahoo-finance.ts`): TTL per type (quotes 20 s, charts 1–15 min, daily 30 min, profiles 6 h), shared in-flight requests,
  3 attempts with backoff on 429 / 5xx / network errors, stale-if-error.
- Browser (`lib/client-cache.ts`): stale-while-revalidate, 3 attempts on network / 429 / 5xx.
- UI: `ErrorState` explains the failure and retries transient ones after 20 s; Market shows placeholders, never simulated prices.

## 7. Tests

- `tests/unit/*.test.ts` (vitest): positions, validation, splits, legacy import, tags, cash & FX, holdings/account returns,
  contribution reconciliation, XIRR, breakdowns, CSV import, error classification.
- `tests/smoke/app.spec.ts` (Playwright): every page with Yahoo "down", dashboard with an analysis fixture, trade log. APIs are mocked,
  nothing is written to `data/store.json`.

## 8. Known limits / next

- Corporate actions other than splits (spin-offs, mergers) are not handled.
- Dividend suggestions use Yahoo per-share amounts × shares held; withholding tax must be entered separately.
- Mobile app: plan is PWA first, then a Capacitor wrapper, reusing this UI.
