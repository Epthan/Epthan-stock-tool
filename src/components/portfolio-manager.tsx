"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { SymbolSearchBox } from "@/components/symbol-search-box";
import { usePortfolios } from "@/hooks/use-portfolios";
import { PortfolioTradesDialog } from "@/components/portfolio-trades-dialog";

// "Portfolios" dialog on the Market page: create, rename and delete portfolios, and manage their symbol lists.
// Adding a symbol here is not a purchase; trades are recorded separately.
export function PortfolioManager({ onPick, triggerLabel }: { onPick: (symbol: string) => void; triggerLabel?: string }) {
  const { locale } = useLanguage();
  const text = (english: string, chinese: string) => locale === "zh" ? chinese : english;
  const { portfolios, activePortfolio, selectPortfolio, createPortfolio, renamePortfolio, deletePortfolio, addSymbol, removeSymbol } = usePortfolios();
  const [mode, setMode] = useState<"create" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tradeEditor, setTradeEditor] = useState<{ portfolioId: string; symbol: string } | null>(null);
  const [removed, setRemoved] = useState<{ portfolioId: string; symbol: string } | null>(null);
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});
  const symbolsKey = activePortfolio.symbols.join(",");
  useEffect(() => {
    const controller = new AbortController();
    // Company names for the list. One request per symbol is fine for a portfolio-sized list.
    for (const symbol of symbolsKey.split(",").filter(Boolean)) {
      fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { quote?: { name?: string } };
        if (payload.quote?.name && !controller.signal.aborted) setCompanyNames((current) => ({ ...current, [symbol]: payload.quote!.name! }));
      }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [symbolsKey]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const actionDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (mode) actionDialogRef.current?.showModal();
    else actionDialogRef.current?.close();
  }, [mode]);
  const portfolioName = locale === "zh" ? activePortfolio.nameZh ?? activePortfolio.name : activePortfolio.name;
  function perform(action: () => void, message: string) {
    try { action(); setError(""); setStatus(message); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : text("Unable to save portfolio.", "无法保存组合。")); return false; }
  }
  function addStock(symbol: string) {
    perform(() => addSymbol(activePortfolio.id, symbol), `${symbol} · ${text("added to", "已添加到")} ${portfolioName}`);
  }
  function beginMode(next: "create" | "rename" | "delete") {
    setMode(next);
    setName(next === "rename" ? portfolioName : "");
    setError("");
  }
  return <>
    <button type="button" className={triggerLabel ? "pd-update-holdings" : "pm-launcher"} onClick={() => dialogRef.current?.showModal()}><span className="pm-launch-icon" aria-hidden="true">▦</span>{triggerLabel ?? text("Portfolios", "投资组合")}{!triggerLabel && <span>{portfolioName}</span>}<span aria-hidden="true">↗</span></button>
    <dialog ref={dialogRef} className="pm-dialog pm-studio" aria-label={text("Portfolio manager", "投资组合管理")} onClick={(event) => {
      if (event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialogRef.current?.close();
      }
    }}>
      <header className="pm-studio-top"><div><span className="pm-studio-mark" aria-hidden="true">▦</span><strong>{text("Portfolio library", "投资组合管理")}</strong><span className="pm-studio-count">{portfolios.length}</span></div><button className="pm-icon-button" type="button" aria-label={text("Close portfolio manager", "关闭组合管理")} title={text("Close", "关闭")} onClick={() => dialogRef.current?.close()}>×</button></header>
      <div className="pm-studio-body">
        <aside className="pm-library"><div className="pm-library-heading"><span>{text("YOUR PORTFOLIOS", "我的投资组合")}</span><button className="pm-icon-button" aria-label={text("New portfolio", "新建组合")} title={text("New portfolio", "新建组合")} onClick={() => beginMode("create")}>+</button></div>
          <nav aria-label={text("Choose portfolio", "选择组合")}>{portfolios.map((portfolio) => <button key={portfolio.id} className={portfolio.id === activePortfolio.id ? "is-selected" : ""} aria-pressed={portfolio.id === activePortfolio.id} onClick={() => { selectPortfolio(portfolio.id); setMode(null); setFilter(""); setStatus(""); setError(""); }}><span className="pm-library-avatar">{portfolio.initials}</span><span className="pm-library-name">{locale === "zh" ? portfolio.nameZh ?? portfolio.name : portfolio.name}<small>{portfolio.symbols.length} {text("securities", "只股票")}</small></span><span className="pm-selection-dot" /></button>)}</nav>
          <button className="pm-new-portfolio" onClick={() => beginMode("create")}>+ {text("New portfolio", "新建投资组合")}</button>
          <div className="pm-library-footer"><span className="pm-local-dot" />{text("Saved locally", "已保存到本地")}</div>
        </aside>
        <section className="pm-studio-main">
          <div className="pm-studio-breadcrumb">{text("PORTFOLIOS", "投资组合")} / <span>{portfolioName}</span></div>
          <div className="pm-portfolio-heading"><div><h2>{portfolioName}</h2><p>{activePortfolio.symbols.length} {text("saved securities", "只已保存股票")}</p></div><div className="pm-heading-actions"><Link href="/dashboard" onClick={() => dialogRef.current?.close()}>{text("Analytics", "组合分析")} ↗</Link><details className="pm-settings"><summary className="pm-icon-button" aria-label={text("Portfolio actions", "组合操作")} title={text("Portfolio actions", "组合操作")}>···</summary><div><button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); beginMode("rename"); }}>{text("Rename portfolio", "重命名组合")}</button><button disabled={portfolios.length <= 1} className="pm-danger" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); beginMode("delete"); }}>{text("Delete portfolio", "删除组合")}</button></div></details></div></div>

          <p className="pm-classification">{text("Add securities, then record buys and sells with date, price and quantity. Adding a symbol alone does not record a trade.", "添加股票后，可编辑交易时间、价格和数量；仅添加代码不会自动记录买入。")}</p>
          <div className="pm-add-row"><div className="pm-stock-search"><SymbolSearchBox placeholder={text("Search a symbol or company to add…", "搜索股票代码或公司，添加到组合…")} onPick={addStock} /></div></div>
          <div className="pm-securities-heading"><h3>{text("Securities", "组合股票")} <span>{activePortfolio.symbols.length}</span></h3><input aria-label={text("Filter portfolio stocks", "筛选组合股票")} placeholder={text("Filter…", "筛选…")} value={filter} onChange={(event) => setFilter(event.target.value)} /></div>
          <div className="pm-security-list">{activePortfolio.symbols.filter((symbol) => symbol.includes(filter.trim().toUpperCase())).map((symbol) => <div className="pm-security-row" key={symbol}><span className="pm-security-avatar">{symbol.slice(0, 2)}</span><button className="pm-security-symbol" onClick={() => { dialogRef.current?.close(); onPick(symbol); }}>{symbol}{companyNames[symbol] && <small>{companyNames[symbol]}</small>}</button><button className="pm-trade-launch" onClick={() => setTradeEditor({ portfolioId: activePortfolio.id, symbol })}>{text("Trades", "编辑交易")} <span>{(activePortfolio.trades ?? []).filter((trade) => trade.symbol === symbol).length || "+"}</span></button><button className="pm-icon-button pm-remove" aria-label={`${text("Remove", "移除")} ${symbol}`} title={`${text("Remove", "移除")} ${symbol}`} onClick={() => { if (perform(() => removeSymbol(activePortfolio.id, symbol), `${symbol} · ${text("removed", "已移除")}`)) setRemoved({ portfolioId: activePortfolio.id, symbol }); }}>×</button></div>)}
          {!activePortfolio.symbols.length && <div className="pm-studio-empty"><span aria-hidden="true">+</span><strong>{text("Your portfolio starts here", "从第一只股票开始")}</strong><p>{text("Search for a stock above to add it to this portfolio.", "在上方搜索股票，加入你的投资组合。")}</p></div>}
          {activePortfolio.symbols.length > 0 && !activePortfolio.symbols.some((symbol) => symbol.includes(filter.trim().toUpperCase())) && <div className="pm-studio-empty"><strong>{text("No matching securities", "没有匹配的股票")}</strong><button onClick={() => setFilter("")}>{text("Clear filter", "清除筛选")}</button></div>}</div>
          <footer className="pm-studio-footer"><p role="status">{status || text("Changes are saved automatically", "更改将自动保存")}{removed && <button onClick={() => { if (perform(() => addSymbol(removed.portfolioId, removed.symbol), text("Removal undone.", "已撤销移除。"))) setRemoved(null); }}>{text("Undo", "撤销")}</button>}</p><span>{text("Local portfolio", "本地组合")}</span></footer>
          {error && !mode && <p role="alert" className="pm-error">{error}</p>}
        </section>
      </div>
    </dialog>
    <dialog ref={actionDialogRef} className="pm-dialog pm-studio pm-action-dialog" aria-labelledby="pm-action-title" onClose={() => setMode(null)} onCancel={() => setMode(null)}>
      <header className="pm-studio-top"><strong id="pm-action-title">{mode === "delete" ? text("Delete portfolio", "删除投资组合") : mode === "rename" ? text("Rename portfolio", "重命名投资组合") : text("New portfolio", "新建投资组合")}</strong><button className="pm-icon-button" type="button" aria-label={text("Close confirmation", "关闭确认窗口")} onClick={() => setMode(null)}>×</button></header>
      <div className="pm-action-body">
          {mode && <form className="pm-studio-edit" onSubmit={(event) => {
            event.preventDefault();
            const success = mode === "delete" ? perform(() => deletePortfolio(activePortfolio.id), text("Portfolio deleted.", "组合已删除。")) : mode === "create" ? perform(() => createPortfolio(name), text("Portfolio created.", "组合已创建。")) : perform(() => renamePortfolio(activePortfolio.id, name), text("Portfolio renamed.", "组合已重命名。"));
            if (success) { setMode(null); setFilter(""); }
          }}><div>{mode === "delete" ? <><strong>{text("Delete", "删除")} “{portfolioName}”?</strong><p>{text("This removes the portfolio and its saved stock list.", "将删除该组合及其中保存的股票列表。")}</p></> : <label>{mode === "create" ? text("New portfolio name", "新组合名称") : text("Portfolio name", "组合名称")}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required /></label>}</div><div className="pm-edit-actions"><button type="button" autoFocus={mode === "delete"} onClick={() => setMode(null)}>{text("Cancel", "取消")}</button><button type="submit" className={mode === "delete" ? "pm-danger" : "pm-primary"}>{mode === "delete" ? text("Confirm delete", "确认删除") : text("Save", "保存")}</button></div></form>}
        {error && <p role="alert" className="pm-error">{error}</p>}
      </div>
    </dialog>
    {tradeEditor && <PortfolioTradesDialog portfolioId={tradeEditor.portfolioId} symbol={tradeEditor.symbol} onClose={() => setTradeEditor(null)} />}
  </>;
}
