"use client";

import { useEffect, useRef, useState } from "react";
import { SymbolSearchBox } from "@/components/symbol-search-box";
import { useLanguage } from "@/components/language-provider";
import { usePortfolios } from "@/hooks/use-portfolios";
import { getTradePosition, tradeDate, type PortfolioTrade } from "@/lib/portfolio-trades";

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
  const position = getTradePosition(portfolio?.trades ?? [], symbol);
  const [form, setForm] = useState({ id: "", side: "buy" as "buy" | "sell", tradedAt: localDate(), price: "", quantity: "" });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); if (!initialSymbol) dialog.current?.querySelector<HTMLInputElement>(".pm-stock-search input")?.focus(); }, [initialSymbol]);
  function reset() { setForm({ id: "", side: "buy", tradedAt: localDate(), price: "", quantity: "" }); setError(""); }
  function errorMessage(reason: unknown) {
    const code = reason instanceof Error ? reason.message : "";
    return ({
      INSUFFICIENT_SHARES: text("This change would create a sale larger than the recorded holdings at that time. Check earlier buys and later sells.", "该操作会导致某笔卖出超过当时可用持仓，请检查此前买入和后续卖出记录。"),
      INVALID_TIME: text("Choose a valid date, not in the future.", "请选择有效交易日期，不能晚于今天。"),
      INVALID_AMOUNT: text("Price and quantity must be finite positive numbers.", "价格和数量必须是大于零的有效数值。"),
    } as Record<string, string>)[code] ?? text("Unable to save this trade. Check your entries.", "无法保存交易，请检查输入内容。");
  }
  function edit(trade: PortfolioTrade) {
    setForm({ id: trade.id, side: trade.side, tradedAt: tradeDate(trade.tradedAt), price: trade.price.toFixed(2), quantity: String(trade.quantity) });
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
          saveTrade(portfolioId, { id: form.id || crypto.randomUUID(), symbol, side: form.side, tradedAt: form.tradedAt, price: Number(form.price), quantity: Number(form.quantity) });
          setStatus(form.id ? text("Trade updated.", "交易已更新。") : text("Trade saved.", "交易已保存。")); reset();
        } catch (reason) { setError(errorMessage(reason)); }
      }}>
        <h3>{form.id ? text("Edit trade", "编辑交易") : text("Add trade", "新增交易")}</h3>
        <div className="pm-trade-fields"><label>{text("Side", "买卖方向")}<select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value as "buy" | "sell" })}><option value="buy">{text("Buy", "买入")}</option><option value="sell">{text("Sell", "卖出")}</option></select></label><label>{text("Trade date", "交易日期")}<input type="date" required value={form.tradedAt} onChange={(event) => setForm({ ...form, tradedAt: event.target.value })} /></label><label>{text("Price per share", "每股成交价")}<input type="number" min="0.01" step="0.01" required value={form.price} onBlur={() => { if (form.price && Number.isFinite(Number(form.price))) setForm((current) => ({ ...current, price: (Math.round((Number(current.price) + Number.EPSILON) * 100) / 100).toFixed(2) })); }} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label><label>{text("Quantity", "数量")}<input type="number" min="0.00000001" step="any" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label></div>
        <div className="pm-edit-actions">{form.id && <button type="button" onClick={reset}>{text("Cancel editing", "取消编辑")}</button>}<button className="pm-primary" type="submit">{text("Save trade", "保存交易")}</button></div>
      </form>
      {error && <p className="pm-error" role="alert">{error}</p>}<p className="pm-trade-status" role="status">{status}</p>
      <div className="pm-trade-table"><table><thead><tr>{[text("Date", "日期"), text("Side", "方向"), text("Price", "价格"), text("Qty", "数量"), text("Actions", "操作")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{records.map((trade) => <tr key={trade.id}><td>{tradeDate(trade.tradedAt)}</td><td>{trade.side === "buy" ? text("Buy", "买入") : text("Sell", "卖出")}</td><td>{trade.price.toFixed(2)}</td><td>{trade.quantity}</td><td>{confirmDelete === trade.id ? <><button className="pm-danger" onClick={() => { try { deleteTrade(portfolioId, trade.id); setConfirmDelete(null); if (form.id === trade.id) reset(); setError(""); setStatus(text("Trade deleted.", "交易已删除。")); } catch (reason) { setError(errorMessage(reason)); } }}>{text("Confirm delete", "确认删除")}</button><button onClick={() => setConfirmDelete(null)}>{text("Cancel", "取消")}</button></> : <><button onClick={() => edit(trade)}>{text("Edit", "编辑")}</button><button className="pm-danger" onClick={() => setConfirmDelete(trade.id)}>{text("Delete", "删除")}</button></>}</td></tr>)}</tbody></table></div>
      {!records.length && <p className="pm-trades-account">{text("No recorded trades. Start with a buy transaction.", "暂无交易记录，请先记录一笔买入。")}</p>}
      </>}
      {symbol && <p className="pm-trades-note">{text("Prices use the security’s quote currency; no currency conversion, fees or corporate-action adjustments. Average cost uses recorded trades only. Demo positions are not treated as actual buys. Records are saved per portfolio and used to recalculate dashboard analytics.", "价格按证券报价币种录入，暂不计汇率、费用或拆股调整；平均成本仅根据已记录交易计算，演示持仓不视为实际买入。记录按组合独立保存，并用于重新计算 Dashboard 分析。")}</p>}
    </div>
  </dialog>;
}
