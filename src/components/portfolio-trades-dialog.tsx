"use client";

import { useEffect, useRef, useState } from "react";
import { SymbolSearchBox } from "@/components/symbol-search-box";
import { useLanguage } from "@/components/language-provider";
import { usePortfolios } from "@/hooks/use-portfolios";
import { SUGGESTED_TAGS, getTradePosition, normalizeTags, tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";
import { feeTradeId } from "@/lib/au-tax";
import { BASE_CURRENCIES } from "@/lib/fx";

function localDate() {
  return tradeDate(new Date().toISOString());
}

export function PortfolioTradesDialog({ portfolioId, symbol: initialSymbol, onClose }: { portfolioId: string; symbol: string; onClose: () => void }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const { locale } = useLanguage();
  const text = (english: string, chinese: string) => locale === "zh" ? chinese : english;
  const { portfolios, saveTrade, deleteTrade } = usePortfolios();
  const portfolio = portfolios.find((item) => item.id === portfolioId);
  const records = (portfolio?.trades ?? []).filter((trade) => trade.symbol === symbol).sort((left, right) => tradeDate(right.tradedAt).localeCompare(tradeDate(left.tradedAt)));
  const position = getTradePosition(portfolio?.trades ?? [], symbol, portfolio?.splits);
  const base = portfolio?.baseCurrency ?? "USD";
  const [form, setForm] = useState({ id: "", side: "buy" as "buy" | "sell", tradedAt: localDate(), price: "", quantity: "", note: "", tags: [] as string[], brokerage: "", brokerageCurrency: base });
  /** The fee entry booked as this trade's brokerage (linked, or an older entry matched by symbol and date). */
  const feeFor = (tradeId: string) => (portfolio?.cash ?? []).find((entry) => feeTradeId(entry, portfolio?.trades ?? []) === tradeId);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); if (!initialSymbol) dialog.current?.querySelector<HTMLInputElement>(".pm-stock-search input")?.focus(); }, [initialSymbol]);
  function reset() { setForm({ id: "", side: "buy", tradedAt: localDate(), price: "", quantity: "", note: "", tags: [], brokerage: "", brokerageCurrency: base }); setError(""); }
  function errorMessage(reason: unknown) {
    const code = reason instanceof Error ? reason.message : "";
    return ({
      INSUFFICIENT_SHARES: text("This change would create a sale larger than the recorded holdings at that time. Check earlier buys and later sells.", "该操作会导致某笔卖出超过当时可用持仓，请检查此前买入和后续卖出记录。"),
      INVALID_TIME: text("Choose a valid date, not in the future.", "请选择有效交易日期，不能晚于今天。"),
      INVALID_AMOUNT: text("Price and quantity must be finite positive numbers.", "价格和数量必须是大于零的有效数值。"),
    } as Record<string, string>)[code] ?? text("Unable to save this trade. Check your entries.", "无法保存交易，请检查输入内容。");
  }
  function edit(trade: PortfolioTrade) {
    const fee = feeFor(trade.id);
    setForm({ id: trade.id, side: trade.side, tradedAt: tradeDate(trade.tradedAt), price: trade.price.toFixed(2), quantity: String(trade.quantity), note: trade.note ?? "", tags: trade.tags ?? [], brokerage: fee ? fee.amount.toFixed(2) : "", brokerageCurrency: fee?.currency ?? base });
    setError(""); setConfirmDelete(null);
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
  }
  return <dialog ref={dialog} className={`pm-dialog pm-studio pm-trades-dialog ${symbol ? "" : "pm-symbol-picker"}`} aria-labelledby="pm-trades-title" onClose={onClose}>
    <header className="pm-studio-top"><strong id="pm-trades-title">{symbol ? `${symbol} · ` : ""}{symbol ? text("Trade records", "交易记录") : text("Add stock transaction", "添加股票交易")}</strong><button className="pm-icon-button" aria-label={text("Close trade editor", "关闭交易编辑")} onClick={() => dialog.current?.close()}>×</button></header>
    <div className="pm-trades-body"><p className="pm-trades-account">{locale === "zh" ? portfolio?.nameZh ?? portfolio?.name : portfolio?.name}</p>
      {!symbol && <div className="pm-stock-search" ><p className="pm-trades-account">{text("Choose a stock to record a transaction in this portfolio.", "搜索并选择股票，为当前组合录入交易记录。")}</p><SymbolSearchBox placeholder={text("Search symbol or company…", "搜索股票代码或公司…")} onPick={setSymbol} /></div>}
      {symbol && <><div className="pm-trades-summary"><span>{text("Recorded shares", "已记录持仓")}<strong>{position.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></span><span>{text("Average cost", "平均成本")}<strong>{position.averageCost?.toFixed(2) ?? "—"}</strong></span><span>{text("Realized P&L", "已实现盈亏")}<strong>{position.realized.toFixed(2)}</strong></span></div>
      <form className="pm-trade-form" onSubmit={(event) => {
        event.preventDefault();
        try {
          const id = form.id || crypto.randomUUID();
          const existing = form.id ? feeFor(form.id) : undefined;
          const amount = Number(form.brokerage || 0);
          if (!Number.isFinite(amount) || amount < 0) throw new Error("INVALID_AMOUNT");
          const brokerage = !form.brokerage && !existing ? undefined : { amount, currency: form.brokerageCurrency, replaceId: existing && !existing.tradeId ? existing.id : undefined };
          saveTrade(portfolioId, { id, symbol, side: form.side, tradedAt: form.tradedAt, price: Number(form.price), quantity: Number(form.quantity), ...(form.note.trim() ? { note: form.note.trim().slice(0, 500) } : {}), ...(normalizeTags(form.tags) ? { tags: normalizeTags(form.tags) } : {}) }, brokerage);
          setStatus(form.id ? text("Trade updated.", "交易已更新。") : text("Trade saved.", "交易已保存。")); reset();
        } catch (reason) { setError(errorMessage(reason)); }
      }}>
        <h3>{form.id ? text("Edit trade", "编辑交易") : text("Add trade", "新增交易")}</h3>
        <div className="pm-trade-fields"><label>{text("Side", "买卖方向")}<select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value as "buy" | "sell" })}><option value="buy">{text("Buy", "买入")}</option><option value="sell">{text("Sell", "卖出")}</option></select></label><label>{text("Trade date", "交易日期")}<input type="date" required value={form.tradedAt} onChange={(event) => setForm({ ...form, tradedAt: event.target.value })} /></label><label>{text("Price per share", "每股成交价")}<input type="number" min="0.01" step="0.01" required value={form.price} onBlur={() => { if (form.price && Number.isFinite(Number(form.price))) setForm((current) => ({ ...current, price: (Math.round((Number(current.price) + Number.EPSILON) * 100) / 100).toFixed(2) })); }} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label><label>{text("Quantity", "数量")}<input type="number" min="0.00000001" step="any" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label>{text("Brokerage (optional)", "佣金（可选）")}<span className="cl-money"><select aria-label={text("Brokerage currency", "佣金币种")} value={form.brokerageCurrency} onChange={(event) => setForm({ ...form, brokerageCurrency: event.target.value })}>{[...new Set([base, ...BASE_CURRENCIES])].map((code) => <option key={code}>{code}</option>)}</select><input type="number" min="0" step="0.01" inputMode="decimal" value={form.brokerage} onChange={(event) => setForm({ ...form, brokerage: event.target.value })} /></span></label><label className="pm-trade-note-field">{text("Note (optional)", "备注（可选）")}<input type="text" maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><div className="pm-trade-tags"><span>{text("Tags — why this trade", "标签 · 这笔交易的理由")}</span><div>{[...new Set([...SUGGESTED_TAGS.map(([en]) => en), ...form.tags, ...(portfolio?.trades ?? []).flatMap((trade) => trade.tags ?? [])])].slice(0, 16).map((tag) => { const on = form.tags.includes(tag); const zh = SUGGESTED_TAGS.find(([en]) => en === tag)?.[1]; return <button type="button" key={tag} aria-pressed={on} className={on ? "is-on" : ""} onClick={() => setForm({ ...form, tags: on ? form.tags.filter((item) => item !== tag) : [...form.tags, tag].slice(0, 6) })}>{locale === "zh" && zh ? zh : tag}</button>; })}<input aria-label={text("Custom tag", "自定义标签")} placeholder={text("+ custom", "+ 自定义")} maxLength={24} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); const value = event.currentTarget.value.trim(); if (value) { setForm({ ...form, tags: normalizeTags([...form.tags, value]) ?? [] }); event.currentTarget.value = ""; } } }} /></div></div></div>
        <div className="pm-edit-actions">{form.id && <button type="button" onClick={reset}>{text("Cancel editing", "取消编辑")}</button>}<button className="pm-primary" type="submit">{text("Save trade", "保存交易")}</button></div>
      </form>
      {error && <p className="pm-error" role="alert">{error}</p>}<p className="pm-trade-status" role="status">{status}</p>
      <div className="pm-trade-table"><table><thead><tr>{[text("Date", "日期"), text("Side", "方向"), text("Price", "价格"), text("Qty", "数量"), text("Note", "备注"), text("Actions", "操作")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{records.map((trade) => <tr key={trade.id}><td>{tradeDate(trade.tradedAt)}</td><td>{trade.side === "buy" ? text("Buy", "买入") : text("Sell", "卖出")}</td><td>{trade.price.toFixed(2)}{(() => { const fee = feeFor(trade.id); return fee ? <small className="pm-fee">{text("fee", "佣金")} {fee.currency && fee.currency !== base ? `${fee.currency} ` : ""}{fee.amount.toFixed(2)}</small> : null; })()}</td><td>{trade.quantity}</td><td className="pm-trade-note">{trade.tags?.length ? <span className="tl-tags">{trade.tags.map((tag) => <i key={tag}>{tag}</i>)}</span> : null}{trade.note ?? ""}</td><td>{confirmDelete === trade.id ? <><button className="pm-danger" onClick={() => { try { deleteTrade(portfolioId, trade.id); setConfirmDelete(null); if (form.id === trade.id) reset(); setError(""); setStatus(text("Trade deleted.", "交易已删除。")); } catch (reason) { setError(errorMessage(reason)); } }}>{text("Confirm delete", "确认删除")}</button><button onClick={() => setConfirmDelete(null)}>{text("Cancel", "取消")}</button></> : <><button onClick={() => edit(trade)}>{text("Edit", "编辑")}</button><button className="pm-danger" onClick={() => setConfirmDelete(trade.id)}>{text("Delete", "删除")}</button></>}</td></tr>)}</tbody></table></div>
      {!records.length && <p className="pm-trades-account">{text("No recorded trades. Start with a buy transaction.", "暂无交易记录，请先记录一笔买入。")}</p>}
      </>}
      {symbol && <p className="pm-trades-note">{text("Enter the price in the security’s quote currency (as on your contract note). Brokerage is added to the parcel's cost (buys) or taken off the proceeds (sells) and booked as a fee in the cash ledger; share splits are applied automatically; foreign trades are converted to the ledger currency at the trade-date rate. Sells close the oldest parcels first (FIFO).", "价格按证券报价币种录入（与成交单一致）。佣金填在下面，会计入批次成本（买入）或从卖出所得中扣除，并自动记入现金账本的“费用”；拆股会自动调整；外币交易按成交日汇率折算为账本币种。卖出时按先进先出（FIFO）平掉最早的批次。")}</p>}
    </div>
  </dialog>;
}
