export type PortfolioTrade = { id: string; symbol: string; side: "buy" | "sell"; tradedAt: string; price: number; quantity: number; note?: string };

export function tradeDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validatePortfolioTrades(trades: PortfolioTrade[]) {
  const quantities = new Map<string, number>();
  const ids = new Set<string>();
  for (const trade of [...trades].sort((left, right) => tradeDate(left.tradedAt).localeCompare(tradeDate(right.tradedAt)))) {
    if (!trade.id || ids.has(trade.id) || !/^[A-Z0-9^][A-Z0-9.^=\-]{0,24}$/.test(trade.symbol) || !["buy", "sell"].includes(trade.side)) throw new Error("INVALID_TRADE");
    ids.add(trade.id);
    if (![trade.price, trade.quantity].every((value) => Number.isFinite(value) && value > 0 && value <= 1e12)) throw new Error("INVALID_AMOUNT");
    if (!Number.isFinite(Date.parse(trade.tradedAt)) || !tradeDate(trade.tradedAt) || tradeDate(trade.tradedAt) > tradeDate(new Date().toISOString())) throw new Error("INVALID_TIME");
    const available = quantities.get(trade.symbol) ?? 0;
    if (trade.side === "sell" && trade.quantity > available + 1e-8) throw new Error("INSUFFICIENT_SHARES");
    quantities.set(trade.symbol, Math.max(0, available + (trade.side === "buy" ? trade.quantity : -trade.quantity)));
  }
}

export function getTradePosition(trades: PortfolioTrade[], symbol: string) {
  let quantity = 0;
  let cost = 0;
  let realized = 0;
  for (const trade of trades.filter((item) => item.symbol === symbol).sort((left, right) => tradeDate(left.tradedAt).localeCompare(tradeDate(right.tradedAt)))) {
    if (trade.side === "buy") { quantity += trade.quantity; cost += trade.quantity * trade.price; }
    else {
      const basis = quantity > 0 ? cost / quantity : 0;
      realized += trade.quantity * (trade.price - basis);
      quantity = Math.max(0, quantity - trade.quantity);
      cost = quantity > 1e-8 ? Math.max(0, cost - basis * trade.quantity) : 0;
    }
  }
  return { quantity, averageCost: quantity > 1e-8 ? cost / quantity : null, realized };
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
