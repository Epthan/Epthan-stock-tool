import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCached, forgetCached, peekCached } from "@/lib/client-cache";
import { classifyError, friendlyError } from "@/lib/friendly-error";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("[D02] browser cache and retries", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("retries a network failure, then caches the answer", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(json(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetch);
    const pending = fetchCached("k1", "/x", 60_000);
    await vi.advanceTimersByTimeAsync(900);
    await expect(pending).resolves.toEqual({ ok: 1 });
    await expect(fetchCached("k1", "/x", 60_000)).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(peekCached("k1")).toEqual({ ok: 1 });
    forgetCached("k1");
    expect(peekCached("k1")).toBeUndefined();
  });
  it("does not retry a 404, gives up on repeated 429 and caches neither", async () => {
    vi.useFakeTimers();
    const notFound = vi.fn().mockResolvedValue(json(404, { message: "找不到" }));
    vi.stubGlobal("fetch", notFound);
    await expect(fetchCached("k2", "/x", 60_000)).rejects.toThrow("找不到");
    expect(notFound).toHaveBeenCalledTimes(1);
    const limited = vi.fn().mockResolvedValue(json(429, { message: "Too Many Requests" }));
    vi.stubGlobal("fetch", limited);
    const pending = fetchCached("k3", "/x", 60_000);
    const settled = expect(pending).rejects.toThrow(/Too Many/);
    await vi.advanceTimersByTimeAsync(3000);
    await settled;
    expect(limited).toHaveBeenCalledTimes(3);
    expect(peekCached("k3")).toBeUndefined();
  });
  it("explains errors in plain words", () => {
    expect(classifyError("HTTP 429 Too Many Requests")).toBe("rate");
    expect(friendlyError("fetch failed", true)).toMatchObject({ kind: "network", title: "暂时连不上行情数据", transient: true });
    expect(friendlyError("Not Found: ZZZZ", true).transient).toBe(false);
  });
});
