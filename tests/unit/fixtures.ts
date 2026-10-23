import type { SecurityHistory } from "@/lib/live-portfolio";

/** Weekday calendar starting 2024-01-02. */
export function tradingDays(count: number, from = "2024-01-02") {
  const days: string[] = [];
  const date = new Date(`${from}T00:00:00Z`);
  while (days.length < count) {
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

export function series(symbol: string, days: string[], price: (index: number) => number, currency = "USD"): SecurityHistory {
  return { symbol, name: symbol, currency, prices: days.map((date, index) => ({ date, close: price(index) })) };
}
