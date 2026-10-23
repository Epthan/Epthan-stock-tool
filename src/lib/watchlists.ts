import { normalizeSymbol } from "@/lib/market-symbols";
import { defaultWatchlist } from "@/lib/mock-market";

export type CustomWatchlist = {
  id: string;
  name: string;
  symbols: string[];
};

export const watchlistsStorageKey = "stock-tool.watchlists.v2";
export const activeWatchlistStorageKey = "stock-tool.active-watchlist-id.v2";
export const legacyWatchlistStorageKey = "stock-tool.watchlist";

function sanitizeSymbols(symbols: unknown) {
  if (!Array.isArray(symbols)) {
    return defaultWatchlist;
  }

  const nextSymbols = symbols
    .map((value) => (typeof value === "string" ? normalizeSymbol(value) : ""))
    .filter(Boolean);

  return nextSymbols.length > 0 ? Array.from(new Set(nextSymbols)) : defaultWatchlist;
}

export function createDefaultWatchlists() {
  return [
    {
      id: "default",
      name: "Main Watch List",
      symbols: [...defaultWatchlist],
    },
  ] satisfies CustomWatchlist[];
}

export function loadStoredWatchlists() {
  if (typeof window === "undefined") {
    return {
      watchlists: createDefaultWatchlists(),
      activeWatchlistId: "default",
    };
  }

  try {
    const raw = window.localStorage.getItem(watchlistsStorageKey);
    const activeWatchlistId = window.localStorage.getItem(activeWatchlistStorageKey) ?? "default";

    if (raw) {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed) && parsed.length > 0) {
        const watchlists = parsed
          .map((item, index) => {
            if (!item || typeof item !== "object") {
              return null;
            }

            const candidate = item as { id?: unknown; name?: unknown; symbols?: unknown };
            const id = typeof candidate.id === "string" ? candidate.id : `list-${index + 1}`;
            const name =
              typeof candidate.name === "string" && candidate.name.trim()
                ? candidate.name.trim()
                : `Watch List ${index + 1}`;

            return {
              id,
              name,
              symbols: sanitizeSymbols(candidate.symbols),
            };
          })
          .filter(Boolean) as CustomWatchlist[];

        if (watchlists.length > 0) {
          const resolvedActiveId = watchlists.some((item) => item.id === activeWatchlistId)
            ? activeWatchlistId
            : watchlists[0].id;

          return { watchlists, activeWatchlistId: resolvedActiveId };
        }
      }
    }

    const legacyRaw = window.localStorage.getItem(legacyWatchlistStorageKey);

    if (legacyRaw) {
      const symbols = sanitizeSymbols(JSON.parse(legacyRaw));
      const watchlists = [{ id: "default", name: "Main Watch List", symbols }];
      return { watchlists, activeWatchlistId: "default" };
    }
  } catch {
    // ignore malformed storage
  }

  return {
    watchlists: createDefaultWatchlists(),
    activeWatchlistId: "default",
  };
}

/** The built-in default list is stored with an English name; show it in the UI language. */
export function watchlistLabel(name: string, zh: boolean) {
  return zh && name === "Main Watch List" ? "主自选列表" : name;
}
