# Stock Tool

Stock Tool is a personal market dashboard built for fast monitoring, chart review, watch list management, and lightweight portfolio tracking.

## Current Status

- Built with `Next.js + TypeScript + Tailwind CSS`
- Includes a multi-panel stock dashboard homepage
- Uses a server-side `Yahoo Finance` proxy through `yahoo-finance2`
- Falls back to local `mock` data when Yahoo requests fail
- Supports multilingual UI with English and Chinese

## Main Features

- Dashboard with market overview cards
- Watch Lists creation and management
- Fuzzy symbol and company search
- Stock chart with multiple timeframes
- Auto `Line / Candles` chart mode
- Moving average toggles
- Company detail panels
- 52-week price position bar
- Volume vs average volume visualization
- Watch list mini sparklines
- Multi Watch page
- Tree Map page
- Portfolio dashboard and unified per-portfolio trade log

## Run Locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env.local` if you want to adjust runtime settings:

```bash
NEXT_PUBLIC_DATA_PROVIDER=yahoo
NEXT_PUBLIC_DEFAULT_SYMBOL=AAPL
```

## Current Data Integration

- `/api/market/dashboard`: dashboard quote cards and watch list data
- `/api/market/candles?symbol=AAPL`: chart candle data for a single symbol
- `/api/market/quote?symbol=AAPL`: single-symbol quote data
- `/api/market/search?q=apple`: symbol and company search
- `/api/market/company?symbol=AAPL`: company detail data
- `/api/market/sparklines`: mini chart data for watch list rows
- `/api/market/treemap`: treemap data for indexes or custom watch lists

Technical notes:

- Charts are rendered with `lightweight-charts`
- Treemap layout uses `d3-hierarchy`
- Data is fetched through the server-side `yahoo-finance2` library
- The Yahoo-based setup is best suited for personal use rather than production-grade market infrastructure

## Market Coverage

The current symbol handling supports:

- US equities
- China A-shares
- Hong Kong equities
- Korea equities

Examples:

- `AAPL`
- `600519.SS`
- `000001.SZ`
- `0700.HK`
- `005930.KS`

## Useful Routes

- `/` — Dashboard
- `/compare` — Multi Watch
- `/treemap` — Tree Map
- `/dashboard` — Portfolio Dashboard (analytics per portfolio)
- `/portfolio` — Trade Log (unified per-portfolio ledger; same data as Workplace and Dashboard)

## Suggested Next Steps

1. Add index switching for multiple markets.
2. Add a market filter to symbol search.
3. Improve Tree Map with hover tooltips and click-through behavior.
4. Add CSV import for trade logs.
5. Replace the current Yahoo-based setup with a more official market data source if long-term public deployment is needed.
