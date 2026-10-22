"use client";

import { hierarchy, treemap as buildTreemap } from "d3-hierarchy";
import { useEffect, useMemo, useState } from "react";
import { useStoredWatchlists } from "@/hooks/use-stored-watchlists";
import { useLanguage } from "@/components/language-provider";
import { timeframeLabels, type TimeframeKey } from "@/lib/mock-market";

type TreemapIndexKey = "sp100" | "nasdaq100";
type TreemapSourceMode = "index" | "watchlists";

type TreemapItem = {
  symbol: string;
  name: string;
  sector: string;
  changePercent: number;
  magnitude: number;
  price: number;
};

type TreemapResponse = {
  items: TreemapItem[];
  updatedAt?: string;
};

type TreemapNode = {
  name: string;
  children?: TreemapNode[];
  value?: number;
  symbol?: string;
  sector?: string;
  changePercent?: number;
  magnitude?: number;
  price?: number;
};

function colorForChange(value: number) {
  if (value >= 8) return "#14532d";
  if (value >= 3) return "#166534";
  if (value >= 0) return "#15803d";
  if (value <= -8) return "#7f1d1d";
  if (value <= -3) return "#991b1b";
  return "#b91c1c";
}

type TreemapViewProps = {
  initialIndex?: TreemapIndexKey;
};

