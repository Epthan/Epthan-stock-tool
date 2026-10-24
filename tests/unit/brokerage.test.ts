import { describe, expect, it } from "vitest";
import { FEE_SCHEDULES, customFee, marketOf, proposeBrokerage } from "@/lib/brokerage";

const schedule = (id: string) => FEE_SCHEDULES.find((item) => item.id === id)!.fee;

describe("[T08] fee schedules", () => {
  it("IBKR fixed: per share with US$1 minimum and 1% cap; no ASX", () => {
    const fee = schedule("ibkr-fixed");
    expect(fee("US", 6219, 15)).toEqual({ amount: 1, currency: "USD" }); // 15 × 0.005 = 0.075 → min 1
    expect(fee("US", 30000, 1000)).toEqual({ amount: 5, currency: "USD" });
    expect(fee("US", 50, 500)).toEqual({ amount: 0.5, currency: "USD" }); // 1% cap below the minimum
    expect(fee("ASX", 5000, 100)).toBeNull();
  });
  it("Stake: flat to 30k then 0.01%", () => {
    expect(schedule("stake")("ASX", 29999, 10)).toEqual({ amount: 3, currency: "AUD" });
    expect(schedule("stake")("US", 50000, 10)).toEqual({ amount: 5, currency: "USD" });
  });
  it("CommSec ASX tiers", () => {
    const fee = schedule("commsec-asx");
    expect([1000, 3000, 9999, 25000, 50000].map((value) => fee("ASX", value, 1)?.amount)).toEqual([5, 10, 19.95, 29.95, 60]);
    expect(fee("US", 1000, 1)).toBeNull();
  });
  it("custom rule and market detection", () => {
    expect(customFee({ fixed: 0, percent: 0.1, minimum: 10, currency: "AUD" })("ASX", 5000, 1)).toEqual({ amount: 10, currency: "AUD" });
    expect([marketOf("BHP.AX"), marketOf("AAPL"), marketOf("0700.HK")]).toEqual(["ASX", "US", "other"]);
    const rows = proposeBrokerage([{ id: "a", symbol: "MSFT", side: "buy", tradedAt: "2024-10-08", price: 414.71, quantity: 15 }], schedule("ibkr-fixed"));
    expect(rows[0]).toMatchObject({ market: "US", fee: { amount: 1, currency: "USD" } });
  });
});
