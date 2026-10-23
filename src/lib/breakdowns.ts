import type { LivePortfolioAnalysis } from "@/lib/live-portfolio";

/**
 * Groupings that answer "where does my money come from": sector, holding period and strategy tag.
 * All P&L figures are in the analysis currency.
 */
export type SectorInfo = { sector: string; industry?: string };
export type GroupRow = { key: string; count: number; pnl: number; realized: number; unrealized: number; weight: number | null; winRate: number | null; averageReturn: number | null; averageDays: number | null };

const HOLDING_BUCKETS: [string, number][] = [["≤7d", 7], ["8–30d", 30], ["31–90d", 90], ["91–365d", 365], [">1y", Infinity]];
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

export function buildBreakdowns(data: Pick<LivePortfolioAnalysis, "holdings" | "trading" | "value">, sectors: Record<string, SectorInfo>) {
  const closed = data.trading.closed;
  const holdings = data.holdings;
  const total = data.value;

  // Sector: period contribution (includes closed positions) and current weight.
  const sectorMap = new Map<string, GroupRow>();
  for (const holding of holdings) {
    const key = sectors[holding.symbol]?.sector || "Unknown";
    const row = sectorMap.get(key) ?? { key, count: 0, pnl: 0, realized: 0, unrealized: 0, weight: 0, winRate: null, averageReturn: null, averageDays: null };
    row.count += holding.quantity > 1e-8 ? 1 : 0;
    row.pnl += holding.contribution;
    row.unrealized += holding.unrealized;
    row.realized += holding.realized;
    row.weight = (row.weight ?? 0) + (total > 0 ? holding.value / total * 100 : 0);
    sectorMap.set(key, row);
  }

  // Holding period: closed trades in the period, by how long the sold shares were held (FIFO).
  const byHolding: GroupRow[] = HOLDING_BUCKETS.map(([key, max], index) => {
    const min = index ? HOLDING_BUCKETS[index - 1][1] : -1;
    const trades = closed.filter((trade) => trade.holdingDays > min && trade.holdingDays <= max);
    return { key, count: trades.length, pnl: trades.reduce((sum, trade) => sum + trade.pnl, 0), realized: trades.reduce((sum, trade) => sum + trade.pnl, 0), unrealized: 0, weight: null, winRate: trades.length ? trades.filter((trade) => trade.pnl > 0).length / trades.length * 100 : null, averageReturn: mean(trades.map((trade) => trade.returnPercent)), averageDays: mean(trades.map((trade) => trade.holdingDays)) };
  }).filter((row) => row.count > 0);

  // Tags: realized P&L of closed lots split by their entry tags + unrealized P&L of open lots.
  const tagMap = new Map<string, { row: GroupRow; wins: number; returns: number[]; days: number[] }>();
  const tagRow = (key: string) => {
    const hit = tagMap.get(key) ?? { row: { key, count: 0, pnl: 0, realized: 0, unrealized: 0, weight: 0, winRate: null, averageReturn: null, averageDays: null }, wins: 0, returns: [], days: [] };
    tagMap.set(key, hit);
    return hit;
  };
  for (const trade of closed) {
    for (const { tag, share } of trade.tagShares) {
      const hit = tagRow(tag);
      hit.row.count += 1;
      hit.row.realized += trade.pnl * share;
      if (trade.pnl > 0) hit.wins += 1;
      hit.returns.push(trade.returnPercent);
      hit.days.push(trade.holdingDays);
    }
  }
  const bySymbol = new Map(holdings.map((holding) => [holding.symbol, holding]));
  for (const lot of data.trading.openLots) {
    const holding = bySymbol.get(lot.symbol);
    if (!holding?.price || holding.averageCost == null) continue;
    const tags = lot.tags.length ? lot.tags : ["__untagged"];
    for (const tag of tags) {
      const hit = tagRow(tag);
      hit.row.unrealized += lot.quantity * (holding.price - holding.averageCost) / tags.length;
      hit.row.weight = (hit.row.weight ?? 0) + (total > 0 ? lot.quantity * holding.price / total * 100 / tags.length : 0);
    }
  }
  const byTag = [...tagMap.values()].map(({ row, wins, returns, days }) => ({ ...row, pnl: row.realized + row.unrealized, winRate: row.count ? wins / row.count * 100 : null, averageReturn: mean(returns), averageDays: mean(days) }));

  const sort = (rows: GroupRow[]) => rows.sort((left, right) => right.pnl - left.pnl);
  return { bySector: sort([...sectorMap.values()]), byHolding, byTag: sort(byTag), tagged: byTag.some((row) => row.key !== "__untagged") };
}
export type Breakdowns = ReturnType<typeof buildBreakdowns>;
/** What the analysis API returns: the core analysis plus groupings. */
export type AnalysisResult = LivePortfolioAnalysis & { groups?: Breakdowns; sectors?: Record<string, SectorInfo> };

const sectorZh: Record<string, string> = {
  Technology: "科技", "Financial Services": "金融", Healthcare: "医疗健康", "Consumer Cyclical": "可选消费", "Consumer Defensive": "必需消费",
  "Communication Services": "通信服务", Industrials: "工业", Energy: "能源", "Basic Materials": "原材料", "Real Estate": "房地产", Utilities: "公用事业",
  "ETF / Fund": "ETF / 基金", Unknown: "未知",
};
export const sectorLabel = (key: string, zh: boolean) => (zh ? sectorZh[key] ?? key : key);
export const holdingLabel = (key: string, zh: boolean) => (zh ? ({ "≤7d": "≤7 天", "8–30d": "8–30 天", "31–90d": "31–90 天", "91–365d": "91–365 天", ">1y": "1 年以上" } as Record<string, string>)[key] ?? key : key);
