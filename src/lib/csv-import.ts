import { tradeDate, validatePortfolioTrades, type PortfolioTrade } from "@/lib/portfolio-trades";
import { validateCashEntries, type CashEntry, type CashKind } from "@/lib/cash-ledger";

/**
 * Broker CSV import. Works with any CSV that has a header row: columns are matched by name
 * (English / Chinese aliases, IBKR / CommSec / Stake / SelfWealth style), then the user can fix the mapping.
 * CommSec "Details" text such as "B 100 CBA @ 95.50" is also understood.
 */
export type Field = "date" | "symbol" | "action" | "quantity" | "price" | "amount" | "fee" | "note" | "details" | "debit" | "credit";
export const FIELDS: Field[] = ["date", "symbol", "action", "quantity", "price", "amount", "fee", "note", "details", "debit", "credit"];
export type DateOrder = "auto" | "ymd" | "dmy" | "mdy";
export type Mapping = Partial<Record<Field, number>>;

const aliases: Record<Field, string[]> = {
  date: ["date", "tradedate", "trade date", "settledate", "datetime", "date/time", "transaction date", "成交日期", "交易日期", "日期", "时间"],
  symbol: ["symbol", "ticker", "code", "security", "stock", "instrument", "asx code", "证券代码", "股票代码", "代码"],
  action: ["side", "action", "type", "buy/sell", "transaction type", "activity", "order type", "买卖", "方向", "业务名称", "操作", "交易类型"],
  quantity: ["quantity", "qty", "units", "shares", "volume", "数量", "成交数量", "股数"],
  price: ["price", "tradeprice", "trade price", "unit price", "avg price", "average price", "成交价格", "成交价", "价格", "均价"],
  amount: ["amount", "proceeds", "value", "net amount", "total", "consideration", "成交金额", "发生金额", "金额"],
  fee: ["fee", "fees", "commission", "ibcommission", "brokerage", "佣金", "手续费", "费用"],
  note: ["note", "notes", "memo", "comment", "备注"],
  details: ["details", "description", "narrative", "摘要", "说明"],
  debit: ["debit", "debit($)", "withdrawals", "借方"],
  credit: ["credit", "credit($)", "deposits", "贷方"],
};

/** RFC-4180-ish parser; auto-detects comma / semicolon / tab. */
export function parseCsv(input: string): string[][] {
  const textIn = input.replace(/^﻿/, "");
  const firstLine = textIn.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < textIn.length; index++) {
    const char = textIn[index];
    if (quoted) {
      if (char === '"' && textIn[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell.trim()); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && textIn[index + 1] === "\n") index++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const norm = (value: string) => value.toLowerCase().replace(/[\s_]+/g, " ").replace(/\s*\(.*?\)\s*/g, (match) => (match.includes("$") ? match.trim() : "")).trim();

function matchField(header: string): Field | null {
  const value = norm(header);
  for (const field of FIELDS) if (aliases[field].includes(value)) return field;
  return null;
}

/** Find the header row (first of the top 15 rows with ≥2 recognised columns) and map columns. */
export function detectMapping(rows: string[][]): { headerRow: number; mapping: Mapping } {
  let best = { headerRow: 0, mapping: {} as Mapping, score: 0 };
  rows.slice(0, 15).forEach((row, headerRow) => {
    const mapping: Mapping = {};
    row.forEach((header, column) => { const field = matchField(header); if (field && mapping[field] === undefined) mapping[field] = column; });
    const score = Object.keys(mapping).length;
    if (score > best.score) best = { headerRow, mapping, score };
  });
  return { headerRow: best.headerRow, mapping: best.mapping };
}

function number(value: string | undefined) {
  if (!value) return NaN;
  let cleaned = value.replace(/[\s$¥€£A-Za-z]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  const negative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith("-");
  cleaned = cleaned.replace(/[()+-]/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return negative ? -parsed : parsed;
}

const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Detect day-first vs month-first from the whole column. Ambiguous → day-first (AU / UK / CN broker exports). */
export function guessDateOrder(values: string[]): DateOrder {
  let dmy = false, mdy = false;
  for (const value of values) {
    const match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (!match) continue;
    if (Number(match[1]) > 12) dmy = true;
    if (Number(match[2]) > 12) mdy = true;
  }
  return mdy && !dmy ? "mdy" : "dmy";
}

export function parseDate(value: string, order: DateOrder): string {
  const raw = value.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  const build = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : "";
  };
  let match = raw.match(/^(\d{4})[/.-]?(\d{1,2})[/.-]?(\d{1,2})/);
  if (match && (raw.length >= 10 || /^\d{8}/.test(raw))) return build(+match[1], +match[2], +match[3]);
  match = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (match) return order === "mdy" ? build(+match[3], +match[1], +match[2]) : build(+match[3], +match[2], +match[1]);
  match = raw.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})/);
  if (match && months[match[2].toLowerCase()]) return build(+match[3], months[match[2].toLowerCase()], +match[1]);
  match = raw.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (match && months[match[1].toLowerCase()]) return build(+match[3], months[match[1].toLowerCase()], +match[2]);
  return "";
}

