"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartLightbox } from "@/components/chart-lightbox";
import { PortfolioManager } from "@/components/portfolio-manager";
import { BacktestPanel } from "@/components/backtest-panel";
import { useStoredWatchlists } from "@/hooks/use-stored-watchlists";
import { usePortfolios } from "@/hooks/use-portfolios";
import { useLanguage } from "@/components/language-provider";
import { StockChart, type ChartStyle } from "@/components/stock-chart";
import { useStockSelection } from "@/components/stock-selection-provider";
import {
  mockIndexes,
  mockMarketBreadth,
  mockProviderPlan,
  mockWatchlist,
  movingAverageLabels,
  timeframeLabels,
  type CandlePoint,
  type MovingAverageKey,
  type QuoteCard,
  type TimeframeKey,
  type Trend,
  type WatchlistRow,
} from "@/lib/mock-market";
import {
  activeWatchlistStorageKey,
  createDefaultWatchlists,
  watchlistsStorageKey,
} from "@/lib/watchlists";

type DashboardResponse = {
  provider: string;
  mode: "mock" | "live";
  indexes: QuoteCard[];
  watchlist: WatchlistRow[];
  marketBreadth: {
    advance: number;
    decline: number;
    highs52w: number;
    lows52w: number;
  };
  isLive: boolean;
  message: string;
};

type CandleResponse = {
  provider: string;
  mode: "mock" | "live";
  symbol: string;
  timeframe: TimeframeKey;
  candles: CandlePoint[];
  isLive: boolean;
  message: string;
};

type QuoteResponse = {
  provider: string;
  mode: "mock" | "live";
  quote: WatchlistRow;
};

type SparklineResponse = {
  provider: string;
  mode: "mock" | "live";
  timeframe: TimeframeKey;
  sparklines: Record<string, CandlePoint[] | { time: number; close: number }[]>;
  isLive: boolean;
  message: string;
};

type CompanyDetail = {
  shortName: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  beta: number | null;
  averageVolume: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
  targetMeanPrice: number | null;
  recommendationKey: string;
  recommendationMean: number | null;
  analystCount: number | null;
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  profitMargins: number | null;
  returnOnEquity: number | null;
  debtToEquity: number | null;
};

type CompanyResponse = {
  symbol: string;
  company: CompanyDetail;
};

type WatchlistSortMode = "symbol-asc" | "symbol-desc" | "change-desc" | "change-asc" | "custom";
type ChartMode = "auto" | ChartStyle;

const defaultMovingAverages: MovingAverageKey[] = [20, 50];

function getRecommendedChartStyle(timeframe: TimeframeKey): ChartStyle {
  return timeframe === "1D" || timeframe === "2D" ? "line" : "candles";
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toString();
}

function formatLargeNumber(value: number | null) {
  if (value === null) return "--";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toFixed(2);
}

function formatNullableNumber(value: number | null, digits = 2) {
  return value === null ? "--" : value.toFixed(digits);
}

function formatRatioPercent(value: number | null) {
  return value === null ? "--" : `${(value * 100).toFixed(2)}%`;
}

function formatRecommendation(value: string) {
  return value
    .split(/[_-]/)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getRangePosition(value: number | null, low: number | null, high: number | null) {
  if (value === null || low === null || high === null || high <= low) {
    return null;
  }

  return clamp(((value - low) / (high - low)) * 100, 0, 100);
}

function getVolumeRatio(volume: number | null, averageVolume: number | null) {
  if (!volume || !averageVolume || averageVolume <= 0) {
    return null;
  }

  return volume / averageVolume;
}

function getSignalTone(value: number | null, thresholds: { strong: number; weak: number }, inverse = false) {
  if (value === null) {
    return {
      label: "N/A",
      className: "bg-white/5 text-slate-300 ring-1 ring-white/10",
    };
  }

  const effective = inverse ? -value : value;
  const strong = inverse ? -thresholds.weak : thresholds.strong;
  const weak = inverse ? -thresholds.strong : thresholds.weak;

  if (effective >= strong) {
    return {
      label: "Strong",
      className: "bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-400/20",
    };
  }

  if (effective <= weak) {
    return {
      label: "Weak",
      className: "bg-rose-500/12 text-rose-300 ring-1 ring-rose-400/20",
    };
  }

  return {
    label: "Neutral",
    className: "bg-amber-500/12 text-amber-200 ring-1 ring-amber-400/20",
  };
}

function TrendPill({ trend, children }: { trend: Trend; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        trend === "up"
          ? "bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-400/20"
          : "bg-rose-500/12 text-rose-300 ring-1 ring-rose-400/20"
      }`}
    >
      {children}
    </span>
  );
}

function MetricSignal({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: { label: string; className: string };
}) {
  const { locale } = useLanguage();
  const translatedTone = locale === "zh" ? ({ Strong: "较强", Weak: "较弱", Neutral: "中性", "N/A": "暂无" }[tone.label] ?? tone.label) : tone.label;
  return (
    <article className="rounded-2xl bg-slate-950/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-500">{label}</p>
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone.className}`}>
          {translatedTone}
        </span>
      </div>
      <p className="mt-3 text-xl font-semibold text-white">{value}</p>
    </article>
  );
}

