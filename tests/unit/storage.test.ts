import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// yahoo-finance2 is replaced by a scripted chart() so the archive logic can be tested offline.
const chart = vi.fn();
vi.mock("yahoo-finance2", () => ({ default: class { chart = chart; quote = vi.fn(); quoteSummary = vi.fn(); search = vi.fn(); } }));

const { readStore, writeStore, listSnapshots, restoreSnapshot } = await import("@/lib/server-store");
const { archiveCoverage, archiveRead } = await import("@/lib/price-archive");
const { loadDaily } = await import("@/lib/yahoo-finance");

const KEY = "stock-tool.portfolios.v1";
beforeEach(() => { process.env.STOCK_TOOL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "stock-tool-")); chart.mockReset(); });

describe("[B08] SQLite store", () => {
  it("migrates an existing store.json once and keeps it as .bak", () => {
    const dir = process.env.STOCK_TOOL_DATA_DIR!;
    fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify({ version: 1, updatedAt: "2026-01-01T00:00:00.000Z", data: { [KEY]: "[1]", "not.allowed": "x" } }));
    const state = readStore();
    expect(state.engine).toBe("sqlite");
    expect(state.data).toEqual({ [KEY]: "[1]" });
    expect(fs.existsSync(path.join(dir, "store.json.bak"))).toBe(true);
  });

  it("refuses a write based on an old revision and keeps the refused version in history", () => {
    const first = writeStore({ [KEY]: "A" });
    expect(first.ok).toBe(true);
    const rev = first.state.revs[KEY];
    expect(writeStore({ [KEY]: "B" }, { expected: { [KEY]: rev } }).ok).toBe(true); // device 1
    const late = writeStore({ [KEY]: "C" }, { expected: { [KEY]: rev } }); // device 2, still on rev 1
    expect(late.ok).toBe(false);
    expect(readStore().data[KEY]).toBe("B");
    expect(listSnapshots().some((snapshot) => snapshot.reason === "conflict")).toBe(true);
    // Writing what is already stored is not a conflict.
    expect(writeStore({ [KEY]: "B" }, { expected: { [KEY]: rev } }).ok).toBe(true);
  });

  it("restores a snapshot and snapshots the current data first", () => {
    writeStore({ [KEY]: "v1" });
    writeStore({ [KEY]: "v2" }); // snapshots v1 (auto)
    const auto = listSnapshots().find((snapshot) => snapshot.reason === "auto")!;
    const restored = restoreSnapshot(auto.id)!;
    expect(restored.ok && restored.state.data[KEY]).toBe("v1");
    expect(listSnapshots().some((snapshot) => snapshot.reason === "before-restore")).toBe(true);
  });
});

const bar = (day: string, close: number) => ({ date: new Date(`${day}T14:30:00Z`), open: close, high: close, low: close, close, volume: 100 });
const chartResult = (bars: ReturnType<typeof bar>[], splits: { date: Date; numerator: number; denominator: number }[] = []) => ({ meta: { gmtoffset: -14400, currentTradingPeriod: { regular: { end: new Date("2000-01-01") } } }, quotes: bars, events: { splits, dividends: [] } });

describe("[B09] price archive", () => {
  it("downloads once, then only the recent tail, and serves the archive when Yahoo is down", async () => {
    chart.mockResolvedValueOnce(chartResult([bar("2024-01-02", 10), bar("2024-01-03", 11), bar("2024-03-01", 12)]));
    const first = await loadDaily("AAA", "2024-01-01", "2024-03-05");
    expect(first.rows.map((row) => row.day)).toEqual(["2024-01-02", "2024-01-03", "2024-03-01"]);
    expect(archiveCoverage("AAA")).toMatchObject({ from: "2024-01-01", lastDay: "2024-03-01", bars: 3 });

    // Next request a week later: only the tail (from lastDay − 14 days) is downloaded.
    chart.mockResolvedValueOnce(chartResult([bar("2024-03-01", 12), bar("2024-03-04", 13)]));
    vi.useFakeTimers({ now: Date.now() + 3600_000, toFake: ["Date"] });
    const second = await loadDaily("AAA", "2024-01-01", "2024-03-06");
    vi.useRealTimers();
    expect(chart.mock.calls.at(-1)?.[1].period1).toBe("2024-02-16");
    expect(second.rows.map((row) => row.close)).toEqual([10, 11, 12, 13]);

    // Yahoo fails: archived bars come back instead of an error.
    chart.mockRejectedValue(new Error("Not Found"));
    vi.useFakeTimers({ now: Date.now() + 7200_000, toFake: ["Date"] });
    const offline = await loadDaily("AAA", "2024-01-01", "2024-03-07");
    vi.useRealTimers();
    expect(offline.rows).toHaveLength(4);
  });

  it("re-downloads everything when a new split appears", async () => {
    chart.mockResolvedValueOnce(chartResult([bar("2024-01-02", 100), bar("2024-01-03", 100)]));
    await loadDaily("BBB", "2024-01-01", "2024-01-05");
    chart.mockResolvedValueOnce(chartResult([bar("2024-01-03", 10), bar("2024-01-04", 10)], [{ date: new Date("2024-01-04T14:30:00Z"), numerator: 10, denominator: 1 }]));
    chart.mockResolvedValueOnce(chartResult([bar("2024-01-02", 10), bar("2024-01-03", 10), bar("2024-01-04", 10)], [{ date: new Date("2024-01-04T14:30:00Z"), numerator: 10, denominator: 1 }]));
    vi.useFakeTimers({ now: Date.now() + 3600_000, toFake: ["Date"] });
    const after = await loadDaily("BBB", "2024-01-01", "2024-01-06");
    vi.useRealTimers();
    expect(after.rows.map((row) => row.close)).toEqual([10, 10, 10]);
    expect(archiveRead("BBB", "2024-01-01", "2024-01-06")?.splits).toEqual([{ date: "2024-01-04", ratio: 10 }]);
  });
});
