/**
 * Currency helpers. Yahoo quotes some markets in minor units (GBp = pence, ZAc = cents, ILA = agorot);
 * those are normalised to the major currency. FX series are Yahoo "XXXYYY=X" daily closes.
 */
export const BASE_CURRENCIES = ["USD", "AUD", "CNY", "HKD", "EUR", "GBP", "CAD", "JPY", "SGD", "NZD"] as const;
const minor: Record<string, [string, number]> = { GBp: ["GBP", 100], GBX: ["GBP", 100], ZAc: ["ZAR", 100], ILA: ["ILS", 100] };

export function normalizeCurrency(code: string | undefined | null): { currency: string; divisor: number } {
  if (!code) return { currency: "USD", divisor: 1 };
  const hit = minor[code];
  return hit ? { currency: hit[0], divisor: hit[1] } : { currency: code.toUpperCase(), divisor: 1 };
}

export const fxSymbol = (from: string, to: string) => `${from}${to}=X`;

export type RatePoint = { date: string; rate: number };

/** Rate on a date: last published rate on or before it, else the first one after (trades before the series starts). */
export function rateOn(series: RatePoint[] | undefined, date: string): number | null {
  if (!series?.length) return null;
  let low = 0, high = series.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (series[mid].date <= date) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  return (found >= 0 ? series[found] : series[0]).rate;
}
