import type { PortfolioTrade } from "@/lib/portfolio-trades";

/**
 * Your actual trades in one stock over a backtest window, on the same footing as the strategy:
 * P&L is marked to market each day (position at the window start is counted at that day's close),
 * and the curve is scaled so that your largest exposure in the window equals the backtest capital.
 */
export function realTradeCurve(trades: PortfolioTrade[], prices: { date: string; close: number }[], capital: number) {
  if (!prices.length) return null;
  const ordered = [...trades].sort((left, right) => left.tradedAt.localeCompare(right.tradedAt));
  const start = prices[0].date;
  let quantity = ordered.filter((trade) => trade.tradedAt < start).reduce((sum, trade) => sum + (trade.side === "buy" ? trade.quantity : -trade.quantity), 0);
  const startValue = Math.max(0, quantity) * prices[0].close;
  let cash = 0;
  let cursor = ordered.findIndex((trade) => trade.tradedAt >= start);
  if (cursor < 0) cursor = ordered.length;
  const inWindow = ordered.filter((trade) => trade.tradedAt >= start && trade.tradedAt <= prices.at(-1)!.date);
  const raw: { date: string; pnl: number; exposure: number; quantity: number }[] = [];
  for (const price of prices) {
    while (cursor < ordered.length && ordered[cursor].tradedAt <= price.date) {
      const trade = ordered[cursor++];
      quantity += trade.side === "buy" ? trade.quantity : -trade.quantity;
      cash += (trade.side === "sell" ? 1 : -1) * trade.quantity * trade.price;
    }
    const value = Math.max(0, quantity) * price.close;
    raw.push({ date: price.date, pnl: value + cash - startValue, exposure: value, quantity });
  }
  const maxExposure = Math.max(...raw.map((row) => row.exposure), startValue);
  if (!inWindow.length && startValue <= 0) return null;
  const scale = maxExposure > 0 ? capital / maxExposure : 0;
  const final = raw.at(-1)!;
  return {
    points: raw.map((row) => ({ date: row.date, equity: capital + row.pnl * scale, quantity: row.quantity })),
    trades: inWindow,
    pnl: final.pnl,
    maxExposure,
    returnOnExposure: maxExposure > 0 ? final.pnl / maxExposure * 100 : null,
    heldAtStart: startValue > 0,
  };
}
