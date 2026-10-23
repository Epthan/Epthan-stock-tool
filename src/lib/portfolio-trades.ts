import { applySplits, type StockSplit } from "@/lib/corporate-actions";
import { chronological, lotPosition } from "@/lib/lots";

export type PortfolioTrade = { id: string; symbol: string; side: "buy" | "sell"; tradedAt: string; price: number; quantity: number; note?: string; tags?: string[] };

/** Suggested strategy tags; any short free-text tag is allowed. */
export const SUGGESTED_TAGS: [string, string][] = [["breakout", "突破"], ["dip", "抄底"], ["long-term", "长持"], ["earnings", "财报"], ["momentum", "动量"], ["swing", "波段"], ["value", "价值"], ["hedge", "对冲"]];
export function normalizeTags(input: unknown): string[] | undefined {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[,，;；#\s]+/) : [];
  const tags = [...new Set(list.map((tag) => String(tag).trim().slice(0, 24)).filter(Boolean))].slice(0, 6);
  return tags.length ? tags : undefined;
}

export function tradeDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validatePortfolioTrades(rawTrades: PortfolioTrade[], splits?: StockSplit[]) {
  const trades = applySplits(rawTrades, splits);
  const quantities = new Map<string, number>();
  const ids = new Set<string>();
  for (const trade of chronological(trades)) {
    if (!trade.id || ids.has(trade.id) || !/^[A-Z0-9^][A-Z0-9.^=\-]{0,24}$/.test(trade.symbol) || !["buy", "sell"].includes(trade.side)) throw new Error("INVALID_TRADE");
    ids.add(trade.id);
    if (![trade.price, trade.quantity].every((value) => Number.isFinite(value) && value > 0 && value <= 1e12)) throw new Error("INVALID_AMOUNT");
    if (!Number.isFinite(Date.parse(trade.tradedAt)) || !tradeDate(trade.tradedAt) || tradeDate(trade.tradedAt) > tradeDate(new Date().toISOString())) throw new Error("INVALID_TIME");
    const available = quantities.get(trade.symbol) ?? 0;
    if (trade.side === "sell" && trade.quantity > available + 1e-8) throw new Error("INSUFFICIENT_SHARES");
    quantities.set(trade.symbol, Math.max(0, available + (trade.side === "buy" ? trade.quantity : -trade.quantity)));
  }
}

/**
 * Position on today's share basis (pre-split trades are restated), on parcel (FIFO) accounting:
 * averageCost = cost of the parcels still held ÷ shares; realized = proceeds − cost of the parcels sold.
 */
export function getTradePosition(rawTrades: PortfolioTrade[], symbol: string, splits?: StockSplit[]) {
  const { quantity, averageCost, realized } = lotPosition(applySplits(rawTrades.filter((item) => item.symbol === symbol), splits), symbol);
  return { quantity, averageCost, realized };
}

/**
 * Convert records from the retired `/portfolio` trade log (stock-tool.portfolio-trades.v1)
 * into portfolio trades. Records are replayed in date order; any record that would fail
 * validation (bad fields, future date, or selling more than held) is skipped and counted.
 */
export function importLegacyTrades(raw: unknown): { trades: PortfolioTrade[]; skipped: number } {
  if (!Array.isArray(raw)) return { trades: [], skipped: 0 };
  const candidates = raw
    .map((item): PortfolioTrade | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const symbol = typeof record.symbol === "string" ? record.symbol.trim().toUpperCase() : "";
      const side = record.side === "sell" ? "sell" : record.side === "buy" ? "buy" : null;
      const tradedAt = typeof record.tradedAt === "string" ? tradeDate(record.tradedAt) : "";
      const price = Number(record.price);
      const quantity = Number(record.quantity);
      if (!symbol || !side || !tradedAt) return null;
      const note = typeof record.note === "string" && record.note.trim() ? record.note.trim().slice(0, 500) : undefined;
      return { id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(), symbol, side, tradedAt, price: Math.round((price + Number.EPSILON) * 100) / 100, quantity, ...(note ? { note } : {}) };
    });
  let skipped = candidates.filter((item) => !item).length;
  const accepted: PortfolioTrade[] = [];
  const ordered = (candidates.filter(Boolean) as PortfolioTrade[]).sort((left, right) => left.tradedAt.localeCompare(right.tradedAt) || (left.side === right.side ? 0 : left.side === "buy" ? -1 : 1));
  for (const trade of ordered) {
    try { validatePortfolioTrades([...accepted, trade]); accepted.push(trade); } catch { skipped += 1; }
  }
  return { trades: accepted, skipped };
}
