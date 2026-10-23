"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useStockSelection } from "@/components/stock-selection-provider";
import { LivePortfolioDashboard } from "@/components/live-portfolio-dashboard";
import { PortfolioTradesDialog } from "@/components/portfolio-trades-dialog";
import { usePortfolios, type ManagedPortfolio } from "@/hooks/use-portfolios";
import { useHydrated } from "@/hooks/use-hydrated";
import { StatePanel } from "@/components/state-panel";
import { DEMO_SYMBOLS, demoPortfolios } from "@/lib/portfolio-analytics";
import type { PortfolioTrade } from "@/lib/portfolio-trades";

type View = "overview" | "trades" | "performance" | "allocation" | "holdings" | "methodology";

/**
 * Demo portfolios have no trades: their fixed quantities are bought two years ago at that day's real close
 * (the server fills in the price), so demo and recorded portfolios go through exactly the same analysis and layout.
 */
function demoTrades(demoId: string): { trades: PortfolioTrade[]; cash: number } | null {
  const demo = demoPortfolios.find((item) => item.id === demoId);
  if (!demo) return null;
  const start = new Date(); start.setUTCFullYear(start.getUTCFullYear() - 2);
  const tradedAt = start.toISOString().slice(0, 10);
  return { cash: demo.cash, trades: DEMO_SYMBOLS.flatMap((symbol, index) => demo.quantities[index] > 0 ? [{ id: `demo-${demo.id}-${symbol}`, symbol, side: "buy" as const, tradedAt, price: 1, quantity: demo.quantities[index] }] : []) };
}

export function PortfolioDashboard() {
  const { locale } = useLanguage();
  const { pickSymbol } = useStockSelection();
  const zh = locale === "zh";
  const text = (english: string, chinese: string) => (zh ? chinese : english);
  const [view, setView] = useState<View>("overview");
  const [tradeEditor, setTradeEditor] = useState<{ portfolioId: string; symbol: string } | null>(null);
  const { portfolios, activePortfolio, selectPortfolio } = usePortfolios();
  const portfolioMenu = useRef<HTMLDetailsElement>(null);
  // Until hydration finishes the store still returns the server default (a demo portfolio); analysing it would waste a heavy request.
  const hydrated = useHydrated();
  const name = (portfolio: ManagedPortfolio) => (zh ? portfolio.nameZh ?? portfolio.name : portfolio.name);
  const demo = !activePortfolio.trades?.length && activePortfolio.demoId ? demoTrades(activePortfolio.demoId) : null;
  const analysed = useMemo<ManagedPortfolio>(() => (demo ? { ...activePortfolio, trades: demo.trades, cash: [] } : activePortfolio), [activePortfolio, demo]);
  const recordedPortfolio = demo ? portfolios.find((portfolio) => portfolio.id !== activePortfolio.id && portfolio.trades?.length) : undefined;

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) { if (event.target instanceof Node && !portfolioMenu.current?.contains(event.target)) portfolioMenu.current?.removeAttribute("open"); }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape" && portfolioMenu.current?.open) { portfolioMenu.current.removeAttribute("open"); portfolioMenu.current.querySelector("summary")?.focus(); } }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  function choose(id: string) {
    selectPortfolio(id);
    portfolioMenu.current?.removeAttribute("open");
    portfolioMenu.current?.querySelector("summary")?.focus();
  }

  const navigation: { id: View; label: string }[] = [
    { id: "overview", label: text("Overview", "组合概览") },
    { id: "trades", label: text("Trade analysis", "交易分析") },
    { id: "performance", label: text("Performance & risk", "表现与风险") },
    { id: "allocation", label: text("Allocation & risk", "配置与风险") },
    { id: "holdings", label: text("Holdings", "持仓明细") },
    { id: "methodology", label: text("Data & methodology", "数据与口径") },
  ];

  return <main className="portfolio-dashboard">
    <aside className="pd-sidebar pd-topbar" aria-label={text("Portfolio navigation", "组合导航")}>
      <details className="pd-portfolio-menu" ref={portfolioMenu}>
        <summary className="pd-sidebar-brand" aria-label={text("Switch portfolio", "切换投资组合")}><span className="pd-brand-mark">{activePortfolio.initials}</span><span className="pd-portfolio-identity"><small>{text("Portfolio", "投资组合")}{demo ? ` · ${text("demo", "演示")}` : ""}</small><strong>{name(activePortfolio)}</strong></span><span aria-hidden="true">⌄</span></summary>
        <div className="pd-portfolio-options" role="group" aria-label={text("Portfolios", "投资组合列表")}>
          <p>{text("Switch portfolio", "切换投资组合")}</p>
          {[...portfolios].sort((left, right) => Number(!!right.trades?.length) - Number(!!left.trades?.length)).map((portfolio) => <button type="button" key={portfolio.id} aria-pressed={portfolio.id === activePortfolio.id} onClick={() => choose(portfolio.id)}><span className="pd-brand-mark">{portfolio.initials}</span><span>{name(portfolio)}<small>{portfolio.trades?.length ? text(`${portfolio.trades.length} trades`, `${portfolio.trades.length} 笔交易`) : portfolio.demoId ? text("Demo · simulated holdings", "演示 · 模拟持仓") : text("No trades yet", "暂无交易")}</small></span></button>)}
        </div>
      </details>
      <nav>{navigation.map((item) => <button key={item.id} className={`pd-side-link ${view === item.id ? "is-active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>
      <Link href="/portfolio" className="pd-topbar-link">{text("Trade log", "交易记录")} ↗</Link>
    </aside>
    <div className="pd-content">
      <h1 className="pd-sr-only">{name(activePortfolio)} · {navigation.find((item) => item.id === view)?.label}</h1>
      {hydrated && demo && <div className="ta-switch-banner" role="note"><span>{recordedPortfolio
        ? <>{text("Demo portfolio: simulated holdings priced with real market data. Your recorded portfolio", "演示组合：模拟持仓 + 真实行情。你的真实记录组合")} <strong>{name(recordedPortfolio)}</strong> {text(`has ${recordedPortfolio.trades!.length} trades.`, `已有 ${recordedPortfolio.trades!.length} 笔交易。`)}</>
        : text("Demo portfolio: fixed holdings bought two years ago at the real close, analysed with real market data. Record a trade to switch this portfolio to your own records.", "演示组合：固定持仓在两年前按真实收盘价买入，用真实行情分析。录入一笔交易后，本组合即切换为你自己的记录。")}</span>
        {recordedPortfolio ? <button className="pd-workplace-link" onClick={() => choose(recordedPortfolio.id)}>{text("Switch to it", "切换过去")} →</button> : <Link className="pd-workplace-link" href="/portfolio">{text("Record a trade", "去录入交易")} →</Link>}</div>}
      {!hydrated ? <StatePanel kind="loading" title={text("Loading portfolio…", "正在加载组合…")} /> : <LivePortfolioDashboard key={`${activePortfolio.id}:${demo ? "demo" : "live"}`} portfolio={analysed} demoCash={demo?.cash} view={view} onPick={pickSymbol} onUpdateHolding={(symbol) => setTradeEditor({ portfolioId: activePortfolio.id, symbol })} />}
    </div>
    {tradeEditor && <PortfolioTradesDialog key={`${tradeEditor.portfolioId}:${tradeEditor.symbol}`} portfolioId={tradeEditor.portfolioId} symbol={tradeEditor.symbol} onClose={() => setTradeEditor(null)} />}
  </main>;
}
