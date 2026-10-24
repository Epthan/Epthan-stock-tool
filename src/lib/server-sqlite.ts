import fs from "node:fs";
import path from "node:path";

/**
 * Thin wrapper over Node's built-in SQLite (node:sqlite, Node 22.13+ / 23.4+ without flags).
 * No native add-on to compile, so `npm install` stays trouble-free on Windows. When the running Node
 * has no SQLite, `openDatabase` returns null and callers fall back (JSON store / no price archive).
 */
export type Statement = {
  run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
};
export type Database = { exec: (sql: string) => void; prepare: (sql: string) => Statement; close: () => void };
type SqliteModule = { DatabaseSync: new (file: string) => Database };

let sqlite: SqliteModule | null | undefined;
function loadSqlite(): SqliteModule | null {
  if (sqlite !== undefined) return sqlite;
  const emit = process.emitWarning;
  // node:sqlite prints an "experimental" warning on first load; keep the server log clean.
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes("SQLite")) return;
    return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    sqlite = (getBuiltin?.("node:sqlite") as SqliteModule | undefined) ?? null;
  } catch {
    sqlite = null;
  } finally {
    process.emitWarning = emit;
  }
  return sqlite;
}

export const dataDir = () => process.env.STOCK_TOOL_DATA_DIR || path.join(process.cwd(), "data");
export const sqliteAvailable = () => !!loadSqlite();

type Handle = { db: Database; file: string };
const handles: Map<string, Handle> = ((globalThis as { __stockToolDb?: Map<string, Handle> }).__stockToolDb ??= new Map());

/**
 * Open (or reuse) data/<name>.db and run `schema` on first open. If the file was deleted while open
 * (e.g. the data folder was cleared), a fresh database is created.
 */
export function openDatabase(name: string, schema: string): Database | null {
  const sqliteModule = loadSqlite();
  if (!sqliteModule) return null;
  const file = path.join(dataDir(), `${name}.db`);
  const hit = handles.get(name);
  if (hit && hit.file === file && fs.existsSync(file)) return hit.db;
  if (hit) { try { hit.db.close(); } catch { /* already closed */ } handles.delete(name); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqliteModule.DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;");
  db.exec(schema);
  handles.set(name, { db, file });
  return db;
}

/** Close every open database (test reset: Windows cannot delete a file that is still open). */
export function closeDatabases() {
  for (const [name, handle] of handles) { try { handle.db.close(); } catch { /* already closed */ } handles.delete(name); }
}

/** Run `work` inside a transaction (rolled back on error). */
export function transaction<T>(db: Database, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
