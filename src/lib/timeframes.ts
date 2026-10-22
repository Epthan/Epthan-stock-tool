import type { TimeframeKey } from "@/lib/mock-market";

export const validTimeframes: TimeframeKey[] = ["1D", "2D", "5D", "1W", "1M", "3M", "6M", "1Y", "5Y", "10Y", "MAX"];

export function normalizeTimeframe(value: string | null, fallback: TimeframeKey): TimeframeKey {
  const timeframe = value?.toUpperCase() as TimeframeKey | undefined;

  if (timeframe && validTimeframes.includes(timeframe)) {
    return timeframe;
  }

  return fallback;
}
