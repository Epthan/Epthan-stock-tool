import type { PortfolioTrade } from "@/lib/portfolio-trades";

/**
 * Share splits. Yahoo's daily closes are split-adjusted for the whole history, so trades recorded
 * at the real (pre-split) quantity and price are restated onto the same basis before any valuation:
 * a 10-for-1 split turns "buy 10 @ 400" (before the split) into "buy 100 @ 40". The stored records stay as typed.
 */
export type StockSplit = { symbol: string; date: string; ratio: number };

export function splitFactor(splits: StockSplit[] | undefined, symbol: string, tradedAt: string) {
  if (!splits?.length) return 1;
  const date = tradedAt.slice(0, 10);
  return splits.reduce((factor, split) => (split.symbol === symbol && date < split.date ? factor * split.ratio : factor), 1);
}

export function applySplits(trades: PortfolioTrade[], splits: StockSplit[] | undefined): PortfolioTrade[] {
  if (!splits?.length) return trades;
  return trades.map((trade) => {
    const factor = splitFactor(splits, trade.symbol, trade.tradedAt);
    return factor === 1 ? trade : { ...trade, quantity: trade.quantity * factor, price: trade.price / factor };
  });
}

export function sameSplits(left: StockSplit[] | undefined, right: StockSplit[] | undefined) {
  const key = (list: StockSplit[] | undefined) => (list ?? []).map((split) => `${split.symbol}|${split.date}|${split.ratio}`).sort().join(",");
  return key(left) === key(right);
}

export function splitLabel(ratio: number) {
  if (ratio >= 1) return `1 → ${Number.isInteger(ratio) ? ratio : ratio.toFixed(2)}`;
  const inverse = 1 / ratio;
  return `${Number.isInteger(inverse) ? inverse : inverse.toFixed(2)} → 1`;
}
