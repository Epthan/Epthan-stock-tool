export type PortfolioTrade = { id: string; symbol: string; side: "buy" | "sell"; tradedAt: string; price: number; quantity: number };

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
