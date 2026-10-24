import { describe, expect, it } from "vitest";
import { parseConstituentTable } from "@/lib/treemap-data";

const rows = (n: number, cell: "td" | "th") => Array.from({ length: n }, (_, i) => `<tr><${cell}>T${String.fromCharCode(65 + (i % 26))}${i}</${cell}><td>Company ${i}</td><td>Technology</td></tr>`).join("");
describe("[C13] index constituents parser", () => {
  it("reads a Nasdaq-100 style table without the wikitable class and with row-header tickers", () => {
    const html = `<table><tr><th>Other</th></tr></table><table id="constituents"><tr><th>Ticker</th><th>Company</th><th>ICB Industry</th><th>ICB Subsector</th></tr>${rows(101, "th")}</table>`;
    const parsed = parseConstituentTable(html, "nasdaq100");
    expect(parsed).toHaveLength(101);
    expect(parsed[0]).toEqual({ symbol: "TA0", name: "Company 0", sector: "Technology" });
  });
  it("reads an S&P 100 style table and converts class-share dots", () => {
    const html = `<table class="wikitable"><thead><tr><th>Symbol</th><th>Name</th><th>Sector</th></tr></thead><tbody><tr><td>BRK.B</td><td>Berkshire</td><td>Financials</td></tr>${rows(60, "td")}</tbody></table>`;
    expect(parseConstituentTable(html, "sp100")[0]).toEqual({ symbol: "BRK-B", name: "Berkshire", sector: "Financials" });
  });
  it("fails loudly when no table matches", () => {
    expect(() => parseConstituentTable("<table><tr><th>Foo</th></tr></table>", "sp100")).toThrow(/S&P 100/);
  });
});