function RangePositionBar({
  current,
  low,
  high,
}: {
  current: number | null;
  low: number | null;
  high: number | null;
}) {
  const { locale } = useLanguage();
  const position = getRangePosition(current, low, high);

  return (
    <div className="rounded-2xl bg-slate-950/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-500">{locale === "zh" ? "52 周价格位置" : "52W price position"}</p>
        <p className="text-xs text-slate-400">{position === null ? "--" : `${position.toFixed(0)}%${locale === "zh" ? " · 区间位置" : " of range"}`}</p>
      </div>
      <div className="mt-4">
        <div className="relative h-3 rounded-full bg-white/8">
          <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-400/75 via-amber-300/70 to-emerald-400/75" style={{ width: "100%" }} />
          {position !== null ? (
            <div className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-slate-950 shadow-[0_0_0_4px_rgba(15,23,42,0.5)]" style={{ left: `${position}%` }}>
              <div className="absolute inset-1 rounded-full bg-white" />
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>{formatNullableNumber(low)}</span>
          <span className="text-white">{formatNullableNumber(current)}</span>
          <span>{formatNullableNumber(high)}</span>
        </div>
      </div>
    </div>
  );
}

function VolumeStrengthBar({
  volume,
  averageVolume,
}: {
  volume: number | null;
  averageVolume: number | null;
}) {
  const { locale } = useLanguage();
  const ratio = getVolumeRatio(volume, averageVolume);
  const width = ratio === null ? 0 : clamp(ratio * 50, 6, 100);
  const trend = ratio !== null && ratio >= 1 ? "up" : "down";

  return (
    <div className="rounded-2xl bg-slate-950/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-500">{locale === "zh" ? "成交量对比均量" : "Volume vs average"}</p>
        <p className="text-xs text-slate-400">{ratio === null ? "--" : `${ratio.toFixed(2)}${locale === "zh" ? " 倍均量" : "× avg"}`}</p>
      </div>
      <div className="mt-4 h-3 rounded-full bg-white/8">
        <div
          className={`h-full rounded-full ${trend === "up" ? "bg-gradient-to-r from-teal-400 to-emerald-300" : "bg-gradient-to-r from-slate-500 to-slate-300"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>{locale === "zh" ? "当日" : "Today"} {volume ? formatVolume(volume) : "--"}</span>
        <span>{locale === "zh" ? "平均" : "Avg"} {averageVolume ? formatVolume(averageVolume) : "--"}</span>
      </div>
    </div>
  );
}

function MiniSparkline({
  points,
  trend,
}: {
  points: { time: number; close: number }[];
  trend: Trend;
}) {
  if (points.length < 2) {
    return <div className="h-12 w-20 shrink-0 rounded-xl bg-white/5" />;
  }

  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 100 - ((point.close - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-12 w-20 shrink-0 overflow-visible">
      <polyline
        fill="none"
        stroke={trend === "up" ? "#34d399" : "#fb7185"}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={path}
      />
    </svg>
  );
}

type StockDashboardProps = {
  defaultSymbol: string;
};

function createWatchlistId() {
  return `list-${Date.now()}`;
}

export function StockDashboard({ defaultSymbol }: StockDashboardProps) {
  const { locale, messages } = useLanguage();
  const { selectedSymbol: globalSelectedSymbol, pickSymbol } = useStockSelection();
  const noDataMessage = messages.common.noData;
  const { watchlists, setWatchlists, activeWatchlistId, setActiveWatchlistId } = useStoredWatchlists();
  const { portfolios, activePortfolio, selectPortfolio, removeSymbol } = usePortfolios();
  const [listSource, setListSource] = useState<"watchlist" | "portfolio">("watchlist");
  const activeWatchlist = useMemo(() => listSource === "portfolio"
    ? { id: activePortfolio.id, name: locale === "zh" ? activePortfolio.nameZh ?? activePortfolio.name : activePortfolio.name, symbols: activePortfolio.symbols }
    : watchlists.find((item) => item.id === activeWatchlistId) ?? watchlists[0] ?? createDefaultWatchlists()[0], [listSource, activePortfolio, locale, watchlists, activeWatchlistId]);
  const selectedSymbol = globalSelectedSymbol ?? (activeWatchlist.symbols.includes(defaultSymbol) ? defaultSymbol : (activeWatchlist.symbols[0] ?? defaultSymbol));
  const resolvedSelectedSymbol = selectedSymbol || activeWatchlist.symbols[0] || defaultSymbol;
  const [activeTimeframe, setActiveTimeframe] = useState<TimeframeKey>("6M");
  const [enabledMovingAverages, setEnabledMovingAverages] =
    useState<MovingAverageKey[]>(defaultMovingAverages);
  const [dashboard, setDashboard] = useState<DashboardResponse>({
    provider: mockProviderPlan.provider,
    mode: "mock",
    indexes: mockIndexes,
    watchlist: mockWatchlist,
    marketBreadth: mockMarketBreadth,
    isLive: false,
    message: messages.common.loading,
  });
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [loadedChartSymbol, setLoadedChartSymbol] = useState("");
  const chartCandles = loadedChartSymbol === resolvedSelectedSymbol ? candles : [];
  const [chartMeta, setChartMeta] = useState({
    mode: "mock" as "mock" | "live",
    message: messages.common.loading,
  });
  const [isLoadingChart, setIsLoadingChart] = useState(true);
  const [selectedSearchQuote, setSelectedSearchQuote] = useState<WatchlistRow | null>(null);
  const [companyResponse, setCompanyDetail] = useState<CompanyResponse | null>(null);
  const companyDetail = companyResponse?.symbol === resolvedSelectedSymbol ? companyResponse.company : null;
  const [sparklines, setSparklines] = useState<Record<string, { time: number; close: number }[]>>({});
  const [watchlistFilter, setWatchlistFilter] = useState("");
  const [watchlistSortMode, setWatchlistSortMode] = useState<WatchlistSortMode>("symbol-asc");
  const [draggedSymbol, setDraggedSymbol] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("auto");
  const [isChartLightboxOpen, setIsChartLightboxOpen] = useState(false);
  const [mobileView, setMobileView] = useState("chart");
  const [workplaceView, setWorkplaceView] = useState<"research" | "backtest">("research");
  const watchlistMenu = useRef<HTMLDetailsElement>(null);
  const [watchlistNotice, setWatchlistNotice] = useState("");
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !watchlistMenu.current?.contains(event.target)) watchlistMenu.current?.removeAttribute("open");
    }
    function closeEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && watchlistMenu.current?.open) {
        watchlistMenu.current.removeAttribute("open");
        watchlistMenu.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, []);
  const [chartRetry, setChartRetry] = useState(0);

  const handleSymbolPick = useCallback((symbol: string) => {
    if (symbol === resolvedSelectedSymbol) return;
    pickSymbol(symbol);
    setCandles([]);
    setCompanyDetail(null);
    setMobileView("chart");
    setIsLoadingChart(true);
    setSelectedSearchQuote(null);
  }, [pickSymbol, resolvedSelectedSymbol]);

  useEffect(() => {
    window.localStorage.setItem(watchlistsStorageKey, JSON.stringify(watchlists));
    window.localStorage.setItem(activeWatchlistStorageKey, activeWatchlistId);
  }, [activeWatchlistId, watchlists]);

  useEffect(() => {
    let ignore = false;

    async function loadDashboard() {
      try {
        const response = await fetch(
          `/api/market/dashboard?symbols=${encodeURIComponent(activeWatchlist.symbols.join(","))}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as DashboardResponse;

        if (!ignore) {
          setDashboard(payload);
        }
      } catch {
        if (!ignore) {
          setDashboard((current) => ({
            ...current,
            message: noDataMessage,
          }));
        }
      }
    }

    if (activeWatchlist.symbols.length > 0) {
      loadDashboard();
      const interval = window.setInterval(loadDashboard, 15000);

      return () => {
        ignore = true;
        window.clearInterval(interval);
      };
    }

    return () => {
      ignore = true;
    };
  }, [activeWatchlist.symbols, noDataMessage]);

  useEffect(() => {
    let ignore = false;

    async function loadSparklines() {
      try {
        const response = await fetch(
          `/api/market/sparklines?symbols=${encodeURIComponent(activeWatchlist.symbols.join(","))}&timeframe=${activeTimeframe}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error("Failed to load sparklines");
        }

        const payload = (await response.json()) as SparklineResponse;

        if (!ignore) {
          setSparklines(payload.sparklines);
        }
      } catch {
        if (!ignore) {
          setSparklines({});
        }
      }
    }

    if (activeWatchlist.symbols.length > 0) {
      loadSparklines();
    }

    return () => {
      ignore = true;
    };
  }, [activeTimeframe, activeWatchlist.symbols]);

  useEffect(() => {
    let ignore = false;

    async function loadCandles() {
      try {
        const response = await fetch(
          `/api/market/candles?symbol=${resolvedSelectedSymbol}&timeframe=${activeTimeframe}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as CandleResponse;
        if (!response.ok || payload.mode !== "live") throw new Error("Chart data unavailable");

        if (!ignore) {
          setCandles(payload.candles);
          setLoadedChartSymbol(resolvedSelectedSymbol);
          setChartMeta({ mode: payload.mode, message: payload.message });
        }
      } catch {
        if (!ignore) {
          setCandles([]);
          setChartMeta({ mode: "mock", message: noDataMessage });
        }
      } finally {
        if (!ignore) {
          setIsLoadingChart(false);
        }
      }
    }

    loadCandles();

    return () => {
      ignore = true;
    };
  }, [activeTimeframe, chartRetry, noDataMessage, resolvedSelectedSymbol]);

  useEffect(() => {
    const existsInWatchlist = dashboard.watchlist.some((item) => item.symbol === resolvedSelectedSymbol);

    if (existsInWatchlist) {
      return;
    }

    let ignore = false;

    async function loadSelectedQuote() {
      try {
        const response = await fetch(`/api/market/quote?symbol=${encodeURIComponent(resolvedSelectedSymbol)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Failed to load selected quote");
        }

        const payload = (await response.json()) as QuoteResponse;

        if (!ignore) {
          setSelectedSearchQuote(payload.quote);
        }
      } catch {
        if (!ignore) {
          setSelectedSearchQuote(null);
        }
      }
    }

    loadSelectedQuote();

    return () => {
      ignore = true;
    };
  }, [dashboard.watchlist, resolvedSelectedSymbol]);

  useEffect(() => {
    let ignore = false;

    async function loadCompanyDetail() {
      try {
        const response = await fetch(`/api/market/company?symbol=${encodeURIComponent(resolvedSelectedSymbol)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Failed to load company detail");
        }

        const payload = (await response.json()) as CompanyResponse;

        if (!ignore) {
          setCompanyDetail(payload);
        }
      } catch {
        if (!ignore) {
          setCompanyDetail(null);
        }
      }
    }

    loadCompanyDetail();

    return () => {
      ignore = true;
    };
  }, [resolvedSelectedSymbol]);

  const selectedQuote = useMemo(() => {
    return (
      dashboard.watchlist.find((item) => item.symbol === resolvedSelectedSymbol) ??
      selectedSearchQuote
    );
  }, [dashboard.watchlist, resolvedSelectedSymbol, selectedSearchQuote]);
  const selectedRangePosition = getRangePosition(
    selectedQuote?.price ?? null,
    companyDetail?.fiftyTwoWeekLow ?? null,
    companyDetail?.fiftyTwoWeekHigh ?? null,
  );
  const selectedVolumeRatio = getVolumeRatio(
    selectedQuote?.volume ?? null,
    companyDetail?.averageVolume ?? null,
  );
  const valuationTone = getSignalTone(companyDetail?.forwardPE ?? null, { strong: 20, weak: 35 }, true);
  const growthTone = getSignalTone(companyDetail?.revenueGrowth ?? null, { strong: 0.12, weak: 0.04 });
  const qualityTone = getSignalTone(companyDetail?.returnOnEquity ?? null, { strong: 0.18, weak: 0.08 });
  const leverageTone = getSignalTone(companyDetail?.debtToEquity ?? null, { strong: 80, weak: 160 }, true);
  const resolvedChartStyle = chartMode === "auto" ? getRecommendedChartStyle(activeTimeframe) : chartMode;


  const filteredAndSortedWatchlist = useMemo(() => {
    const orderMap = new Map(activeWatchlist.symbols.map((symbol, index) => [symbol, index]));
    const normalizedFilter = watchlistFilter.trim().toUpperCase();
    const filtered = dashboard.watchlist.filter((item) => {
      if (!activeWatchlist.symbols.includes(item.symbol)) return false;
      if (!normalizedFilter) {
        return true;
      }

      return (
        item.symbol.toUpperCase().includes(normalizedFilter) ||
        item.name.toUpperCase().includes(normalizedFilter) ||
        item.market.toUpperCase().includes(normalizedFilter) ||
        item.exchange.toUpperCase().includes(normalizedFilter) ||
        item.currency.toUpperCase().includes(normalizedFilter)
      );
    });

    const sorted = [...filtered];

    switch (watchlistSortMode) {
      case "symbol-asc":
        sorted.sort((left, right) => left.symbol.localeCompare(right.symbol));
        break;
      case "symbol-desc":
        sorted.sort((left, right) => right.symbol.localeCompare(left.symbol));
        break;
      case "change-desc":
        sorted.sort((left, right) => right.changePercent - left.changePercent);
        break;
      case "change-asc":
        sorted.sort((left, right) => left.changePercent - right.changePercent);
        break;
      case "custom":
        sorted.sort((left, right) => (orderMap.get(left.symbol) ?? 999) - (orderMap.get(right.symbol) ?? 999));
        break;
    }

    return sorted;
  }, [activeWatchlist.symbols, dashboard.watchlist, watchlistFilter, watchlistSortMode]);



  function handleChartTimeframeChange(nextTimeframe: TimeframeKey) {
    if (nextTimeframe === activeTimeframe) {
      return;
    }

    setIsLoadingChart(true);
    setActiveTimeframe(nextTimeframe);
  }

  function removeFromActiveWatchlist(symbol: string) {
    const nextSymbol = activeWatchlist.symbols.find((item) => item !== symbol);
    if (listSource === "portfolio") {
      removeSymbol(activePortfolio.id, symbol);
      if (selectedSymbol === symbol && nextSymbol) handleSymbolPick(nextSymbol);
      return;
    }

    setWatchlists((current) =>
      current.map((list) => {
        if (list.id !== activeWatchlistId || list.symbols.length <= 1) {
          return list;
        }

        return {
          ...list,
          symbols: list.symbols.filter((item) => item !== symbol),
        };
      }),
    );

    if (selectedSymbol === symbol && nextSymbol) {
      handleSymbolPick(nextSymbol);
    }
  }

  function createWatchlist() {
    const name = window.prompt(
      messages.dashboard.promptNewWatchList,
      messages.dashboard.defaultWatchListName(watchlists.length + 1),
    )?.trim();

    if (!name) {
      return;
    }

    const newList = {
      id: createWatchlistId(),
      name,
      symbols: [selectedSymbol],
    };

    setWatchlists((current) => [...current, newList]);
    setListSource("watchlist");
    setActiveWatchlistId(newList.id);
  }

  function renameWatchlist() {
    const name = window.prompt(messages.dashboard.promptRenameWatchList, activeWatchlist.name)?.trim();

    if (!name) {
      return;
    }

    setWatchlists((current) =>
      current.map((list) => (list.id === activeWatchlistId ? { ...list, name } : list)),
    );
  }

  function deleteWatchlist() {
    if (watchlists.length <= 1) {
      return;
    }

    const confirmed = window.confirm(messages.dashboard.confirmDeleteWatchList(activeWatchlist.name));

    if (!confirmed) {
      return;
    }

    const nextWatchlists = watchlists.filter((list) => list.id !== activeWatchlistId);
    setWatchlists(nextWatchlists);
    setActiveWatchlistId(nextWatchlists[0].id);
  }

  function toggleMovingAverage(period: MovingAverageKey) {
    setEnabledMovingAverages((current) =>
      current.includes(period) ? current.filter((item) => item !== period) : [...current, period],
    );
  }

  function reorderActiveWatchlist(fromSymbol: string, toSymbol: string) {
    if (fromSymbol === toSymbol) {
      return;
    }

    setWatchlists((current) =>
      current.map((list) => {
        if (list.id !== activeWatchlistId) {
          return list;
        }

        const nextSymbols = [...list.symbols];
        const fromIndex = nextSymbols.indexOf(fromSymbol);
        const toIndex = nextSymbols.indexOf(toSymbol);

        if (fromIndex === -1 || toIndex === -1) {
          return list;
        }

        const [moved] = nextSymbols.splice(fromIndex, 1);
        nextSymbols.splice(toIndex, 0, moved);

        return {
          ...list,
          symbols: nextSymbols,
        };
      }),
    );
  }

  return (
    <main className="workplace-page min-h-screen bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.14),_transparent_24%),linear-gradient(180deg,#020617_0%,#071224_42%,#020617_100%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="wp-heading"><div><h1>{locale === "zh" ? "市场工作台" : "Market Workplace"}</h1><nav aria-label={locale === "zh" ? "市场工具" : "Market tools"}><button aria-pressed={workplaceView === "research"} onClick={() => setWorkplaceView("research")}>{locale === "zh" ? "行情研究" : "Research"}</button><button aria-pressed={workplaceView === "backtest"} onClick={() => { setWorkplaceView("backtest"); setIsChartLightboxOpen(false); }}>{locale === "zh" ? "策略回测" : "Backtest"}</button><Link href="/compare">{locale === "zh" ? "多股比较" : "Compare"}</Link><Link href="/treemap">{locale === "zh" ? "市场热力图" : "Heatmap"}</Link></nav></div><PortfolioManager onPick={handleSymbolPick} /></header>
        {workplaceView === "backtest" ? <BacktestPanel key={resolvedSelectedSymbol} symbol={resolvedSelectedSymbol} /> : <>
        <div className="wp-market-status">{locale === "zh" ? "市场概览" : "Market overview"} · {dashboard.isLive ? (locale === "zh" ? "Yahoo 行情快照" : "Yahoo quote snapshot") : (locale === "zh" ? "演示数据 · 非实时行情" : "Demo data · not live prices")}</div>
        <section className="wp-market-strip grid gap-4 xl:grid-cols-4">
          {dashboard.indexes.map((index) => (
            <article
              key={index.symbol}
              className="rounded-[24px] border border-white/8 bg-white/5 p-5 backdrop-blur transition hover:border-teal-300/30 hover:bg-white/8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{index.symbol}</p>
                  <p className="mt-1 text-xs text-slate-400">{index.name}</p>
                </div>
                <TrendPill trend={index.trend}>{formatPercent(index.changePercent)}</TrendPill>
              </div>
              <p className="mt-6 text-3xl font-semibold tracking-tight text-white">{formatPrice(index.price)}</p>
              <p className={index.trend === "up" ? "mt-2 text-sm text-emerald-300" : "mt-2 text-sm text-rose-300"}>
                {formatSigned(index.change)} today
              </p>
            </article>
          ))}
        </section>

        <nav className="wp-mobile-tabs" aria-label={locale === "zh" ? "工作台视图" : "Workplace views"}>{[["chart", locale === "zh" ? "图表" : "Chart"], ["watchlist", locale === "zh" ? "自选" : "Watchlist"], ["details", locale === "zh" ? "公司资料" : "Company"]].map(([value, label]) => <button key={value} aria-pressed={mobileView === value} onClick={() => setMobileView(value)}>{label}</button>)}</nav>
        <section className="wp-grid" data-mobile-view={mobileView}>
          <aside className="wp-watchlist rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{messages.dashboard.watchLists}</p>
                  <p className="mt-1 text-xs text-slate-400">{locale === "zh" ? "关注列表，不代表实际持仓" : "Followed securities, not investment positions"}</p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
                  {watchlists.length + portfolios.length} {locale === "zh" ? "个列表" : "lists"}
                </div>
              </div>

              <select
                aria-label={locale === "zh" ? "选择自选列表或投资组合" : "Select watchlist or portfolio"}
                value={`${listSource}:${listSource === "portfolio" ? activePortfolio.id : activeWatchlistId}`}
                onChange={(event) => {
                  const [source, ...parts] = event.target.value.split(":");
                  const id = parts.join(":");
                  setWatchlistFilter("");
                  if (source === "portfolio") { setListSource("portfolio"); selectPortfolio(id); }
                  else { setListSource("watchlist"); setActiveWatchlistId(id); }
                }}
                className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none"
              >
                <optgroup label={locale === "zh" ? "自选列表" : "Watch lists"}>{watchlists.map((list) => (
                  <option key={list.id} value={`watchlist:${list.id}`}>
                    {list.name}
                  </option>
                ))}</optgroup>
                <optgroup label={locale === "zh" ? "投资组合" : "Portfolios"}>{portfolios.map((portfolio) => <option key={portfolio.id} value={`portfolio:${portfolio.id}`}>{locale === "zh" ? portfolio.nameZh ?? portfolio.name : portfolio.name} ({portfolio.symbols.length})</option>)}</optgroup>
              </select>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={createWatchlist} className="rounded-full bg-teal-400/15 px-3 py-1.5 text-xs text-teal-200 hover:bg-teal-400/25">
                  {messages.common.new}
                </button>
                <button type="button" onClick={renameWatchlist} disabled={listSource === "portfolio"} title={listSource === "portfolio" ? (locale === "zh" ? "请在投资组合浮窗中重命名" : "Rename in the portfolio manager") : undefined} className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40">
                  {messages.common.rename}
                </button>
                <button
                  type="button"
                  onClick={deleteWatchlist}
                  disabled={listSource === "portfolio" || watchlists.length <= 1}
                  className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600"
                >
                  {messages.common.delete}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <input
                value={watchlistFilter}
                onChange={(event) => setWatchlistFilter(event.target.value)}
                placeholder={messages.dashboard.filterPlaceholder}
                className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <select
                value={watchlistSortMode}
                onChange={(event) => setWatchlistSortMode(event.target.value as WatchlistSortMode)}
                className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="symbol-asc">{messages.dashboard.sortSymbolAsc}</option>
                <option value="symbol-desc">{messages.dashboard.sortSymbolDesc}</option>
                <option value="change-desc">{messages.dashboard.sortChangeDesc}</option>
                <option value="change-asc">{messages.dashboard.sortChangeAsc}</option>
                <option value="custom">{messages.dashboard.sortCustom}</option>
              </select>
            </div>

            <div className="mt-4 space-y-2">
              {filteredAndSortedWatchlist.map((item) => (
                <div
                  key={item.symbol}
                  draggable={listSource === "watchlist"}
                  onDragStart={() => {
                    setDraggedSymbol(item.symbol);
                    if (watchlistSortMode !== "custom") {
                      setWatchlistSortMode("custom");
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={() => {
                    if (draggedSymbol && listSource === "watchlist") {
                      reorderActiveWatchlist(draggedSymbol, item.symbol);
                    }
                    setDraggedSymbol(null);
                  }}
                  onDragEnd={() => setDraggedSymbol(null)}
                  className={`wp-watch-row flex items-center gap-2 rounded-2xl border px-3 py-3 transition ${
                    item.symbol === resolvedSelectedSymbol
                      ? "border-teal-300/40 bg-teal-400/10"
                      : "border-transparent bg-slate-950/40 hover:border-white/10 hover:bg-slate-950/70"
                  }`}
                >
                  <div className="cursor-grab px-1 text-slate-500 active:cursor-grabbing">::</div>
                  <button
                    type="button"
                    onClick={() => handleSymbolPick(item.symbol)}
                    className="wp-watch-pick flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">{item.symbol}</p>
                      <div className="wp-watch-meta mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                          {item.market}
                        </span>
                        <span className="text-[11px] text-slate-500">{item.currency}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-400">{item.name}</p>
                      
                    </div>
                    <MiniSparkline points={sparklines[item.symbol] ?? []} trend={item.trend} />
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">{formatPrice(item.price)}</p>
                      <p className={item.trend === "up" ? "mt-1 text-xs text-emerald-300" : "mt-1 text-xs text-rose-300"}>
                        {formatPercent(item.changePercent)}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromActiveWatchlist(item.symbol)}
                    disabled={listSource === "watchlist" && activeWatchlist.symbols.length <= 1}
                    aria-label={`${messages.common.remove} ${item.symbol}`}
                    title={`${messages.common.remove} ${item.symbol}`}
                    className="wp-watch-remove inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-sm text-slate-500 transition hover:bg-white/10 hover:text-slate-300 disabled:cursor-not-allowed disabled:text-slate-700"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
              {filteredAndSortedWatchlist.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 px-4 py-6 text-sm text-slate-400">
                  {messages.dashboard.noSymbolsMatch}
                </div>
              ) : null}
            </div>
          </aside>

          <section className="wp-research space-y-6">
            <div className="relative overflow-visible rounded-[28px] border border-white/8 bg-[#07111f] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_35%)]" />
              <div className="relative">
                <div className="wp-chart-head">
                  <div>
                    <p className="text-sm uppercase tracking-[0.24em] text-slate-400">{selectedQuote?.symbol ?? resolvedSelectedSymbol}</p>
                    {selectedQuote ? (
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                        {selectedQuote.market} · {selectedQuote.exchange || "--"} · {selectedQuote.currency || "--"}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <span className="text-4xl font-semibold tracking-tight text-white">
                        {selectedQuote ? formatPrice(selectedQuote.price) : "--"}
                      </span>
                      {selectedQuote ? (
                        <TrendPill trend={selectedQuote.trend}>{formatSigned(selectedQuote.change)} {messages.dashboard.today}</TrendPill>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-400" role="status">{isLoadingChart ? messages.dashboard.loadingCandles : candles.length ? `${locale === "zh" ? "Yahoo 行情" : "Yahoo market data"} · ${activeTimeframe} · ${locale === "zh" ? "非实时行情" : "not real-time"}` : (locale === "zh" ? "图表暂不可用，未替换为模拟行情。" : "Chart unavailable. No simulated data substituted.")}</p>
                    {!isLoadingChart && !candles.length && <button className="pd-button" onClick={() => { setIsLoadingChart(true); setChartRetry((value) => value + 1); }}>{locale === "zh" ? "重试图表" : "Retry chart"}</button>}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex justify-end gap-2">
                      <details ref={watchlistMenu} className="wp-add-watchlist">
                        <summary aria-label={locale === "zh" ? "添加到自选列表" : "Add to watch list"} title={locale === "zh" ? "添加到指定 Watch List" : "Add to a specific watch list"}>+</summary>
                        <div className="wp-watchlist-menu" role="group" aria-label={locale === "zh" ? "选择目标自选列表" : "Choose a watch list"}>
                          <p>{locale === "zh" ? "添加到自选列表" : "Add to watch list"} · {resolvedSelectedSymbol}</p>
                          {watchlists.map((list) => {
                            const included = list.symbols.includes(resolvedSelectedSymbol);
                            return <button type="button" key={list.id} disabled={included} onClick={() => {
                              setWatchlists((current) => current.map((item) => item.id === list.id && !item.symbols.includes(resolvedSelectedSymbol) ? { ...item, symbols: [...item.symbols, resolvedSelectedSymbol] } : item));
                              setWatchlistNotice(`${resolvedSelectedSymbol} ${locale === "zh" ? "已添加到" : "added to"} ${list.name}`);
                              watchlistMenu.current?.removeAttribute("open");
                              watchlistMenu.current?.querySelector("summary")?.focus();
                            }}><span>{list.name}</span><small>{included ? (locale === "zh" ? "已添加 ✓" : "Added ✓") : "+"}</small></button>;
                          })}
                        </div>
                      </details>
                      <button
                        type="button"
                        onClick={() => setIsChartLightboxOpen(true)}
                        aria-label={locale === "zh" ? "放大图表" : "Expand chart"}
                        title={locale === "zh" ? "放大图表" : "Expand chart"}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4.5 w-4.5">

                          <path
                            d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>

                    {watchlistNotice && <p className="wp-watchlist-notice" role="status">{watchlistNotice}</p>}
                    <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                      {timeframeLabels.filter((timeframe) => ["1D", "1W", "1M", "6M", "1Y"].includes(timeframe) || timeframe === activeTimeframe).map((timeframe) => (
                        <button
                          key={timeframe}
                          type="button"
                          data-timeframe-tab={timeframe === activeTimeframe ? "active" : "inactive"}
                          onClick={() => handleChartTimeframeChange(timeframe)}
                          className={`rounded-full px-3 py-1.5 transition ${
                            timeframe === activeTimeframe
                              ? "bg-white text-slate-950"
                              : "bg-white/5 hover:bg-white/10"
                          }`}
                        >
                          {timeframe}
                        </button>
                      ))}
                    </div>

                    <details className="wp-chart-menu"><summary>{locale === "zh" ? "更多周期" : "More ranges"}</summary><div>{timeframeLabels.filter((timeframe) => !["1D", "1W", "1M", "6M", "1Y"].includes(timeframe) && timeframe !== activeTimeframe).map((timeframe) => <button type="button" key={timeframe} onClick={(event) => { handleChartTimeframeChange(timeframe); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{timeframe}</button>)}</div></details>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {(["auto", "line", "candles"] as const).map((mode) => {
                        const selected = chartMode === mode;
                        const label =
                          mode === "auto"
                            ? getRecommendedChartStyle(activeTimeframe) === "line"
                              ? messages.chart.autoLine
                              : messages.chart.autoCandles
                            : mode === "line"
                              ? messages.chart.line
                              : messages.chart.candles;

                        return (
                          <button
                            key={mode}
                            type="button"
                            data-chart-mode-tab={selected ? "active" : "inactive"}
                            onClick={() => setChartMode(mode)}
                            className={`rounded-full px-3 py-1.5 transition ${
                              selected
                                ? "bg-sky-400/20 text-sky-200 ring-1 ring-sky-300/30"
                                : "bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <details className="wp-chart-menu"><summary>{locale === "zh" ? "指标" : "Indicators"} · {enabledMovingAverages.length}</summary><div>
                      {movingAverageLabels.map((period) => {
                        const enabled = enabledMovingAverages.includes(period);

                        return (
                          <button
                            key={period}
                            type="button"
                            data-chart-control-tab={enabled ? "active" : "inactive"}
                            onClick={() => toggleMovingAverage(period)}
                            className={`rounded-full px-3 py-1.5 transition ${
                              enabled
                                ? "bg-teal-400/20 text-teal-200 ring-1 ring-teal-300/30"
                                : "bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            {locale === "zh" ? "均线" : "MA"} {period}
                          </button>
                        );
                      })}
                    </div></details>
                  </div>
                </div>

                <div className="mt-6">
                  <StockChart
                    candles={chartCandles}
                    chartStyle={resolvedChartStyle}
                    movingAverages={enabledMovingAverages}
                    onTimeframeChange={handleChartTimeframeChange}
                    timeframe={activeTimeframe}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <RangePositionBar
                current={selectedQuote?.price ?? null}
                low={companyDetail?.fiftyTwoWeekLow ?? null}
                high={companyDetail?.fiftyTwoWeekHigh ?? null}
              />
              <VolumeStrengthBar
                volume={selectedQuote?.volume ?? null}
                averageVolume={companyDetail?.averageVolume ?? null}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Symbol / Name</p>
                <p className="mt-4 text-2xl font-semibold text-white">{selectedQuote?.symbol ?? "--"}</p>
                <p className="mt-2 text-sm text-slate-400">{companyDetail?.shortName ?? selectedQuote?.name ?? messages.dashboard.waitingSelection}</p>
              </article>
              <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{messages.dashboard.changePercent}</p>
                <p className="mt-4 text-2xl font-semibold text-white">
                  {selectedQuote ? formatSigned(selectedQuote.change) : "--"}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {selectedQuote ? formatPercent(selectedQuote.changePercent) : messages.dashboard.waitingData}
                </p>
              </article>
              <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{messages.dashboard.chartSource}</p>
                <p className="mt-4 text-2xl font-semibold text-white">{chartMeta.mode === "live" ? messages.common.yahoo : messages.common.mock}</p>
                <p className="mt-2 text-sm text-slate-400">
                  {isLoadingChart
                    ? messages.dashboard.loadingCandles
                    : `${activeTimeframe} · ${resolvedChartStyle === "line" ? messages.chart.line : messages.chart.candles} · ${enabledMovingAverages.length} ${locale === "zh" ? "条均线" : "MA overlays"}`}
                </p>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-4">
              <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{messages.dashboard.marketCap}</p>
                <p className="mt-4 text-2xl font-semibold text-white">{formatLargeNumber(companyDetail?.marketCap ?? null)}</p>
                <p className="mt-2 text-sm text-slate-400">{companyDetail?.sector ?? messages.dashboard.sectorPending}</p>
              </article>
              <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{messages.dashboard.valuation}</p>
                <p className="mt-4 text-2xl font-semibold text-white">{formatNullableNumber(companyDetail?.trailingPE ?? null)}</p>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <p className="text-slate-400">Fwd PE {formatNullableNumber(companyDetail?.forwardPE ?? null)}</p>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${valuationTone.className}`}>
                    {valuationTone.label}
                  </span>
                </div>
              </article>
              <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{messages.dashboard.analystView}</p>
                <p className="mt-4 text-2xl font-semibold text-white">{formatRecommendation(companyDetail?.recommendationKey ?? "n/a")}</p>
                <p className="mt-2 text-sm text-slate-400">
                  Target {formatNullableNumber(companyDetail?.targetMeanPrice ?? null)} / {formatNullableNumber(companyDetail?.recommendationMean ?? null)}
                </p>
              </article>
              <article className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{messages.dashboard.riskIncome}</p>
                <p className="mt-4 text-2xl font-semibold text-white">Beta {formatNullableNumber(companyDetail?.beta ?? null)}</p>
                <p className="mt-2 text-sm text-slate-400">Yield {formatRatioPercent(companyDetail?.dividendYield ?? null)}</p>
              </article>
            </div>
          </section>

          <aside className="wp-company space-y-6">
            <section className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{messages.dashboard.companyIntel}</p>
                  
                </div>
                <TrendPill trend={selectedQuote?.trend ?? "up"}>{selectedQuote?.symbol ?? "--"}</TrendPill>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-slate-950/45 p-4">
                  <p className="text-slate-500">{locale === "zh" ? "52 周区间" : "52W Range"}</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {formatNullableNumber(companyDetail?.fiftyTwoWeekLow ?? null)} - {formatNullableNumber(companyDetail?.fiftyTwoWeekHigh ?? null)}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    {selectedRangePosition === null ? messages.dashboard.rangePending : `${locale === "zh" ? "区间位置" : "Range position"} ${selectedRangePosition.toFixed(0)}%`}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-950/45 p-4">
                  <p className="text-slate-500">{locale === "zh" ? "平均成交量" : "Avg Volume"}</p>
                  <p className="mt-2 text-lg font-semibold text-white">{companyDetail?.averageVolume ? formatVolume(companyDetail.averageVolume) : "--"}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    {selectedVolumeRatio === null ? messages.dashboard.volumePending : `${selectedVolumeRatio.toFixed(2)}${locale === "zh" ? " 倍均量" : "× average volume"}`}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-950/45 p-4">
                  <p className="text-slate-500">{locale === "zh" ? "50 / 200 日均价" : "50D / 200D"}</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {formatNullableNumber(companyDetail?.fiftyDayAverage ?? null)} / {formatNullableNumber(companyDetail?.twoHundredDayAverage ?? null)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-950/45 p-4">
                  <p className="text-slate-500">{locale === "zh" ? "分析师人数" : "Analysts"}</p>
                  <p className="mt-2 text-lg font-semibold text-white">{companyDetail?.analystCount ?? "--"}</p>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
              <p className="text-sm font-semibold text-white">{messages.dashboard.qualitySnapshot}</p>
              
              <div className="mt-5 space-y-3">
                <MetricSignal
                  label={locale === "zh" ? "盈利增长" : "Earnings Growth"}
                  value={formatRatioPercent(companyDetail?.earningsGrowth ?? null)}
                  tone={getSignalTone(companyDetail?.earningsGrowth ?? null, { strong: 0.12, weak: 0.03 })}
                />
                <MetricSignal
                  label={locale === "zh" ? "营收增长" : "Revenue Growth"}
                  value={formatRatioPercent(companyDetail?.revenueGrowth ?? null)}
                  tone={growthTone}
                />
                <MetricSignal
                  label={locale === "zh" ? "净利润率 / ROE" : "Profit Margin / ROE"}
                  value={`${formatRatioPercent(companyDetail?.profitMargins ?? null)} / ${formatRatioPercent(companyDetail?.returnOnEquity ?? null)}`}
                  tone={qualityTone}
                />
                <MetricSignal
                  label={locale === "zh" ? "债务权益比" : "Debt to Equity"}
                  value={formatNullableNumber(companyDetail?.debtToEquity ?? null)}
                  tone={leverageTone}
                />
              </div>
            </section>

          </aside>
        </section>
        </>}
      </div>
      {isChartLightboxOpen ? (
        <ChartLightbox
          candles={chartCandles}
          chartStyle={resolvedChartStyle}
          locale={locale}
          movingAverages={enabledMovingAverages}
          onClose={() => setIsChartLightboxOpen(false)}
          onTimeframeChange={handleChartTimeframeChange}
          symbol={selectedQuote?.symbol ?? resolvedSelectedSymbol}
          timeframe={activeTimeframe}
        />
      ) : null}
    </main>
  );
}
