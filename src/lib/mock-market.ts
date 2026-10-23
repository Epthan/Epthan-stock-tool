import type { SupportedMarket } from "@/lib/market-symbols";

export type Trend = "up" | "down";

export type QuoteCard = {
  symbol: string;
  name: string;
  market?: SupportedMarket;
  exchange?: string;
  currency?: string;
  price: number;
  change: number;
  changePercent: number;
  trend: Trend;
};

export type WatchlistRow = {
  symbol: string;
  name: string;
  market: SupportedMarket;
  exchange: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  trend: Trend;
};

export type SparklinePoint = {
  time: number;
  close: number;
};

export type CandlePoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TimeframeKey =
  | "1D"
  | "2D"
  | "5D"
  | "1W"
  | "1M"
  | "3M"
  | "6M"
  | "1Y"
  | "5Y"
  | "10Y"
  | "MAX";

export type MovingAverageKey = 5 | 10 | 20 | 50 | 200;

export const marketSymbols = {
  indexes: ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "^TNX"] as const,
  watchlist: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA"] as const,
};

export const defaultWatchlist = [...marketSymbols.watchlist];

export const timeframeLabels: TimeframeKey[] = ["1D", "2D", "5D", "1W", "1M", "3M", "6M", "1Y", "5Y", "10Y", "MAX"];

export const movingAverageLabels: MovingAverageKey[] = [5, 10, 20, 50, 200];

export const symbolMeta: Record<string, string> = {
  SPY: "S&P 500 ETF",
  QQQ: "Nasdaq 100 ETF",
  DIA: "Dow Jones ETF",
  IWM: "Russell 2000 ETF",
  AAPL: "Apple",
  MSFT: "Microsoft",
  NVDA: "NVIDIA",
  AMZN: "Amazon",
  META: "Meta",
  TSLA: "Tesla",
};

export const mockProviderPlan = {
  provider: "mock",
  supportsRealtime: false,
  nextCandidates: ["yahoo"],
};

