"use client";

import Link from "next/link";
import { buildPerformanceInsights } from "@/lib/performance-insights";
import { PerformanceInsights } from "@/components/performance-insights";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import type { ManagedPortfolio } from "@/hooks/use-portfolios";
import type { LivePortfolioAnalysis } from "@/lib/live-portfolio";
import type { Benchmark, PortfolioRange } from "@/lib/portfolio-analytics";

function AnalysisChart({ data, benchmark, drawdown = false }: { data: LivePortfolioAnalysis; benchmark: Benchmark; drawdown?: boolean }) {
  const { locale } = useLanguage();
  const [hover, setHover] = useState<number | null>(null);
  const values = data.points.flatMap((point) => drawdown ? [point.drawdown, 0] : [point.portfolio, point.benchmark, 0]);
  const low = Math.min(...values) - 0.5;
  const high = Math.max(...values) + 0.5;
  const x = (index: number) => 60 + index / Math.max(1, data.points.length - 1) * 810;
  const y = (value: number) => 20 + (high - value) / (high - low) * 205;
  const path = (key: "portfolio" | "benchmark" | "drawdown") => data.points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point[key])}`).join(" ");
  const index = Math.min(hover ?? data.points.length - 1, data.points.length - 1);
  const current = data.points[index];
  return <div className="pd-chart"><div className="pd-chart-readout"><span>{current.date}</span>{drawdown ? <span className="pd-series-legend"><i style={{ background: "#fb7185" }} aria-hidden="true" />{locale === "zh" ? "组合回撤" : "Portfolio drawdown"} <strong>{current.drawdown.toFixed(2)}%</strong></span> : <><span className="pd-series-legend"><i style={{ background: "#14b8a6" }} aria-hidden="true" />{locale === "zh" ? "组合收益" : "Portfolio return"} <strong>{current.portfolio.toFixed(2)}%</strong></span><span className="pd-series-legend"><i style={{ background: "#a78bfa" }} aria-hidden="true" />{locale === "zh" ? "基准收益" : "Benchmark return"} ({benchmark}) <strong>{current.benchmark.toFixed(2)}%</strong></span></>}</div><svg viewBox="0 0 900 260" role="img" aria-label={drawdown ? "Securities drawdown" : "Securities return versus benchmark"} onPointerLeave={() => setHover(null)} onPointerMove={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(data.points.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width * 900 - 60) / 810 * (data.points.length - 1))))); }}>
    {[0, 1, 2, 3, 4].map((level) => { const value = low + (high - low) * level / 4; return <g key={level}><line x1="60" x2="870" y1={y(value)} y2={y(value)} className="pd-grid-line" /><text x="50" y={y(value) + 4} textAnchor="end" className="pd-chart-label">{value.toFixed(1)}%</text></g>; })}
    {!drawdown && <path d={path("benchmark")} fill="none" stroke="#a78bfa" strokeWidth="2" />}
    <path d={path(drawdown ? "drawdown" : "portfolio")} fill="none" stroke={drawdown ? "#fb7185" : "#14b8a6"} strokeWidth="2.5" />
    {hover != null && <line x1={x(index)} x2={x(index)} y1="20" y2="225" className="pd-grid-line" />}
    <text x="60" y="250" className="pd-chart-label">{data.start}</text><text x="870" y="250" textAnchor="end" className="pd-chart-label">{data.end}</text>
  </svg></div>;
}

export function LivePortfolioDashboard({ portfolio, view, onPick, onUpdateHolding }: { portfolio: ManagedPortfolio; view: string; onPick: (symbol: string) => void; onUpdateHolding: (symbol: string) => void }) {
  const { locale } = useLanguage();
  const text = (english: string, chinese: string) => locale === "zh" ? chinese : english;
  const [range, setRange] = useState<PortfolioRange>("YTD");
  const [benchmark, setBenchmark] = useState<Benchmark>("SPY");
  const [state, setState] = useState<{ key: string; data?: LivePortfolioAnalysis; error?: string }>({ key: "" });
  const [retry, setRetry] = useState(0);
  const tradesJson = JSON.stringify(portfolio.trades ?? []);
  const requestKey = `${portfolio.id}:${tradesJson}:${range}:${benchmark}:${retry}`;
  const hasTrades = !!portfolio.trades?.length;
  useEffect(() => {
    if (!JSON.parse(tradesJson).length) return;
    const controller = new AbortController();
    fetch("/api/market/portfolio-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trades: JSON.parse(tradesJson), range, benchmark }), signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Unable to load market data.");
      if (!controller.signal.aborted) setState({ key: requestKey, data: payload.result });
    }).catch((reason) => { if (!controller.signal.aborted) setState({ key: requestKey, error: reason instanceof Error ? reason.message : "Unable to load market data." }); });
    return () => controller.abort();
  }, [tradesJson, range, benchmark, requestKey]);
  const data = state.key === requestKey ? state.data : undefined;
  const error = state.key === requestKey ? state.error : undefined;
  const money = (value: number) => `${data?.currency ?? "USD"} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  const holdings = [...(data?.holdings ?? [])].sort((left, right) => right.value - left.value);
  const insights = data ? buildPerformanceInsights(data.points) : null;
  const decimal = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signedAmount = (value: number) => `${value > 0 ? "+" : ""}${decimal(value)}`;
  const contributions = [...holdings].sort((left, right) => right.contribution - left.contribution);
  const unrecorded = portfolio.symbols.filter((symbol) => !portfolio.trades?.some((trade) => trade.symbol === symbol));
  const cards = data ? [
    [text("Securities value", "证券市值"), money(data.value), text("Cash excluded · latest completed close", "不含现金 · 最近完整交易日收盘")],
    [text("Period P&L", "区间盈亏"), money(data.pnl), `${data.start} — ${data.end}`],
    [text("Securities return · estimated", "证券收益率 · 近似"), percent(data.returnPercent), text("Daily cash-flow convention", "按日买入期初、卖出期末约定")],
    [text("Excess vs benchmark", "相对基准超额收益"), `${data.excess.toFixed(2)} pp`, benchmark],
    [text("Maximum drawdown", "最大回撤"), percent(data.maxDrawdown), text("Selected period · daily close", "所选区间 · 日收盘")],
    [text("Equity beta", "持仓 β"), data.beta?.toFixed(2) ?? "—", `${benchmark} · ${text("2Y daily · excludes cash", "两年日收益 · 不含现金")}`],
    [text("Unrealized P&L", "未实现盈亏"), money(data.unrealized), text("Current recorded positions", "当前已记录持仓")],
    [text("Realized P&L · all trades", "已实现盈亏 · 全部交易"), money(data.realized), text("Average cost method", "平均成本法")],
  ] : [];
  return <>
    <div className="pd-toolbar"><div className="pd-segments">{(["1M", "3M", "6M", "YTD", "1Y", "ALL"] as const).map((option) => <button key={option} className={range === option ? "is-active" : ""} aria-pressed={range === option} onClick={() => setRange(option)}>{option}</button>)}</div><label className="pd-benchmark">{text("Benchmark", "基准")}<select value={benchmark} onChange={(event) => setBenchmark(event.target.value as Benchmark)}><option>SPY</option><option>QQQ</option></select></label><span className="pd-data-stamp">{text("RECORDED TRADES + MARKET DATA", "已录入交易 + 真实行情")}{data && ` · ${data.end}`}</span></div>
    <details className="pd-calculation-note"><summary>{text("Daily close · securities only", "日收盘估值 · 仅证券资产")} ⓘ</summary><p>{text("Cash, dividends, fees and FX excluded. Returns include first-day trading P&L and are estimated using date-only transactions. The zero baseline is the prior trading close; both series use the same start.", "不含现金、股息、手续费和汇率影响。收益采用仅日期交易近似计算，包含首日交易盈亏；零点为前一交易日收盘，组合与基准使用相同起点。")}</p></details>
    {view === "holdings" && <div className="pd-section-heading"><h2>{text("Recorded positions", "实际录入持仓")}</h2><div className="pd-table-tools">{data && <span className="pd-badge">{data.currency}</span>}<button type="button" className="pd-button" aria-label={text("Add stock transaction", "添加股票交易")} title={text("Add stock transaction", "添加股票交易")} onClick={() => onUpdateHolding("")}>＋</button></div></div>}
    {!hasTrades ? <section className="pd-pending"><h2>{text("No recorded positions yet", "尚未录入可分析持仓")}</h2><p>{text("Your stocks are saved, but quantities and purchase prices are needed to calculate market value and returns. Record a buy in Workplace to unlock analytics.", "股票清单已保存，但计算市值和收益需要买入日期、价格及数量。请先在 Workplace 记录买入交易。")}</p><p>{portfolio.symbols.join(" · ")}</p><Link href="/" className="pd-workplace-link">{text("Go to Workplace", "前往 Workplace")} ↗</Link></section> : !data ? <section className="pd-pending" role="status"><h2>{error ? text("Analysis unavailable", "分析暂不可用") : text("Calculating your portfolio…", "正在计算你的组合分析…")}</h2><p>{error ?? text("Loading historical prices and reconstructing recorded positions.", "正在获取历史行情，按已录入交易重建持仓。")}</p>{error && <button className="pd-button" onClick={() => setRetry((value) => value + 1)}>{text("Retry", "重试")}</button>}</section> : <>
      {unrecorded.length > 0 && <p className="pd-muted">{text("Excluded: no trades recorded", "未录入交易，未计入分析")}: {unrecorded.join(", ")}</p>}
      {(view === "overview" || view === "performance") && <section className="pd-metrics">{(view === "overview" ? cards.slice(0, 4) : [cards[4], [text("Current drawdown", "当前回撤"), percent(insights?.currentDrawdown ?? 0), text("Below selected-period peak", "相对所选区间前高")], [text("Rolling volatility", "滚动年化波动率"), insights?.series.at(-1)?.portfolioVolatility == null ? "—" : `${insights.series.at(-1)!.portfolioVolatility!.toFixed(2)}%`, text("20 trading days · annualized", "20 个交易日 · 年化")], cards[5]]).map(([label, value, note]) => <article key={label} className="pd-metric"><p>{label}</p><strong>{value}</strong><small>{note}</small></article>)}</section>}
      {view === "overview" && holdings.length > 0 && <aside className="pd-brief" aria-label={text("Portfolio brief", "组合摘要")}><span>{text("Largest exposure", "最大持仓")}</span><strong>{holdings[0].symbol} · {holdings[0].weight.toFixed(1)}%</strong><span>{text("of securities value. Highest signed period P&L", "占证券市值；区间盈亏贡献最高")}</span><strong>{contributions[0]?.symbol} · {signedAmount(contributions[0]?.contribution ?? 0)}</strong></aside>}
      {view === "overview" && <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Securities returns vs benchmark", "证券收益与基准对比")}</h2><p>{data.start} — {data.end} · {benchmark}</p></div></div><AnalysisChart data={data} benchmark={benchmark} /></section>}
      {view === "performance" && <><PerformanceInsights points={data.points} benchmark={benchmark} /><section className="pd-section"><h2>{text("Current market exposure", "当前市场暴露")}</h2><dl className="pd-risk-snapshot"><div><dt>{text("Equity beta · excluding cash", "持仓 β · 不含现金")}</dt><dd>{data.beta?.toFixed(2) ?? "—"}</dd></div><div><dt>{text("Beta coverage", "β 数据覆盖率")}</dt><dd>{data.betaCoverage.toFixed(1)}%</dd></div><div><dt>{text("Largest position", "最大持仓")}</dt><dd>{holdings[0]?.symbol} · {holdings[0]?.weight.toFixed(1)}%</dd></div></dl></section></>}
      {(view === "overview" || view === "allocation") && <div className="pd-two-columns"><section className="pd-section"><div className="pd-section-heading"><h2>{text("Equity allocation", "股票配置")}</h2><span className="pd-badge">{text("CASH EXCLUDED", "不含现金")}</span></div>{holdings.filter((holding) => holding.quantity > 0).map((holding) => <div className="pd-allocation-row" key={holding.symbol}><button className="pd-symbol" onClick={() => onPick(holding.symbol)}>{holding.symbol}</button><span>{money(holding.value)}</span><strong>{holding.weight.toFixed(1)}%</strong></div>)}</section><section className="pd-section"><div className="pd-section-heading"><h2>{text("P&L drivers", "盈亏贡献")}</h2></div>{contributions.map((holding) => <div className="pd-allocation-row" key={holding.symbol}><span>{holding.symbol}</span><span>{text("Period P&L", "区间盈亏")}</span><strong className={holding.contribution >= 0 ? "pd-positive" : "pd-negative"}>{holding.contribution.toFixed(2)}</strong></div>)}<p className="pd-reconciliation">{text("Reconciled contribution total", "贡献对账合计")} <strong>{money(data.pnl)}</strong></p></section></div>}
      {view === "holdings" && <section className="pd-section"><div className="pd-table-scroll"><table><thead><tr>{[text("Symbol", "股票"), text("Qty", "数量"), text("Average cost", "平均成本"), text("Close price", "收盘价"), text("Market value", "市值"), text("Weight", "仓位"), text("Unrealized P&L", "未实现盈亏"), text("Period P&L", "区间盈亏"), "β", text("Actions", "操作")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{holdings.map((holding) => <tr key={holding.symbol}><td><button className="pd-symbol" onClick={() => onPick(holding.symbol)}>{holding.symbol} ↗</button><small>{holding.name}</small></td><td>{holding.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td>{holding.averageCost == null ? "—" : decimal(holding.averageCost)}</td><td>{holding.price == null ? "—" : decimal(holding.price)}</td><td>{decimal(holding.value)}</td><td>{holding.weight.toFixed(1)}%</td><td className={holding.unrealized < 0 ? "pd-negative" : holding.unrealized > 0 ? "pd-positive" : ""}>{signedAmount(holding.unrealized)}</td><td className={holding.contribution < 0 ? "pd-negative" : holding.contribution > 0 ? "pd-positive" : ""}>{signedAmount(holding.contribution)}</td><td>{holding.beta?.toFixed(2) ?? "—"}</td><td><button type="button" className="pd-button" aria-label={`${text("Record trade", "记录交易")} · ${holding.symbol}`} onClick={() => onUpdateHolding(holding.symbol)}>{text("Record trade", "记录交易")}</button></td></tr>)}</tbody><tfoot><tr><td>{text("Total", "合计")}</td><td colSpan={3} /><td>{decimal(data.value)}</td><td>{data.value > 0 ? "100.0%" : "—"}</td><td>{signedAmount(data.unrealized)}</td><td>{signedAmount(data.pnl)}</td><td colSpan={2} /></tr></tfoot></table></div><p className="pd-table-note">{text("Weight excludes cash. Beta measures historical sensitivity to the selected benchmark; period P&L includes realized and unrealized changes within the selected range.", "仓位不含现金；β 衡量对所选基准的历史敏感度；区间盈亏包含所选区间内已实现与未实现的变化。")}</p></section>}
      {view === "methodology" && <section className="pd-section pd-methodology"><h2>{text("Analysis methodology", "计算口径")}</h2>{[
        text("Market value uses recorded remaining quantities and Yahoo Finance daily close prices. Cash balance and external funding are unknown and excluded.", "市值采用已录入的剩余数量与 Yahoo 日收盘价，未知现金余额及外部资金流水不计入。"),
        text("Daily securities return = (closing securities value + sale proceeds) / (previous closing value + purchase amounts) − 1. Buys are treated at day start and sells at day end. Daily returns are geometrically linked. With date-only trades this is an approximation, not account TWR or IRR.", "日证券收益率 =（日末证券市值 + 当日卖出金额）/（前日证券市值 + 当日买入金额）− 1，买入视为期初、卖出视为期末，再逐日连乘。仅有日期的交易采用该近似约定，不称为账户 TWR 或 IRR。"),
        text("P&L contribution = ending market value − beginning market value + sales − purchases. Realized P&L uses average cost across all recorded trades; period P&L follows the selected range. Dividends, fees and corporate actions are not automatically booked.", "区间盈亏贡献 = 期末市值 − 期初市值 + 卖出金额 − 买入金额。已实现盈亏采用全部已录入交易的平均成本法，区间盈亏跟随筛选；股息、费用与公司行动尚未自动入账。"),
        text("Beta uses aligned daily price returns from the prior two years, at least 60 matched observations. Weights exclude cash. Incomplete beta coverage leaves portfolio beta unavailable. Portfolio and benchmark must use the same currency; no FX conversion.", "β 使用最近两年对齐的日收益，至少 60 个匹配样本，按股票市值加权且不含现金。覆盖不全时不展示组合 β。组合与基准须币种一致，暂不做汇率转换。"),
      ].map((note, index) => <article key={note}><span>0{index + 1}</span><p>{note}</p></article>)}</section>}
      <footer className="pd-footer">{text("RECORDED TRADES · DAILY MARKET PRICES · NO SIMULATED HOLDINGS", "真实录入交易 · 日收盘行情 · 未使用演示持仓")}</footer>
    </>}
  </>;
}
