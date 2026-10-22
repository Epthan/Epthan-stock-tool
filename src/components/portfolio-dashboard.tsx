"use client";

import Link from "next/link";
import { PerformanceInsights } from "@/components/performance-insights";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useStockSelection } from "@/components/stock-selection-provider";
import { LivePortfolioDashboard } from "@/components/live-portfolio-dashboard";
import { PortfolioTradesDialog } from "@/components/portfolio-trades-dialog";
import { initialPortfolios, usePortfolios } from "@/hooks/use-portfolios";
import { getPortfolioAnalytics, type Benchmark, type PortfolioAnalytics, type PortfolioRange } from "@/lib/portfolio-analytics";

const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const ranges: PortfolioRange[] = ["1M", "3M", "6M", "YTD", "1Y", "ALL"];
type View = "overview" | "performance" | "allocation" | "holdings" | "methodology";

function PerformanceChart({ data, drawdown = false }: { data: PortfolioAnalytics; drawdown?: boolean }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const values = data.points.flatMap((point) => drawdown ? [point.drawdown, 0] : [point.portfolio, point.benchmark, 0]);
  const low = Math.min(...values) - 0.5;
  const high = Math.max(...values) + 0.5;
  const scaleX = (index: number) => 55 + index / Math.max(1, data.points.length - 1) * 815;
  const scaleY = (value: number) => 22 + (high - value) / (high - low) * 205;
  const path = (key: "portfolio" | "benchmark" | "drawdown") => data.points.map((point, index) => `${index === 0 ? "M" : "L"}${scaleX(index)},${scaleY(point[key])}`).join(" ");
  const currentIndex = Math.min(hovered ?? data.points.length - 1, data.points.length - 1);
  const current = data.points[currentIndex];
  return <div className="pd-chart">
    <div className="pd-chart-readout" aria-live="polite"><span>{current.date}</span>{drawdown ? <strong className="pd-negative">{percent(current.drawdown)}</strong> : <><span><i style={{ background: "#14b8a6" }} />Portfolio <strong>{percent(current.portfolio)}</strong></span><span><i style={{ background: "#a78bfa" }} />Benchmark <strong>{percent(current.benchmark)}</strong></span><span>Excess <strong>{(current.portfolio - current.benchmark).toFixed(2)} pp</strong></span></>}</div>
    <svg viewBox="0 0 900 260" role="img" aria-label={drawdown ? "Portfolio drawdown" : "Cumulative portfolio and benchmark returns"} onPointerMove={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const position = (event.clientX - bounds.left) / bounds.width * 900;
      setHovered(Math.max(0, Math.min(data.points.length - 1, Math.round((position - 55) / 815 * (data.points.length - 1)))));
    }} onPointerLeave={() => setHovered(null)}>
      {Array.from({ length: 5 }, (_, index) => {
        const value = low + (high - low) * index / 4;
        return <g key={index}><line x1="55" x2="870" y1={scaleY(value)} y2={scaleY(value)} className="pd-grid-line" /><text x="45" y={scaleY(value) + 4} textAnchor="end" className="pd-chart-label">{value.toFixed(1)}%</text></g>;
      })}
      <line x1="55" x2="870" y1={scaleY(0)} y2={scaleY(0)} className="pd-grid-line" strokeDasharray="4 4" />
      {drawdown ? <path d={`${path("drawdown")} L870,${scaleY(0)} L55,${scaleY(0)} Z`} fill="rgba(251,113,133,0.12)" /> : <path d={path("benchmark")} fill="none" stroke="#a78bfa" strokeWidth="2" />}
      <path d={path(drawdown ? "drawdown" : "portfolio")} fill="none" stroke={drawdown ? "#fb7185" : "#14b8a6"} strokeWidth="2.5" />
      {hovered !== null && <g><line x1={scaleX(currentIndex)} x2={scaleX(currentIndex)} y1="22" y2="227" className="pd-grid-line" /><circle cx={scaleX(currentIndex)} cy={scaleY(drawdown ? current.drawdown : current.portfolio)} r="4" fill={drawdown ? "#fb7185" : "#14b8a6"} /></g>}
      {[0, Math.floor((data.points.length - 1) / 2), data.points.length - 1].map((index, labelIndex) => <text key={labelIndex} x={scaleX(index)} y="252" textAnchor={labelIndex === 0 ? "start" : labelIndex === 2 ? "end" : "middle"} className="pd-chart-label">{data.points[index].date}</text>)}
    </svg>
  </div>;
}