function classify(action: string): "buy" | "sell" | CashKind | null {
  const value = action.trim().toLowerCase();
  if (!value) return null;
  if (/^(b|buy|bought|purchase|bot)$|买入|证券买入|buy to open|^buy\b/.test(value)) return "buy";
  if (/^(s|sell|sold|sld)$|卖出|证券卖出|^sell\b/.test(value)) return "sell";
  if (/div|股息|红利|分红/.test(value)) return "dividend";
  if (/withdraw|出金|转出|direct debit|transfer out/.test(value)) return "withdrawal";
  if (/deposit|入金|转入|direct credit|transfer in|funding/.test(value)) return "deposit";
  if (/interest|利息/.test(value)) return "interest";
  if (/tax|withholding|税/.test(value)) return "tax";
  if (/fee|commission|brokerage|佣金|手续费/.test(value)) return "fee";
  return null;
}

export type ImportRow = { line: number; status: "trade" | "cash" | "duplicate" | "skipped"; reason?: string; trade?: PortfolioTrade; cash?: CashEntry[] };
export type ImportOptions = { headerRow: number; mapping: Mapping; dateOrder: DateOrder; suffix: string; existingTrades: PortfolioTrade[]; existingCash: CashEntry[] };

const reasonText = {
  date: ["Unreadable date", "日期无法识别"], kind: ["Unknown transaction type", "无法识别交易类型"], fields: ["Missing symbol, quantity or price", "缺少代码、数量或价格"],
  amount: ["Missing amount", "缺少金额"], future: ["Date is in the future", "日期晚于今天"], shares: ["Sells more than held at that date", "卖出数量超过当时持仓"],
} as const;
export type Reason = keyof typeof reasonText;
export const reasonLabel = (reason: string, zh: boolean) => reasonText[reason as Reason]?.[zh ? 1 : 0] ?? reason;

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const tradeKey = (trade: PortfolioTrade) => `${tradeDate(trade.tradedAt)}|${trade.symbol}|${trade.side}|${trade.quantity}|${round2(trade.price)}`;
const cashKey = (entry: CashEntry) => `${entry.date}|${entry.kind}|${round2(entry.amount)}|${entry.symbol ?? ""}`;

