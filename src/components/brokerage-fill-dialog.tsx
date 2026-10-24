"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortfolios } from "@/hooks/use-portfolios";
import { brokerageByTrade } from "@/lib/au-tax";
import { FEE_SCHEDULES, customFee, proposeBrokerage, type CustomFee } from "@/lib/brokerage";
import { BASE_CURRENCIES } from "@/lib/fx";
import { tradeDate } from "@/lib/portfolio-trades";

/** Fill in brokerage for every trade that has none, from a broker's fee schedule or a custom rule. Preview first, then save in one go. */
export function BrokerageFillDialog({ portfolioId, zh, onClose }: { portfolioId: string; zh: boolean; onClose: (message?: string) => void }) {
  const text = (english: string, chinese: string) => (zh ? chinese : english);
  const dialog = useRef<HTMLDialogElement>(null);
  const { portfolios, addBrokerage } = usePortfolios();
  const portfolio = portfolios.find((item) => item.id === portfolioId);
  const [scheduleId, setScheduleId] = useState(FEE_SCHEDULES[0].id);
  const [custom, setCustom] = useState<CustomFee>({ fixed: 0, percent: 0.1, minimum: 0, currency: portfolio?.baseCurrency ?? "USD" });
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);

  const missing = useMemo(() => {
    const trades = portfolio?.trades ?? [];
    const has = brokerageByTrade(trades, portfolio?.cash ?? []);
    return trades.filter((trade) => !has.has(trade.id)).sort((left, right) => tradeDate(left.tradedAt).localeCompare(tradeDate(right.tradedAt)));
  }, [portfolio]);
  const schedule = FEE_SCHEDULES.find((item) => item.id === scheduleId);
  const rows = useMemo(() => proposeBrokerage(missing, schedule ? schedule.fee : customFee(custom)), [missing, schedule, custom]);
  const chosen = rows.filter((row) => row.fee && !skipped.has(row.trade.id));
  const totals = chosen.reduce<Record<string, number>>((sum, row) => ({ ...sum, [row.fee!.currency]: (sum[row.fee!.currency] ?? 0) + row.fee!.amount }), {});
  const uncovered = rows.filter((row) => !row.fee).length;

  function apply() {
    try {
      const count = addBrokerage(portfolioId, chosen.map((row) => ({ tradeId: row.trade.id, amount: row.fee!.amount, currency: row.fee!.currency })));
      onClose(text(`Brokerage added to ${count} trade${count === 1 ? "" : "s"}. Undo with Trades → History if needed.`, `已为 ${count} 笔交易补上佣金。需要撤销可在“历史版本”里恢复。`));
    } catch { setError(text("Could not save the brokerage.", "无法保存佣金。")); }
  }
  const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const number = (value: string) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

  return <dialog ref={dialog} className="ci-dialog bf-dialog" aria-labelledby="bf-title" onClose={() => onClose()}>
    <header className="ci-top"><strong id="bf-title">{text("Fill in missing brokerage", "批量补佣金")}</strong><button className="tl-row-button" aria-label={text("Close", "关闭")} onClick={() => dialog.current?.close()}>×</button></header>
    <div className="ci-body">
      <p className="tl-muted">{text("Applies to trades with no brokerage recorded. Each fee is added as a fee entry linked to its trade, so it counts in the cost base / sale proceeds for tax. Check against your contract notes.", "只处理还没有记录佣金的交易。每笔佣金会作为“费用”记入现金账本并关联到对应交易，税务计算会计入成本或从卖出所得中扣除。请与成交单核对。")}</p>
      <div className="ci-options bf-options">
        <label>{text("Fee schedule", "收费标准")}<select value={scheduleId} onChange={(event) => setScheduleId(event.target.value)}>
          {FEE_SCHEDULES.map((item) => <option key={item.id} value={item.id}>{item.label[zh ? 1 : 0]}</option>)}
          <option value="custom">{text("Custom rule", "自定义规则")}</option>
        </select></label>
        {!schedule && <>
          <label>{text("Fixed per trade", "每笔固定")}<input type="number" min="0" step="0.01" value={custom.fixed} onChange={(event) => setCustom({ ...custom, fixed: number(event.target.value) })} /></label>
          <label>{text("% of trade value", "成交额 %")}<input type="number" min="0" step="0.01" value={custom.percent} onChange={(event) => setCustom({ ...custom, percent: number(event.target.value) })} /></label>
          <label>{text("Minimum", "最低")}<input type="number" min="0" step="0.01" value={custom.minimum} onChange={(event) => setCustom({ ...custom, minimum: number(event.target.value) })} /></label>
          <label>{text("Currency", "币种")}<select value={custom.currency} onChange={(event) => setCustom({ ...custom, currency: event.target.value })}>{BASE_CURRENCIES.map((code) => <option key={code}>{code}</option>)}</select></label>
        </>}
      </div>
      {schedule && <p className="bf-note">{schedule.note[zh ? 1 : 0]} <span className="tl-muted">{text(`Checked ${schedule.checked}; fees change, so confirm with your broker.`, `核对于 ${schedule.checked}，收费会调整，请以券商为准。`)}</span></p>}
      {!missing.length ? <p className="tl-muted">{text("Every trade already has brokerage.", "所有交易都已记录佣金。")}</p> : <>
        <p className="ci-counts"><b>{chosen.length}</b> {text("to add", "笔将补上")} · {Object.entries(totals).map(([code, value]) => `${code} ${money(value)}`).join(" + ") || "—"}{uncovered ? <> · <b className="tl-negative">{uncovered}</b> {text("not covered by this schedule (use a custom rule)", "笔不在该收费标准范围内（可用自定义规则）")}</> : null}</p>
        <div className="tl-scroll ci-preview"><table>
          <thead><tr>{["", text("Date", "日期"), text("Symbol", "代码"), text("Side", "方向"), text("Qty", "数量"), text("Value", "成交额"), text("Brokerage", "佣金")].map((label, index) => <th key={index} className={index === 2 ? "tl-left" : undefined}>{label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.trade.id} className={!row.fee || skipped.has(row.trade.id) ? "tl-closed" : ""}>
            <td><input type="checkbox" aria-label={`${row.trade.symbol} ${tradeDate(row.trade.tradedAt)}`} disabled={!row.fee} checked={!!row.fee && !skipped.has(row.trade.id)} onChange={(event) => { const next = new Set(skipped); if (event.target.checked) next.delete(row.trade.id); else next.add(row.trade.id); setSkipped(next); }} /></td>
            <td>{tradeDate(row.trade.tradedAt)}</td><td className="tl-left tl-symbol">{row.trade.symbol}</td>
            <td>{row.trade.side === "buy" ? text("Buy", "买入") : text("Sell", "卖出")}</td>
            <td>{row.trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td>{money(row.value)}</td>
            <td>{row.fee ? `${row.fee.currency} ${money(row.fee.amount)}` : text("not covered", "不适用")}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
      {error && <p className="tl-negative" role="alert">{error}</p>}
    </div>
    <footer className="ci-actions">
      <span className="tl-muted">{portfolio ? (zh ? portfolio.nameZh ?? portfolio.name : portfolio.name) : ""}</span>
      <button className="tl-button" onClick={() => dialog.current?.close()}>{text("Cancel", "取消")}</button>
      <button className="tl-primary" disabled={!chosen.length} onClick={apply}>{text(`Add ${chosen.length}`, `补上 ${chosen.length} 笔`)}</button>
    </footer>
  </dialog>;
}
