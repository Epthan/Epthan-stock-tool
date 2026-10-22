"use client";

import Link from "next/link";
import { TTL, fetchCached } from "@/lib/client-cache";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import { BackupControls } from "@/components/data-sync";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import { CASH_KINDS, cashLabel, cashSign, cashSummary, type CashKind } from "@/lib/cash-ledger";
import { PortfolioTradesDialog } from "@/components/portfolio-trades-dialog";
import { useStockSelection } from "@/components/stock-selection-provider";
import { legacyMigrationKey, usePortfolios, type LegacyMigration } from "@/hooks/use-portfolios";
import { getTradePosition, tradeDate } from "@/lib/portfolio-trades";

type Quote = { price: number; currency: string };

function money(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function signed(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.005) return money(0);
  return `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
}
function tone(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) < 0.005) return "";
  return value > 0 ? "tl-positive" : "tl-negative";
}
function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function subscribeNever() { return () => {}; }

/** Unified trade log: reads and writes the same per-portfolio records used by Workplace and Dashboard. */
export function TradeLedgerView() {
  const { locale } = useLanguage();
  const text = (english: string, chinese: string) => (locale === "zh" ? chinese : english);
  const { portfolios, activePortfolio, selectPortfolio, saveCash, deleteCash } = usePortfolios();
  const { pickSymbol } = useStockSelection();
  const [editor, setEditor] = useState<{ symbol: string } | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [cashForm, setCashForm] = useState<{ kind: CashKind; date: string; amount: string; symbol: string; note: string }>({ kind: "deposit", date: tradeDate(new Date().toISOString()), amount: "", symbol: "", note: "" });
  const [cashError, setCashError] = useState("");

  const migrationRaw = useSyncExternalStore(subscribeNever, () => { try { return window.localStorage.getItem(legacyMigrationKey); } catch { return null; } }, () => null);
  const migration = useMemo(() => { try { return JSON.parse(migrationRaw ?? "null") as LegacyMigration | null; } catch { return null; } }, [migrationRaw]);

  const trades = useMemo(() => activePortfolio.trades ?? [], [activePortfolio]);
  const symbols = useMemo(() => [...new Set(trades.map((trade) => trade.symbol))].sort(), [trades]);
  const symbolKey = symbols.join(",");

  useEffect(() => {
    if (!symbolKey) return;
    let cancelled = false;
    Promise.all(symbolKey.split(",").map(async (symbol) => {
      try {
        const body = await fetchCached<{ quote?: { price?: number; currency?: string } }>(`quote:${symbol}`, `/api/market/quote?symbol=${encodeURIComponent(symbol)}`, TTL.quote);
        return [symbol, body.quote?.price ? { price: body.quote.price, currency: body.quote.currency || "USD" } : null] as const;
      } catch { return [symbol, null] as const; }
    })).then((entries) => { if (!cancelled) setQuotes((current) => ({ ...current, ...Object.fromEntries(entries) })); });
    return () => { cancelled = true; };
  }, [symbolKey]);

  const positions = useMemo(() => symbols.map((symbol) => {
    const position = getTradePosition(trades, symbol);
    const quote = quotes[symbol];
    const open = position.quantity > 1e-8;
    const marketValue = open && quote ? quote.price * position.quantity : open ? null : 0;
    const unrealized = open && quote && position.averageCost !== null ? (quote.price - position.averageCost) * position.quantity : open ? null : 0;
    return { symbol, ...position, open, quote, marketValue, unrealized, tradeCount: trades.filter((trade) => trade.symbol === symbol).length };
  }).sort((left, right) => Number(right.open) - Number(left.open) || (right.marketValue ?? 0) - (left.marketValue ?? 0)), [symbols, trades, quotes]);

  const openPositions = positions.filter((position) => position.open);
  const currencies = new Set(openPositions.map((position) => position.quote?.currency).filter(Boolean));
  const mixedCurrency = currencies.size > 1;
  const quotesPending = openPositions.some((position) => !(position.symbol in quotes));
  const quotesMissing = openPositions.some((position) => position.symbol in quotes && !quotes[position.symbol]);
  const totalMarket = mixedCurrency || quotesMissing || quotesPending ? null : openPositions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
  const totalUnrealized = mixedCurrency || quotesMissing || quotesPending ? null : openPositions.reduce((sum, position) => sum + (position.unrealized ?? 0), 0);
  const totalRealized = mixedCurrency ? null : positions.reduce((sum, position) => sum + position.realized, 0);

  const cashEntries = useMemo(() => activePortfolio.cash ?? [], [activePortfolio]);
  const cash = useMemo(() => cashSummary(cashEntries, trades), [cashEntries, trades]);
  const hasCash = cashEntries.length > 0;
  const accountValue = totalMarket !== null && !mixedCurrency ? totalMarket + cash.balance : null;
  const totalReturn = accountValue !== null && cash.deposits > 0 ? accountValue - cash.netContributions : null;
  const cashRows = useMemo(() => [...cashEntries].sort((left, right) => right.date.localeCompare(left.date)), [cashEntries]);

  function addCash(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(cashForm.amount);
    try {
      saveCash(activePortfolio.id, { id: crypto.randomUUID(), kind: cashForm.kind, date: cashForm.date, amount: Math.round(amount * 100) / 100, ...(cashForm.symbol.trim() ? { symbol: cashForm.symbol.trim().toUpperCase() } : {}), ...(cashForm.note.trim() ? { note: cashForm.note.trim().slice(0, 500) } : {}) });
      setCashForm({ ...cashForm, amount: "", symbol: "", note: "" });
      setCashError("");
    } catch (reason) {
      setCashError(reason instanceof Error && reason.message === "INVALID_TIME" ? text("Date cannot be in the future.", "日期不能晚于今天。") : text("Enter an amount greater than 0.", "请输入大于 0 的金额。"));
    }
  }

  const ledger = useMemo(() => {
    const query = filter.trim().toUpperCase();
    return [...trades]
      .filter((trade) => !query || trade.symbol.includes(query) || (trade.note ?? "").toUpperCase().includes(query))
      .sort((left, right) => tradeDate(right.tradedAt).localeCompare(tradeDate(left.tradedAt)) || left.symbol.localeCompare(right.symbol));
  }, [trades, filter]);

  function exportCsv() {
    const header = ["date", "symbol", "side", "quantity", "price", "amount", "note"];
    const rows = [...trades].sort((left, right) => tradeDate(left.tradedAt).localeCompare(tradeDate(right.tradedAt))).map((trade) => [tradeDate(trade.tradedAt), trade.symbol, trade.side, trade.quantity, trade.price.toFixed(2), (trade.price * trade.quantity).toFixed(2), trade.note ?? ""]);
    const blob = new Blob([[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activePortfolio.name.replace(/[^\w-]+/g, "-").toLowerCase()}-trades.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const portfolioLabel = (portfolio: typeof activePortfolio) => (locale === "zh" ? portfolio.nameZh ?? portfolio.name : portfolio.name);
  const showMigration = migration && migration.portfolioId === activePortfolio.id && migration.imported > 0;

  return <main className="trade-ledger">
    <header className="tl-heading">
      <div>
        <p className="tl-eyebrow">{portfolioLabel(activePortfolio)} / {text("TRADE LOG", "交易记录")}</p>
        <h1>{text("Trade log", "交易记录")}</h1>
        <p className="tl-muted">{text("One ledger per portfolio. The same records drive Workplace and Dashboard analytics.", "每个组合一份交易账本，Workplace 与 Dashboard 分析共用同一份记录。")}</p>
      </div>
      <div className="tl-heading-actions">
        <label className="tl-select">{text("Portfolio", "组合")}
          <select value={activePortfolio.id} onChange={(event) => selectPortfolio(event.target.value)}>
            {portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolioLabel(portfolio)}{portfolio.trades?.length ? ` · ${portfolio.trades.length}` : ""}</option>)}
          </select>
        </label>
        <button className="tl-primary" onClick={() => setEditor({ symbol: "" })}>{text("+ Add trade", "+ 新增交易")}</button>
        <button className="tl-button" onClick={() => setImporting(true)}>{text("Import CSV", "导入 CSV")}</button>
        <BackupControls zh={locale === "zh"} />
        <Link className="tl-link" href="/dashboard">{text("Dashboard", "组合分析")} ↗</Link>
      </div>
    </header>

    {showMigration && <p className="tl-notice" role="status">{text(
      `Imported ${migration.imported} trade${migration.imported === 1 ? "" : "s"} from the previous trade log into this portfolio${migration.skipped ? `; ${migration.skipped} invalid record${migration.skipped === 1 ? " was" : "s were"} skipped (e.g. a sale exceeding holdings or a future date)` : ""}. The old records are kept untouched as a backup.`,
      `已将旧版交易日志中的 ${migration.imported} 笔交易导入本组合${migration.skipped ? `；${migration.skipped} 笔无效记录被跳过（如卖出超过持仓或日期晚于今天）` : ""}。旧数据保留未动，作为备份。`)}</p>}

    {notice && <p className="tl-notice" role="status">{notice}</p>}

    <section className="tl-metrics" aria-label={text("Ledger summary", "账本概览")}>
      <article><span>{text("Trades", "交易笔数")}</span><strong>{trades.length}</strong><small>{symbols.length} {text("securities", "只证券")}</small></article>
      <article><span>{text("Open positions", "持仓数")}</span><strong>{openPositions.length}</strong><small>{text("Average-cost method", "平均成本法")}</small></article>
      <article><span>{text("Market value", "持仓市值")}</span><strong>{quotesPending && openPositions.length ? "…" : money(totalMarket)}</strong><small>{mixedCurrency ? text("Mixed currencies — no FX", "多币种，未做汇率换算") : quotesMissing ? text("Some quotes unavailable", "部分报价缺失") : text("Latest quote", "最新报价")}</small></article>
      <article><span>{text("Unrealized P&L", "未实现盈亏")}</span><strong className={tone(totalUnrealized)}>{quotesPending && openPositions.length ? "…" : signed(totalUnrealized)}</strong><small>{text("vs. average cost", "相对平均成本")}</small></article>
      <article><span>{text("Realized P&L", "已实现盈亏")}</span><strong className={tone(totalRealized)}>{signed(totalRealized)}</strong><small>{text("Excl. fees & dividends", "不含费用与分红")}</small></article>
    </section>

    {hasCash && <section className="tl-metrics tl-metrics-cash" aria-label={text("Cash summary", "现金概览")}>
      <article><span>{text("Cash balance", "现金余额")}</span><strong className={cash.balance < -0.005 ? "tl-negative" : ""}>{money(cash.balance)}</strong><small>{cash.balance < -0.005 ? text("Negative — a deposit may be missing", "为负，可能漏记入金") : text("Deposits + sells + income − buys − costs", "入金+卖出+收入−买入−费用")}</small></article>
      <article><span>{text("Net contributions", "净投入")}</span><strong>{money(cash.netContributions)}</strong><small>{text("Deposits − withdrawals", "入金 − 出金")}</small></article>
      <article><span>{text("Dividends & interest", "分红与利息")}</span><strong className={tone(cash.income)}>{signed(cash.income)}</strong><small>{text("Cash income", "现金收入")}</small></article>
      <article><span>{text("Fees & tax", "费用与税")}</span><strong className={tone(-cash.costs)}>{signed(-cash.costs)}</strong><small>{text("Brokerage, withholding", "佣金、预扣税等")}</small></article>
      <article><span>{text("Account value", "账户总值")}</span><strong>{quotesPending && openPositions.length ? "…" : money(accountValue)}</strong><small className={tone(totalReturn)}>{totalReturn !== null ? `${text("Total return", "总收益")} ${signed(totalReturn)}${cash.netContributions > 0 ? ` (${signed((totalReturn / cash.netContributions) * 100)}%)` : ""}` : text("Holdings + cash", "持仓 + 现金")}</small></article>
    </section>}

    {!trades.length ? <section className="tl-empty">
      <h2>{text("No trades recorded in this portfolio", "此组合暂无交易记录")}</h2>
      <p>{activePortfolio.demoId
        ? text("This is a demo portfolio: its Dashboard holdings are simulated, not purchases. Add a real trade to switch it to recorded-trade analytics.", "这是演示组合：Dashboard 上的持仓为模拟数据，不是实际买入。录入真实交易后会切换为基于交易记录的分析。")
        : text("Record a buy to start. Dashboard analytics rebuild from these records.", "先录入一笔买入。Dashboard 分析会基于这些记录重新计算。")}</p>
      <button className="tl-primary" onClick={() => setEditor({ symbol: "" })}>{text("+ Add first trade", "+ 录入第一笔交易")}</button>
    </section> : <>
      <section className="tl-section">
        <div className="tl-section-heading"><div><h2>{text("Positions", "持仓")}</h2><p>{text("Rebuilt from the ledger. Prices in each security's quote currency.", "由交易记录重建，价格为各证券报价币种。")}</p></div></div>
        <div className="tl-scroll"><table>
          <thead><tr>{[text("Symbol", "代码"), text("Qty", "数量"), text("Avg cost", "平均成本"), text("Last", "现价"), text("Market value", "市值"), text("Unrealized", "未实现"), text("Realized", "已实现"), ""].map((label, index) => <th key={index}>{label}</th>)}</tr></thead>
          <tbody>{positions.map((position) => <tr key={position.symbol} className={position.open ? "" : "tl-closed"}>
            <td><button className="tl-symbol" title={text("Open in Workplace", "在 Workplace 中查看")} onClick={() => pickSymbol(position.symbol)}>{position.symbol} ↗</button>{!position.open && <small>{text("Closed", "已平仓")}</small>}</td>
            <td>{position.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
            <td>{money(position.averageCost)}</td>
            <td>{position.open ? (position.symbol in quotes ? money(position.quote?.price) : "…") : "—"}{position.quote && position.quote.currency !== "USD" ? <small>{position.quote.currency}</small> : null}</td>
            <td>{position.open ? money(position.marketValue) : "—"}</td>
            <td className={tone(position.unrealized)}>{position.open ? signed(position.unrealized) : "—"}</td>
            <td className={tone(position.realized)}>{signed(position.realized)}</td>
            <td><button className="tl-row-button" onClick={() => setEditor({ symbol: position.symbol })}>{text("Trades", "交易")} · {position.tradeCount}</button></td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className="tl-section">
        <div className="tl-section-heading">
          <div><h2>{text("All trades", "全部交易")}</h2><p>{text("Newest first. Edit or delete in the trade editor.", "按日期倒序；在交易编辑器中修改或删除。")}</p></div>
          <div className="tl-tools"><input type="search" placeholder={text("Filter symbol or note…", "筛选代码或备注…")} value={filter} onChange={(event) => setFilter(event.target.value)} /><button className="tl-button" onClick={exportCsv}>{text("Export CSV", "导出 CSV")}</button></div>
        </div>
        <div className="tl-scroll"><table>
          <thead><tr>{[text("Date", "日期"), text("Symbol", "代码"), text("Side", "方向"), text("Qty", "数量"), text("Price", "价格"), text("Amount", "金额"), text("Note", "备注"), ""].map((label, index) => <th key={index} className={index === 1 || index === 6 ? "tl-left" : undefined}>{label}</th>)}</tr></thead>
          <tbody>{ledger.map((trade) => <tr key={trade.id}>
            <td>{tradeDate(trade.tradedAt)}</td>
            <td className="tl-symbol tl-left">{trade.symbol}</td>
            <td><span className={`tl-side tl-side-${trade.side}`}>{trade.side === "buy" ? text("Buy", "买入") : text("Sell", "卖出")}</span></td>
            <td>{trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
            <td>{money(trade.price)}</td>
            <td>{money(trade.price * trade.quantity)}</td>
            <td className="tl-note">{trade.note ?? ""}</td>
            <td><button className="tl-row-button" onClick={() => setEditor({ symbol: trade.symbol })}>{text("Edit", "编辑")}</button></td>
          </tr>)}</tbody>
        </table></div>
        {!ledger.length && <p className="tl-muted">{text("No trades match this filter.", "没有符合筛选条件的交易。")}</p>}
      </section>
    </>}

    <section className="tl-section">
      <div className="tl-section-heading"><div><h2>{text("Cash ledger", "现金账本")}</h2><p>{text("Deposits, withdrawals, dividends, interest, fees and tax. Buys and sells move cash automatically.", "入金、出金、分红、利息、费用和税。买卖交易会自动计入现金变动。")}</p></div></div>
      <form className="cl-form" onSubmit={addCash}>
        <label>{text("Type", "类型")}<select value={cashForm.kind} onChange={(event) => setCashForm({ ...cashForm, kind: event.target.value as CashKind })}>{CASH_KINDS.map((kind) => <option key={kind} value={kind}>{cashLabel[kind][locale === "zh" ? 1 : 0]}</option>)}</select></label>
        <label>{text("Date", "日期")}<input type="date" required value={cashForm.date} onChange={(event) => setCashForm({ ...cashForm, date: event.target.value })} /></label>
        <label>{text("Amount", "金额")}<input type="number" min="0.01" step="0.01" required value={cashForm.amount} onChange={(event) => setCashForm({ ...cashForm, amount: event.target.value })} /></label>
        <label>{text("Symbol (optional)", "代码（可选）")}<input value={cashForm.symbol} onChange={(event) => setCashForm({ ...cashForm, symbol: event.target.value })} /></label>
        <label>{text("Note (optional)", "备注（可选）")}<input maxLength={500} value={cashForm.note} onChange={(event) => setCashForm({ ...cashForm, note: event.target.value })} /></label>
        <button className="tl-primary" type="submit">{text("Add", "添加")}</button>
      </form>
      {cashError && <p className="tl-negative" role="alert">{cashError}</p>}
      {hasCash ? <div className="tl-scroll"><table>
        <thead><tr>{[text("Date", "日期"), text("Type", "类型"), text("Symbol", "代码"), text("Amount", "金额"), text("Note", "备注"), ""].map((label, index) => <th key={index} className={index === 2 || index === 4 ? "tl-left" : undefined}>{label}</th>)}</tr></thead>
        <tbody>{cashRows.map((entry) => <tr key={entry.id}>
          <td>{entry.date}</td>
          <td>{cashLabel[entry.kind][locale === "zh" ? 1 : 0]}</td>
          <td className="tl-left">{entry.symbol ?? ""}</td>
          <td className={cashSign[entry.kind] > 0 ? "cl-in" : "cl-out"}>{cashSign[entry.kind] > 0 ? "+" : "−"}{money(entry.amount)}</td>
          <td className="tl-note">{entry.note ?? ""}</td>
          <td><button className="tl-row-button" onClick={() => deleteCash(activePortfolio.id, entry.id)}>{text("Delete", "删除")}</button></td>
        </tr>)}</tbody>
      </table></div> : <p className="tl-muted">{text("No cash entries yet. Record your deposits to see cash balance, net contributions and total return.", "还没有现金流水。录入入金后即可看到现金余额、净投入和总收益。")}</p>}
    </section>

    {importing && <CsvImportDialog portfolioId={activePortfolio.id} zh={locale === "zh"} onClose={(message) => { setImporting(false); if (message) setNotice(message); }} />}

    {editor && <PortfolioTradesDialog key={`${activePortfolio.id}:${editor.symbol}`} portfolioId={activePortfolio.id} symbol={editor.symbol} onClose={() => setEditor(null)} />}
  </main>;
}