export function TreemapView({ initialIndex = "sp100" }: TreemapViewProps) {
  const { messages } = useLanguage();
  const treemapMessages = messages.treemap;
  const { watchlists, activeWatchlistId } = useStoredWatchlists();
  const [activeIndex, setActiveIndex] = useState<TreemapIndexKey>(initialIndex);
  const [sourceMode, setSourceMode] = useState<TreemapSourceMode>("index");
  const [selectedWatchlistIds, setSelectedWatchlistIds] = useState<string[]>([]);
  const [activeTimeframe, setActiveTimeframe] = useState<TimeframeKey>("1D");
  const [items, setItems] = useState<TreemapItem[]>([]);
  const [message, setMessage] = useState(treemapMessages.loading);
  const [isLoading, setIsLoading] = useState(true);
  const resolvedSelectedWatchlistIds = useMemo(() => {
    if (selectedWatchlistIds.length > 0) {
      return selectedWatchlistIds;
    }

    if (watchlists.some((watchlist) => watchlist.id === activeWatchlistId)) {
      return [activeWatchlistId];
    }

    return watchlists[0] ? [watchlists[0].id] : [];
  }, [activeWatchlistId, selectedWatchlistIds, watchlists]);
  const selectedWatchlists = useMemo(
    () => watchlists.filter((watchlist) => resolvedSelectedWatchlistIds.includes(watchlist.id)),
    [resolvedSelectedWatchlistIds, watchlists],
  );
  const customSymbols = useMemo(
    () => Array.from(new Set(selectedWatchlists.flatMap((watchlist) => watchlist.symbols))),
    [selectedWatchlists],
  );
  const customSymbolsKey = useMemo(() => customSymbols.join(","), [customSymbols]);
  const title = useMemo(() => {
    if (sourceMode === "watchlists") {
      return selectedWatchlists.length > 0
        ? selectedWatchlists.map((watchlist) => watchlist.name).join(" + ")
        : treemapMessages.watchLists;
    }

    return treemapMessages.titleForIndex(activeIndex);
  }, [activeIndex, selectedWatchlists, sourceMode, treemapMessages]);

  useEffect(() => {
    let ignore = false;

    async function loadTreemap() {
      try {
        if (!ignore) {
          setIsLoading(true);
        }
        setMessage(treemapMessages.loading);
        if (sourceMode === "watchlists" && customSymbols.length === 0) {
          if (!ignore) {
            setItems([]);
            setIsLoading(false);
            setMessage(treemapMessages.noWatchListsSelected);
          }
          return;
        }

        const searchParams = new URLSearchParams({
          timeframe: activeTimeframe,
        });

        if (sourceMode === "watchlists") {
          searchParams.set("symbols", customSymbolsKey);
        } else {
          searchParams.set("index", activeIndex);
        }

        const response = await fetch(
          `/api/market/treemap?${searchParams.toString()}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as TreemapResponse;

        if (!ignore) {
          setItems(payload.items ?? []);
          setMessage(treemapMessages.loadedCompanies(payload.items?.length ?? 0));
          setIsLoading(false);
        }
      } catch {
        if (!ignore) {
          setItems([]);
          setMessage(treemapMessages.failed);
          setIsLoading(false);
        }
      }
    }

    loadTreemap();

    return () => {
      ignore = true;
    };
  }, [activeIndex, activeTimeframe, customSymbols.length, customSymbolsKey, sourceMode, treemapMessages]);

  const layout = useMemo(() => {
    const grouped = Object.values(
      items.reduce<Record<string, { name: string; children: TreemapItem[] }>>((accumulator, item) => {
        const key = item.sector || "Other";
        if (!accumulator[key]) {
          accumulator[key] = { name: key, children: [] };
        }
        accumulator[key].children.push(item);
        return accumulator;
      }, {}),
    );

    const root = hierarchy<TreemapNode>({
      name: title,
      children: grouped.map((group) => ({
        name: group.name,
        children: group.children.map((item) => ({
          ...item,
          value: item.magnitude,
        })),
      })),
    })
      .sum((item) => ("value" in item ? Number(item.value) : 0))
      .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));

    const tree = buildTreemap<TreemapNode>()
      .size([1200, 760])
      .paddingOuter(8)
      .paddingTop(28)
      .paddingInner(3)(root);

    return {
      sectorNodes: tree.children ?? [],
      companyNodes: tree.leaves(),
    };
  }, [items, title]);

  function toggleWatchlistSelection(watchlistId: string) {
    setSelectedWatchlistIds((current) =>
      current.includes(watchlistId)
        ? current.filter((item) => item !== watchlistId)
        : [...current, watchlistId],
    );
  }

  function activateWatchlistsMode() {
    if (resolvedSelectedWatchlistIds.length === 0) {
      const fallbackIds = watchlists[0] ? [watchlists[0].id] : [];

      if (fallbackIds.length > 0) {
        setSelectedWatchlistIds(fallbackIds);
      }
    }

    setSourceMode("watchlists");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.14),_transparent_24%),linear-gradient(180deg,#020617_0%,#071224_42%,#020617_100%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-6">
        <section className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.28em] text-teal-300">Treemap</p>
              <h1 className="mt-3 text-3xl font-semibold text-white">Tree Map</h1>
              <p className="mt-2 text-sm text-slate-300">
                {messages.treemap.description(title, activeTimeframe)}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSourceMode("index")}
                  className={`rounded-full px-3 py-1.5 ${
                    sourceMode === "index" ? "bg-teal-300 text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {treemapMessages.sourceIndex}
                </button>
                <button
                  type="button"
                  onClick={activateWatchlistsMode}
                  className={`rounded-full px-3 py-1.5 ${
                    sourceMode === "watchlists" ? "bg-teal-300 text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {treemapMessages.sourceWatchLists}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveIndex("sp100")}
                  disabled={sourceMode !== "index"}
                  className={`rounded-full px-3 py-1.5 ${
                    activeIndex === "sp100" && sourceMode === "index"
                      ? "bg-white text-slate-950"
                      : "bg-white/5 text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                  }`}
                >
                  {messages.treemap.sp100}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIndex("nasdaq100")}
                  disabled={sourceMode !== "index"}
                  className={`rounded-full px-3 py-1.5 ${
                    activeIndex === "nasdaq100" && sourceMode === "index"
                      ? "bg-white text-slate-950"
                      : "bg-white/5 text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                  }`}
                >
                  {messages.treemap.nasdaq100}
                </button>
              </div>
              {sourceMode === "watchlists" ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{treemapMessages.selectedWatchLists}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {watchlists.map((watchlist) => {
                      const selected = resolvedSelectedWatchlistIds.includes(watchlist.id);

                      return (
                        <label
                          key={watchlist.id}
                          className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                            selected
                              ? "border-teal-300/40 bg-teal-400/15 text-teal-100"
                              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleWatchlistSelection(watchlist.id)}
                            className="h-3.5 w-3.5 rounded border-white/15 bg-transparent text-teal-300"
                          />
                          <span>{watchlist.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 text-xs">
                {timeframeLabels.map((timeframe) => (
                  <button
                    key={timeframe}
                    type="button"
                    onClick={() => setActiveTimeframe(timeframe)}
                    className={`rounded-full px-3 py-1.5 ${
                      timeframe === activeTimeframe ? "bg-white text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    {timeframe}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-400">{message}</p>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[#07111f] p-4">
          <div className="relative overflow-x-auto">
            {isLoading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#07111f]/72 backdrop-blur-sm">
                <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-5 py-4 text-center shadow-[0_20px_60px_rgba(2,8,23,0.35)]">
                  <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-teal-300" />
                  <p className="mt-3 text-sm font-semibold text-white">{messages.treemap.loading}</p>
                  <p className="mt-1 text-xs text-slate-400">{messages.treemap.loadingHint}</p>
                </div>
              </div>
            ) : null}
            {layout.companyNodes.length > 0 ? (
              <svg viewBox="0 0 1200 760" className="h-auto w-full min-w-[900px]">
                {layout.sectorNodes.map((sectorNode) => {
                  const width = sectorNode.x1 - sectorNode.x0;
                  const height = sectorNode.y1 - sectorNode.y0;
                  const sectorName = sectorNode.data.name ?? "Other";

                  return (
                    <g key={`sector-${sectorName}-${sectorNode.x0}-${sectorNode.y0}`}>
                      <rect
                        x={sectorNode.x0}
                        y={sectorNode.y0}
                        width={width}
                        height={height}
                        rx={14}
                        fill="rgba(255,255,255,0.02)"
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth={1}
                      />
                      <text
                        x={sectorNode.x0 + 10}
                        y={sectorNode.y0 + 18}
                        fill="#94a3b8"
                        fontSize="12"
                        fontWeight="700"
                      >
                        {sectorName}
                      </text>
                    </g>
                  );
                })}
                {layout.companyNodes.map((node) => {
                  const item = node.data as Partial<TreemapItem> & { value?: number; name?: string };
                  const width = node.x1 - node.x0;
                  const height = node.y1 - node.y0;
                  const area = width * height;
                  const showSymbol = width > 48 && height > 24 && area > 2200;
                  const showDetail = width > 92 && height > 60 && area > 6200;
                  const changePercent = item.changePercent ?? 0;
                  const symbol = item.symbol ?? item.name ?? "N/A";
                  const sector = item.sector ?? "Other";

                  return (
                    <g key={`${symbol}-${sector}-${node.x0}-${node.y0}`}>
                      <rect
                        x={node.x0}
                        y={node.y0}
                        width={width}
                        height={height}
                        rx={10}
                        fill={colorForChange(changePercent)}
                        opacity={0.92}
                      />
                      {showSymbol ? (
                        <text x={node.x0 + 8} y={node.y0 + 18} fill="#f8fafc" fontSize="12" fontWeight="700">
                          {symbol}
                        </text>
                      ) : null}
                      {showDetail ? (
                        <>
                          <text x={node.x0 + 8} y={node.y0 + 34} fill="#dbeafe" fontSize="11">
                            {changePercent >= 0 ? "+" : ""}
                            {changePercent.toFixed(2)}%
                          </text>
                          <text x={node.x0 + 8} y={node.y0 + 50} fill="#e2e8f0" fontSize="10">
                            {sector}
                          </text>
                        </>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            ) : (
              <div className="flex min-h-[760px] min-w-[900px] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-slate-950/30">
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">{messages.treemap.noData}</p>
                  <p className="mt-2 text-xs text-slate-400">{messages.treemap.tryAnother}</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
