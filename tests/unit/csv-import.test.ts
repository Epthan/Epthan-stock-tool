import { describe, expect, it } from "vitest";
import { buildImport, detectMapping, parseCsv, parseDate } from "@/lib/csv-import";

function run(csv: string, suffix = "", existing: Parameters<typeof buildImport>[1]["existingTrades"] = []) {
  const rows = parseCsv(csv);
  const { headerRow, mapping } = detectMapping(rows);
  return buildImport(rows, { headerRow, mapping, dateOrder: "auto", suffix, existingTrades: existing, existingCash: [] });
}

describe("csv import", () => {
  it("IBKR: signed quantity, commission, sells checked against holdings", () => {
    const out = run(`"Symbol","TradeDate","Quantity","TradePrice","IBCommission","Buy/Sell"\n"AAPL","20240115","10","185.5","-1.00","BUY"\n"AAPL","20240301","-4","179.2","-1.00","SELL"\n"MSFT","20240301","-4","400","-1","SELL"`);
    expect(out.map((row) => row.status)).toEqual(["trade", "trade", "skipped"]);
    expect(out[2].reason).toBe("shares");
    expect(out[0].cash?.[0]).toMatchObject({ kind: "fee", amount: 1 });
  });

  it("CommSec: details text, implied brokerage, deposits and dividends", () => {
    const out = run(`Date,Reference,Details,Debit($),Credit($),Balance($)\n15/03/2024,C1,B 100 CBA @ 115.50,11569.95,,\n20/03/2024,C2,Direct Credit deposit,,20000.00,\n28/03/2024,D1,CBA DIVIDEND,,215.00,`, ".AX");
    expect(out[0].trade).toMatchObject({ symbol: "CBA.AX", side: "buy", quantity: 100, price: 115.5, tradedAt: "2024-03-15" });
    expect(out[0].cash?.[0].amount).toBeCloseTo(19.95);
    expect(out[1].cash?.[0]).toMatchObject({ kind: "deposit", amount: 20000 });
    expect(out[2].cash?.[0]).toMatchObject({ kind: "dividend", amount: 215 });
  });

  it("dedupes against existing records only, keeping in-file partial fills", () => {
    const csv = `date,symbol,side,quantity,price\n2024-02-01,NVDA,buy,5,650\n2024-02-01,NVDA,buy,5,650`;
    expect(run(csv).map((row) => row.status)).toEqual(["trade", "trade"]);
    const existing = [{ id: "x", symbol: "NVDA", side: "buy" as const, tradedAt: "2024-02-01", price: 650, quantity: 5 }];
    expect(run(csv, "", existing).map((row) => row.status)).toEqual(["duplicate", "trade"]);
  });

  it("reads tags and Chinese headers", () => {
    const out = run(`成交日期,证券代码,业务名称,成交数量,成交价格,标签\n2024-04-02,600519.SS,证券买入,100,1700.5,价值;长持`);
    expect(out[0].trade).toMatchObject({ symbol: "600519.SS", side: "buy", tags: ["价值", "长持"] });
  });

  it("parses dates in common formats", () => {
    expect(parseDate("03/04/2024", "dmy")).toBe("2024-04-03");
    expect(parseDate("03/04/2024", "mdy")).toBe("2024-03-04");
    expect(parseDate("20240115", "dmy")).toBe("2024-01-15");
    expect(parseDate("12 Mar 2024", "dmy")).toBe("2024-03-12");
    expect(parseDate("31/02/2024", "dmy")).toBe("");
  });
});
