/**
 * Tiny browser-side cache for JSON API calls.
 * - fresh hit (younger than ttl): resolves immediately, no network
 * - stale hit: resolves immediately with the cached value AND refreshes in the background
 *   (pass onRefresh to receive the newer value)
 * - identical in-flight requests share one fetch
 * Only successful (2xx) responses are cached.
 */
type Entry = { at: number; data: unknown; promise?: Promise<unknown> };
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 400;

export const TTL = { quote: 15_000, intraday: 60_000, daily: 10 * 60_000, company: 6 * 60 * 60_000, analysis: 10 * 60_000, search: 5 * 60_000 };

async function load<T>(key: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = (await response.json()) as T;
  if (!response.ok) throw Object.assign(new Error((data as { message?: string })?.message ?? `Request failed (${response.status})`), { data });
  entries.set(key, { at: Date.now(), data });
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  return data;
}

export function peekCached<T>(key: string): T | undefined {
  return entries.get(key)?.data as T | undefined;
}

export function fetchCached<T>(key: string, url: string, ttl: number, init?: RequestInit, onRefresh?: (data: T) => void): Promise<T> {
  const hit = entries.get(key);
  if (hit?.data !== undefined) {
    if (Date.now() - hit.at > ttl && !hit.promise) {
      hit.promise = load<T>(key, url, init).then((data) => { onRefresh?.(data); return data; }).catch(() => hit.data).finally(() => { const current = entries.get(key); if (current) current.promise = undefined; });
    }
    return Promise.resolve(hit.data as T);
  }
  if (hit?.promise) return hit.promise as Promise<T>;
  const promise = load<T>(key, url, init).catch((error) => { entries.delete(key); throw error; });
  entries.set(key, { at: 0, data: undefined, promise });
  return promise;
}

/** Warm the cache ahead of a likely click (e.g. hovering a watch-list row). */
export function prefetchCached(key: string, url: string, ttl: number, init?: RequestInit) {
  const hit = entries.get(key);
  if (hit && (hit.promise || Date.now() - hit.at <= ttl)) return;
  fetchCached(key, url, ttl, init).catch(() => undefined);
}

export function forgetCached(key: string) {
  entries.delete(key);
}
