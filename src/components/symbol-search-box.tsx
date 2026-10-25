"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { TTL, fetchCached } from "@/lib/client-cache";
import { useLanguage } from "@/components/language-provider";
import { normalizeSymbol } from "@/lib/market-symbols";

type SearchResult = {
  symbol: string;
  name: string;
  market: string;
  marketLabel: string;
  exchange: string;
  type: string;
  delayedByMinutes: number | null;
};

type SymbolSearchBoxProps = {
  getActionLabel?: (symbol: string) => string;
  onAction?: (symbol: string) => void;
  onPick: (symbol: string) => void;
  placeholder?: string;
};

export function SymbolSearchBox({
  getActionLabel,
  onAction,
  onPick,
  placeholder,
}: SymbolSearchBoxProps) {
  const { messages } = useLanguage();
  const resolvedPlaceholder = placeholder ?? messages.search.placeholder;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  // Typing stays responsive; the request follows the deferred value rather than every keystroke.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isSearching =
    searchQuery.trim().length > 0 && deferredSearchQuery.trim() !== searchQuery.trim();

  useEffect(() => {
    const normalized = deferredSearchQuery.trim();

    if (normalized.length < 1) {
      return;
    }

    let ignore = false;

    async function loadSearchResults() {
      try {
        const payload = await fetchCached<{ results: SearchResult[] }>(`search:${normalized.toLowerCase()}`, `/api/market/search?q=${encodeURIComponent(normalized)}`, TTL.search);

        if (!ignore) {
          setSearchResults(payload.results);
        }
      } catch {
        if (!ignore) {
          setSearchResults([]);
        }
      }
    }

    loadSearchResults();

    return () => {
      ignore = true;
    };
  }, [deferredSearchQuery]);

  function handlePick(symbol: string) {
    setSearchQuery("");
    setSearchResults([]);
    onPick(normalizeSymbol(symbol));
  }

  return (
    <div className="relative z-30">
      <input
        value={searchQuery}
        onChange={(event) => {
          const nextValue = event.target.value;
          setSearchQuery(nextValue);

          if (!nextValue.trim()) {
            setSearchResults([]);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") {
            return;
          }

          event.preventDefault();

          const firstResult = searchResults[0]?.symbol;
          const typedSymbol = normalizeSymbol(searchQuery);

          if (firstResult || typedSymbol) {
            handlePick(firstResult ?? typedSymbol);
          }
        }}
        placeholder={resolvedPlaceholder}
        className="w-full rounded-[10px] border border-[var(--ui-line)] bg-[var(--ui-input)] px-4 py-3 text-sm text-[var(--ui-ink)] outline-none transition placeholder:text-[var(--ui-faint)] focus:border-[var(--ui-accent)]"
      />

      {(searchQuery.trim() || searchResults.length > 0) && (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-[10px] border border-[var(--ui-line)] bg-[var(--ui-panel)] shadow-[var(--ui-overlay)] ">
          {isSearching ? (
            <div className="px-4 py-3 text-sm text-[var(--ui-muted)]">{messages.search.searching}</div>
          ) : searchResults.length > 0 ? (
            searchResults.map((result) => (
              <div
                key={`${result.symbol}-${result.exchange}`}
                className="flex items-center justify-between border-b border-[var(--ui-line)] px-4 py-3 last:border-b-0"
              >
                <button type="button" onClick={() => handlePick(result.symbol)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--ui-ink)]">{result.symbol}</p>
                    <span className="rounded-full bg-[var(--ui-panel-2)] px-2 py-0.5 text-[10px] text-[var(--ui-ink-2)]">
                      {result.marketLabel}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--ui-muted)]">{result.name}</p>
                </button>
                <div className="ml-3 flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-xs text-[var(--ui-faint)]">{result.type}</p>
                    <p className="mt-1 text-xs text-[var(--ui-muted)]">{result.exchange}</p>
                    {result.delayedByMinutes ? (
                      <p className="mt-1 text-[11px] text-[var(--ui-faint)]">Delayed {result.delayedByMinutes}m</p>
                    ) : null}
                  </div>
                  {onAction ? (
                    <button
                      type="button"
                      onClick={() => {
                        const actionLabel = getActionLabel?.(result.symbol) ?? "Add";
                        onAction(result.symbol);

                        if (actionLabel === "Add") {
                          handlePick(result.symbol);
                        }
                      }}
                      className={`rounded-full px-3 py-1.5 text-xs ${ (getActionLabel?.(result.symbol) ?? "Add") === "Remove" ? "bg-[var(--ui-panel-2)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-seg)]" : "bg-[var(--ui-accent-soft)] text-[var(--ui-accent)] hover:bg-[var(--ui-accent-soft)]" }`}
                    >
                      {getActionLabel?.(result.symbol) ?? "Add"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-[var(--ui-muted)]">{messages.search.noSymbols}</div>
          )}
        </div>
      )}
    </div>
  );
}
