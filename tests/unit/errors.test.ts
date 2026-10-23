import { describe, expect, it } from "vitest";
import { classifyError } from "@/lib/friendly-error";
import { isTransient } from "@/lib/yahoo-finance";

describe("error handling", () => {
  it("classifies user-facing errors", () => {
    expect(classifyError("Too Many Requests")).toBe("rate");
    expect(classifyError("Failed to fetch")).toBe("network");
    expect(classifyError("No daily price for AAPL on 2024-01-06. Check the trade date")).toBe("price");
    expect(classifyError("Record at least one buy transaction")).toBe("input");
  });
  it("retries only transient upstream failures", () => {
    expect(isTransient(new Error("HTTP 429 Too Many Requests"))).toBe(true);
    expect(isTransient(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransient(new Error("Quote not found for symbol: ZZZZ"))).toBe(false);
  });
});
