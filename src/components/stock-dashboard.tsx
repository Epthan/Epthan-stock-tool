"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartLightbox } from "@/components/chart-lightbox";
import { PortfolioManager } from "@/components/portfolio-manager";
import { BacktestPanel } from "@/components/backtest-panel";
import { watchlistLabel } from "@/lib/watchlists";
import { MarketOverview } from "@/components/market-overview";
import { CORE_INDEXES, formatOverview, overviewName } from "@/lib/market-overview";
import { useStoredWatchlists } from "@/hooks/use-stored-watchlists";
import { usePortfolios } from "@/hooks/use-portfolios";
import { getTradePosition } from "@/lib/portfolio-trades";
import { TTL, fetchCached, forgetCached, prefetchCached } from "@/lib/client-cache";
import { useLanguage } from "@/components/language-provider";
import { StockChart, type ChartStyle } from "@/components/stock-chart";
import { useStockSelection } from "@/components/stock-selection-provider";
import {
  mockMarketBreadth,
  mockProviderPlan,
  movingAverageLabels,
  timeframeLabels,
  type CandlePoint,
  type MovingAverageKey,
  type QuoteCard,
  type TimeframeKey,
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

const recommendationZh: Record<string, string> = { strong_buy: "强烈买入", buy: "买入", hold: "持有", underperform: "弱于大盘", sell: "卖出", strong_sell: "强烈卖出", none: "无" };
function formatRecommendation(value: string, locale: "en" | "zh" = "en") {
  if (locale === "zh" && recommendationZh[value]) return recommendationZh[value];
  return value
    .split(/[_-]/)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ");
}

type StockDashboardProps = {
  defaultSymbol: string;
};

function createWatchlistId() {
  return `list-${Date.now()}`;
}

const candleCacheKey = (symbol: string, timeframe: string) => `candles:${symbol}:${timeframe}`;
const candleUrl = (symbol: string, timeframe: string) => `/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`;
const candleTtl = (timeframe: string) => (["1D", "2D", "5D", "1W"].includes(timeframe) ? TTL.intraday : TTL.daily);
const companyUrl = (symbol: string) => `/api/market/company?symbol=${encodeURIComponent(symbol)}`;

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
    indexes: [],
    watchlist: [],
    marketBreadth: mockMarketBreadth,
    isLive: false,
    message: messages.common.loading,
  });
  // No simulated prices on screen: until Yahoo answers the strip and list show placeholders.
  const [marketState, setMarketState] = useState<"loading" | "live" | "error">("loading");
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [loadedChartSymbol, setLoadedChartSymbol] = useState("");
  const chartCandles = loadedChartSymbol === resolvedSelectedSymbol ? candles : [];
  const [, setChartMeta] = useState({
    mode: "mock" as "mock" | "live",
    message: messages.common.loading,
  });
  const [isLoadingChart, setIsLoadingChart] = useState(true);
  const [selectedSearchQuote, setSelectedSearchQuote] = useState<WatchlistRow | null>(null);
  const [companyResponse, setCompanyDetail] = useState<CompanyResponse | null>(null);
  const companyDetail = companyResponse?.symbol === resolvedSelectedSymbol ? companyResponse.company : null;
  const [watchlistFilter, setWatchlistFilter] = useState("");
  const [watchlistSortMode, setWatchlistSortMode] = useState<WatchlistSortMode>("symbol-asc");
  const [draggedSymbol, setDraggedSymbol] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("auto");
  const [isChartLightboxOpen, setIsChartLightboxOpen] = useState(false);
  const [mobileView, setMobileView] = useState("chart");
  // Three tabs: market overview, single-stock research, backtest. The last one used is remembered.
  type MarketView = "overview" | "research" | "backtest";
  const [workplaceView, setWorkplaceViewState] = useState<MarketView>("research");
  const setWorkplaceView = useCallback((view: MarketView) => { setWorkplaceViewState(view); try { window.localStorage.setItem("stock-tool.market-view.v1", view); } catch {} }, []);
  useEffect(() => { try { const saved = window.localStorage.getItem("stock-tool.market-view.v1"); if (saved === "overview" || saved === "backtest") startTransition(() => setWorkplaceViewState(saved)); } catch {} }, []);
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
        const url = `/api/market/dashboard?symbols=${encodeURIComponent(activeWatchlist.symbols.join(","))}`;
        const accept = (next: DashboardResponse) => {
          if (ignore) return;
          if (next.mode === "live") { setDashboard(next); setMarketState("live"); }
          else setMarketState((current) => (current === "live" ? current : "error")); // keep the last live snapshot if we had one
        };
        const payload = await fetchCached<DashboardResponse>(`dashboard:${activeWatchlist.symbols.join(",")}`, url, 10_000, undefined, accept);
        accept(payload);
      } catch {
        if (!ignore) setMarketState((current) => (current === "live" ? current : "error"));
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

    async function loadCandles() {
      try {
        const key = candleCacheKey(resolvedSelectedSymbol, activeTimeframe);
        const payload = await fetchCached<CandleResponse>(key, candleUrl(resolvedSelectedSymbol, activeTimeframe), candleTtl(activeTimeframe));
        if (payload.mode !== "live") { forgetCached(key); throw new Error("Chart data unavailable"); }

        if (!ignore) {
          setCandles(payload.candles);
          setLoadedChartSymbol(resolvedSelectedSymbol);
          setChartMeta({ mode: payload.mode, message: payload.message });
        }
      } catch {
        if (!ignore) {
          setCandles([]);
          setChartMeta({ mode: "mock", message: noDataMessage });
          // One automatic retry for transient failures (rate limit / network); the Retry button stays for later.
          if (chartRetry === 0) autoRetry = window.setTimeout(() => { setIsLoadingChart(true); setChartRetry(1); }, 5000);
        }
      } finally {
        if (!ignore) {
          setIsLoadingChart(false);
        }
      }
    }

    let autoRetry: number | undefined;
    loadCandles();

    return () => {
      ignore = true;
      window.clearTimeout(autoRetry);
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
        const payload = await fetchCached<QuoteResponse>(`quote:${resolvedSelectedSymbol}`, `/api/market/quote?symbol=${encodeURIComponent(resolvedSelectedSymbol)}`, TTL.quote);

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
        const payload = await fetchCached<CompanyResponse>(`company:${resolvedSelectedSymbol}`, companyUrl(resolvedSelectedSymbol), TTL.company);

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

  const heldPosition = (() => {
    for (const portfolio of portfolios) {
      const trades = portfolio.trades?.filter((trade) => trade.symbol === resolvedSelectedSymbol) ?? [];
      if (!trades.length) continue;
      const position = getTradePosition(portfolio.trades ?? [], resolvedSelectedSymbol, portfolio.splits);
      if (position.quantity <= 1e-8 || position.averageCost == null) continue;
      return { portfolio, ...position };
    }
    return null;
  })();
  const zh = locale === "zh";
  const facts = companyDetail ? ([
    [zh ? "市值" : "Market cap", companyDetail.marketCap ? formatLargeNumber(companyDetail.marketCap) : null],
    [zh ? "市盈率 / 预期" : "P/E · forward", companyDetail.trailingPE != null || companyDetail.forwardPE != null ? `${formatNullableNumber(companyDetail.trailingPE ?? null, 1)} / ${formatNullableNumber(companyDetail.forwardPE ?? null, 1)}` : null],
    [zh ? "50 / 200 日均价" : "50D / 200D avg", companyDetail.fiftyDayAverage != null ? `${formatNullableNumber(companyDetail.fiftyDayAverage)} / ${formatNullableNumber(companyDetail.twoHundredDayAverage ?? null)}` : null],
    ["β", companyDetail.beta != null ? formatNullableNumber(companyDetail.beta) : null],
    [zh ? "股息率" : "Dividend yield", companyDetail.dividendYield != null ? formatRatioPercent(companyDetail.dividendYield) : null],
    [zh ? "营收增长" : "Revenue growth", companyDetail.revenueGrowth != null ? formatRatioPercent(companyDetail.revenueGrowth) : null, companyDetail.revenueGrowth],
    [zh ? "盈利增长" : "Earnings growth", companyDetail.earningsGrowth != null ? formatRatioPercent(companyDetail.earningsGrowth) : null, companyDetail.earningsGrowth],
    [zh ? "净利率" : "Profit margin", companyDetail.profitMargins != null ? formatRatioPercent(companyDetail.profitMargins) : null],
    ["ROE", companyDetail.returnOnEquity != null ? formatRatioPercent(companyDetail.returnOnEquity) : null],
    [zh ? "负债权益比" : "Debt / equity", companyDetail.debtToEquity != null ? formatNullableNumber(companyDetail.debtToEquity, 1) : null],
  ] as [string, string | null, number?][]).filter((row) => row[1] != null) : [];
  const targetGap = companyDetail?.targetMeanPrice && selectedQuote?.price ? (companyDetail.targetMeanPrice / selectedQuote.price - 1) * 100 : null;
  const rangeLow = companyDetail?.fiftyTwoWeekLow ?? null;
  const rangeHigh = companyDetail?.fiftyTwoWeekHigh ?? null;
  const fromHigh = rangeHigh && selectedQuote?.price ? (selectedQuote.price / rangeHigh - 1) * 100 : null;

  return (
    <main className="workplace-page wpx">
      <div className="wpx-inner">
        <header className="wpx-tools"><div><nav aria-label={zh ? "行情视图" : "Market views"}>{([["overview", zh ? "市场概览" : "Markets"], ["research", zh ? "个股研究" : "Research"], ["backtest", zh ? "策略回测" : "Backtest"]] as [MarketView, string][]).map(([view, label]) => <button key={view} aria-pressed={workplaceView === view} onClick={() => { setWorkplaceView(view); setIsChartLightboxOpen(false); }}>{label}</button>)}</nav></div><PortfolioManager onPick={handleSymbolPick} /></header>
        {workplaceView !== "overview" && <section className="wpx-indexes" aria-label={zh ? "主要指数" : "Major indexes"}>
          {!dashboard.indexes.length && CORE_INDEXES.map((item) => <div key={item.symbol} className="wpx-index is-placeholder"><span className="wpx-index-symbol">{zh ? item.zh : item.en}</span><span className="wpx-num">—</span></div>)}
          {dashboard.indexes.map((index) => { const shown = formatOverview(index.symbol, index.price, index.change, index.changePercent); return <button type="button" key={index.symbol} className="wpx-index" onClick={() => { handleSymbolPick(index.symbol); setWorkplaceView("research"); }} title={index.symbol}><span className="wpx-index-symbol">{overviewName(index.symbol, zh)}</span><span className="wpx-num">{shown.value}</span><span className={`wpx-num ${index.change >= 0 ? "is-up" : "is-down"}`}>{shown.change}</span></button>; })}
          <button type="button" className="wpx-index-more" onClick={() => setWorkplaceView("overview")}>{zh ? "行业与宏观" : "Sectors & macro"} ›</button>
          <span className="wpx-index-note">{marketState === "live" ? (zh ? "Yahoo 行情快照，约延迟 15 分钟" : "Yahoo snapshot, ~15 min delayed") : marketState === "loading" ? (zh ? "正在加载行情…" : "Loading market data…") : (zh ? "行情暂不可用，每 15 秒自动重试" : "Market data unavailable — retrying every 15 s")}</span>
        </section>}
        {workplaceView === "overview" ? <MarketOverview zh={zh} onPick={(symbol) => { handleSymbolPick(symbol); setWorkplaceView("research"); }} />
        : workplaceView === "backtest" ? <BacktestPanel key={resolvedSelectedSymbol} symbol={resolvedSelectedSymbol} /> : <>

        <nav className="wp-mobile-tabs" aria-label={locale === "zh" ? "工作台视图" : "Workplace views"}>{[["chart", locale === "zh" ? "图表" : "Chart"], ["watchlist", locale === "zh" ? "自选" : "Watchlist"], ["details", locale === "zh" ? "公司资料" : "Company"]].map(([value, label]) => <button key={value} aria-pressed={mobileView === value} onClick={() => setMobileView(value)}>{label}</button>)}</nav>
        <section className="wp-grid wpx-grid" data-mobile-view={mobileView}>
          <aside className="wp-watchlist wpx-watch" aria-label={messages.dashboard.watchLists}>
            <div className="wpx-watch-head">
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
                className="wpx-list-select"
              >
                <optgroup label={locale === "zh" ? "自选列表" : "Watch lists"}>{watchlists.map((list) => (
                  <option key={list.id} value={`watchlist:${list.id}`}>
                    {watchlistLabel(list.name, zh)}
                  </option>
                ))}</optgroup>
                <optgroup label={locale === "zh" ? "投资组合" : "Portfolios"}>{portfolios.map((portfolio) => <option key={portfolio.id} value={`portfolio:${portfolio.id}`}>{locale === "zh" ? portfolio.nameZh ?? portfolio.name : portfolio.name} ({portfolio.symbols.length})</option>)}</optgroup>
              </select>
              <details className="wpx-menu">
                <summary aria-label={zh ? "列表操作" : "List actions"} title={zh ? "列表操作" : "List actions"}>···</summary>
                <div>
                  <button type="button" onClick={createWatchlist}>{zh ? "新建自选列表" : "New watch list"}</button>
                  <button type="button" onClick={renameWatchlist} disabled={listSource === "portfolio"}>{zh ? "重命名" : "Rename"}</button>
                  <button type="button" onClick={deleteWatchlist} disabled={listSource === "portfolio" || watchlists.length <= 1}>{zh ? "删除列表" : "Delete list"}</button>
                </div>
              </details>
            </div>
            <div className="wpx-watch-tools">
              <input
                value={watchlistFilter}
                onChange={(event) => setWatchlistFilter(event.target.value)}
                placeholder={messages.dashboard.filterPlaceholder}
                className="wpx-input"
              />
              <select
                value={watchlistSortMode}
                onChange={(event) => setWatchlistSortMode(event.target.value as WatchlistSortMode)}
                className="wpx-input" aria-label={locale === "zh" ? "排序" : "Sort"}
              >
                <option value="symbol-asc">{messages.dashboard.sortSymbolAsc}</option>
                <option value="symbol-desc">{messages.dashboard.sortSymbolDesc}</option>
                <option value="change-desc">{messages.dashboard.sortChangeDesc}</option>
                <option value="change-asc">{messages.dashboard.sortChangeAsc}</option>
                <option value="custom">{messages.dashboard.sortCustom}</option>
              </select>
            </div>
            <div className="wpx-watch-list">
              {!dashboard.watchlist.length && activeWatchlist.symbols.map((symbol) => <div key={symbol} className="wpx-watch-row is-placeholder"><button type="button" onClick={() => handleSymbolPick(symbol)} className="wpx-watch-pick"><span className="wpx-watch-symbol">{symbol}</span><span className="wpx-num wpx-faint">{marketState === "error" ? (zh ? "暂无行情" : "no data") : "…"}</span></button></div>)}
              {filteredAndSortedWatchlist.map((item) => (
                <div
                  key={item.symbol}
                  draggable={listSource === "watchlist"}
                  onDragStart={() => { setDraggedSymbol(item.symbol); if (watchlistSortMode !== "custom") setWatchlistSortMode("custom"); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => { if (draggedSymbol && listSource === "watchlist") reorderActiveWatchlist(draggedSymbol, item.symbol); setDraggedSymbol(null); }}
                  onDragEnd={() => setDraggedSymbol(null)}
                  onPointerEnter={() => { prefetchCached(candleCacheKey(item.symbol, activeTimeframe), candleUrl(item.symbol, activeTimeframe), candleTtl(activeTimeframe)); prefetchCached(`company:${item.symbol}`, companyUrl(item.symbol), TTL.company); }}
                  className={`wpx-watch-row ${item.symbol === resolvedSelectedSymbol ? "is-active" : ""}`}
                >
                  <button type="button" onClick={() => handleSymbolPick(item.symbol)} className="wpx-watch-pick" aria-current={item.symbol === resolvedSelectedSymbol ? "true" : undefined}>
                    <span className="wpx-watch-symbol">{item.symbol}</span>
                    <span className="wpx-num wpx-watch-price">{formatPrice(item.price)}</span>
                    <span className="wpx-watch-name">{item.name}</span>
                    <span className={`wpx-num wpx-watch-change ${item.trend === "up" ? "is-up" : "is-down"}`}>{formatPercent(item.changePercent)}</span>
                  </button>
                  <button type="button" onClick={() => removeFromActiveWatchlist(item.symbol)} disabled={listSource === "watchlist" && activeWatchlist.symbols.length <= 1} aria-label={`${messages.common.remove} ${item.symbol}`} title={`${messages.common.remove} ${item.symbol}`} className="wpx-watch-remove">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
              {filteredAndSortedWatchlist.length === 0 ? <p className="wpx-empty">{messages.dashboard.noSymbolsMatch}</p> : null}
            </div>
          </aside>

          <section className="wp-research wpx-research">
            <div className="wpx-quote">
              <div className="wpx-quote-main">
                <div className="wpx-quote-title"><h2>{selectedQuote?.symbol ?? resolvedSelectedSymbol}</h2>{(companyDetail?.shortName || selectedQuote?.name) && <span>{companyDetail?.shortName ?? selectedQuote?.name}{selectedQuote?.exchange ? ` · ${selectedQuote.exchange}` : ""}{companyDetail?.industry ? ` · ${companyDetail.industry}` : ""}</span>}</div>
                {selectedQuote ? <div className="wpx-quote-price"><span className="wpx-num wpx-big">{formatPrice(selectedQuote.price)}</span><span className={`wpx-num wpx-change ${selectedQuote.trend === "up" ? "is-up" : "is-down"}`}>{formatSigned(selectedQuote.change)}　{formatPercent(selectedQuote.changePercent)}</span><span className="wpx-faint">{zh ? "今日" : "today"}{selectedQuote.currency ? ` · ${selectedQuote.currency}` : ""}</span></div> : <p className="wpx-faint">{messages.dashboard.waitingData}</p>}
                <p className="wpx-status" role="status">{isLoadingChart ? messages.dashboard.loadingCandles : candles.length ? `${locale === "zh" ? "Yahoo 行情" : "Yahoo market data"} · ${activeTimeframe} · ${locale === "zh" ? "非实时行情" : "not real-time"}` : (locale === "zh" ? "图表暂不可用，未替换为模拟行情。" : "Chart unavailable. No simulated data substituted.")}</p>
                    {!isLoadingChart && !candles.length && <button className="pd-button" onClick={() => { setIsLoadingChart(true); setChartRetry((value) => value + 1); }}>{locale === "zh" ? "重试图表" : "Retry chart"}</button>}
              </div>
              <div className="wpx-quote-actions">
                <details ref={watchlistMenu} className="wp-add-watchlist">
                        <summary aria-label={locale === "zh" ? "添加到自选列表" : "Add to watch list"} title={locale === "zh" ? "添加到指定自选列表" : "Add to a specific watch list"}>+</summary>
                        <div className="wp-watchlist-menu" role="group" aria-label={locale === "zh" ? "选择目标自选列表" : "Choose a watch list"}>
                          <p>{locale === "zh" ? "添加到自选列表" : "Add to watch list"} · {resolvedSelectedSymbol}</p>
                          {watchlists.map((list) => {
                            const included = list.symbols.includes(resolvedSelectedSymbol);
                            return <button type="button" key={list.id} disabled={included} onClick={() => {
                              setWatchlists((current) => current.map((item) => item.id === list.id && !item.symbols.includes(resolvedSelectedSymbol) ? { ...item, symbols: [...item.symbols, resolvedSelectedSymbol] } : item));
                              setWatchlistNotice(`${resolvedSelectedSymbol} ${locale === "zh" ? "已添加到" : "added to"} ${watchlistLabel(list.name, zh)}`);
                              watchlistMenu.current?.removeAttribute("open");
                              watchlistMenu.current?.querySelector("summary")?.focus();
                            }}><span>{watchlistLabel(list.name, zh)}</span><small>{included ? (locale === "zh" ? "已添加 ✓" : "Added ✓") : "+"}</small></button>;
                          })}
                        </div>
                      </details>
                <button
                        type="button"
                        onClick={() => setIsChartLightboxOpen(true)}
                        aria-label={locale === "zh" ? "放大图表" : "Expand chart"}
                        title={locale === "zh" ? "放大图表" : "Expand chart"}
                        className="wpx-icon-btn"
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
            </div>
            <div className="wpx-controls">
              {watchlistNotice && <p className="wp-watchlist-notice" role="status">{watchlistNotice}</p>}
                    <div className="wpx-seg" role="group" aria-label={locale === "zh" ? "周期" : "Range"}>
                      {timeframeLabels.filter((timeframe) => ["1D", "1W", "1M", "6M", "1Y"].includes(timeframe) || timeframe === activeTimeframe).map((timeframe) => (
                        <button
                          key={timeframe}
                          type="button"
                          data-timeframe-tab={timeframe === activeTimeframe ? "active" : "inactive"}
                          onClick={() => handleChartTimeframeChange(timeframe)}
                          className={`rounded-full px-3 py-1.5 transition ${ timeframe === activeTimeframe
 ? "bg-[var(--ui-accent)] text-[var(--ui-on-accent)]" : "bg-[var(--ui-panel-2)] hover:bg-[var(--ui-seg)]" }`}
                        >
                          {timeframe}
                        </button>
                      ))}
                    </div>

                    <details className="wp-chart-menu"><summary>{locale === "zh" ? "更多周期" : "More ranges"}</summary><div>{timeframeLabels.filter((timeframe) => !["1D", "1W", "1M", "6M", "1Y"].includes(timeframe) && timeframe !== activeTimeframe).map((timeframe) => <button type="button" key={timeframe} onClick={(event) => { handleChartTimeframeChange(timeframe); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{timeframe}</button>)}</div></details>

                    <div className="wpx-seg" role="group" aria-label={locale === "zh" ? "图表类型" : "Chart type"}>
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
                            className={`rounded-full px-3 py-1.5 transition ${ selected
 ? "bg-[var(--ui-accent-soft)] text-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)]" : "bg-[var(--ui-panel-2)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-seg)]" }`}
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
                            className={`rounded-full px-3 py-1.5 transition ${ enabled
 ? "bg-[var(--ui-accent-soft)] text-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)]" : "bg-[var(--ui-panel-2)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-seg)]" }`}
                          >
                            {locale === "zh" ? "均线" : "MA"} {period}
                          </button>
                        );
                      })}
                    </div></details>
            </div>
            <div className="wpx-chart">
              <StockChart
                    candles={chartCandles}
                    chartStyle={resolvedChartStyle}
                    movingAverages={enabledMovingAverages}
                    onTimeframeChange={handleChartTimeframeChange}
                    timeframe={activeTimeframe}
                    drawable
                    drawingKey={resolvedSelectedSymbol}
                    zh={zh}
                  />
            </div>
            {(rangeLow != null && rangeHigh != null && selectedQuote) || (selectedQuote?.volume && companyDetail?.averageVolume) ? <div className="wpx-tracks">
              {rangeLow != null && rangeHigh != null && selectedQuote && <div className="wpx-track">
                <div className="wpx-track-head"><span>{zh ? "52 周区间" : "52-week range"}</span><span className="wpx-num">{fromHigh != null ? (zh ? `距高点 ${fromHigh.toFixed(1)}%` : `${fromHigh.toFixed(1)}% from high`) : ""}</span></div>
                <div className="wpx-bar"><span className="wpx-bar-fill" style={{ width: `${Math.min(100, Math.max(0, (selectedQuote.price - rangeLow) / Math.max(1e-9, rangeHigh - rangeLow) * 100))}%` }} /><span className="wpx-bar-mark" style={{ left: `${Math.min(100, Math.max(0, (selectedQuote.price - rangeLow) / Math.max(1e-9, rangeHigh - rangeLow) * 100))}%` }} /></div>
                <div className="wpx-track-foot wpx-num"><span>{formatPrice(rangeLow)}</span><span>{formatPrice(rangeHigh)}</span></div>
              </div>}
              {selectedQuote?.volume && companyDetail?.averageVolume ? <div className="wpx-track">
                <div className="wpx-track-head"><span>{zh ? "成交量 / 3 个月均量" : "Volume vs 3-month average"}</span><span className="wpx-num">{(selectedQuote.volume / companyDetail.averageVolume * 100).toFixed(0)}%</span></div>
                <div className="wpx-bar"><span className="wpx-bar-fill is-accent" style={{ width: `${Math.min(100, selectedQuote.volume / companyDetail.averageVolume * 80)}%` }} /><span className="wpx-bar-mark is-muted" style={{ left: "80%" }} /></div>
                <div className="wpx-track-foot wpx-num"><span>{zh ? "今日" : "Today"} {formatVolume(selectedQuote.volume)}</span><span>{zh ? "均量" : "Avg"} {formatVolume(companyDetail.averageVolume)}</span></div>
              </div> : null}
            </div> : null}
          </section>

          <aside className="wp-company wpx-company" aria-label={zh ? "公司与持仓" : "Company and position"}>
            {heldPosition && selectedQuote && <section className="wpx-card wpx-held">
              <div className="wpx-card-head"><h3>{zh ? "你的持仓" : "Your position"}</h3><Link href="/dashboard">{zh ? heldPosition.portfolio.nameZh ?? heldPosition.portfolio.name : heldPosition.portfolio.name}</Link></div>
              <div className="wpx-held-main"><span className={`wpx-num wpx-held-pct ${selectedQuote.price >= heldPosition.averageCost! ? "is-up" : "is-down"}`}>{formatPercent((selectedQuote.price / heldPosition.averageCost! - 1) * 100)}</span><span className={`wpx-num ${selectedQuote.price >= heldPosition.averageCost! ? "is-up" : "is-down"}`}>{formatSigned((selectedQuote.price - heldPosition.averageCost!) * heldPosition.quantity)}</span></div>
              <p className="wpx-num">{zh ? `${heldPosition.quantity.toLocaleString()} 股，成本 ${formatPrice(heldPosition.averageCost!)}` : `${heldPosition.quantity.toLocaleString()} shares at ${formatPrice(heldPosition.averageCost!)}`}</p>
            </section>}
            <section className="wpx-card-plain">
              <h3>{zh ? "估值" : "Valuation"}</h3>
              {facts.length ? <dl className="wpx-facts">{facts.slice(0, 5).map(([label, value, signal]) => <div key={label}><dt>{label}</dt><dd className={`wpx-num ${signal == null ? "" : signal >= 0 ? "is-up" : "is-down"}`}>{value}</dd></div>)}</dl> : <p className="wpx-faint">{zh ? "暂时拿不到这只股票的基本面数据。" : "Fundamentals are not available for this symbol right now."}</p>}
              {facts.length > 5 && <details className="wpx-more"><summary>{zh ? "成长与盈利能力" : "Growth & profitability"}<span>{facts.length - 5}</span></summary><dl className="wpx-facts">{facts.slice(5).map(([label, value, signal]) => <div key={label}><dt>{label}</dt><dd className={`wpx-num ${signal == null ? "" : signal >= 0 ? "is-up" : "is-down"}`}>{value}</dd></div>)}</dl></details>}
            </section>
            {companyDetail?.analystCount && companyDetail.targetMeanPrice ? <section className="wpx-card-plain">
              <h3>{zh ? "分析师" : "Analysts"}</h3>
              <p className="wpx-sentence">{zh ? <>{companyDetail.analystCount} 位分析师，平均评级<strong>{formatRecommendation(companyDetail.recommendationKey, "zh")}</strong>，目标价 <span className="wpx-num">{formatPrice(companyDetail.targetMeanPrice)}</span>{targetGap != null && <>，<span className={targetGap >= 0 ? "is-up" : "is-down"}>{targetGap >= 0 ? "高于" : "低于"}现价 {Math.abs(targetGap).toFixed(1)}%</span></>}。</> : <>{companyDetail.analystCount} analysts rate it <strong>{formatRecommendation(companyDetail.recommendationKey)}</strong>; mean target <span className="wpx-num">{formatPrice(companyDetail.targetMeanPrice)}</span>{targetGap != null && <>, <span className={targetGap >= 0 ? "is-up" : "is-down"}>{Math.abs(targetGap).toFixed(1)}% {targetGap >= 0 ? "above" : "below"} the price</span></>}.</>}</p>
            </section> : null}
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