export function PortfolioDashboard() {
  const { locale } = useLanguage();
  const { pickSymbol } = useStockSelection();
  const chinese = locale === "zh";
  const text = (english: string, translated: string) => chinese ? translated : english;
  const [range, setRange] = useState<PortfolioRange>("YTD");
  const [benchmark, setBenchmark] = useState<Benchmark>("SPY");
  const [view, setView] = useState<View>("overview");
  const [tradeEditor, setTradeEditor] = useState<{ portfolioId: string; symbol: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 850px)");
    function closeOnDesktop() {
      if (!mobile.matches) setSidebarOpen(false);
    }
    mobile.addEventListener("change", closeOnDesktop);
    if (!sidebarOpen) return () => mobile.removeEventListener("change", closeOnDesktop);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLElement>("summary")?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        sidebarToggle.current?.focus();
      }
      if (event.key === "Tab") {
        const elements = [sidebarToggle.current, ...Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("summary, button, a[href]") ?? [])].filter((element): element is HTMLElement => !!element && element.getClientRects().length > 0);
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      mobile.removeEventListener("change", closeOnDesktop);
    };
  }, [sidebarOpen]);
  const [allocationMode, setAllocationMode] = useState<"holdings" | "sector">("holdings");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"value" | "pnl" | "symbol">("value");
  const { portfolios, activePortfolio, selectPortfolio: selectSavedPortfolio } = usePortfolios();
  const portfolioId = activePortfolio.id;
  const portfolioName = chinese ? activePortfolio.nameZh ?? activePortfolio.name : activePortfolio.name;
  const originalPortfolio = initialPortfolios.find((portfolio) => portfolio.id === activePortfolio.demoId);
  const analyticsAvailable = !(activePortfolio.trades?.length) && !!originalPortfolio && originalPortfolio.symbols.length === activePortfolio.symbols.length && originalPortfolio.symbols.every((symbol) => activePortfolio.symbols.includes(symbol));
  const portfolioMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && !portfolioMenu.current?.contains(event.target)) {
        portfolioMenu.current?.removeAttribute("open");
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && portfolioMenu.current?.open) {
        portfolioMenu.current.removeAttribute("open");
        portfolioMenu.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const data = useMemo(() => getPortfolioAnalytics(range, benchmark, portfolioId), [range, benchmark, portfolioId]);
  function selectPortfolio(nextId: string) {
    selectSavedPortfolio(nextId);
    setFilter("");
    portfolioMenu.current?.removeAttribute("open");
    portfolioMenu.current?.querySelector("summary")?.focus();
  }
  const sorted = [...data.holdings].sort((left, right) => right.pnl - left.pnl);
  const largest = [...data.holdings].sort((left, right) => right.marketValue - left.marketValue)[0];
  const allocations = allocationMode === "holdings" ? data.holdings.map((holding) => ({ name: holding.symbol, value: holding.marketValue, color: holding.color })) : Object.entries(data.holdings.reduce<Record<string, { value: number; color: string }>>((groups, holding) => {
    groups[holding.sector] = { value: (groups[holding.sector]?.value ?? 0) + holding.marketValue, color: groups[holding.sector]?.color ?? holding.color };
    return groups;
  }, {})).map(([name, item]) => ({ name, ...item }));
  const bars = [...allocations, { name: text("Cash", "现金"), value: data.cash, color: "#94a3b8" }].sort((left, right) => right.value - left.value);
  const visibleHoldings = data.holdings.filter((holding) => `${holding.symbol} ${holding.name}`.toLowerCase().includes(filter.toLowerCase())).sort((left, right) => sort === "symbol" ? left.symbol.localeCompare(right.symbol) : sort === "pnl" ? right.pnl - left.pnl : right.marketValue - left.marketValue);
  const navigation: { id: View; label: string; number: string }[] = [
    { id: "overview", label: text("Overview", "组合概览"), number: "01" },
    { id: "performance", label: text("Performance & risk", "表现与风险"), number: "02" },
    { id: "allocation", label: text("Allocation & drivers", "配置与贡献"), number: "03" },
    { id: "holdings", label: text("Holdings", "持仓明细"), number: "04" },
    { id: "methodology", label: text("Data & methodology", "数据与口径"), number: "05" },
  ];
  const metrics = [
    { label: text("Total assets", "总资产"), value: money(data.totalValue), note: text("Securities + cash · USD", "证券 + 现金 · 美元") },
    { label: text("Period net P&L", "区间净盈亏"), value: money(data.pnl), note: `${data.startDate} → ${data.endDate}`, tone: data.pnl >= 0 ? "positive" : "negative" },
    { label: text("Portfolio return", "组合收益率"), value: percent(data.returnPercent), note: text("Time-weighted · selected period", "时间加权 · 所选区间"), tone: data.returnPercent >= 0 ? "positive" : "negative" },
    { label: text("Excess return", "超额收益"), value: `${data.excess >= 0 ? "+" : ""}${data.excess.toFixed(2)} pp`, note: `${text("Relative to", "相对")} ${benchmark}`, tone: data.excess >= 0 ? "positive" : "negative" },
    { label: text("Maximum drawdown", "最大回撤"), value: percent(data.maxDrawdown), note: text("Weekly observations · period", "周度观测 · 所选区间"), tone: "negative" },
    { label: text("Equity beta", "持仓 β"), value: data.equityBeta.toFixed(2), note: `${benchmark} · ${text("2Y weekly · excl. cash", "2 年周收益 · 不含现金")}` },
    { label: text("Largest position", "最大持仓占比"), value: `${data.largestWeight.toFixed(1)}%`, note: `${largest.symbol} · ${text("of total assets", "占总资产")}` },
    { label: text("Cash allocation", "现金占比"), value: `${data.cashWeight.toFixed(1)}%`, note: `${money(data.cash)} · USD` },
  ];
  function exportHoldings() {
    const rows = [["Symbol", "Quantity", "Average cost", "Price", "Market value", "Period P&L", "Beta"], ...visibleHoldings.map((holding) => [holding.symbol, holding.quantity, holding.averageCost, holding.price.toFixed(2), holding.marketValue.toFixed(2), holding.pnl.toFixed(2), holding.beta?.toFixed(4) ?? ""])];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `demo-${portfolioId}-holdings-${data.endDate}-${range}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const topHoldings = [...data.holdings].sort((left, right) => right.marketValue - left.marketValue).slice(0, 3);
  const volatility = (key: "portfolio" | "benchmark") => {
    const returns = data.points.slice(1).map((point, index) => (1 + point[key] / 100) / (1 + data.points[index][key] / 100) - 1);
    if (returns.length < 2) return null;
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    return Math.sqrt(returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1)) * Math.sqrt(52) * 100;
  };
  const benchmarkDrawdown = data.points.reduce((state, point) => {
    const value = 1 + point.benchmark / 100;
    const peak = Math.max(state.peak, value);
    return { peak, drawdown: Math.min(state.drawdown, (value / peak - 1) * 100) };
  }, { peak: 1, drawdown: 0 }).drawdown;
  const comparison = [
    { label: text("Period return", "区间收益"), portfolio: percent(data.returnPercent), market: percent(data.benchmarkReturn) },
    { label: text("Maximum drawdown", "最大回撤"), portfolio: percent(data.maxDrawdown), market: percent(benchmarkDrawdown) },
    { label: text("Annualized volatility", "年化波动率"), portfolio: volatility("portfolio")?.toFixed(2).concat("%") ?? "—", market: volatility("benchmark")?.toFixed(2).concat("%") ?? "—" },
    { label: text("Weekly observations", "周收益样本数"), portfolio: String(data.points.length - 1), market: String(data.points.length - 1) },
  ];
  return <main className="portfolio-dashboard">
    <button ref={sidebarToggle} type="button" className="pd-sidebar-toggle" aria-label={text("Toggle portfolio navigation", "展开或收起组合导航")} aria-expanded={sidebarOpen} aria-controls="portfolio-sidebar" onClick={() => setSidebarOpen((open) => !open)}><span aria-hidden="true">{sidebarOpen ? "×" : "☰"}</span></button>
    {sidebarOpen && <button type="button" className="pd-sidebar-backdrop" aria-label={text("Close portfolio navigation", "关闭组合导航")} tabIndex={-1} onClick={() => { setSidebarOpen(false); sidebarToggle.current?.focus(); }} />}
    <aside ref={sidebarRef} id="portfolio-sidebar" className={`pd-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label={text("Portfolio navigation", "组合导航")}>
      <details className="pd-portfolio-menu" ref={portfolioMenu}>
        <summary className="pd-sidebar-brand" aria-label={text("Switch portfolio", "切换投资组合")}><span className="pd-brand-mark">{activePortfolio.initials}</span><span className="pd-portfolio-identity"><small>{text("Portfolio", "投资组合")}</small><strong>{portfolioName}</strong></span><span className="pd-menu-chevron" aria-hidden="true">⌄</span></summary>
        <div className="pd-portfolio-options" role="group" aria-label={text("Portfolios", "投资组合列表")}>
          <p>{text("Switch portfolio", "切换投资组合")}</p>
          {portfolios.map((portfolio) => <button type="button" key={portfolio.id} aria-pressed={portfolio.id === portfolioId} onClick={() => selectPortfolio(portfolio.id)}><span className="pd-brand-mark">{portfolio.initials}</span><span><strong>{chinese ? portfolio.nameZh ?? portfolio.name : portfolio.name}</strong><small>{portfolio.symbols.length} {text("holdings · USD", "只持仓 · 美元")}</small></span><span className="pd-menu-check" aria-hidden="true">{portfolio.id === portfolioId ? "✓" : ""}</span></button>)}
        </div>
      </details>
      <p className="pd-eyebrow">{text("ANALYTICS", "投资分析")}</p>
      <nav>{navigation.map((item) => <button key={item.id} className={`pd-side-link ${view === item.id ? "is-active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => { setView(item.id); setSidebarOpen(false); sidebarToggle.current?.focus(); }}><span>{item.number}</span>{item.label}</button>)}</nav>
      <div className="pd-sidebar-footer"><span className="pd-demo-dot" />{portfolioName}<small>{activePortfolio.symbols.length} {analyticsAvailable ? text("holdings · USD · Demo", "只持仓 · 美元 · 演示") : text("saved stocks", "只已保存股票")}</small><Link href="/portfolio" className="pd-side-link">{text("Trade log", "交易记录")} ↗</Link><Link href="/" className="pd-workplace-link">{text("Open Workplace", "前往 Workplace")} ↗</Link></div>
    </aside>
    <div className="pd-content">
      <header className="pd-heading"><div><p className="pd-eyebrow">{portfolioName} / {text("PERSONAL INVESTOR", "个人投资者")}</p><h1>{navigation.find((item) => item.id === view)?.label}</h1><p className="pd-muted">{text("Portfolio performance, exposures and the drivers behind your returns.", "了解组合表现、风险暴露，以及收益背后的驱动因素。")}</p></div></header>
      {analyticsAvailable ? <>
      <div className="pd-toolbar"><div className="pd-segments" aria-label={text("Time range", "时间范围")}>{ranges.map((option) => <button key={option} aria-pressed={range === option} className={range === option ? "is-active" : ""} onClick={() => setRange(option)}>{option}</button>)}</div><label className="pd-benchmark">{text("Benchmark", "基准")}<select value={benchmark} onChange={(event) => setBenchmark(event.target.value as Benchmark)}><option>SPY</option><option>QQQ</option></select></label><span className="pd-data-stamp"><span className="pd-demo-dot" />{text("SIMULATED", "模拟数据")} · {data.endDate}</span></div>
      {(view === "overview" || view === "performance") && <section className="pd-metrics" aria-label={text("Key portfolio metrics", "组合核心指标")}>{(view === "overview" ? metrics.slice(0, 4) : [metrics[4], { label: text("Current drawdown", "当前回撤"), value: percent(data.points.at(-1)?.drawdown ?? 0), note: text("Below selected-period peak", "相对区间前高"), tone: "negative" }, { label: text("Annualized volatility", "年化波动率"), value: volatility("portfolio")?.toFixed(2).concat("%") ?? "—", note: text("Weekly observations", "周度观测") }, metrics[5]]).map((metric) => <article className="pd-metric" key={metric.label}><p className="pd-metric-help">{metric.label}<abbr title={metric.note} aria-label={metric.note}>ⓘ</abbr></p><strong className={metric.tone ? `pd-${metric.tone}` : ""}>{metric.value}</strong><small>{metric.note}</small></article>)}</section>}
      {view === "overview" && <div className="pd-primary-grid"><section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Cumulative returns", "累计收益")}</h2><p>{text("Portfolio vs", "组合对比")} {benchmark} · {data.startDate} — {data.endDate}</p></div>{view === "overview" ? <button className="pd-button" onClick={() => setView("performance")}>{text("Explore performance", "查看表现详情")} ↗</button> : <span className="pd-badge">{text("WEEKLY", "周度")}</span>}</div><PerformanceChart data={data} /></section>{view === "overview" && <section className="pd-section pd-insights"><p className="pd-eyebrow">{text("PORTFOLIO BRIEF", "组合分析摘要")}</p><h2>{text("Behind the numbers", "数字背后的发现")}</h2><article><small>01 / {text("PERFORMANCE", "表现")}</small><p>{text("Portfolio returned", "组合收益")} <strong>{percent(data.returnPercent)}</strong>, {text("with excess return of", "相对基准超额收益为")} <strong>{data.excess.toFixed(2)} pp</strong> {text("against", "对比")} {benchmark}.</p></article><article><small>02 / {text("CONTRIBUTION", "贡献")}</small><p><strong>{sorted[0].symbol}</strong> {text("is the largest contributor", "是最大贡献持仓")} ({money(sorted[0].pnl)}). {text("Lowest contribution", "最低贡献")}: <strong>{sorted[sorted.length - 1].symbol}</strong> ({money(sorted[sorted.length - 1].pnl)}).</p></article><article><small>03 / {text("EXPOSURE", "风险暴露")}</small><p><strong>{largest.symbol}</strong> {text("accounts for", "占总资产")} <strong>{data.largestWeight.toFixed(1)}%</strong>. {text("Equity beta is", "不含现金的持仓 β 为")} <strong>{data.equityBeta.toFixed(2)}</strong>.</p></article><small className="pd-muted">{text("Selected period · simulated observations", "所选区间 · 模拟观测数据")}</small></section>}</div>}
      {view === "performance" && <PerformanceInsights points={data.points} benchmark={benchmark} weekly />}
      {view === "allocation" && <div className="pd-two-columns"><section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Asset allocation", "资产配置")}</h2><p>{text("As of", "截至")} {data.endDate} · {text("including cash", "包含现金")}</p></div><div className="pd-segments">{(["holdings", "sector"] as const).map((mode) => <button key={mode} className={allocationMode === mode ? "is-active" : ""} aria-pressed={allocationMode === mode} onClick={() => setAllocationMode(mode)}>{mode === "holdings" ? text("Holdings", "持仓") : text("Sector", "行业")}</button>)}</div></div><div className="pd-stacked-bar">{bars.map((bar) => <span key={bar.name} title={`${bar.name}: ${money(bar.value)}`} style={{ width: `${bar.value / data.totalValue * 100}%`, background: bar.color }} />)}</div>{bars.map((bar) => <div className="pd-allocation-row" key={bar.name}><span><i style={{ background: bar.color }} />{bar.name}</span><span>{money(bar.value)}</span><strong>{(bar.value / data.totalValue * 100).toFixed(1)}%</strong></div>)}</section><section className="pd-section"><div className="pd-section-heading"><div><h2>{text("P&L contribution", "区间盈亏贡献")}</h2><p>{text("Dollar contribution · selected period", "美元盈亏贡献 · 所选区间")}</p></div><span className="pd-badge">USD</span></div>{sorted.map((holding) => <div className="pd-contribution" key={holding.symbol}><button onClick={() => pickSymbol(holding.symbol)}>{holding.symbol}</button><div className="pd-diverging"><span style={{ width: `${Math.abs(holding.pnl) / Math.max(...sorted.map((item) => Math.abs(item.pnl)), 1) * 50}%`, left: holding.pnl >= 0 ? "50%" : undefined, right: holding.pnl < 0 ? "50%" : undefined, background: holding.pnl >= 0 ? "#14b8a6" : "#fb7185" }} /></div><strong className={holding.pnl >= 0 ? "pd-positive" : "pd-negative"}>{money(holding.pnl)}</strong></div>)}<p className="pd-reconciliation">{text("Contribution total", "贡献合计")} <strong>{money(data.pnl)}</strong> · {text("Reconciled to net P&L", "与净盈亏一致")}</p></section></div>}
      {view === "holdings" && <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Holdings", "持仓明细")}</h2><p>{text("Period-end positions · click a symbol to research", "区间期末持仓 · 点击代码进入工作台")}</p></div><div className="pd-table-tools"><input aria-label={text("Search holdings", "搜索持仓")} placeholder={text("Search holdings…", "搜索持仓…")} value={filter} onChange={(event) => setFilter(event.target.value)} /><select aria-label={text("Sort holdings", "持仓排序")} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="value">{text("Market value", "市值")}</option><option value="pnl">{text("Period P&L", "区间盈亏")}</option><option value="symbol">{text("Symbol", "代码")}</option></select><button type="button" className="pd-button" aria-label={text("Add stock transaction", "添加股票交易")} title={text("Add stock transaction", "添加股票交易")} onClick={() => setTradeEditor({ portfolioId, symbol: "" })}>＋</button><button className="pd-button" onClick={exportHoldings}>{text("Export CSV", "导出 CSV")}</button></div></div><div className="pd-table-scroll"><table><thead><tr>{[text("Symbol / Company", "代码 / 公司"), text("Qty", "数量"), text("Avg cost", "平均成本"), text("Price", "价格"), text("Market value", "市值"), text("Weight", "仓位"), text("Unrealized P&L", "未实现盈亏"), text("Period P&L", "区间盈亏"), "β", text("Actions", "操作")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{visibleHoldings.map((holding) => <tr key={holding.symbol}><td><button className="pd-symbol" onClick={() => pickSymbol(holding.symbol)}>{holding.symbol} ↗</button><small>{holding.name}</small></td><td>{holding.quantity}</td><td>${holding.averageCost.toFixed(2)}</td><td>${holding.price.toFixed(2)}</td><td>{money(holding.marketValue)}</td><td>{(holding.marketValue / data.totalValue * 100).toFixed(1)}%</td><td className={holding.unrealized >= 0 ? "pd-positive" : "pd-negative"}>{money(holding.unrealized)}<small>{percent(holding.unrealized / (holding.quantity * holding.averageCost) * 100)}</small></td><td className={holding.pnl >= 0 ? "pd-positive" : "pd-negative"}>{money(holding.pnl)}</td><td>{holding.beta?.toFixed(2) ?? "—"}</td><td><button type="button" className="pd-button" aria-label={`${text("Record trade", "记录交易")} · ${holding.symbol}`} onClick={() => setTradeEditor({ portfolioId, symbol: holding.symbol })}>{text("Record trade", "记录交易")}</button></td></tr>)}</tbody><tfoot><tr><td>{text("Displayed securities", "当前显示证券")}</td><td colSpan={3} /><td>{money(visibleHoldings.reduce((sum, holding) => sum + holding.marketValue, 0))}</td><td>{(visibleHoldings.reduce((sum, holding) => sum + holding.marketValue, 0) / data.totalValue * 100).toFixed(1)}%</td><td>{money(visibleHoldings.reduce((sum, holding) => sum + holding.unrealized, 0))}</td><td>{money(visibleHoldings.reduce((sum, holding) => sum + holding.pnl, 0))}</td><td>—</td><td /></tr></tfoot></table>{visibleHoldings.length === 0 && <p className="pd-empty">{text("No matching holdings.", "没有匹配的持仓。")}</p>}</div></section>}
      {view === "overview" && <div className="pd-two-columns">
        <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Largest holdings", "主要持仓")}</h2><p>{text("Top three · share of total assets", "前三大持仓 · 占总资产比例")}</p></div><button className="pd-button" onClick={() => setView("holdings")}>{text("All holdings", "全部持仓")} ↗</button></div>
          {topHoldings.map((holding) => <div className="pd-overview-holding" key={holding.symbol}><button className="pd-symbol" onClick={() => pickSymbol(holding.symbol)}>{holding.symbol}<small>{holding.name}</small></button><div className="pd-overview-track"><span style={{ width: `${holding.marketValue / data.totalValue * 100}%`, background: holding.color }} /></div><strong>{(holding.marketValue / data.totalValue * 100).toFixed(1)}%</strong><span>{money(holding.marketValue)}</span></div>)}
          <button className="pd-overview-link" onClick={() => setView("allocation")}>{text("Explore allocation & P&L drivers", "查看配置与盈亏贡献")} ↗</button>
        </section>
        <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Risk snapshot", "风险快照")}</h2><p>{text("As of", "截至")} {data.endDate}</p></div><button className="pd-button" onClick={() => setView("performance")}>{text("Risk details", "风险详情")} ↗</button></div>
          <dl className="pd-risk-snapshot"><div><dt>{text("Equity beta · excluding cash", "持仓 β · 不含现金")}</dt><dd>{data.equityBeta.toFixed(2)}</dd></div><div><dt>{text("Cash allocation", "现金占比")}</dt><dd>{data.cashWeight.toFixed(1)}%</dd></div><div><dt>{text("Largest position", "最大持仓")} · {largest.symbol}</dt><dd>{data.largestWeight.toFixed(1)}%</dd></div></dl>
        </section>
      </div>}
      {view === "performance" && <div className="pd-two-columns">
        <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Risk & return comparison", "风险收益对比")}</h2><p>{text("Selected period · cash included in portfolio returns", "所选区间 · 组合收益包含现金")}</p></div></div><div className="pd-table-scroll"><table><thead><tr><th>{text("Metric", "指标")}</th><th>{text("Portfolio", "投资组合")}</th><th>{benchmark}</th></tr></thead><tbody>{comparison.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.portfolio}</td><td>{row.market}</td></tr>)}</tbody></table></div><p className="pd-muted">{text("Volatility uses sample standard deviation of weekly returns × √52. Short windows produce less stable estimates.", "年化波动率采用周收益样本标准差 × √52；较短区间的估计稳定性较低。")}</p></section>
        <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Current equity exposure", "当前股票市场暴露")}</h2><p>{text("Fixed 2-year weekly window · independent of selected period", "固定两年周收益窗口 · 独立于所选区间")}</p></div></div><dl className="pd-risk-snapshot"><div><dt>{text("Equity beta vs", "持仓 β 相对")} {benchmark}</dt><dd>{data.equityBeta.toFixed(2)}</dd></div><div><dt>{text("Beta data coverage", "β 数据覆盖率")}</dt><dd>100%</dd></div><div><dt>{text("Estimation observations", "估计样本数")}</dt><dd>104</dd></div></dl><p className="pd-muted">{text("Beta is weighted by equity market value, excluding cash. It measures historical market sensitivity, not total account risk.", "β 按股票市值加权，不含现金。它衡量历史市场敏感度，不代表账户全部风险。")}</p></section>
      </div>}
      {view === "methodology" && <section className="pd-section pd-methodology"><h2>{text("Data & calculation notes", "数据与计算口径")}</h2>{[
        text("Source: deterministic simulated weekly prices, 2024-10-18 to 2026-10-16. SPY and QQQ curves are simulated proxies, not historical market observations.", "来源：2024-10-18 至 2026-10-16 的固定模拟周度价格。SPY 和 QQQ 为模拟基准，不是真实历史行情。"),
        text(`Account: ${activePortfolio.name}, USD, ${data.holdings.length} long-only positions opened on the first observation, ${money(data.cash)} cash. No subsequent trades, deposits, withdrawals, dividends or fees. Demo holdings are simulated, not trades; recording a trade for this portfolio (Trade log or Workplace) switches it to recorded-trade analytics.`, `账户：${activePortfolio.nameZh}，美元，首日建立 ${data.holdings.length} 只多头持仓，现金 ${money(data.cash)}。此后没有交易、入金、出金、股息或费用。演示持仓为模拟数据而非交易；为本组合录入交易（交易记录页或 Workplace）后将切换为基于交易记录的分析。`),
        text("Return: account value / initial period value minus one. With no external cash flows this equals the time-weighted return. Benchmark is rebased at each selected period start. Weekly cutoff is the last observation on or before the requested start.", "收益：期末账户价值 / 区间期初价值 − 1；本组合无外部资金流，因此等于时间加权收益。基准在每个区间期初归零；区间起点使用目标日期之前最近的周度观测。"),
        text("Equity beta: covariance of stock and benchmark weekly returns / benchmark variance, using 104 weekly returns; weighted by current securities market value. Cash excluded; coverage 100%. The estimation window stays fixed when the display period changes.", "持仓 β：使用 104 个周收益，以个股和基准协方差除以基准方差，再按当前股票市值加权。不含现金，覆盖率 100%；不随显示区间改变估计窗口。"),
        text("Drawdown uses weekly portfolio observations and may understate intraweek losses. Allocation uses total account assets including cash. Dollar contributions reconcile to net P&L; no transaction costs or income exist in this demo.", "回撤根据周度组合净值计算，可能低估周内跌幅。配置以含现金的账户总资产为分母；美元贡献与净盈亏对账一致。本演示无交易成本和股息收入。"),
      ].map((note, index) => <article key={note}><span>0{index + 1}</span><p>{note}</p></article>)}</section>}
      <footer className="pd-footer"><span>{text("DEMO DATA · USD · Weekly valuations", "演示数据 · 美元 · 周度估值")}</span><button onClick={() => setView("methodology")}>{text("Data & methodology", "查看数据与口径")} ↗</button></footer>
      </> : <LivePortfolioDashboard key={activePortfolio.id} portfolio={activePortfolio} view={view} onPick={pickSymbol} onUpdateHolding={(symbol) => setTradeEditor({ portfolioId, symbol })} />}

    </div>
    {tradeEditor && <PortfolioTradesDialog key={`${tradeEditor.portfolioId}:${tradeEditor.symbol}`} portfolioId={tradeEditor.portfolioId} symbol={tradeEditor.symbol} onClose={() => setTradeEditor(null)} />}
  </main>;
}
