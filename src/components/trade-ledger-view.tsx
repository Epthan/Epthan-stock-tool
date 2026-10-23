"use client";

import Link from "next/link";
import { TTL, fetchCached } from "@/lib/client-cache";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import { BackupControls } from "@/components/data-sync";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import { useCorporateActions } from "@/hooks/use-corporate-actions";
import { splitFactor, splitLabel } from "@/lib/corporate-actions";
import { CASH_KINDS, cashLabel, cashSign, cashSummary, type CashKind } from "@/lib/cash-ledger";
import { PortfolioTradesDialog } from "@/components/portfolio-trades-dialog";
import { useStockSelection } from "@/components/stock-selection-provider";
import { legacyMigrationKey, usePortfolios, type LegacyMigration } from "@/hooks/use-portfolios";
import { getTradePosition, tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";
import { BASE_CURRENCIES, normalizeCurrency, rateOn, type RatePoint } from "@/lib/fx";

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
  const { portfolios, activePortfolio, selectPortfolio, saveCash, deleteCash, setBaseCurrency, setCashMode } = usePortfolios();
  const { pickSymbol } = useStockSelection();
  const [editor, setEditor] = useState<{ symbol: string } | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [cashForm, setCashForm] = useState<{ kind: CashKind; date: string; amount: string; currency: string; toAmount: string; toCurrency: string; symbol: string; note: string }>({ kind: "deposit", currency: "", toAmount: "", toCurrency: "", date: tradeDate(new Date().toISOString()), amount: "", symbol: "", note: "" });
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

  // ---- Currencies: positions are shown in each security's own currency; totals in the ledger currency ----
  const base = activePortfolio.baseCurrency ?? "USD";
  const unitOf = useMemo(() => Object.fromEntries(symbols.map((symbol) => [symbol, quotes[symbol] ? normalizeCurrency(quotes[symbol]!.currency) : null])), [symbols, quotes]);
  const cashList = activePortfolio.cash;
  const cashMode = activePortfolio.cashMode ?? "base";
  const foreign = useMemo(() => [...new Set([
    ...Object.values(unitOf).filter((unit): unit is { currency: string; divisor: number } => !!unit).map((unit) => unit.currency),
    ...(cashList ?? []).flatMap((entry) => [entry.currency, entry.toCurrency]).filter((code): code is string => !!code),
  ])].filter((currency) => currency !== base).sort(), [unitOf, base, cashList]);
  const firstDate = useMemo(() => [...trades.map((trade) => tradeDate(trade.tradedAt)), ...(cashList ?? []).map((entry) => entry.date)].sort()[0] ?? "", [trades, cashList]);
  const fxKey = foreign.length && firstDate ? `fx:${foreign.join(",")}:${base}:${firstDate}` : "";
  const [fx, setFx] = useState<{ key: string; rates: Record<string, RatePoint[]> | null }>({ key: "", rates: null });
  useEffect(() => {
    if (!fxKey) return;
    let active = true;
    fetchCached<{ rates: Record<string, RatePoint[]> }>(fxKey, `/api/market/fx?pairs=${foreign.map((currency) => `${currency}:${base}`).join(",")}&from=${firstDate}`, TTL.daily)
      .then((body) => { if (active) setFx({ key: fxKey, rates: body.rates }); })
      .catch(() => { if (active) setFx({ key: fxKey, rates: {} }); });
    return () => { active = false; };
  }, [fxKey, foreign, base, firstDate]);
  const fxReady = !fxKey || fx.key === fxKey;
  /** Multiplier from a security's quote unit to the ledger currency on a date (null = rate unavailable). */
  const toBase = useCallback((symbol: string, date?: string) => {
    const unit = unitOf[symbol];
    if (!unit) return null;
    if (unit.currency === base) return 1 / unit.divisor;
    const series = fx.key === fxKey ? fx.rates?.[`${unit.currency}:${base}`] : undefined;
    const rate = date ? rateOn(series, date) : series?.at(-1)?.rate ?? null;
    return rate == null ? null : rate / unit.divisor;
  }, [unitOf, base, fx, fxKey]);
  const baseTrades = useMemo(() => trades.map((trade) => { const factor = toBase(trade.symbol, tradeDate(trade.tradedAt)); return factor == null ? null : { ...trade, price: trade.price * factor }; }), [trades, toBase]);
  const baseComplete = baseTrades.every(Boolean);

  const positions = useMemo(() => symbols.map((symbol) => {
    const position = getTradePosition(trades, symbol, activePortfolio.splits);
    const quote = quotes[symbol];
    const open = position.quantity > 1e-8;
    const marketValue = open && quote ? quote.price * position.quantity : open ? null : 0;
    const unrealized = open && quote && position.averageCost !== null ? (quote.price - position.averageCost) * position.quantity : open ? null : 0;
    // Same position in the ledger currency, cost at the trade-date rate and value at today's rate (so FX gains are included).
    const rateNow = toBase(symbol);
    const inBase = baseComplete ? getTradePosition(baseTrades as PortfolioTrade[], symbol, activePortfolio.splits) : null;
    const marketBase = !open ? 0 : quote && rateNow != null ? quote.price * position.quantity * rateNow : null;
    const unrealizedBase = !open ? 0 : marketBase != null && inBase?.averageCost != null ? marketBase - inBase.averageCost * position.quantity : null;
    return { symbol, ...position, open, quote, marketValue, unrealized, marketBase, unrealizedBase, realizedBase: inBase?.realized ?? null, currency: unitOf[symbol]?.currency ?? quote?.currency ?? "", tradeCount: trades.filter((trade) => trade.symbol === symbol).length };
  }).sort((left, right) => Number(right.open) - Number(left.open) || (right.marketBase ?? 0) - (left.marketBase ?? 0)), [symbols, trades, quotes, activePortfolio.splits, toBase, baseTrades, baseComplete, unitOf]);

  const openPositions = positions.filter((position) => position.open);
  const hasForeign = foreign.length > 0;
  const quotesPending = positions.some((position) => !(position.symbol in quotes)) || !fxReady;
  const quotesMissing = openPositions.some((position) => position.symbol in quotes && !quotes[position.symbol]);
  const sumOrNull = (values: (number | null)[]) => (values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0));
  const totalMarket = quotesPending ? null : sumOrNull(openPositions.map((position) => position.marketBase));
  const totalUnrealized = quotesPending ? null : sumOrNull(openPositions.map((position) => position.unrealizedBase));
  const totalRealized = quotesPending ? null : sumOrNull(positions.map((position) => position.realizedBase));

  const cashEntries = useMemo(() => activePortfolio.cash ?? [], [activePortfolio]);
  // Per-currency cash. In "base" mode trades settle in the ledger currency at the trade-date rate;
  // in "local" mode each currency keeps its own balance and is marked at today's rate.
  const rateFor = useCallback((currency: string, date?: string) => {
    if (currency === base) return 1;
    const series = fx.key === fxKey ? fx.rates?.[`${currency}:${base}`] : undefined;
    return date ? rateOn(series, date) : series?.at(-1)?.rate ?? null;
  }, [base, fx, fxKey]);
  const cash = useMemo(() => cashSummary(cashEntries, trades, { base, mode: cashMode, rate: rateFor, unit: (symbol) => unitOf[symbol] ?? null }), [cashEntries, trades, base, cashMode, rateFor, unitOf]);
  const cashCurrencies = useMemo(() => [...new Set([base, ...foreign, "USD", "AUD", "HKD", "CNY"])], [base, foreign]);
  const hasCash = cashEntries.length > 0;
  const accountValue = totalMarket !== null && baseComplete && Number.isFinite(cash.balance) ? totalMarket + cash.balance : null;
  const totalReturn = accountValue !== null && cash.deposits > 0 ? accountValue - cash.netContributions : null;
  const cashRows = useMemo(() => [...cashEntries].sort((left, right) => right.date.localeCompare(left.date)), [cashEntries]);

  function addCash(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(cashForm.amount);
    try {
      const currency = cashForm.currency || base;
      const toCurrency = cashForm.toCurrency || (currency === base ? foreign[0] ?? "USD" : base);
      saveCash(activePortfolio.id, { id: crypto.randomUUID(), kind: cashForm.kind, date: cashForm.date, amount: Math.round(amount * 100) / 100,
        ...(currency !== base ? { currency } : {}),
        ...(cashForm.kind === "fx" ? { currency, toCurrency, toAmount: Math.round(Number(cashForm.toAmount) * 100) / 100 } : {}),
        ...(cashForm.symbol.trim() ? { symbol: cashForm.symbol.trim().toUpperCase() } : {}), ...(cashForm.note.trim() ? { note: cashForm.note.trim().slice(0, 500) } : {}) });
      setCashForm({ ...cashForm, amount: "", toAmount: "", symbol: "", note: "" });
      setCashError("");
    } catch (reason) {
      setCashError(reason instanceof Error && reason.message === "INVALID_TIME" ? text("Date cannot be in the future.", "日期不能晚于今天。") : reason instanceof Error && reason.message === "INVALID_FX" ? text("Enter the amount received and pick a different currency.", "请填写换得的金额，并选择不同的币种。") : text("Enter an amount greater than 0.", "请输入大于 0 的金额。"));
    }
  }

  // ---- Splits applied & dividends that may be missing from the cash ledger ----
  const actions = useCorporateActions(activePortfolio);
  const appliedSplits = useMemo(() => (activePortfolio.splits ?? []).filter((split) => trades.some((trade) => trade.symbol === split.symbol && tradeDate(trade.tradedAt) < split.date)), [activePortfolio.splits, trades]);
  const missingDividends = useMemo(() => {
    if (!actions) return [];
    return actions.dividends.flatMap((dividend) => {
      // Entitled if the shares were held at the close before the ex-date. Yahoo's per-share amounts are
      // split-adjusted, so shares are counted on today's basis too.
      const held = trades.filter((trade) => trade.symbol === dividend.symbol && tradeDate(trade.tradedAt) < dividend.date)
        .reduce((sum, trade) => sum + (trade.side === "buy" ? 1 : -1) * trade.quantity * splitFactor(activePortfolio.splits, trade.symbol, trade.tradedAt), 0);
      if (held <= 1e-8) return [];
      const from = new Date(`${dividend.date}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 7);
      const to = new Date(`${dividend.date}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 75);
      const recorded = cashEntries.some((entry) => entry.kind === "dividend" && entry.symbol === dividend.symbol && entry.date >= from.toISOString().slice(0, 10) && entry.date <= to.toISOString().slice(0, 10));
      const factor = toBase(dividend.symbol, dividend.date);
      if (factor == null) return [];
      return recorded ? [] : [{ ...dividend, shares: held, currency: unitOf[dividend.symbol]?.currency ?? base, total: Math.round(held * dividend.amount * factor * 100) / 100 }];
    }).filter((item) => item.total >= 0.01).sort((left, right) => right.date.localeCompare(left.date));
  }, [actions, trades, cashEntries, activePortfolio.splits, toBase, unitOf, base]);
  function addDividends(items: typeof missingDividends) {
    try {
      for (const item of items) saveCash(activePortfolio.id, { id: crypto.randomUUID(), kind: "dividend", date: item.date, amount: item.total, symbol: item.symbol, note: `${item.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} × ${item.currency} ${item.amount} (ex-date, gross${item.currency !== base ? `, in ${base}` : ""})` });
    } catch { setCashError(text("Could not add dividends.", "无法添加分红。")); }
  }

  const ledger = useMemo(() => {
    const query = filter.trim().toUpperCase();
    return [...trades]
      .filter((trade) => !query || trade.symbol.includes(query) || (trade.note ?? "").toUpperCase().includes(query) || (trade.tags ?? []).some((tag) => tag.toUpperCase().includes(query)))
      .sort((left, right) => tradeDate(right.tradedAt).localeCompare(tradeDate(left.tradedAt)) || left.symbol.localeCompare(right.symbol));
  }, [trades, filter]);

  function exportCsv() {
    const header = ["date", "symbol", "side", "quantity", "price", "amount", "note", "tags"];
    const rows = [...trades].sort((left, right) => tradeDate(left.tradedAt).localeCompare(tradeDate(right.tradedAt))).map((trade) => [tradeDate(trade.tradedAt), trade.symbol, trade.side, trade.quantity, trade.price.toFixed(2), (trade.price * trade.quantity).toFixed(2), trade.note ?? "", (trade.tags ?? []).join(";")]);
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
        <p className="tl-muted">{text("One ledger per portfolio. The same records drive the Market and Portfolio pages.", "每个组合一份交易账本，行情页和组合页的分析共用同一份记录。")}</p>
      </div>
      <div className="tl-heading-actions">
        <label className="tl-select">{text("Portfolio", "组合")}
          <select value={activePortfolio.id} onChange={(event) => selectPortfolio(event.target.value)}>
            {portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolioLabel(portfolio)}{portfolio.trades?.length ? ` · ${portfolio.trades.length}` : ""}</option>)}
          </select>
        </label>
        <label className="tl-select tl-select-small">{text("Ledger currency", "账本币种")}
          <select value={base} onChange={(event) => setBaseCurrency(activePortfolio.id, event.target.value)}>{BASE_CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select>
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
    {appliedSplits.length > 0 && <p className="tl-notice" role="status">{text("Share splits applied to earlier trades: ", "已按拆股调整之前的交易：")}{appliedSplits.map((split) => `${split.symbol} ${split.date} ${splitLabel(split.ratio)}`).join(" · ")}{text(". Records stay as typed; positions, costs and analytics use today's share count.", "。原始记录保持不变，持仓、成本和分析都按现在的股数计算。")}</p>}

    <section className="tl-metrics" aria-label={text("Ledger summary", "账本概览")}>
      <article><span>{text("Trades", "交易笔数")}</span><strong>{trades.length}</strong><small>{symbols.length} {text("securities", "只证券")}</small></article>
      <article><span>{text("Open positions", "持仓数")}</span><strong>{openPositions.length}</strong><small>{text("Average-cost method", "平均成本法")}</small></article>
      <article><span>{text("Market value", "持仓市值")}</span><strong>{quotesPending && openPositions.length ? "…" : money(totalMarket)}</strong><small>{quotesMissing ? text("Some quotes unavailable", "部分报价缺失") : hasForeign ? text(`${base} · ${foreign.join("/")} at today's rate`, `${base} · ${foreign.join("/")} 按今日汇率`) : `${base} · ${text("latest quote", "最新报价")}`}</small></article>
      <article><span>{text("Unrealized P&L", "未实现盈亏")}</span><strong className={tone(totalUnrealized)}>{quotesPending && openPositions.length ? "…" : signed(totalUnrealized)}</strong><small>{hasForeign ? text("vs. cost, incl. FX", "相对成本，含汇率影响") : text("vs. average cost", "相对平均成本")}</small></article>
      <article><span>{text("Realized P&L", "已实现盈亏")}</span><strong className={tone(totalRealized)}>{quotesPending ? "…" : signed(totalRealized)}</strong><small>{text("Excl. fees & dividends", "不含费用与分红")}</small></article>
    </section>

    {hasCash && <section className="tl-metrics tl-metrics-cash" aria-label={text("Cash summary", "现金概览")}>
      <article><span>{text("Cash balance", "现金余额")} · {base}</span><strong className={cash.negative || cash.balance < -0.005 ? "tl-negative" : ""}>{quotesPending ? "…" : money(cash.balance)}</strong><small>{Object.keys(cash.balances).length > 1 || Object.keys(cash.balances).some((code) => code !== base)
        ? Object.entries(cash.balances).map(([code, value]) => `${code} ${money(value)}`).join(" · ") + (Math.abs(cash.fxGain) >= 0.005 && Number.isFinite(cash.fxGain) ? ` · ${text("FX", "汇兑")} ${signed(cash.fxGain)}` : "")
        : cash.negative || cash.balance < -0.005 ? text("Negative — a deposit may be missing", "为负，可能漏记入金") : text("Deposits + sells + income − buys − costs", "入金+卖出+收入−买入−费用")}</small></article>
      <article><span>{text("Net contributions", "净投入")}</span><strong>{money(cash.netContributions)}</strong><small>{text("Deposits − withdrawals", "入金 − 出金")}</small></article>
      <article><span>{text("Dividends & interest", "分红与利息")}</span><strong className={tone(cash.income)}>{signed(cash.income)}</strong><small>{text("Cash income", "现金收入")}</small></article>
      <article><span>{text("Fees & tax", "费用与税")}</span><strong className={tone(-cash.costs)}>{signed(-cash.costs)}</strong><small>{text("Brokerage, withholding", "佣金、预扣税等")}</small></article>
      <article><span>{text("Account value", "账户总值")}</span><strong>{quotesPending && openPositions.length ? "…" : money(accountValue)}</strong><small className={tone(totalReturn)}>{totalReturn !== null ? `${text("Total return", "总收益")} ${signed(totalReturn)}${cash.netContributions > 0 ? ` (${signed((totalReturn / cash.netContributions) * 100)}%)` : ""}` : text("Holdings + cash", "持仓 + 现金")}</small></article>
    </section>}

    {!trades.length ? <section className="tl-empty">
      <h2>{text("No trades recorded in this portfolio", "此组合暂无交易记录")}</h2>
      <p>{activePortfolio.demoId
        ? text("This is a demo portfolio: its holdings are fixed sample positions priced with real market data, not your purchases. Add a real trade to switch it to your own records.", "这是演示组合：持仓是固定的示例仓位（按真实行情计价），不是你的实际买入。录入真实交易后即切换为你自己的记录。")
        : text("Record a buy to start. Portfolio analytics rebuild from these records.", "先录入一笔买入。组合页的分析会基于这些记录重新计算。")}</p>
      <button className="tl-primary" onClick={() => setEditor({ symbol: "" })}>{text("+ Add first trade", "+ 录入第一笔交易")}</button>
    </section> : <>
      <section className="tl-section">
        <div className="tl-section-heading"><div><h2>{text("Positions", "持仓")}</h2><p>{text("Rebuilt from the ledger. Prices in each security's quote currency.", "由交易记录重建，价格为各证券报价币种。")}</p></div></div>
        <div className="tl-scroll"><table>
          <thead><tr>{[text("Symbol", "代码"), text("Qty", "数量"), text("Avg cost", "平均成本"), text("Last", "现价"), text("Market value", "市值"), text("Unrealized", "未实现"), text("Realized", "已实现"), ...(hasForeign ? [`${text("Value", "市值")} ${base}`, `${text("Total P&L", "总盈亏")} ${base}`] : []), ""].map((label, index) => <th key={index}>{label}</th>)}</tr></thead>
          <tbody>{positions.map((position) => <tr key={position.symbol} className={position.open ? "" : "tl-closed"}>
            <td><button className="tl-symbol" title={text("Open on the Market page", "在行情页查看")} onClick={() => pickSymbol(position.symbol)}>{position.symbol} ↗</button>{!position.open && <small>{text("Closed", "已平仓")}</small>}</td>
            <td>{position.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
            <td>{money(position.averageCost)}</td>
            <td>{position.open ? (position.symbol in quotes ? money(position.quote?.price) : "…") : "—"}{position.quote && (hasForeign || position.currency !== "USD") ? <small>{position.currency}</small> : null}</td>
            <td>{position.open ? money(position.marketValue) : "—"}</td>
            <td className={tone(position.unrealized)}>{position.open ? signed(position.unrealized) : "—"}</td>
            <td className={tone(position.realized)}>{signed(position.realized)}</td>
            {hasForeign && <td>{position.open ? (position.marketBase == null ? "…" : money(position.marketBase)) : "—"}</td>}
            {hasForeign && (() => { const total = position.unrealizedBase != null && position.realizedBase != null ? position.unrealizedBase + position.realizedBase : null; return <td className={tone(total)}>{total == null ? "…" : signed(total)}</td>; })()}
            <td><button className="tl-row-button" onClick={() => setEditor({ symbol: position.symbol })}>{text("Trades", "交易")} · {position.tradeCount}</button></td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className="tl-section">
        <div className="tl-section-heading">
          <div><h2>{text("All trades", "全部交易")}</h2><p>{text("Newest first. Edit or delete in the trade editor.", "按日期倒序；在交易编辑器中修改或删除。")}</p></div>
          <div className="tl-tools"><input type="search" placeholder={text("Filter symbol, note or tag…", "筛选代码、备注或标签…")} value={filter} onChange={(event) => setFilter(event.target.value)} /><button className="tl-button" onClick={exportCsv}>{text("Export CSV", "导出 CSV")}</button></div>
        </div>
        <div className="tl-scroll"><table>
          <thead><tr>{[text("Date", "日期"), text("Symbol", "代码"), text("Side", "方向"), text("Qty", "数量"), text("Price", "价格"), text("Amount", "金额"), text("Note", "备注"), ""].map((label, index) => <th key={index} className={index === 1 || index === 6 ? "tl-left" : undefined}>{label}</th>)}</tr></thead>
          <tbody>{ledger.map((trade) => <tr key={trade.id}>
            <td>{tradeDate(trade.tradedAt)}</td>
            <td className="tl-symbol tl-left">{trade.symbol}</td>
            <td><span className={`tl-side tl-side-${trade.side}`}>{trade.side === "buy" ? text("Buy", "买入") : text("Sell", "卖出")}</span></td>
            <td>{trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}{(() => { const factor = splitFactor(activePortfolio.splits, trade.symbol, trade.tradedAt); return factor !== 1 ? <small title={text("After share split", "拆股调整后")}>{text("now", "现")} {(trade.quantity * factor).toLocaleString(undefined, { maximumFractionDigits: 4 })}</small> : null; })()}</td>
            <td>{money(trade.price)}{(() => { const factor = splitFactor(activePortfolio.splits, trade.symbol, trade.tradedAt); return factor !== 1 ? <small>{text("now", "现")} {money(trade.price / factor)}</small> : null; })()}</td>
            <td>{money(trade.price * trade.quantity)}</td>
            <td className="tl-note">{trade.tags?.length ? <span className="tl-tags">{trade.tags.map((tag) => <i key={tag}>{tag}</i>)}</span> : null}{trade.note ?? ""}</td>
            <td><button className="tl-row-button" onClick={() => setEditor({ symbol: trade.symbol })}>{text("Edit", "编辑")}</button></td>
          </tr>)}</tbody>
        </table></div>
        {!ledger.length && <p className="tl-muted">{text("No trades match this filter.", "没有符合筛选条件的交易。")}</p>}
      </section>
    </>}

    <section className="tl-section">
      <div className="tl-section-heading"><div><h2>{text("Cash ledger", "现金账本")}</h2><p>{cashMode === "local"
        ? text(`Each currency keeps its own cash (Stake / IBKR style). Trades settle in the security's currency; use "FX conversion" when you change money. Totals in ${base} at today's rate.`, `每个币种单独记现金（Stake / IBKR 方式）。交易用证券本币结算，换汇时记一笔“换汇”。合计按今日汇率折成 ${base}。`)
        : text(`Your broker converts every trade into ${base} at the trade-date rate (CommSec style). Buys and sells move cash automatically.`, `券商把每笔交易按成交日汇率换成 ${base} 结算（CommSec 方式）。买卖交易会自动计入现金变动。`)}</p></div>
        <label className="tl-select tl-select-small">{text("Cash settlement", "现金结算方式")}<select value={cashMode} onChange={(event) => setCashMode(activePortfolio.id, event.target.value as "base" | "local")}><option value="base">{text(`All in ${base}`, `统一 ${base}`)}</option><option value="local">{text("Per currency", "分币种")}</option></select></label></div>
      {missingDividends.length > 0 && <div className="cl-suggest">
        <div className="cl-suggest-head"><strong>{text(`${missingDividends.length} dividend${missingDividends.length === 1 ? "" : "s"} may be missing`, `可能漏记了 ${missingDividends.length} 笔分红`)}</strong><span>{text("Estimated from Yahoo per-share dividends × shares held before the ex-date, gross of withholding tax. Check against your broker statement.", "按 Yahoo 每股分红 × 除息日前持股数估算，税前金额，请与券商结单核对。")}</span><button className="tl-button" onClick={() => addDividends(missingDividends)}>{text("Add all", "全部添加")}</button></div>
        <div className="tl-scroll"><table><tbody>{missingDividends.slice(0, 6).map((item) => <tr key={`${item.symbol}:${item.date}`}>
          <td>{item.date}</td><td className="tl-left tl-symbol">{item.symbol}</td><td>{item.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} × {item.currency} {item.amount}</td><td className="cl-in">+{money(item.total)}</td>
          <td><button className="tl-row-button" onClick={() => addDividends([item])}>{text("Add", "添加")}</button></td>
        </tr>)}</tbody></table></div>
        {missingDividends.length > 6 && <p className="tl-muted">{text(`${missingDividends.length - 6} more not shown; "Add all" includes them.`, `另有 ${missingDividends.length - 6} 笔未显示，“全部添加”会一并加入。`)}</p>}
      </div>}
      <form className="cl-form" onSubmit={addCash}>
        <label>{text("Type", "类型")}<select value={cashForm.kind} onChange={(event) => setCashForm({ ...cashForm, kind: event.target.value as CashKind })}>{CASH_KINDS.map((kind) => <option key={kind} value={kind}>{cashLabel[kind][locale === "zh" ? 1 : 0]}</option>)}</select></label>
        <label>{text("Date", "日期")}<input type="date" required value={cashForm.date} onChange={(event) => setCashForm({ ...cashForm, date: event.target.value })} /></label>
        <label>{cashForm.kind === "fx" ? text("Sell amount", "换出金额") : text("Amount", "金额")}<span className="cl-money"><select aria-label={text("Currency", "币种")} value={cashForm.currency || base} onChange={(event) => setCashForm({ ...cashForm, currency: event.target.value })}>{cashCurrencies.map((code) => <option key={code}>{code}</option>)}</select><input type="number" min="0.01" step="0.01" required value={cashForm.amount} onChange={(event) => setCashForm({ ...cashForm, amount: event.target.value })} /></span></label>
        {cashForm.kind === "fx" ? <label>{text("Receive", "换得金额")}<span className="cl-money"><select aria-label={text("Currency received", "换入币种")} value={cashForm.toCurrency || ((cashForm.currency || base) === base ? foreign[0] ?? "USD" : base)} onChange={(event) => setCashForm({ ...cashForm, toCurrency: event.target.value })}>{cashCurrencies.map((code) => <option key={code}>{code}</option>)}</select><input type="number" min="0.01" step="0.01" required value={cashForm.toAmount} onChange={(event) => setCashForm({ ...cashForm, toAmount: event.target.value })} /></span></label>
          : <label>{text("Symbol (optional)", "代码（可选）")}<input value={cashForm.symbol} onChange={(event) => setCashForm({ ...cashForm, symbol: event.target.value })} /></label>}
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
          <td className={entry.kind === "fx" ? "" : cashSign[entry.kind] > 0 ? "cl-in" : "cl-out"}>{entry.kind === "fx"
            ? `${entry.currency ?? base} ${money(entry.amount)} → ${entry.toCurrency} ${money(entry.toAmount)}`
            : `${cashSign[entry.kind] > 0 ? "+" : "−"}${entry.currency && entry.currency !== base ? `${entry.currency} ` : ""}${money(entry.amount)}`}</td>
          <td className="tl-note">{entry.note ?? ""}</td>
          <td><button className="tl-row-button" onClick={() => deleteCash(activePortfolio.id, entry.id)}>{text("Delete", "删除")}</button></td>
        </tr>)}</tbody>
      </table></div> : <p className="tl-muted">{text("No cash entries yet. Record your deposits to see cash balance, net contributions and total return.", "还没有现金流水。录入入金后即可看到现金余额、净投入和总收益。")}</p>}
    </section>

    {importing && <CsvImportDialog portfolioId={activePortfolio.id} zh={locale === "zh"} onClose={(message) => { setImporting(false); if (message) setNotice(message); }} />}

    {editor && <PortfolioTradesDialog key={`${activePortfolio.id}:${editor.symbol}`} portfolioId={activePortfolio.id} symbol={editor.symbol} onClose={() => setEditor(null)} />}
  </main>;
}
