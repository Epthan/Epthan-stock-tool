"use client";

import { useEffect, useRef, useState } from "react";
import { SYNCED_KEYS } from "@/lib/synced-keys";
import { useLanguage } from "@/components/language-provider";

/**
 * Keeps the synced localStorage keys in step with the server store so the PC and a phone
 * on the same Wi-Fi see the same portfolios, trades and watch lists.
 * - first run with an empty server: uploads this browser's data (one-time migration)
 * - otherwise: server wins on load / focus / every 30s; local writes are pushed (debounced)
 * - each push says which revision it was based on; if another device saved in between, the server refuses it,
 *   this browser loads the newer data and the refused version is kept in the server's history
 */
const keys = new Set<string>(SYNCED_KEYS);
type Store = { updatedAt: string | null; data: Record<string, string>; revs?: Record<string, number> };
export const CONFLICT_EVENT = "stock-tool-sync-conflict";

/** Server revisions this browser's data is based on. Kept in localStorage so every tab shares them. */
const revsKey = "stock-tool.sync-revs.v1";
// The original setItem, so writing the revisions doesn't itself get queued for sync.
let setItemRaw: ((key: string, value: string) => void) | null = null;
function readRevs(): Record<string, number> | null { try { return JSON.parse(window.localStorage.getItem(revsKey) ?? "null"); } catch { return null; } }
function writeRevs(revs: Record<string, number> | undefined) {
  if (!revs) return;
  try { (setItemRaw ?? ((key, value) => window.localStorage.setItem(key, value)))(revsKey, JSON.stringify(revs)); } catch { /* storage full or blocked */ }
}

let installed = false;
// True while we write server data into storage; those writes must not be pushed back.
let applying = false;
let pending: Record<string, string | null> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
// updatedAt of the last server state we applied; an unchanged server is skipped on pull.
let lastSeen: string | null = null;

function push() {
  const data = pending;
  pending = {};
  const known = readRevs();
  // No revisions yet (very first push): send none, and the server accepts the write as is.
  const revs = known ? Object.fromEntries(Object.keys(data).map((key) => [key, known[key] ?? 0])) : undefined;
  fetch("/api/store", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, revs }) })
    .then(async (response) => {
      const result = (await response.json()) as Store & { conflicts?: string[] };
      if (response.status === 409) {
        // Another device saved first: take its data. Our version is in the server history.
        lastSeen = result.updatedAt;
        writeRevs(result.revs);
        applyServerData(result.data);
        window.dispatchEvent(new CustomEvent(CONFLICT_EVENT, { detail: result.conflicts ?? [] }));
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      if (result.updatedAt) lastSeen = result.updatedAt;
      writeRevs(result.revs);
    })
    // Offline or server down: keep the changes and send them with the next write.
    // Anything queued meanwhile is newer, so it wins over the failed batch.
    .catch(() => { pending = { ...data, ...pending }; });
}

// Debounced, so typing in a form or a bulk import becomes one request.
function queue(key: string, value: string | null) {
  if (applying || !keys.has(key)) return;
  pending[key] = value;
  clearTimeout(timer);
  timer = setTimeout(push, 600);
}

// Patch Storage once so every localStorage write anywhere in the app is synced, without each
// feature having to call a sync API. Only the keys in SYNCED_KEYS are sent.
function install() {
  if (installed) return;
  installed = true;
  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  setItemRaw = (key, value) => setItem.call(window.localStorage, key, value);
  Storage.prototype.setItem = function (key: string, value: string) {
    setItem.call(this, key, value);
    if (this === window.localStorage) queue(key, value);
  };
  Storage.prototype.removeItem = function (key: string) {
    removeItem.call(this, key);
    if (this === window.localStorage) queue(key, null);
  };
}

/** Write server values into localStorage and tell the app. Returns true when anything changed. */
export function applyServerData(data: Record<string, string>, replace = false) {
  let changed = false;
  applying = true;
  try {
    for (const key of SYNCED_KEYS) {
      const next = data[key];
      const current = window.localStorage.getItem(key);
      if (next === undefined) {
        if (replace && current !== null) { window.localStorage.removeItem(key); changed = true; }
      } else if (next !== current) {
        window.localStorage.setItem(key, next);
        changed = true;
      }
    }
  } finally {
    applying = false;
  }
  if (changed) {
    // The real storage event only fires in other tabs; fire it here so this tab's hooks re-read too.
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("portfolio-selection-change"));
  }
  return changed;
}