export const mockIndexes: QuoteCard[] = [
  { symbol: "SPY", name: "S&P 500 ETF", market: "US", exchange: "NYSE Arca", currency: "USD", price: 529.84, change: 4.22, changePercent: 0.8, trend: "up" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", market: "US", exchange: "NasdaqGM", currency: "USD", price: 455.37, change: 6.11, changePercent: 1.36, trend: "up" },
  { symbol: "DIA", name: "Dow Jones ETF", market: "US", exchange: "NYSE Arca", currency: "USD", price: 392.18, change: -0.74, changePercent: -0.19, trend: "down" },
  { symbol: "IWM", name: "Russell 2000 ETF", market: "US", exchange: "NYSE Arca", currency: "USD", price: 207.5, change: 1.18, changePercent: 0.57, trend: "up" },
];

export const mockWatchlist: WatchlistRow[] = [
  { symbol: "AAPL", name: "Apple", market: "US", exchange: "NasdaqGS", currency: "USD", price: 214.93, change: 2.38, changePercent: 1.12, volume: 54800000, trend: "up" },
  { symbol: "MSFT", name: "Microsoft", market: "US", exchange: "NasdaqGS", currency: "USD", price: 468.21, change: 2.99, changePercent: 0.64, volume: 21900000, trend: "up" },
  { symbol: "NVDA", name: "NVIDIA", market: "US", exchange: "NasdaqGS", currency: "USD", price: 1178.44, change: 32.64, changePercent: 2.85, volume: 48200000, trend: "up" },
  { symbol: "AMZN", name: "Amazon", market: "US", exchange: "NasdaqGS", currency: "USD", price: 183.4, change: -0.57, changePercent: -0.31, volume: 35500000, trend: "down" },
  { symbol: "META", name: "Meta", market: "US", exchange: "NasdaqGS", currency: "USD", price: 501.26, change: 4.58, changePercent: 0.92, volume: 17300000, trend: "up" },
  { symbol: "TSLA", name: "Tesla", market: "US", exchange: "NasdaqGS", currency: "USD", price: 176.89, change: -2.58, changePercent: -1.44, volume: 88100000, trend: "down" },
];

export const mockSparklines: Record<string, SparklinePoint[]> = {
  AAPL: [
    { time: 1, close: 208.2 },
    { time: 2, close: 209.1 },
    { time: 3, close: 209.8 },
    { time: 4, close: 210.4 },
    { time: 5, close: 211.6 },
    { time: 6, close: 212.1 },
    { time: 7, close: 211.4 },
    { time: 8, close: 212.9 },
    { time: 9, close: 213.7 },
    { time: 10, close: 214.3 },
    { time: 11, close: 214.1 },
    { time: 12, close: 214.93 },
  ],
  MSFT: [
    { time: 1, close: 455.7 },
    { time: 2, close: 456.9 },
    { time: 3, close: 458.4 },
    { time: 4, close: 459.2 },
    { time: 5, close: 460.8 },
    { time: 6, close: 462.6 },
    { time: 7, close: 463.5 },
    { time: 8, close: 464.1 },
    { time: 9, close: 465.8 },
    { time: 10, close: 466.9 },
    { time: 11, close: 467.4 },
    { time: 12, close: 468.21 },
  ],
  NVDA: [
    { time: 1, close: 1112.1 },
    { time: 2, close: 1125.4 },
    { time: 3, close: 1131.8 },
    { time: 4, close: 1146.3 },
    { time: 5, close: 1154.9 },
    { time: 6, close: 1162.7 },
    { time: 7, close: 1160.8 },
    { time: 8, close: 1168.5 },
    { time: 9, close: 1171.9 },
    { time: 10, close: 1174.4 },
    { time: 11, close: 1176.2 },
    { time: 12, close: 1178.44 },
  ],
  AMZN: [
    { time: 1, close: 186.2 },
    { time: 2, close: 185.7 },
    { time: 3, close: 185.1 },
    { time: 4, close: 184.5 },
    { time: 5, close: 184.9 },
    { time: 6, close: 184.4 },
    { time: 7, close: 183.9 },
    { time: 8, close: 183.7 },
    { time: 9, close: 183.4 },
    { time: 10, close: 183.8 },
    { time: 11, close: 183.6 },
    { time: 12, close: 183.4 },
  ],
  META: [
    { time: 1, close: 490.7 },
    { time: 2, close: 492.4 },
    { time: 3, close: 493.9 },
    { time: 4, close: 495.6 },
    { time: 5, close: 496.4 },
    { time: 6, close: 497.1 },
    { time: 7, close: 498.2 },
    { time: 8, close: 499.4 },
    { time: 9, close: 500.6 },
    { time: 10, close: 500.1 },
    { time: 11, close: 500.8 },
    { time: 12, close: 501.26 },
  ],
  TSLA: [
    { time: 1, close: 184.8 },
    { time: 2, close: 183.1 },
    { time: 3, close: 181.7 },
    { time: 4, close: 180.9 },
    { time: 5, close: 180.1 },
    { time: 6, close: 179.4 },
    { time: 7, close: 178.6 },
    { time: 8, close: 178.2 },
    { time: 9, close: 177.6 },
    { time: 10, close: 177.1 },
    { time: 11, close: 176.7 },
    { time: 12, close: 176.89 },
  ],
};

function toUnixTime(value: string) {
  return Math.floor(new Date(value).getTime() / 1000);
}

export const mockCandles: CandlePoint[] = [
  { time: toUnixTime("2026-05-06T00:00:00Z"), open: 198.2, high: 201.8, low: 197.6, close: 200.9, volume: 41700000 },
  { time: toUnixTime("2026-05-07T00:00:00Z"), open: 201.1, high: 204.2, low: 200.4, close: 203.4, volume: 38900000 },
  { time: toUnixTime("2026-05-08T00:00:00Z"), open: 203.7, high: 205.5, low: 201.8, close: 202.4, volume: 36200000 },
  { time: toUnixTime("2026-05-09T00:00:00Z"), open: 202.3, high: 206.1, low: 201.7, close: 205.7, volume: 45100000 },
  { time: toUnixTime("2026-05-12T00:00:00Z"), open: 205.9, high: 208.6, low: 204.9, close: 207.8, volume: 47600000 },
  { time: toUnixTime("2026-05-13T00:00:00Z"), open: 207.5, high: 209.1, low: 205.2, close: 206.3, volume: 43800000 },
  { time: toUnixTime("2026-05-14T00:00:00Z"), open: 206.1, high: 210.4, low: 205.9, close: 209.8, volume: 49300000 },
  { time: toUnixTime("2026-05-15T00:00:00Z"), open: 210, high: 211.5, low: 207.7, close: 208.4, volume: 44100000 },
  { time: toUnixTime("2026-05-16T00:00:00Z"), open: 208.9, high: 212.2, low: 208.1, close: 211.6, volume: 52200000 },
  { time: toUnixTime("2026-05-19T00:00:00Z"), open: 211.9, high: 214.4, low: 210.5, close: 213.8, volume: 53400000 },
  { time: toUnixTime("2026-05-20T00:00:00Z"), open: 213.3, high: 214.8, low: 211.2, close: 212.4, volume: 49700000 },
  { time: toUnixTime("2026-05-21T00:00:00Z"), open: 212.1, high: 215.1, low: 211.7, close: 214.6, volume: 55700000 },
  { time: toUnixTime("2026-05-22T00:00:00Z"), open: 214.7, high: 216.2, low: 213.4, close: 215.4, volume: 50900000 },
  { time: toUnixTime("2026-05-23T00:00:00Z"), open: 215, high: 216.5, low: 212.8, close: 213.6, volume: 46100000 },
  { time: toUnixTime("2026-05-27T00:00:00Z"), open: 213.9, high: 217.2, low: 213.1, close: 216.7, volume: 58800000 },
  { time: toUnixTime("2026-05-28T00:00:00Z"), open: 216.4, high: 217.8, low: 214.2, close: 215.9, volume: 55100000 },
  { time: toUnixTime("2026-05-29T00:00:00Z"), open: 216, high: 218.1, low: 214.7, close: 217.4, volume: 61200000 },
  { time: toUnixTime("2026-05-30T00:00:00Z"), open: 217.1, high: 219.4, low: 215.8, close: 218.8, volume: 62400000 },
];

export const mockNews = [
  "NVIDIA 再次带动 AI 板块走强，半导体 ETF 盘前活跃。",
  "美股主要指数期货小幅走高，市场等待本周通胀与就业数据。",
  "苹果开发者大会临近，大型科技股成交量持续抬升。",
];

export const mockMarketBreadth = {
  advance: 61,
  decline: 39,
  highs52w: 143,
  lows52w: 18,
};
