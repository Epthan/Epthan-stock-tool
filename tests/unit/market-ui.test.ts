import { afterEach, describe, expect, it, vi } from "vitest";
import { formatOverview, overviewName, OVERVIEW_GROUPS } from "@/lib/market-overview";
import { createDefaultWatchlists, loadStoredWatchlists, watchlistLabel } from "@/lib/watchlists";

describe("[C01] market overview data", () => {
  it("shows yields in percent with basis-point changes, prices with sensible digits", () => {
    expect(formatOverview("^TNX", 4.253, 0.031, 0.7)).toEqual({ value: "4.25%", change: "+3 bp" });
    expect(formatOverview("^GSPC", 6123.4, -30, -0.5)).toEqual({ value: "6,123", change: "−0.50%" });
    expect(formatOverview("XLK", 210.456, 1, 0.48)).toEqual({ value: "210.46", change: "+0.48%" });
  });
  it("has 11 sector ETFs and Chinese names", () => {
    expect(OVERVIEW_GROUPS.find((group) => group.id === "sectors")!.items).toHaveLength(11);
    expect(overviewName("^DJI", true)).not.toBe("^DJI");
  });
});

describe("[C03] watch lists", () => {
  afterEach(() => vi.unstubAllGlobals());
  const storage = (items: Record<string, string>) => ({ localStorage: { getItem: (key: string) => items[key] ?? null } });
  it("falls back to the default list and shows its name in Chinese", () => {
    expect(createDefaultWatchlists()[0].id).toBe("default");
    expect(watchlistLabel("Main Watch List", true)).toBe("主自选列表");
    expect(watchlistLabel("Tech", true)).toBe("Tech");
  });
  it("cleans stored lists (bad symbols, duplicates) and keeps a valid active list", () => {
    vi.stubGlobal("window", storage({ "stock-tool.watchlists.v2": JSON.stringify([{ id: "a", name: " Tech ", symbols: ["msft", "MSFT", "", 3] }, null]), "stock-tool.active-watchlist-id.v2": "missing" }));
    const { watchlists, activeWatchlistId } = loadStoredWatchlists();
    expect(watchlists).toEqual([{ id: "a", name: "Tech", symbols: ["MSFT"] }]);
    expect(activeWatchlistId).toBe("a");
  });
  it("migrates the legacy single list and survives malformed storage", () => {
    vi.stubGlobal("window", storage({ "stock-tool.watchlist": JSON.stringify(["aapl", "nvda"]) }));
    expect(loadStoredWatchlists().watchlists[0].symbols).toEqual(["AAPL", "NVDA"]);
    vi.stubGlobal("window", storage({ "stock-tool.watchlists.v2": "{not json" }));
    expect(loadStoredWatchlists().activeWatchlistId).toBe("default");
  });
});
