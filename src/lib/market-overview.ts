/**
 * US market overview: the indexes, sectors and macro gauges worth checking besides tech.
 * Symbols are Yahoo Finance tickers; ^-prefixed ones are indexes, X?? are SPDR sector ETFs.
 */
export type OverviewKind = "index" | "volatility" | "yield" | "etf" | "fx" | "commodity" | "crypto";
export type OverviewItem = { symbol: string; en: string; zh: string; kind: OverviewKind };
export type OverviewGroup = { id: string; en: string; zh: string; items: OverviewItem[] };

export const CORE_INDEXES: OverviewItem[] = [
  { symbol: "^GSPC", en: "S&P 500", zh: "标普 500", kind: "index" },
  { symbol: "^DJI", en: "Dow Jones", zh: "道琼斯", kind: "index" },
  { symbol: "^IXIC", en: "Nasdaq", zh: "纳斯达克", kind: "index" },
  { symbol: "^RUT", en: "Russell 2000", zh: "罗素 2000", kind: "index" },
  { symbol: "^VIX", en: "VIX", zh: "VIX 恐慌指数", kind: "volatility" },
  { symbol: "^TNX", en: "US 10Y", zh: "10 年美债", kind: "yield" },
];

export const OVERVIEW_GROUPS: OverviewGroup[] = [
  { id: "broad", en: "Broad market & style", zh: "大盘与风格", items: [
    ...CORE_INDEXES.slice(0, 4),
    { symbol: "^NDX", en: "Nasdaq 100", zh: "纳斯达克 100", kind: "index" },
    { symbol: "^NYA", en: "NYSE Composite", zh: "纽交所综合", kind: "index" },
    { symbol: "^SP400", en: "S&P MidCap 400", zh: "标普中盘 400", kind: "index" },
    { symbol: "RSP", en: "S&P 500 Equal Weight", zh: "标普 500 等权", kind: "etf" },
    { symbol: "IWD", en: "Russell 1000 Value", zh: "罗素 1000 价值", kind: "etf" },
    { symbol: "IWF", en: "Russell 1000 Growth", zh: "罗素 1000 成长", kind: "etf" },
  ] },
  { id: "sectors", en: "S&P 500 sectors", zh: "标普 500 行业", items: [
    { symbol: "XLK", en: "Technology", zh: "科技", kind: "etf" },
    { symbol: "XLC", en: "Communication", zh: "通信服务", kind: "etf" },
    { symbol: "XLY", en: "Consumer Discretionary", zh: "可选消费", kind: "etf" },
    { symbol: "XLP", en: "Consumer Staples", zh: "必需消费", kind: "etf" },
    { symbol: "XLV", en: "Health Care", zh: "医疗保健", kind: "etf" },
    { symbol: "XLF", en: "Financials", zh: "金融", kind: "etf" },
    { symbol: "XLI", en: "Industrials", zh: "工业", kind: "etf" },
    { symbol: "XLE", en: "Energy", zh: "能源", kind: "etf" },
    { symbol: "XLB", en: "Materials", zh: "原材料", kind: "etf" },
    { symbol: "XLRE", en: "Real Estate", zh: "房地产", kind: "etf" },
    { symbol: "XLU", en: "Utilities", zh: "公用事业", kind: "etf" },
  ] },
  { id: "macro", en: "Risk, rates, dollar & commodities", zh: "风险、利率、美元与商品", items: [
    CORE_INDEXES[4],
    { symbol: "^IRX", en: "US 3M bill", zh: "3 个月美债", kind: "yield" },
    { symbol: "^FVX", en: "US 5Y", zh: "5 年美债", kind: "yield" },
    CORE_INDEXES[5],
    { symbol: "^TYX", en: "US 30Y", zh: "30 年美债", kind: "yield" },
    { symbol: "DX-Y.NYB", en: "US Dollar Index", zh: "美元指数", kind: "fx" },
    { symbol: "GC=F", en: "Gold", zh: "黄金", kind: "commodity" },
    { symbol: "CL=F", en: "WTI crude", zh: "WTI 原油", kind: "commodity" },
    { symbol: "HG=F", en: "Copper", zh: "铜", kind: "commodity" },
    { symbol: "BTC-USD", en: "Bitcoin", zh: "比特币", kind: "crypto" },
  ] },
];

export const OVERVIEW_ITEMS = new Map(OVERVIEW_GROUPS.flatMap((group) => group.items).concat(CORE_INDEXES).map((item) => [item.symbol, item]));
export const overviewName = (symbol: string, zh: boolean) => { const item = OVERVIEW_ITEMS.get(symbol); return item ? (zh ? item.zh : item.en) : symbol; };

/** Yields are quoted in percent: show "4.25%" and the change in basis points. */
export function formatOverview(symbol: string, price: number, change: number, changePercent: number) {
  const kind = OVERVIEW_ITEMS.get(symbol)?.kind;
  if (kind === "yield") return { value: `${price.toFixed(2)}%`, change: `${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(0)} bp` };
  const digits = price >= 1000 ? 0 : 2;
  return { value: price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }), change: `${changePercent >= 0 ? "+" : "−"}${Math.abs(changePercent).toFixed(2)}%` };
}
