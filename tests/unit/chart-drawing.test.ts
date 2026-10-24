import { describe, expect, it } from "vitest";
import { fibLevels, snapPrice, timeMapper } from "@/lib/chart-drawing";

describe("chart drawing anchors", () => {
  const day = 86400;
  const times = [0, 1, 2, 5, 6].map((d) => 1_700_000_000 + d * day); // weekend gap between index 2 and 3
  const map = timeMapper(times);
  it("maps bars both ways, interpolating inside the data", () => {
    expect(map.toLogical(times[3])).toBe(3);
    expect(map.toTime(2.5)).toBe(times[2] + 1.5 * day);
    expect(map.toLogical(map.toTime(1.25))).toBeCloseTo(1.25);
  });
  it("extrapolates past either end with the typical bar spacing", () => {
    expect(map.step).toBe(day);
    expect(map.toTime(6)).toBe(times[4] + 2 * day);
    expect(map.toLogical(times[0] - 3 * day)).toBe(-3);
  });
  it("same anchor lands on the same date in another timeframe", () => {
    const weekly = timeMapper([0, 7, 14, 21].map((d) => 1_700_000_000 + d * day));
    const anchor = map.toTime(3); // a daily bar
    expect(weekly.toTime(weekly.toLogical(anchor))).toBe(anchor);
  });
  it("snaps to the nearest OHLC within the radius, fib levels run from 100% at the start to 0% at the end", () => {
    const y = (price: number) => 1000 - price * 10;
    expect(snapPrice(10.3, { open: 10, high: 11, low: 9, close: 10.5 }, y, y(10.3))).toBe(10.5);
    expect(snapPrice(13, { open: 10, high: 11, low: 9, close: 10.5 }, y, y(13))).toBe(13);
    const levels = fibLevels(100, 200);
    expect(levels.find((item) => item.level === 0)?.price).toBe(200);
    expect(levels.find((item) => item.level === 1)?.price).toBe(100);
    expect(levels.find((item) => item.level === 0.618)?.price).toBeCloseTo(138.2);
  });
});
