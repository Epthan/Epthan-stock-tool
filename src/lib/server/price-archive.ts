import { openDatabase, transaction, type Database } from "@/lib/server/sqlite";

/**
 * Local archive of daily bars and split / dividend events (data/prices.db).
 * - Every successful Yahoo download is saved, so history survives restarts and Yahoo outages.
 * - Once a symbol's history is archived, only the last couple of weeks are re-downloaded.
 * - The archive is a cache: it can be deleted at any time and is rebuilt on demand.
 */
export type ArchivedBar = { day: string; date: Date; open: number | null; high: number | null; low: number | null; close: number; volume: number | null };
export type ArchivedData = { rows: ArchivedBar[]; splits: { date: string; ratio: number }[]; dividends: { date: string; amount: number }[] };
export type Coverage = { from: string; to: string; fetchedAt: string; lastDay: string | null; bars: number };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bars (symbol TEXT NOT NULL, day TEXT NOT NULL, ts INTEGER NOT NULL, open REAL, high REAL, low REAL, close REAL NOT NULL, volume REAL, PRIMARY KEY (symbol, day)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS events (symbol TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (symbol, day, kind)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS coverage (symbol TEXT PRIMARY KEY, from_day TEXT NOT NULL, to_day TEXT NOT NULL, fetched_at TEXT NOT NULL);
`;

const db = (): Database | null => {
  try { return openDatabase("prices", SCHEMA); } catch { return null; }
};

export function archiveCoverage(symbol: string): Coverage | null {
  const handle = db();
  const row = handle?.prepare("SELECT from_day, to_day, fetched_at FROM coverage WHERE symbol = ?").get(symbol);
  if (!handle || !row) return null;
  const last = handle.prepare("SELECT MAX(day) AS day, COUNT(*) AS n FROM bars WHERE symbol = ?").get(symbol);
  return { from: row.from_day as string, to: row.to_day as string, fetchedAt: row.fetched_at as string, lastDay: (last?.day as string | null) ?? null, bars: Number(last?.n ?? 0) };
}

/** Bars with period1 <= day < period2, plus events in the same window. */
export function archiveRead(symbol: string, period1: string, period2: string): ArchivedData | null {
  const handle = db();
  if (!handle) return null;
  const rows = handle.prepare("SELECT day, ts, open, high, low, close, volume FROM bars WHERE symbol = ? AND day >= ? AND day < ? ORDER BY day").all(symbol, period1, period2).map((row) => ({
    day: row.day as string, date: new Date(Number(row.ts)), open: row.open as number | null, high: row.high as number | null, low: row.low as number | null, close: row.close as number, volume: row.volume as number | null,
  }));
  const events = handle.prepare("SELECT day, kind, value FROM events WHERE symbol = ? AND day >= ? AND day < ? ORDER BY day").all(symbol, period1, period2);
  return {
    rows,
    splits: events.filter((row) => row.kind === "split").map((row) => ({ date: row.day as string, ratio: row.value as number })),
    dividends: events.filter((row) => row.kind === "dividend").map((row) => ({ date: row.day as string, amount: row.value as number })),
  };
}

export function archiveSplits(symbol: string) {
  return (db()?.prepare("SELECT day FROM events WHERE symbol = ? AND kind = 'split'").all(symbol) ?? []).map((row) => row.day as string);
}

/**
 * Save a download covering [period1, period2). `replace` clears that window first (a full download is
 * authoritative: Yahoo restates history after a split); a tail update only upserts.
 */
export function archiveWrite(symbol: string, data: ArchivedData, period1: string, period2: string, replace: boolean) {
  const handle = db();
  if (!handle) return;
  try {
    transaction(handle, () => {
      if (replace) {
        handle.prepare("DELETE FROM bars WHERE symbol = ? AND day >= ? AND day < ?").run(symbol, period1, period2);
        handle.prepare("DELETE FROM events WHERE symbol = ? AND day >= ? AND day < ?").run(symbol, period1, period2);
      }
      const bar = handle.prepare("INSERT OR REPLACE INTO bars (symbol, day, ts, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const row of data.rows) bar.run(symbol, row.day, row.date.getTime(), row.open, row.high, row.low, row.close, row.volume);
      const event = handle.prepare("INSERT OR REPLACE INTO events (symbol, day, kind, value) VALUES (?, ?, ?, ?)");
      for (const split of data.splits) event.run(symbol, split.date, "split", split.ratio);
      for (const dividend of data.dividends) event.run(symbol, dividend.date, "dividend", dividend.amount);
      const current = handle.prepare("SELECT from_day, to_day FROM coverage WHERE symbol = ?").get(symbol);
      // A tail update only extends coverage that already reaches its start.
      const from = current ? (replace && period1 < (current.from_day as string) ? period1 : current.from_day as string) : period1;
      const to = current && (current.to_day as string) > period2 ? current.to_day as string : period2;
      handle.prepare("INSERT OR REPLACE INTO coverage (symbol, from_day, to_day, fetched_at) VALUES (?, ?, ?, ?)").run(symbol, from, to, new Date().toISOString());
    });
  } catch { /* the archive is best-effort; a failed write never breaks a request */ }
}

/** Drop everything archived for a symbol (used when a new split invalidates stored prices). */
export function archiveForget(symbol: string) {
  const handle = db();
  if (!handle) return;
  for (const table of ["bars", "events", "coverage"]) handle.prepare(`DELETE FROM ${table} WHERE symbol = ?`).run(symbol);
}

export function archiveStats() {
  const handle = db();
  if (!handle) return { enabled: false as const, symbols: 0, bars: 0, lastFetch: null as string | null };
  const symbols = Number(handle.prepare("SELECT COUNT(*) AS n FROM coverage").get()?.n ?? 0);
  const bars = Number(handle.prepare("SELECT COUNT(*) AS n FROM bars").get()?.n ?? 0);
  const lastFetch = (handle.prepare("SELECT MAX(fetched_at) AS at FROM coverage").get()?.at as string | null) ?? null;
  return { enabled: true as const, symbols, bars, lastFetch };
}
