# Data and storage

All data stays on the computer that runs the app. The only outbound requests are market data from Yahoo Finance
(ticker symbols and date ranges), the S&P 100 member list from Wikipedia for the heatmap, and the web fonts the
browser loads from Google Fonts. None of them include your trades or balances.

| File | What it holds | Can it be deleted? |
| --- | --- | --- |
| `data/store.db` | Portfolios, trades, cash entries, splits, watch lists, and version history | **No.** This is your data. Back it up |
| `data/prices.db` | Archive of daily bars and split / dividend events | Yes. It is a cache and rebuilds itself |
| `data/store.json` | Fallback store when Node has no SQLite (older than 22.13) | Only after migrating to SQLite |
| `data/store.json.bak` | The old JSON store, kept after the one-time migration to SQLite | Yes, once you have checked the migration |

The folder can be moved with the `STOCK_TOOL_DATA_DIR` environment variable. The test suites use this to run against
throw-away folders. `data/` is listed in `.gitignore`, so it is never committed.

## The store

The browser keeps a working copy of the synced keys in `localStorage`, so pages render instantly and keep working
briefly offline. `DataSync` (`src/components/data-sync.tsx`) keeps that copy and the server in step:

1. **First run.** Existing browser data is uploaded once.
2. **Load, focus and every 30 seconds.** The server version is pulled. The server is the source of truth.
3. **Local change.** After a short debounce, the change is pushed with the **revision** it was based on.

Synced keys (`src/lib/synced-keys.ts`): portfolios (with their trades, cash, splits and settings), the active
portfolio, watch lists, the active watch list, and the legacy migration marker. Skin and language are per-device and
are not synced.

### Revisions and conflicts

Every key has a revision number. A write based on an older revision than the stored one is refused with
**409 Conflict**, instead of silently overwriting what another device saved. The browser then:

1. loads the current server data;
2. shows a banner;
3. keeps the refused version as a `conflict` snapshot in History, so it can still be restored.

Revisions are shared by the tabs of one browser (`stock-tool.sync-revs.v1`). Opening the app in two tabs does not
cause conflicts.

### History (snapshots)

| Reason | Saved when | Kept |
| --- | --- | --- |
| `auto` | Before a change, at most once every 10 minutes | Last 100 |
| `restore` | Before restoring a backup file | Last 50, shared by all non-auto snapshots |
| `before-restore` | Before restoring an earlier version from History | (same pool) |
| `conflict` | A write from another device was refused; its version is kept | (same pool) |

Each snapshot holds the data **as it was before** that event, so restoring it undoes the event. The exception is
`conflict`, which holds the refused version, so you can bring back an edit that lost the race.

Open **Trades → History** to download any version as JSON or restore it.

### Backup and restore

- **Back up** (`GET /api/store?download=1`) downloads `stock-tool-backup-<date>.json` with every synced key.
- **Restore** uploads such a file and replaces everything. The file is validated first: a file that isn't a valid
  backup is rejected and your data is left unchanged.

It is worth copying `data/store.db` or a backup JSON somewhere else from time to time. History lives in the same
file as the data, so it does not protect against losing the disk.

### Limits

The server accepts only the allow-listed keys. Each value must be a string of at most 5 MB, and `null` deletes a key.
Requests that aren't JSON are rejected with 400.

## Price archive

`src/lib/price-archive.ts` stores every successful daily download in `data/prices.db`. `loadDaily` in
`src/lib/yahoo-finance.ts` uses it like this:

- **History already archived.** Only the last 14 days are downloaded again and merged in.
- **Downloaded within the last 30 minutes** and covering the window. No network request at all, for example after
  a restart.
- **A new split appears**, or a re-downloaded close differs from the stored one by more than 2% (Yahoo restated its
  history). The symbol's archive is dropped and fully downloaded again.
- **Yahoo is unavailable.** The archived bars are served when they cover the requested window.

The **Data & methodology** view and `GET /api/store/info` show the store engine, the Node version and archive
statistics.

## Caching

| Layer | Behaviour |
| --- | --- |
| Server (`lib/yahoo-finance.ts`) | Per-type TTL: quotes 20 s, intraday charts 1–15 min, daily data 30 min, company profiles 6 h. Identical requests in flight are shared. 3 attempts with backoff on 429, 5xx and network errors. The last good value is served if Yahoo fails |
| Browser (`lib/client-cache.ts`) | Stale-while-revalidate. 3 attempts on network errors, 429 and 5xx |

## CSV import formats

The importer (`src/lib/csv-import.ts`) recognises header aliases for:

| Source | Notes |
| --- | --- |
| Interactive Brokers | Trades / activity statement exports |
| CommSec | Includes `Details` such as `B 100 CBA @ 115.50`; brokerage is implied from the debit amount |
| Stake | US and ASX exports |
| SelfWealth | Trade history export |
| Chinese brokers | GBK-encoded files with Chinese headers (成交日期, 证券代码, 买卖标志 …) |
| Stock Tool | This app's own trade CSV export |

You can override the column mapping, the date format (for example `DD/MM/YYYY`) and a symbol suffix such as `.AX`.

- Rows matching an existing trade (same symbol, side, date, quantity and price) are skipped as duplicates.
- Sells are replayed against your holdings.
- The import is **all or nothing**: if any row fails validation, nothing is saved.

## Storage API reference

These routes exist for the app's own use. They have no authentication; see [SECURITY.md](../SECURITY.md).

| Method and route | Purpose |
| --- | --- |
| `GET /api/store` | Current data and revisions. `?download=1` returns it as a backup file |
| `PUT /api/store` | Body `{ data, revs }` merges changed keys. A stale revision gives 409 with the current state. `{ data, replace: true }` restores a backup |
| `GET /api/store/snapshots` | List snapshots. `?id=N` downloads one |
| `POST /api/store/snapshots` | Body `{ id }` restores a snapshot |
| `GET /api/store/info` | App version, Node version, store engine, price archive statistics |
| `POST /api/store/reset` | Test servers only (`STOCK_TOOL_TEST_MODE=1`). Returns 404 otherwise |
