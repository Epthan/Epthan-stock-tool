"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortfolios } from "@/hooks/use-portfolios";
import { cashLabel } from "@/lib/cash-ledger";
import { FIELDS, buildImport, detectMapping, parseCsv, reasonLabel, type DateOrder, type Field, type Mapping } from "@/lib/csv-import";

const fieldLabel: Record<Field, [string, string]> = {
  date: ["Date", "日期"], symbol: ["Symbol", "代码"], action: ["Type / side", "类型/方向"], quantity: ["Quantity", "数量"], price: ["Price", "价格"],
  amount: ["Amount", "金额"], fee: ["Fee / brokerage", "佣金/费用"], note: ["Note", "备注"], tags: ["Tags", "标签"], details: ["Details", "摘要"], debit: ["Debit", "借方"], credit: ["Credit", "贷方"],
};

export function CsvImportDialog({ portfolioId, zh, onClose }: { portfolioId: string; zh: boolean; onClose: (message?: string) => void }) {
  const text = (english: string, chinese: string) => (zh ? chinese : english);
  const { portfolios, importRecords } = usePortfolios();
  const portfolio = portfolios.find((item) => item.id === portfolioId);
  const dialog = useRef<HTMLDialogElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("auto");
  const [suffix, setSuffix] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function load(file: File) {
    setError("");
    const buffer = await file.arrayBuffer();
    let content = new TextDecoder("utf-8").decode(buffer);
    if (content.includes("�")) { try { content = new TextDecoder("gbk").decode(buffer); } catch {} } // Chinese brokers export GBK
    const parsed = parseCsv(content);
    if (parsed.length < 2) { setError(text("No rows found in this file.", "文件里没有可读的数据行。")); return; }
    const detected = detectMapping(parsed);
    setFileName(file.name); setRows(parsed); setHeaderRow(detected.headerRow); setMapping(detected.mapping);
  }

  const header = rows[headerRow] ?? [];
  const result = useMemo(() => {
    if (!rows.length || !portfolio) return null;
    try { return buildImport(rows, { headerRow, mapping, dateOrder, suffix, existingTrades: portfolio.trades ?? [], existingCash: portfolio.cash ?? [], splits: portfolio.splits }); }
    catch { return null; }
  }, [rows, headerRow, mapping, dateOrder, suffix, portfolio]);
  const counts = useMemo(() => {
    const list = result ?? [];
    return { trade: list.filter((row) => row.status === "trade").length, cash: list.filter((row) => row.status === "cash").length, fees: list.filter((row) => row.status === "trade" && row.cash?.length).length, duplicate: list.filter((row) => row.status === "duplicate").length, skipped: list.filter((row) => row.status === "skipped").length };
  }, [result]);

  function commit() {
    if (!result) return;
    const trades = result.flatMap((row) => (row.status === "trade" && row.trade ? [row.trade] : []));
    const cash = result.flatMap((row) => (row.status === "trade" || row.status === "cash" ? row.cash ?? [] : []));
    try {
      importRecords(portfolioId, trades, cash);
      onClose(text(`Imported ${trades.length} trades and ${cash.length} cash entries.`, `已导入 ${trades.length} 笔交易、${cash.length} 条现金流水。`));
    } catch {
      setError(text("Import failed validation. Nothing was saved.", "导入校验失败，未保存任何数据。"));
    }
  }

  const statusText = (status: string) => ({ trade: text("Trade", "交易"), cash: text("Cash", "现金"), duplicate: text("Duplicate", "重复"), skipped: text("Skipped", "跳过") }[status] ?? status);

  return <dialog ref={dialog} className="ci-dialog" aria-labelledby="ci-title" onClose={() => onClose()}>
    <header className="ci-top"><strong id="ci-title">{text("Import broker CSV", "导入券商 CSV")}</strong><button className="tl-row-button" aria-label={text("Close", "关闭")} onClick={() => dialog.current?.close()}>×</button></header>
    <div className="ci-body">
      <p className="tl-muted">{text(
        "Columns are matched automatically (IBKR, CommSec, Stake, SelfWealth, Chinese brokers, or this app's own export). Check the mapping and preview, then import. Duplicates already in the portfolio are skipped; brokerage becomes a fee entry in the cash ledger.",
        "自动识别列名（IBKR、CommSec、Stake、SelfWealth、国内券商，或本工具导出的 CSV）。确认列映射和预览后再导入。组合里已有的重复记录会自动跳过；佣金会记入现金账本的“费用”。")}</p>
      <label className="tl-button ci-file">{fileName || text("Choose CSV file…", "选择 CSV 文件…")}<input type="file" accept=".csv,text/csv,.txt" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) load(file); }} /></label>
      {rows.length > 0 && <>
        <div className="ci-options">
          <label>{text("Header row", "表头所在行")}<select value={headerRow} onChange={(event) => { const next = Number(event.target.value); setHeaderRow(next); setMapping(detectMapping([rows[next]]).mapping); }}>{rows.slice(0, 15).map((row, index) => <option key={index} value={index}>{index + 1}: {row.slice(0, 4).join(" | ").slice(0, 50)}</option>)}</select></label>
          <label>{text("Date format", "日期格式")}<select value={dateOrder} onChange={(event) => setDateOrder(event.target.value as DateOrder)}><option value="auto">{text("Auto", "自动")}</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option><option value="ymd">YYYY-MM-DD</option></select></label>
          <label>{text("Symbol suffix", "代码后缀")}<input value={suffix} placeholder={text("e.g. .AX for ASX", "如 ASX 填 .AX")} onChange={(event) => setSuffix(event.target.value)} /></label>
        </div>
        <div className="ci-mapping">{FIELDS.map((field) => <label key={field}>{fieldLabel[field][zh ? 1 : 0]}
          <select value={mapping[field] ?? ""} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value === "" ? undefined : Number(event.target.value) })}>
            <option value="">—</option>{header.map((name, column) => <option key={column} value={column}>{name || `#${column + 1}`}</option>)}
          </select></label>)}</div>
        <p className="ci-counts"><b>{counts.trade}</b> {text("trades", "笔交易")} · <b>{counts.cash}</b> {text("cash entries", "条现金流水")}{counts.fees ? ` (+${counts.fees} ${text("fees", "条佣金")})` : ""} · <b>{counts.duplicate}</b> {text("duplicates", "条重复")} · <b className={counts.skipped ? "tl-negative" : ""}>{counts.skipped}</b> {text("skipped", "条跳过")}</p>
        <div className="tl-scroll ci-preview"><table>
          <thead><tr>{[text("Line", "行"), text("Result", "结果"), text("Date", "日期"), text("Symbol", "代码"), text("Type", "类型"), text("Qty", "数量"), text("Price", "价格"), text("Amount", "金额")].map((label, index) => <th key={index}>{label}</th>)}</tr></thead>
          <tbody>{(result ?? []).slice(0, 200).map((row) => {
            const cash = row.status === "cash" ? row.cash?.[0] : undefined;
            return <tr key={row.line} className={row.status === "skipped" || row.status === "duplicate" ? "tl-closed" : ""}>
              <td>{row.line}</td>
              <td className="tl-left">{statusText(row.status)}{row.reason ? <small>{reasonLabel(row.reason, zh)}</small> : null}</td>
              <td>{row.trade?.tradedAt ?? cash?.date ?? ""}</td>
              <td className="tl-left">{row.trade?.symbol ?? cash?.symbol ?? ""}</td>
              <td>{row.trade ? (row.trade.side === "buy" ? text("Buy", "买入") : text("Sell", "卖出")) : cash ? cashLabel[cash.kind][zh ? 1 : 0] : ""}</td>
              <td>{row.trade?.quantity ?? ""}</td>
              <td>{row.trade?.price.toFixed(2) ?? ""}</td>
              <td>{row.trade ? (row.trade.price * row.trade.quantity).toFixed(2) : cash?.amount.toFixed(2) ?? ""}</td>
            </tr>;
          })}</tbody>
        </table></div>
        {(result?.length ?? 0) > 200 && <p className="tl-muted">{text("Preview shows the first 200 rows; all rows will be imported.", "预览只显示前 200 行，导入时会处理全部行。")}</p>}
      </>}
      {error && <p className="tl-negative" role="alert">{error}</p>}
    </div>
    <footer className="ci-actions">
      <span className="tl-muted">{portfolio ? (zh ? portfolio.nameZh ?? portfolio.name : portfolio.name) : ""}</span>
      <button className="tl-button" onClick={() => dialog.current?.close()}>{text("Cancel", "取消")}</button>
      <button className="tl-primary" disabled={!counts.trade && !counts.cash} onClick={commit}>{text(`Import ${counts.trade + counts.cash}`, `导入 ${counts.trade + counts.cash} 条`)}</button>
    </footer>
  </dialog>;
}
