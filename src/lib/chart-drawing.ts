/**
 * Chart drawings anchored to (time, price), so a line stays on the same date and price when the chart
 * is re-created, restyled or switched to another timeframe. Time ↔ logical bar index is interpolated
 * between bars and extrapolated past either end with the typical bar spacing (lines can extend into
 * the future).
 */
export type DrawingTool = "trend" | "ray" | "hline" | "rect" | "fib";
export type AnchorPoint = { time: number; price: number };
export type Drawing = { id: string; tool: DrawingTool; points: AnchorPoint[] };

export const TOOL_POINTS: Record<DrawingTool, 1 | 2> = { trend: 2, ray: 2, hline: 1, rect: 2, fib: 2 };
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function timeMapper(times: number[]) {
  const n = times.length;
  const recent = times.slice(-51);
  const sorted = recent.slice(1).map((time, index) => time - recent[index]).filter((gap) => gap > 0).sort((a, b) => a - b);
  const step = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 86400;
  /** Bar index (fractional) → unix time. */
  const toTime = (logical: number) => {
    if (!n) return logical * step;
    if (logical <= 0) return times[0] + logical * step;
    if (logical >= n - 1) return times[n - 1] + (logical - (n - 1)) * step;
    const left = Math.floor(logical);
    return times[left] + (times[left + 1] - times[left]) * (logical - left);
  };
  /** Unix time → bar index (fractional). */
  const toLogical = (time: number) => {
    if (!n) return time / step;
    if (time <= times[0]) return (time - times[0]) / step;
    if (time >= times[n - 1]) return n - 1 + (time - times[n - 1]) / step;
    let low = 0, high = n - 1;
    while (high - low > 1) { const mid = (low + high) >> 1; if (times[mid] <= time) low = mid; else high = mid; }
    return low + (time - times[low]) / (times[high] - times[low]);
  };
  return { toTime, toLogical, step };
}

/** Nearest open / high / low / close of the bar under the pointer, when it is within `radius` pixels. */
export function snapPrice(price: number, bar: { open: number; high: number; low: number; close: number } | undefined, priceToY: (price: number) => number | null, y: number, radius = 10) {
  if (!bar) return price;
  let best = price, distance = radius;
  for (const value of [bar.open, bar.high, bar.low, bar.close]) {
    const at = priceToY(value);
    if (at != null && Math.abs(at - y) <= distance) { distance = Math.abs(at - y); best = value; }
  }
  return best;
}

/** Fibonacci retracement levels from the first point (0%) to the second (100%). */
export const fibLevels = (from: number, to: number) => FIB_LEVELS.map((level) => ({ level, price: to + (from - to) * level }));
