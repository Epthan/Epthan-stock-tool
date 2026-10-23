import fs from "node:fs";
import path from "node:path";
import { SYNCED_KEYS } from "@/lib/synced-keys";
import { dataDir, openDatabase, transaction, type Database } from "@/lib/server/sqlite";

/**
 * Server-side store for the synced app data (portfolios, trades, cash, watch lists).
 *
 * SQLite (data/store.db) when the running Node has it:
 *  - every key carries a revision; a write based on an older revision is refused (409) instead of silently
 *    overwriting what another device saved in the meantime
 *  - snapshots: the previous state is kept automatically (at most every 10 minutes while editing, and always
 *    before a restore or a refused write), so any earlier version can be restored
 * Falls back to data/store.json (same API, revisions, no snapshots) on Node without SQLite.
 * An existing store.json is migrated into SQLite once and kept as store.json.bak.
 */
export type StoreState = { updatedAt: string | null; data: Record<string, string>; revs: Record<string, number>; engine: "sqlite" | "json" };
export type Snapshot = { id: number; createdAt: string; reason: string; keys: number; bytes: number };
export type WriteResult = { ok: true; state: StoreState } | { ok: false; conflicts: string[]; state: StoreState };
type Changes = Record<string, string | null>;

const KEYS = new Set<string>(SYNCED_KEYS);
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const KEEP_AUTO = 100;
const KEEP_OTHER = 50;
const now = () => new Date().toISOString();
/** Keys the client changed on top of an older revision — unless it is writing exactly what is stored now. */
const staleKeys = (changes: Changes, before: StoreState, expected?: Record<string, number>) =>
  Object.keys(changes).filter((key) => expected?.[key] !== undefined && (before.revs[key] ?? 0) !== expected[key] && (changes[key] ?? null) !== (before.data[key] ?? null));

/* ------------------------------------------------------------------ */
/* SQLite                                                               */
/* ------------------------------------------------------------------ */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, rev INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, reason TEXT NOT NULL, data TEXT NOT NULL);
`;

function db(): Database | null {
  const handle = openDatabase("store", SCHEMA);
  if (handle) migrateJson(handle);
  return handle;
}

function migrateJson(handle: Database) {
  if (handle.prepare("SELECT value FROM meta WHERE key = 'migrated'").get()) return;
  const file = path.join(dataDir(), "store.json");
  transaction(handle, () => {
    if (fs.existsSync(file) && !handle.prepare("SELECT 1 FROM kv LIMIT 1").get()) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { updatedAt?: string | null; data?: Record<string, string> };
        const stamp = parsed.updatedAt ?? now();
        for (const [key, value] of Object.entries(parsed.data ?? {})) if (KEYS.has(key) && typeof value === "string") handle.prepare("INSERT INTO kv (key, value, rev, updated_at) VALUES (?, ?, 1, ?)").run(key, value, stamp);
        handle.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('updatedAt', ?)").run(stamp);
      } catch { /* unreadable JSON: start empty, the file stays where it is */ }
    }
    handle.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated', ?)").run(now());
  });
  if (fs.existsSync(file)) { try { fs.renameSync(file, `${file}.bak`); } catch { /* keep it */ } }
}

function sqliteState(handle: Database): StoreState {
  const data: Record<string, string> = {};
  const revs: Record<string, number> = {};
  for (const row of handle.prepare("SELECT key, value, rev FROM kv").all()) {
    revs[row.key as string] = Number(row.rev);
    if (row.value != null) data[row.key as string] = row.value as string;
  }
  const updatedAt = (handle.prepare("SELECT value FROM meta WHERE key = 'updatedAt'").get()?.value as string | undefined) ?? null;
  return { updatedAt, data, revs, engine: "sqlite" };
}

function snapshot(handle: Database, reason: string, data: Record<string, string>, force: boolean) {
  if (!Object.keys(data).length) return;
  if (!force) {
    const last = handle.prepare("SELECT created_at FROM snapshots WHERE reason = 'auto' ORDER BY id DESC LIMIT 1").get();
    if (last && Date.now() - Date.parse(last.created_at as string) < SNAPSHOT_EVERY_MS) return;
  }
  handle.prepare("INSERT INTO snapshots (created_at, reason, data) VALUES (?, ?, ?)").run(now(), reason, JSON.stringify(data));
  handle.prepare("DELETE FROM snapshots WHERE reason = 'auto' AND id NOT IN (SELECT id FROM snapshots WHERE reason = 'auto' ORDER BY id DESC LIMIT ?)").run(KEEP_AUTO);
  handle.prepare("DELETE FROM snapshots WHERE reason != 'auto' AND id NOT IN (SELECT id FROM snapshots WHERE reason != 'auto' ORDER BY id DESC LIMIT ?)").run(KEEP_OTHER);
}

function sqliteWrite(handle: Database, changes: Changes, options: { replace?: boolean; expected?: Record<string, number>; reason?: string }): WriteResult {
  return transaction(handle, () => {
    const before = sqliteState(handle);
    const conflicts = staleKeys(changes, before, options.expected);
    if (conflicts.length) {
      // Keep the refused version so it can be restored from the history.
      const refused = { ...before.data };
      for (const [key, value] of Object.entries(changes)) { if (value === null) delete refused[key]; else refused[key] = value; }
      snapshot(handle, "conflict", refused, true);
      return { ok: false as const, conflicts, state: before };
    }
    snapshot(handle, options.reason ?? (options.replace ? "restore" : "auto"), before.data, !!options.replace || !!options.reason);
    const stamp = now();
    const upsert = handle.prepare("INSERT INTO kv (key, value, rev, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, rev = kv.rev + 1, updated_at = excluded.updated_at");
    const final: Changes = { ...changes };
    if (options.replace) for (const key of Object.keys(before.data)) if (!(key in final)) final[key] = null;
    for (const [key, value] of Object.entries(final)) {
      if (value === (before.data[key] ?? null)) continue; // unchanged: keep the revision
      upsert.run(key, value, stamp);
    }
    handle.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('updatedAt', ?)").run(stamp);
    return { ok: true as const, state: sqliteState(handle) };
  });
}

/* ------------------------------------------------------------------ */
/* JSON fallback                                                        */
/* ------------------------------------------------------------------ */
type JsonStore = { version: 1; updatedAt: string | null; data: Record<string, string>; revs?: Record<string, number> };
const jsonFile = () => path.join(dataDir(), "store.json");
function jsonRead(): StoreState {
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonFile(), "utf8")) as JsonStore;
    return { updatedAt: parsed.updatedAt ?? null, data: parsed.data ?? {}, revs: parsed.revs ?? {}, engine: "json" };
  } catch {
    return { updatedAt: null, data: {}, revs: {}, engine: "json" };
  }
}
function jsonWrite(changes: Changes, options: { replace?: boolean; expected?: Record<string, number> }): WriteResult {
  const before = jsonRead();
  const conflicts = staleKeys(changes, before, options.expected);
  if (conflicts.length) return { ok: false, conflicts, state: before };
  const data = options.replace ? {} : { ...before.data };
  const revs = { ...before.revs };
  const final: Changes = { ...changes };
  if (options.replace) for (const key of Object.keys(before.data)) if (!(key in final)) final[key] = null;
  for (const [key, value] of Object.entries(final)) {
    if (value !== (before.data[key] ?? null)) revs[key] = (revs[key] ?? 0) + 1;
    if (value === null) delete data[key]; else data[key] = value;
  }
  const state: StoreState = { updatedAt: now(), data, revs, engine: "json" };
  fs.mkdirSync(dataDir(), { recursive: true });
  const temp = `${jsonFile()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: state.updatedAt, data, revs }, null, 2), "utf8");
  fs.renameSync(temp, jsonFile()); // atomic replace
  return { ok: true, state };
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */
export function readStore(): StoreState {
  const handle = db();
  return handle ? sqliteState(handle) : jsonRead();
}

