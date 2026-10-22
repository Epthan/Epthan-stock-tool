"use client";

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type Locale = "en" | "zh";

type Messages = {
  nav: {
    title: string;
    subtitle: string;
    dashboard: string;
    portfolio: string;
    multiWatch: string;
    treeMap: string;
    toggleLanguage: string;
  };
  common: {
    add: string;
    remove: string;
    rename: string;
    delete: string;
    new: string;
    live: string;
    mock: string;
    loading: string;
    noData: string;
    yahoo: string;
  };
  search: {
    placeholder: string;
    searching: string;
    noSymbols: string;
  };
  dashboard: {
    titleEyebrow: string;
    title: string;
    description: string;
    dataMode: string;
    watchLists: string;
    selected: string;
    createManage: string;
    filterPlaceholder: string;
    noSymbolsMatch: string;
    chartSource: string;
    symbolName: string;
    changePercent: string;
    marketCap: string;
    valuation: string;
    analystView: string;
    riskIncome: string;
    marketState: string;
    companyIntel: string;
    qualitySnapshot: string;
    newsPlaceholder: string;
    newsHint: string;
    today: string;
    loadingCandles: string;
    waitingSelection: string;
    waitingData: string;
    sectorPending: string;
    rangePending: string;
    volumePending: string;
    loadedCompanies: (count: number) => string;
    sortSymbolAsc: string;
    sortSymbolDesc: string;
    sortChangeDesc: string;
    sortChangeAsc: string;
    sortCustom: string;
    promptNewWatchList: string;
    promptRenameWatchList: string;
    confirmDeleteWatchList: (name: string) => string;
    defaultWatchListName: (index: number) => string;
    feedLabel: (isLive: boolean) => string;
  };
  compare: {
    eyebrow: string;
    title: string;
    description: string;
    currentWatchlist: string;
    empty: string;
    loadingQuote: string;
    loadingMessage: string;
    failedMessage: string;
  };
  treemap: {
    eyebrow: string;
    title: string;
    sp100: string;
    nasdaq100: string;
    watchLists: string;
    sourceIndex: string;
    sourceWatchLists: string;
    selectedWatchLists: string;
    noWatchListsSelected: string;
    titleForIndex: (index: "sp100" | "nasdaq100") => string;
    description: (title: string, timeframe: string) => string;
    loading: string;
    loadingHint: string;
    failed: string;
    noData: string;
    tryAnother: string;
    loadedCompanies: (count: number) => string;
  };
  chart: {
    lineChartLegend: string;
    candleGreen: string;
    candleRed: string;
    volumeGreen: string;
    volumeRed: string;
    autoLine: string;
    autoCandles: string;
    line: string;
    candles: string;
  };
  news: string[];
};

