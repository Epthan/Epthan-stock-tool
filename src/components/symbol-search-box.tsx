"use client";

import { useDeferredValue, useEffect, useState } from "react";
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
        const response = await fetch(`/api/market/search?q=${encodeURIComponent(normalized)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as { results: SearchResult[] };

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
        className="w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40 focus:bg-slate-950/80"
      />

      {(searchQuery.trim() || searchResults.length > 0) && (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#06101d]/95 shadow-[0_20px_60px_rgba(2,8,23,0.5)] backdrop-blur">
          {isSearching ? (
            <div className="px-4 py-3 text-sm text-slate-400">{messages.search.searching}</div>
          ) : searchResults.length > 0 ? (
            searchResults.map((result) => (
              <div
                key={`${result.symbol}-${result.exchange}`}
                className="flex items-center justify-between border-b border-white/6 px-4 py-3 last:border-b-0"
              >
                <button type="button" onClick={() => handlePick(result.symbol)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{result.symbol}</p>
                    <span className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                      {result.marketLabel}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-400">{result.name}</p>
                </button>
                <div className="ml-3 flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{result.type}</p>
                    <p className="mt-1 text-xs text-slate-400">{result.exchange}</p>
                    {result.delayedByMinutes ? (
                      <p className="mt-1 text-[11px] text-slate-500">Delayed {result.delayedByMinutes}m</p>
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
                      className={`rounded-full px-3 py-1.5 text-xs ${
                        (getActionLabel?.(result.symbol) ?? "Add") === "Remove"
                          ? "bg-white/8 text-slate-200 hover:bg-white/12"
                          : "bg-teal-400/15 text-teal-200 hover:bg-teal-400/25"
                      }`}
                    >
                      {getActionLabel?.(result.symbol) ?? "Add"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-slate-400">{messages.search.noSymbols}</div>
          )}
        </div>
      )}
    </div>
  );
}
