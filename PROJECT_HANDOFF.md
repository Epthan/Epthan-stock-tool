# Stock Tool Project Handoff

## Overview

This is a web-based US stock dashboard project focused on personal market watching and portfolio tracking.

Current stack:

- Next.js 16
- TypeScript
- Tailwind CSS
- lightweight-charts
- yahoo-finance2
- d3-hierarchy

Primary market focus:

- US equities

## Main Pages

### 1. Dashboard

Route:

- `/`

Main features:

- US market overview cards
- Watch Lists management
- Symbol/company fuzzy search
- Stock chart with multiple timeframes
- Auto `Line / Candles` mode
- Moving average toggles
- Company detail cards
- 52W position bar
- Volume vs average volume bar
- Watch list mini sparklines
- Local persistence for watch lists

Important files:

- `src/components/stock-dashboard.tsx`
- `src/components/stock-chart.tsx`
- `src/components/symbol-search-box.tsx`
- `src/lib/watchlists.ts`

### 2. Multi Watch

Route:

- `/compare`

Main features:

- Choose a watch list
- Render all symbols in that watch list
- Shared timeframe
- Shared chart mode
- Shared moving average toggles

Important file:

- `src/components/compare-view.tsx`

### 3. Tree Map

Route:

- `/treemap`

Main features:

- Source mode switch:
  - Indexes
  - Watch Lists
- Index options:
  - S&P 100
  - Nasdaq 100
- Custom treemap from one or more selected watch lists
- Sector-grouped treemap layout
- Loading overlay
- Reduced label clutter for tiny tiles

Current note:

- Watch Lists mode was recently adjusted to stop flickering by memoizing derived arrays and stabilizing request dependencies.

Important files:

- `src/components/treemap-view.tsx`
- `src/app/api/market/treemap/route.ts`
- `src/lib/treemap-data.ts`

### 4. Portfolio / Trade Log

Route:

- `/portfolio`

Main features:

- Record buy/sell trades locally in browser storage
- Fields:
  - symbol
  - side
  - quantity
  - price
  - traded date
  - note
- Calculates:
  - open positions
  - average cost
  - realized P&L
  - unrealized P&L
  - market value
- Local equity curve with timeframe selector
- Mobile-friendly layout
  - desktop table
  - mobile card list

Important file:

- `src/components/portfolio-view.tsx`

## Data Sources

### Market / Quote / Chart Data

- Yahoo Finance via `yahoo-finance2`

Relevant files:

- `src/lib/yahoo-finance.ts`
- `src/app/api/market/dashboard/route.ts`
- `src/app/api/market/candles/route.ts`
- `src/app/api/market/quote/route.ts`
- `src/app/api/market/search/route.ts`
- `src/app/api/market/company/route.ts`
- `src/app/api/market/sparklines/route.ts`

### Treemap Constituents

- S&P 100 from Wikipedia
- Nasdaq 100 from Wikipedia

Relevant file:

- `src/lib/treemap-data.ts`

## Local Storage Usage

### Watch Lists

Storage keys:

- `stock-tool.watchlists.v2`
- `stock-tool.active-watchlist-id.v2`
- legacy fallback: `stock-tool.watchlist`

Relevant file:

- `src/lib/watchlists.ts`

### Locale

Storage key:

- `stock-tool.locale.v1`

Relevant file:

- `src/components/language-provider.tsx`

### Portfolio Trades

Storage key:

- `stock-tool.portfolio-trades.v1`

Relevant file:

- `src/components/portfolio-view.tsx`

## Language System

Current behavior:

- Two-language UI
  - Chinese
  - English
- Browser default language decides initial locale
- Manual language toggle in navbar
- Selection persists in local storage

Important files:

- `src/components/language-provider.tsx`
- `src/components/app-nav.tsx`
- `src/app/layout.tsx`

## Recent UX Decisions

- Search box moved to top-right of dashboard header
- Watch Lists text standardized
- 1D / 2D default chart style is `Line`
- 5D and above default chart style is `Candles`
- Manual chart mode override remains available
- Chart legend added under charts
- Watch list row remove action changed to a small gray close icon
- Watch list sparklines follow selected timeframe, but always stay as line charts
- Treemap labels hidden for very small boxes
- Tree Map now groups companies by sector
- Portfolio page adjusted for mobile

## Known Assumptions / Calculation Rules

### Portfolio P&L

- Realized P&L uses average cost method
- Unrealized P&L uses latest fetched market price
- Data is local only, not server-backed

### Tree Map

- Tile area is based on absolute percent move magnitude
- Tile color indicates positive or negative move

## Development Status

Last verified commands:

- `npm run lint`
- `npm run build`

Both were passing at the time this handoff file was created.

## Suggested Next Steps

1. Finish full bilingual coverage for any remaining smaller labels/messages.
2. Improve Tree Map with hover tooltip and click-through to stock detail.
3. Add editing for portfolio trades.
4. Add portfolio contribution / allocation visualization.
5. Add optional import/export for watch lists and trade logs.

## Quick File Map

- `src/app/page.tsx`
- `src/app/compare/page.tsx`
- `src/app/treemap/page.tsx`
- `src/app/portfolio/page.tsx`
- `src/components/app-nav.tsx`
- `src/components/language-provider.tsx`
- `src/components/stock-dashboard.tsx`
- `src/components/stock-chart.tsx`
- `src/components/symbol-search-box.tsx`
- `src/components/compare-view.tsx`
- `src/components/treemap-view.tsx`
- `src/components/portfolio-view.tsx`
- `src/lib/watchlists.ts`
- `src/lib/yahoo-finance.ts`
- `src/lib/treemap-data.ts`