async function pull() {
  // Unsent local changes win: pulling now would overwrite them before they reach the server.
  if (Object.keys(pending).length) return;
  const response = await fetch("/api/store", { cache: "no-store" });
  if (!response.ok) return;
  const store = (await response.json()) as Store;
  if (!store.updatedAt) {
    // Empty server: migrate whatever this browser already has.
    for (const key of SYNCED_KEYS) {
      const value = window.localStorage.getItem(key);
      if (value !== null) pending[key] = value;
    }
    if (Object.keys(pending).length) push();
    return;
  }
  if (store.updatedAt === lastSeen) return;
  lastSeen = store.updatedAt;
  writeRevs(store.revs);
  const watchlistsChanged = ["stock-tool.watchlists.v2", "stock-tool.active-watchlist-id.v2"].some(
    (key) => store.data[key] !== undefined && store.data[key] !== window.localStorage.getItem(key),
  );
  applyServerData(store.data);
  // The watch-list hook only reads storage on mount, so remount by reloading the market page.
  if (watchlistsChanged && window.location.pathname === "/") window.location.reload();
}

export function DataSync() {
  const [conflict, setConflict] = useState(false);
  const { locale } = useLanguage();
  useEffect(() => {
    const onConflict = () => setConflict(true);
    window.addEventListener(CONFLICT_EVENT, onConflict);
    return () => window.removeEventListener(CONFLICT_EVENT, onConflict);
  }, []);
  useEffect(() => {
    install();
    pull().catch(() => undefined);
    const refresh = () => { if (document.visibilityState === "visible") pull().catch(() => undefined); };
    const interval = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  if (!conflict) return null;
  const zh = locale === "zh";
  return <div className="sync-conflict" role="alert">
    <span>{zh ? "另一台设备刚刚也改了数据，已载入它保存的最新版本。你这次的修改没有丢，保存在“交易 → 历史版本”里，需要时可以恢复。" : "Another device saved changes first, so its latest data is now loaded. Your edit is kept under Trades → History and can be restored."}</span>
    <button type="button" onClick={() => setConflict(false)}>{zh ? "知道了" : "OK"}</button>
  </div>;
}

/** Download / restore a full backup of the synced data. */
export function BackupControls({ zh }: { zh: boolean }) {
  async function restore(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as { app?: string; data?: Record<string, string> };
      if (parsed.app !== "stock-tool" || !parsed.data || typeof parsed.data !== "object") throw new Error();
      if (!window.confirm(zh ? "用备份覆盖当前所有组合、交易与自选？" : "Replace all current portfolios, trades and watch lists with this backup?")) return;
      // Drop unsent local edits; the backup replaces everything anyway.
      clearTimeout(timer);
      pending = {};
      const response = await fetch("/api/store", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: parsed.data, replace: true }) });
      if (!response.ok) throw new Error();
      const saved = (await response.json()) as { updatedAt?: string; revs?: Record<string, number> };
      lastSeen = saved.updatedAt ?? null;
      writeRevs(saved.revs);
      applyServerData(parsed.data, true);
      window.location.reload(); // simplest way to make every page re-read its state
    } catch {
      window.alert(zh ? "无法读取该备份文件。" : "That file is not a valid Stock Tool backup.");
    }
  }
  const [history, setHistory] = useState(false);
  return <>
    <a className="tl-button" href="/api/store?download=1" download>{zh ? "备份数据" : "Back up"}</a>
    <button type="button" className="tl-button" onClick={() => setHistory(true)}>{zh ? "历史版本" : "History"}</button>
    {history && <HistoryDialog zh={zh} onClose={() => setHistory(false)} />}
    <label className="tl-button" style={{ cursor: "pointer" }}>{zh ? "恢复备份" : "Restore"}
      <input type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) restore(file); }} />
    </label>
  </>;
}

type SnapshotRow = { id: number; createdAt: string; reason: string; keys: number; bytes: number };
type Info = { node: string; store: { engine: "sqlite" | "json"; bytes: number; snapshots: number }; prices: { enabled: boolean; symbols: number; bars: number; lastFetch: string | null } };
const reasonLabel: Record<string, [string, string]> = {
  auto: ["Automatic", "自动保存"],
  restore: ["Before restoring a backup file", "恢复备份文件之前"],
  "before-restore": ["Before restoring a version", "恢复历史版本之前"],
  conflict: ["Edit refused — another device saved first", "被拒绝的修改（另一设备先保存了）"],
};