/** Only whitelisted keys, string values up to 5 MB (null deletes). */
export function cleanChanges(input: unknown): Changes {
  const out: Changes = {};
  if (!input || typeof input !== "object") return out;
  for (const key of SYNCED_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (value === null) out[key] = null;
    else if (typeof value === "string" && value.length <= 5_000_000) out[key] = value;
  }
  return out;
}

export function writeStore(changes: Changes, options: { replace?: boolean; expected?: Record<string, number>; reason?: string } = {}): WriteResult {
  const handle = db();
  return handle ? sqliteWrite(handle, changes, options) : jsonWrite(changes, options);
}

export function listSnapshots(): Snapshot[] {
  const handle = db();
  if (!handle) return [];
  return handle.prepare("SELECT id, created_at, reason, data FROM snapshots ORDER BY id DESC LIMIT 200").all().map((row) => {
    const text = row.data as string;
    let keys = 0;
    try { keys = Object.keys(JSON.parse(text)).length; } catch { /* corrupt row */ }
    return { id: Number(row.id), createdAt: row.created_at as string, reason: row.reason as string, keys, bytes: text.length };
  });
}

export function readSnapshot(id: number): Record<string, string> | null {
  const row = db()?.prepare("SELECT data FROM snapshots WHERE id = ?").get(id);
  if (!row) return null;
  try { return JSON.parse(row.data as string) as Record<string, string>; } catch { return null; }
}

/** Replace the current data with a snapshot (the current state is snapshotted first, so this can be undone). */
export function restoreSnapshot(id: number): WriteResult | null {
  const data = readSnapshot(id);
  if (!data) return null;
  return writeStore(cleanChanges(data) as Changes, { replace: true, reason: "before-restore" });
}

export function storeInfo() {
  const handle = db();
  const file = path.join(dataDir(), handle ? "store.db" : "store.json");
  let bytes = 0;
  try { bytes = fs.statSync(file).size; } catch { /* not created yet */ }
  return { engine: handle ? "sqlite" as const : "json" as const, file, bytes, snapshots: handle ? Number(handle.prepare("SELECT COUNT(*) AS n FROM snapshots").get()?.n ?? 0) : 0 };
}
