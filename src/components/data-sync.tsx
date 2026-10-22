"use client";

import { useEffect } from "react";
import { SYNCED_KEYS } from "@/lib/synced-keys";

/**
 * Keeps the synced localStorage keys in step with the server store so the PC and a phone
 * on the same Wi-Fi see the same portfolios, trades and watch lists.
 * - first run with an empty server: uploads this browser's data (one-time migration)
 * - otherwise: server wins on load / focus / every 30s; local writes are pushed (debounced)
 */
const keys = new Set<string>(SYNCED_KEYS);
type Store = { updatedAt: string | null; data: Record<string, string> };

let installed = false;
let applying = false;
let pending: Record<string, string | null> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSeen: string | null = null;

function push() {
  const data = pending;
  pending = {};
  fetch("/api/store", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) })
    .then((response) => response.json())
    .then((result: { updatedAt?: string }) => { if (result.updatedAt) lastSeen = result.updatedAt; })
    .catch(() => { pending = { ...data, ...pending }; });
}

function queue(key: string, value: string | null) {
  if (applying || !keys.has(key)) return;
  pending[key] = value;
  clearTimeout(timer);
  timer = setTimeout(push, 600);
}

function install() {
  if (installed) return;
  installed = true;
  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
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
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("portfolio-selection-change"));
  }
  return changed;
}

async function pull() {
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
  const watchlistsChanged = ["stock-tool.watchlists.v2", "stock-tool.active-watchlist-id.v2"].some(
    (key) => store.data[key] !== undefined && store.data[key] !== window.localStorage.getItem(key),
  );
  applyServerData(store.data);
  // The watch-list hook only reads storage on mount, so remount by reloading the market page.
  if (watchlistsChanged && window.location.pathname === "/") window.location.reload();
}

export function DataSync() {
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
  return null;
}

/** Download / restore a full backup of the synced data. */
export function BackupControls({ zh }: { zh: boolean }) {
  async function restore(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as { app?: string; data?: Record<string, string> };
      if (parsed.app !== "stock-tool" || !parsed.data || typeof parsed.data !== "object") throw new Error();
      if (!window.confirm(zh ? "用备份覆盖当前所有组合、交易与自选？" : "Replace all current portfolios, trades and watch lists with this backup?")) return;
      clearTimeout(timer);
      pending = {};
      const response = await fetch("/api/store", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: parsed.data, replace: true }) });
      if (!response.ok) throw new Error();
      lastSeen = ((await response.json()) as { updatedAt?: string }).updatedAt ?? null;
      applyServerData(parsed.data, true);
      window.location.reload();
    } catch {
      window.alert(zh ? "无法读取该备份文件。" : "That file is not a valid Stock Tool backup.");
    }
  }
  return <>
    <a className="tl-button" href="/api/store?download=1" download>{zh ? "备份数据" : "Back up"}</a>
    <label className="tl-button" style={{ cursor: "pointer" }}>{zh ? "恢复备份" : "Restore"}
      <input type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) restore(file); }} />
    </label>
  </>;
}