const messages: Record<Locale, Messages> = {
  en: {
    nav: {
      title: "Stock Tool",
      subtitle: "US market workspace",
      dashboard: "Dashboard",
      portfolio: "Portfolio",
      multiWatch: "Multi Watch",
      treeMap: "Tree Map",
      toggleLanguage: "Switch to Chinese",
    },
    common: {
      add: "Add",
      remove: "Remove",
      rename: "Rename",
      delete: "Delete",
      new: "New",
      live: "Live",
      mock: "Mock",
      loading: "Loading...",
      noData: "No data",
      yahoo: "Yahoo",
    },
    search: {
      placeholder: "Search symbol or company",
      searching: "Searching...",
      noSymbols: "No symbols found.",
    },
    dashboard: {
      titleEyebrow: "US Market Dashboard",
      title: "Stock Market Workplace",
      description:
        "Built for fast scanning with multiple watch lists, chart timeframes, and moving average overlays.",
      dataMode: "Data Mode",
      watchLists: "Watch Lists",
      selected: "Selected",
      createManage: "Create, select, rename, and delete",
      filterPlaceholder: "Filter symbol or name",
      noSymbolsMatch: "No symbols match the current filter.",
      chartSource: "Chart Source",
      symbolName: "Symbol / Name",
      changePercent: "Change / Percent",
      marketCap: "Market Cap",
      valuation: "Valuation",
      analystView: "Analyst View",
      riskIncome: "Risk / Income",
      marketState: "Market State",
      companyIntel: "Company Intel",
      qualitySnapshot: "Quality Snapshot",
      newsPlaceholder: "News Placeholder",
      newsHint: "Real news feed can be added next.",
      today: "today",
      loadingCandles: "Loading candles...",
      waitingSelection: "Waiting for selection",
      waitingData: "Waiting for data",
      sectorPending: "Sector pending",
      rangePending: "Range pending",
      volumePending: "Volume pending",
      loadedCompanies: (count) => `Loaded ${count} companies`,
      sortSymbolAsc: "Symbol A-Z",
      sortSymbolDesc: "Symbol Z-A",
      sortChangeDesc: "Change High-Low",
      sortChangeAsc: "Change Low-High",
      sortCustom: "Custom Order",
      promptNewWatchList: "New watch list name",
      promptRenameWatchList: "Rename watch list",
      confirmDeleteWatchList: (name) => `Delete watch list "${name}"?`,
      defaultWatchListName: (index) => `Watch List ${index}`,
      feedLabel: (isLive) => (isLive ? "Live Feed" : "Mock Feed"),
    },
    compare: {
      eyebrow: "Multi Watch",
      title: "Multi-Symbol View",
      description:
        "Choose any watch list to generate synchronized company panels with shared timeframe and moving averages.",
      currentWatchlist: "Current watch list",
      empty: "This watch list is empty. Add symbols from the main dashboard first.",
      loadingQuote: "Loading quote...",
      loadingMessage: "Loading...",
      failedMessage: "Failed to load comparison data.",
    },
    treemap: {
      eyebrow: "Treemap",
      title: "Tree Map",
      sp100: "S&P 100",
      nasdaq100: "Nasdaq 100",
      watchLists: "Watch Lists",
      sourceIndex: "Indexes",
      sourceWatchLists: "Watch Lists",
      selectedWatchLists: "Selected Watch Lists",
      noWatchListsSelected: "Select one or more watch lists to build a custom tree map.",
      titleForIndex: (index) => (index === "sp100" ? "S&P 100 Treemap" : "Nasdaq 100 Treemap"),
      description: (title, timeframe) =>
        `Area reflects absolute move size and color shows direction. Viewing ${title} over ${timeframe}.`,
      loading: "Loading tree map...",
      loadingHint: "Fetching components and calculating moves",
      failed: "Failed to load treemap.",
      noData: "No tree map data available",
      tryAnother: "Try another timeframe or refresh in a moment.",
      loadedCompanies: (count) => `Loaded ${count} companies`,
    },
    chart: {
      lineChartLegend: "Line chart: shows closing-price trend for the selected timeframe",
      candleGreen: "Green candle: close is above open",
      candleRed: "Red candle: close is below open",
      volumeGreen: "Green volume bar: up period volume shown below",
      volumeRed: "Red volume bar: down period volume shown below",
      autoLine: "Auto (Line)",
      autoCandles: "Auto (Candles)",
      line: "Line",
      candles: "Candles",
    },
    news: [
      "NVIDIA continues to lead AI strength, with semiconductor ETFs active premarket.",
      "US index futures edge higher as traders wait for inflation and labor data this week.",
      "Apple developer event positioning is lifting turnover across large-cap tech.",
    ],
  },
  zh: {
    nav: {
      title: "Stock Tool",
      subtitle: "美股看盘工作台",
      dashboard: "看盘首页",
      portfolio: "交易记录",
      multiWatch: "多看版",
      treeMap: "树状图",
      toggleLanguage: "切换到英文",
    },
    common: {
      add: "添加",
      remove: "移除",
      rename: "重命名",
      delete: "删除",
      new: "新建",
      live: "实时",
      mock: "模拟",
      loading: "加载中...",
      noData: "暂无数据",
      yahoo: "Yahoo",
    },
    search: {
      placeholder: "搜索股票代码或公司名",
      searching: "搜索中...",
      noSymbols: "没有找到相关股票。",
    },
    dashboard: {
      titleEyebrow: "美股看盘面板",
      title: "美股交易观察工作台",
      description: "支持多 Watch Lists、本地持久化、多时间维度图表和常用均线叠加，适合快速浏览。",
      dataMode: "数据模式",
      watchLists: "自选列表",
      selected: "当前标的",
      createManage: "创建、切换、重命名和删除",
      filterPlaceholder: "按代码或公司名筛选",
      noSymbolsMatch: "当前筛选条件下没有匹配股票。",
      chartSource: "图表来源",
      symbolName: "代码 / 名称",
      changePercent: "涨跌 / 幅度",
      marketCap: "市值",
      valuation: "估值",
      analystView: "分析师观点",
      riskIncome: "风险 / 收益",
      marketState: "市场状态",
      companyIntel: "公司情报",
      qualitySnapshot: "质量快照",
      newsPlaceholder: "新闻占位",
      newsHint: "下一步可以接入真实新闻流。",
      today: "今日",
      loadingCandles: "正在加载图表...",
      waitingSelection: "等待选择标的",
      waitingData: "等待数据",
      sectorPending: "行业信息待加载",
      rangePending: "区间信息待加载",
      volumePending: "量能信息待加载",
      loadedCompanies: (count) => `已加载 ${count} 只股票`,
      sortSymbolAsc: "代码 A-Z",
      sortSymbolDesc: "代码 Z-A",
      sortChangeDesc: "涨幅 高-低",
      sortChangeAsc: "涨幅 低-高",
      sortCustom: "自定义顺序",
      promptNewWatchList: "新 watch list 名称",
      promptRenameWatchList: "重命名 watch list",
      confirmDeleteWatchList: (name) => `确定删除 watch list “${name}” 吗？`,
      defaultWatchListName: (index) => `Watch List ${index}`,
      feedLabel: (isLive) => (isLive ? "实时数据" : "模拟数据"),
    },
    compare: {
      eyebrow: "多看版",
      title: "多标的联看",
      description: "选择任意 watch list，自动生成对应公司的看板，并共享时间维度和均线开关。",
      currentWatchlist: "当前 watch list",
      empty: "这个 watch list 还是空的，先去主页面添加股票吧。",
      loadingQuote: "正在加载报价...",
      loadingMessage: "加载中...",
      failedMessage: "多看版数据加载失败。",
    },
    treemap: {
      eyebrow: "Treemap",
      title: "树状图",
      sp100: "标普 100",
      nasdaq100: "纳斯达克 100",
      watchLists: "自选列表",
      sourceIndex: "指数",
      sourceWatchLists: "自选列表",
      selectedWatchLists: "已选自选列表",
      noWatchListsSelected: "请先勾选一个或多个 watch list，再生成自定义树状图。",
      titleForIndex: (index) => (index === "sp100" ? "标普 100 树状图" : "纳斯达克 100 树状图"),
      description: (title, timeframe) => `面积代表涨跌幅绝对值大小，颜色代表涨跌方向。当前查看 ${title}，范围为 ${timeframe}。`,
      loading: "正在加载树状图...",
      loadingHint: "正在获取成分股并计算区间涨跌幅",
      failed: "树状图加载失败。",
      noData: "当前没有可展示的树状图数据",
      tryAnother: "可以切换时间维度，或者稍后再刷新试试。",
      loadedCompanies: (count) => `已加载 ${count} 只股票`,
    },
    chart: {
      lineChartLegend: "折线图：显示所选周期内的收盘价走势",
      candleGreen: "K线绿色：收盘价高于开盘价",
      candleRed: "K线红色：收盘价低于开盘价",
      volumeGreen: "量能柱绿色：该周期收涨，对应成交量显示在下方",
      volumeRed: "量能柱红色：该周期收跌，对应成交量显示在下方",
      autoLine: "自动（折线）",
      autoCandles: "自动（K线）",
      line: "折线",
      candles: "K线",
    },
    news: [
      "NVIDIA 再次带动 AI 板块走强，半导体 ETF 盘前活跃。",
      "美股主要指数期货小幅走高，市场等待本周通胀与就业数据。",
      "苹果开发者大会临近，大型科技股成交量持续抬升。",
    ],
  },
};