export function buildImport(rows: string[][], options: ImportOptions): ImportRow[] {
  const { headerRow, mapping, dateOrder, existingTrades, existingCash } = options;
  const suffix = options.suffix.trim().toUpperCase();
  const get = (row: string[], field: Field) => (mapping[field] === undefined ? "" : row[mapping[field] as number] ?? "");
  const body = rows.slice(headerRow + 1);
  const order = dateOrder === "auto" ? guessDateOrder(body.map((row) => get(row, "date"))) : dateOrder;
  // Dedupe only against what the portfolio already holds (multiset), so re-importing the same file adds nothing
  // while genuine identical rows inside one file (partial fills) are kept.
  const countKeys = (keys: string[]) => keys.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map<string, number>());
  const seenTrades = countKeys(existingTrades.map(tradeKey));
  const seenCash = countKeys(existingCash.map(cashKey));
  const takeSeen = (map: Map<string, number>, key: string) => { const left = map.get(key) ?? 0; if (left > 0) map.set(key, left - 1); return left > 0; };
  const today = tradeDate(new Date().toISOString());
  const symbolOf = (value: string) => {
    const symbol = value.trim().toUpperCase().replace(/\s+/g, "");
    if (!symbol) return "";
    return suffix && !symbol.includes(".") && !symbol.startsWith("^") ? `${symbol}${suffix.startsWith(".") ? suffix : `.${suffix}`}` : symbol;
  };

  const parsed: ImportRow[] = body.map((row, index) => {
    const line = headerRow + index + 2;
    const date = parseDate(get(row, "date"), order);
    if (!date) return { line, status: "skipped", reason: "date" };
    if (date > today) return { line, status: "skipped", reason: "future" };
    const details = get(row, "details");
    const note = (get(row, "note") || details).slice(0, 500) || undefined;
    let symbol = symbolOf(get(row, "symbol"));
    let quantity = number(get(row, "quantity"));
    let price = number(get(row, "price"));
    let kind = classify(get(row, "action"));
    // CommSec style: "B 100 CBA @ 95.50" / "S 50 BHP @ 45.10"
    const commsec = details.match(/^(B|S)\s+([\d,]+)\s+([A-Z0-9.]+)\s+@\s+([\d.]+)/i);
    if (commsec) { kind = commsec[1].toUpperCase() === "B" ? "buy" : "sell"; quantity = number(commsec[2]); symbol = symbolOf(commsec[3]); price = number(commsec[4]); }
    let amount = number(get(row, "amount"));
    if (!Number.isFinite(amount)) {
      const credit = number(get(row, "credit")), debit = number(get(row, "debit"));
      if (Number.isFinite(credit) && credit) amount = Math.abs(credit);
      else if (Number.isFinite(debit) && debit) amount = -Math.abs(debit);
    }
    if (!kind && details) kind = classify(details);
    if (!kind && Number.isFinite(quantity) && quantity !== 0 && symbol) kind = quantity < 0 ? "sell" : "buy";
    if (!kind && !symbol && Number.isFinite(amount) && amount !== 0) kind = amount > 0 ? "deposit" : "withdrawal";
    if (!kind) return { line, status: "skipped", reason: "kind" };

    const fee = Math.abs(number(get(row, "fee")));
    if (kind === "buy" || kind === "sell") {
      quantity = Math.abs(quantity);
      if (!Number.isFinite(price) || price <= 0) price = Number.isFinite(amount) && quantity ? Math.abs(amount) / quantity : NaN;
      if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) return { line, status: "skipped", reason: "fields" };
      const trade: PortfolioTrade = { id: crypto.randomUUID(), symbol, side: kind, tradedAt: date, price: round2(price), quantity, ...(note ? { note } : {}) };
      const key = tradeKey(trade);
      if (takeSeen(seenTrades, key)) return { line, status: "duplicate" };
      let brokerage = Number.isFinite(fee) && fee > 0 ? fee : 0;
      if (!brokerage && commsec && Number.isFinite(amount)) {
        const implied = kind === "buy" ? Math.abs(amount) - price * quantity : price * quantity - Math.abs(amount);
        if (implied > 0.004 && implied < price * quantity * 0.05) brokerage = implied;
      }
      const cash = brokerage > 0 ? [{ id: crypto.randomUUID(), kind: "fee" as const, date, amount: round2(brokerage), symbol, note: `${kind === "buy" ? "Buy" : "Sell"} ${symbol} brokerage` }] : [];
      return { line, status: "trade", trade, cash };
    }
    const value = Math.abs(Number.isFinite(amount) ? amount : NaN);
    if (!Number.isFinite(value) || value <= 0) return { line, status: "skipped", reason: "amount" };
    const entry: CashEntry = { id: crypto.randomUUID(), kind, date, amount: round2(value), ...(symbol ? { symbol } : {}), ...(note ? { note } : {}) };
    const key = cashKey(entry);
    if (takeSeen(seenCash, key)) return { line, status: "duplicate" };
    return { line, status: "cash", cash: [entry] };
  });

  // Replay trades in date order (buys before sells on the same day) so sells are checked against holdings.
  const accepted = [...existingTrades];
  const tradeRows = parsed.filter((row) => row.trade).sort((a, b) => a.trade!.tradedAt.localeCompare(b.trade!.tradedAt) || (a.trade!.side === b.trade!.side ? 0 : a.trade!.side === "buy" ? -1 : 1));
  for (const row of tradeRows) {
    try { validatePortfolioTrades([...accepted, row.trade!]); accepted.push(row.trade!); }
    catch { row.status = "skipped"; row.reason = "shares"; row.cash = []; }
  }
  validateCashEntries(parsed.flatMap((row) => row.cash ?? []));
  return parsed;
}
