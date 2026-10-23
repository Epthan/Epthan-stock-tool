import { tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";

/**
 * Parcel (lot) accounting. Every buy opens a parcel; every sell closes parcels first-in, first-out.
 * This is the single source of truth for cost, realised P&L, holding periods and capital-gains events,
 * so the trade log, the portfolio analytics and the tax report always agree.
 *
 * Trades must already be on today's share basis (applySplits) — a split changes quantity and unit cost
 * but not the parcel's acquisition date or total cost.
 */
export type Lot = { tradeId: string; symbol: string; acquiredAt: string; quantity: number; unitCost: number; tags: string[] };
export type LotMatch = { tradeId: string; acquiredAt: string; quantity: number; unitCost: number; tags: string[] };
export type Disposal = {
  tradeId: string; symbol: string; disposedAt: string; quantity: number; price: number;
  matches: LotMatch[]; costBase: number; proceeds: number; gain: number; note?: string; tags?: string[];
};

const EPS = 1e-9;

/** Date order, buys before sells on the same day (a same-day round trip needs the buy first). */
export function chronological(trades: PortfolioTrade[]) {
  return [...trades].sort((left, right) => tradeDate(left.tradedAt).localeCompare(tradeDate(right.tradedAt)) || (left.side === right.side ? 0 : left.side === "buy" ? -1 : 1));
}

export function buildLots(trades: PortfolioTrade[]) {
  const open = new Map<string, Lot[]>();
  const disposals: Disposal[] = [];
  for (const trade of chronological(trades)) {
    const date = tradeDate(trade.tradedAt);
    const lots = open.get(trade.symbol) ?? [];
    if (trade.side === "buy") {
      lots.push({ tradeId: trade.id, symbol: trade.symbol, acquiredAt: date, quantity: trade.quantity, unitCost: trade.price, tags: trade.tags ?? [] });
      open.set(trade.symbol, lots);
      continue;
    }
    let remaining = trade.quantity;
    const matches: LotMatch[] = [];
    while (remaining > EPS && lots.length) {
      const lot = lots[0];
      const used = Math.min(lot.quantity, remaining);
      matches.push({ tradeId: lot.tradeId, acquiredAt: lot.acquiredAt, quantity: used, unitCost: lot.unitCost, tags: lot.tags });
      lot.quantity -= used;
      remaining -= used;
      if (lot.quantity <= EPS) lots.shift();
    }
    const sold = trade.quantity - Math.max(0, remaining);
    const costBase = matches.reduce((sum, match) => sum + match.quantity * match.unitCost, 0);
    const proceeds = sold * trade.price;
    disposals.push({ tradeId: trade.id, symbol: trade.symbol, disposedAt: date, quantity: sold, price: trade.price, matches, costBase, proceeds, gain: proceeds - costBase, note: trade.note, tags: trade.tags });
    open.set(trade.symbol, lots);
  }
  const openLots = [...open.values()].flat().filter((lot) => lot.quantity > EPS);
  return { openLots, disposals };
}

/** Position summary for one symbol: shares held, cost of the remaining parcels, realised P&L of closed parcels. */
export function lotPosition(trades: PortfolioTrade[], symbol: string) {
  const { openLots, disposals } = buildLots(trades.filter((trade) => trade.symbol === symbol));
  const quantity = openLots.reduce((sum, lot) => sum + lot.quantity, 0);
  const cost = openLots.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0);
  const realized = disposals.reduce((sum, disposal) => sum + disposal.gain, 0);
  return { quantity: quantity > 1e-8 ? quantity : 0, cost: quantity > 1e-8 ? cost : 0, averageCost: quantity > 1e-8 ? cost / quantity : null, realized, lots: openLots, disposals };
}