const storageKey = "stock-tool.locale.v1";

type LanguageContextValue = {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function detectBrowserLocale(): Locale {
  if (typeof window === "undefined") {
    return "en";
  }

  const language = window.navigator.language.toLowerCase();
  return language.startsWith("zh") ? "zh" : "en";
}

const localeEvent = "stock-tool-locale-change";
function readLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "zh" || stored === "en") return stored;
  } catch {}
  return detectBrowserLocale();
}
function subscribeLocale(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(localeEvent, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(localeEvent, listener); };
}
function writeLocale(next: Locale) {
  try { window.localStorage.setItem(storageKey, next); } catch {}
  window.dispatchEvent(new Event(localeEvent));
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Server renders English; the client switches to the saved/browser locale right after hydration,
  // so the first client render matches the server HTML (no hydration mismatch).
  const locale = useSyncExternalStore<Locale>(subscribeLocale, readLocale, () => "en");
  const setLocaleState = useCallback((next: Locale | ((current: Locale) => Locale)) => writeLocale(typeof next === "function" ? next(readLocale()) : next), []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      messages: messages[locale],
      setLocale: setLocaleState,
      toggleLocale: () => setLocaleState((current) => (current === "en" ? "zh" : "en")),
    }),
    [locale, setLocaleState],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }

  return context;
}