/** Ask the server to restore a snapshot and load the result into this browser. */
async function restoreServerVersion(id: number) {
  clearTimeout(timer);
  pending = {};
  const response = await fetch("/api/store/snapshots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  if (!response.ok) throw new Error(String(response.status));
  const state = (await response.json()) as Store;
  lastSeen = state.updatedAt;
  writeRevs(state.revs);
  applyServerData(state.data, true);
}

/** Server-side history of the synced data: restore or download any earlier version. */
function HistoryDialog({ zh, onClose }: { zh: boolean; onClose: () => void }) {
  const text = (english: string, chinese: string) => (zh ? chinese : english);
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<SnapshotRow[] | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const json = (response: Response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); };
    fetch("/api/store/snapshots", { cache: "no-store" }).then(json).then((body: { snapshots?: SnapshotRow[] }) => { if (!Array.isArray(body.snapshots)) throw new Error(); setRows(body.snapshots); })
      .catch(() => { setRows([]); setError(text("Could not load the history.", "无法读取历史版本。")); });
    fetch("/api/store/info", { cache: "no-store" }).then(json).then((body: Info) => { if (body?.store) setInfo(body); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function restoreVersion(id: number) {
    try { await restoreServerVersion(id); window.location.reload(); }
    catch { setError(text("Could not restore that version.", "无法恢复该版本。")); }
  }
  const size = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  return <dialog ref={dialog} className="pm-dialog sync-history" aria-labelledby="sync-history-title" onClose={onClose}>
    <header className="pm-studio-top"><strong id="sync-history-title">{text("Data history", "历史版本")}</strong><button type="button" className="pm-icon-button" aria-label={text("Close history", "关闭历史版本")} onClick={() => dialog.current?.close()}>×</button></header>
    <div className="sync-history-body">
      <p className="tl-muted">{info?.store.engine === "json"
        ? text(`History needs SQLite, which this Node (${info.node}) does not have. Install Node 22.13 or later to turn it on; backups still work.`, `历史版本需要 SQLite，当前 Node（${info.node}）不支持。安装 Node 22.13 或更新版本后即可开启；备份功能不受影响。`)
        : text("The server keeps a copy before changes (at most every 10 minutes while you edit) and always before a restore. Restoring saves the current data first, so it can be undone.", "服务器会在修改前自动保存一份（编辑时最多每 10 分钟一份），恢复前也一定会先保存。恢复某个版本前会先保存当前数据，所以可以撤销。")}</p>
      {info && <p className="sync-history-info">Stock Tool v{process.env.NEXT_PUBLIC_APP_VERSION} · {text("Storage", "存储")}: {info.store.engine === "sqlite" ? "SQLite" : "JSON"} · {size(info.store.bytes)}{info.prices.enabled ? ` · ${text("price archive", "价格存档")} ${info.prices.symbols} ${text("symbols", "只")} / ${info.prices.bars.toLocaleString()} ${text("bars", "条日线")}` : ""}</p>}
      {error && <p className="tl-negative" role="alert">{error}</p>}
      {rows === null ? <p className="tl-muted">{text("Loading…", "读取中…")}</p> : !rows.length ? <p className="tl-muted">{text("No earlier versions yet.", "还没有历史版本。")}</p> : <div className="tl-scroll"><table>
        <thead><tr><th className="tl-left">{text("Saved", "保存时间")}</th><th className="tl-left">{text("Why", "原因")}</th><th>{text("Size", "大小")}</th><th /></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td className="tl-left">{new Date(row.createdAt).toLocaleString(zh ? "zh-CN" : "en-AU", { dateStyle: "medium", timeStyle: "short" })}</td>
          <td className="tl-left">{(reasonLabel[row.reason] ?? [row.reason, row.reason])[zh ? 1 : 0]}</td>
          <td>{size(row.bytes)}</td>
          <td className="sync-history-actions">{confirm === row.id
            ? <><button type="button" className="tl-primary" onClick={() => restoreVersion(row.id)}>{text("Confirm restore", "确认恢复")}</button><button type="button" className="tl-row-button" onClick={() => setConfirm(null)}>{text("Cancel", "取消")}</button></>
            : <><button type="button" className="tl-row-button" onClick={() => setConfirm(row.id)}>{text("Restore", "恢复")}</button><a className="tl-row-button" href={`/api/store/snapshots?id=${row.id}`} download>{text("Download", "下载")}</a></>}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
  </dialog>;
}
