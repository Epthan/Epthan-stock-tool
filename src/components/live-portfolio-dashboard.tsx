"use client";

import Link from "next/link";
import { InsightChart, PerformanceInsights } from "@/components/performance-insights";
import { useEffect, useMemo, useState } from "react";
import { InsightList, TradeAnalysis } from "@/components/trade-analysis";
import { ContributionScatter, CorrelationHeatmap, MonthlyCalendar, ReturnDrawdownChart, WeightRiskBars } from "@/components/trader-charts";
import { buildTraderInsights } from "@/lib/trader-insights";
import { RISK_FREE_RATE } from "@/lib/trader-analytics";
import { TTL, fetchCached, forgetCached, prefetchCached } from "@/lib/client-cache";
import { useLanguage } from "@/components/language-provider";
import type { ManagedPortfolio } from "@/hooks/use-portfolios";
import type { LivePortfolioAnalysis } from "@/lib/live-portfolio";
import type { Benchmark, PortfolioRange } from "@/lib/portfolio-analytics";

export function LivePortfolioDashboard({ portfolio, view, onPick, onUpdateHolding }: { portfolio: ManagedPortfolio; view: string; onPick: (symbol: string) => void; onUpdateHolding: (symbol: string) => void }) {
  const { locale } = useLanguage();
  const text = (english: string, chinese: string) => locale === "zh" ? chinese : english;
  const [range, setRange] = useState<PortfolioRange>("YTD");
  const [benchmark, setBenchmark] = useState<Benchmark>("SPY");
  const [state, setState] = useState<{ key: string; data?: LivePortfolioAnalysis; error?: string }>({ key: "" });
  const [retry, setRetry] = useState(0);
  const tradesJson = JSON.stringify({ trades: portfolio.trades ?? [], cash: portfolio.cash ?? [] });
  const requestKey = `${portfolio.id}:${tradesJson}:${range}:${benchmark}:${retry}`;
  const hasTrades = !!portfolio.trades?.length;
  useEffect(() => {
    const { trades, cash } = JSON.parse(tradesJson) as { trades: unknown[]; cash: unknown[] };
    if (!trades.length) return;
    let active = true;
    const request = (forRange: PortfolioRange): [string, RequestInit] => [`analysis:${tradesJson}:${forRange}:${benchmark}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trades, cash, range: forRange, benchmark }) }];
    const [key, init] = request(range);
    if (retry > 0) forgetCached(key);
    fetchCached<{ result: LivePortfolioAnalysis }>(key, "/api/market/portfolio-analysis", TTL.analysis, init, (fresh) => { if (active) setState({ key: requestKey, data: fresh.result }); })
      .then((payload) => {
        if (!active) return;
        setState({ key: requestKey, data: payload.result });
        // Warm the other ranges so switching is instant (server already holds the prices).
        window.setTimeout(() => { for (const other of ["1M", "3M", "6M", "YTD", "1Y", "ALL"] as PortfolioRange[]) if (other !== range) { const [otherKey, otherInit] = request(other); prefetchCached(otherKey, "/api/market/portfolio-analysis", TTL.analysis, otherInit); } }, 400);
      })
      .catch((reason) => { if (active) setState({ key: requestKey, error: reason instanceof Error ? reason.message : "Unable to load market data." }); });
    return () => { active = false; };
  }, [tradesJson, range, benchmark, requestKey, retry]);
  const loading = hasTrades && state.key !== requestKey;
  // While a new range/benchmark loads, keep showing the previous result (marked as updating) instead of blanking the page.
  const data = state.data;
  const error = state.key === requestKey ? state.error : undefined;
  const money = (value: number) => `${data?.currency ?? "USD"} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  const num = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
  const toneOf = (value: number | null | undefined) => value == null || !Number.isFinite(value) || Math.abs(value) < 1e-9 ? "" : value > 0 ? "pd-positive" : "pd-negative";
  const holdings = [...(data?.holdings ?? [])].sort((left, right) => right.value - left.value);
  const openHoldings = holdings.filter((holding) => holding.quantity > 1e-8);
  const insights = useMemo(() => data ? buildTraderInsights(data, benchmark) : [], [data, benchmark]);
  const decimal = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signedAmount = (value: number) => `${value > 0 ? "+" : ""}${decimal(value)}`;
  const contributions = [...holdings].sort((left, right) => right.contribution - left.contribution);
  const unrecorded = portfolio.symbols.filter((symbol) => !portfolio.trades?.some((trade) => trade.symbol === symbol));
  const st = data?.statistics;
  const tr = data?.trading.stats;
  const alphaNote = (t: number | null | undefined) => t == null ? text("Needs ≥40 trading days", "需 ≥40 个交易日") : `t = ${t.toFixed(2)} · ${Math.abs(t) >= 2 ? text("significant", "显著") : text("not significant", "不显著")}`;
  type Card = { label: string; value: string; note: string; tone?: string };
  const performanceCards: Card[] = data && st ? [
    { label: text("Annualized return", "年化收益"), value: st.annualReturn == null ? "—" : percent(st.annualReturn), note: `${st.observations} ${text("trading days", "个交易日")}`, tone: toneOf(st.annualReturn) },
    { label: text("Annualized volatility", "年化波动率"), value: st.volatility == null ? "—" : `${st.volatility.toFixed(2)}%`, note: `${benchmark} ${num(st.benchmarkVolatility)}%` },
    { label: "Sharpe", value: num(st.sharpe), note: `rf ${(RISK_FREE_RATE * 100).toFixed(0)}% · ${text("annualized", "年化")}` },
    { label: "Sortino", value: num(st.sortino), note: text("Downside volatility only", "仅计下行波动") },
    { label: "Calmar", value: num(st.calmar), note: text("Annual return ÷ |max drawdown|", "年化收益 ÷ |最大回撤|") },
    { label: text("Maximum drawdown", "最大回撤"), value: percent(st.maxDrawdown), note: text("Selected period · daily close", "所选区间 · 日收盘"), tone: "pd-negative" },
    { label: text("Period beta", "区间 β"), value: num(st.beta), note: `R² ${num(st.rSquared)} · ${text("2Y equity β", "两年持仓 β")} ${num(data.beta)}` },
    { label: text("Alpha · annualized", "年化 Alpha"), value: st.alphaAnnual == null ? "—" : percent(st.alphaAnnual), note: alphaNote(st.alphaT), tone: st.alphaT != null && Math.abs(st.alphaT) >= 2 ? toneOf(st.alphaAnnual) : "" },
  ] : [];
  const metricGrid = (cards: Card[]) => <section className="pd-metrics" aria-label={text("Key metrics", "核心指标")}>{cards.map((card) => <article key={card.label} className="pd-metric"><p>{card.label}</p><strong className={card.tone ?? ""}>{card.value}</strong><small>{card.note}</small></article>)}</section>;
  const conc = data?.risk.concentration;
  const residual = st && st.betaComponent != null ? st.totalReturn - st.betaComponent : null;
  return <>
    <div className="pd-toolbar"><div className="pd-segments">{(["1M", "3M", "6M", "YTD", "1Y", "ALL"] as const).map((option) => <button key={option} className={range === option ? "is-active" : ""} aria-pressed={range === option} onClick={() => setRange(option)}>{option}</button>)}</div><label className="pd-benchmark">{text("Benchmark", "基准")}<select value={benchmark} onChange={(event) => setBenchmark(event.target.value as Benchmark)}><option>SPY</option><option>QQQ</option></select></label><span className="pd-data-stamp">{loading && data ? <span className="pd-updating" role="status">{text("Updating…", "更新中…")}</span> : <>{text("RECORDED TRADES + MARKET DATA", "已录入交易 + 真实行情")}{data && ` · ${data.end}`}</>}</span></div>
    <details className="pd-calculation-note"><summary>{text("Daily close · holdings return", "日收盘估值 · 持仓收益")} ⓘ</summary><p>{text("Holdings return includes dividends, interest, fees and tax from the cash ledger; idle cash and FX are excluded (the Account panel includes cash). Returns are estimated from date-only transactions and include first-day trading P&L. The zero baseline is the prior trading close; both series use the same start.", "持仓收益已计入现金账本里的分红、利息、费用和税；不含闲置现金和汇率影响（含现金的结果见“账户”面板）。收益按仅日期的交易近似计算，包含首日交易盈亏；零点为前一交易日收盘，组合与基准使用相同起点。")}</p></details>
    {view === "holdings" && <div className="pd-section-heading"><h2>{text("Recorded positions", "实际录入持仓")}</h2><div className="pd-table-tools">{data && <span className="pd-badge">{data.currency}</span>}<button type="button" className="pd-button" aria-label={text("Add stock transaction", "添加股票交易")} title={text("Add stock transaction", "添加股票交易")} onClick={() => onUpdateHolding("")}>＋</button></div></div>}
    {!hasTrades ? <section className="pd-pending"><h2>{text("No recorded positions yet", "尚未录入可分析持仓")}</h2><p>{text("Your stocks are saved, but quantities and purchase prices are needed to calculate market value and returns. Record a buy in the Trade log or Workplace to unlock analytics.", "股票清单已保存，但计算市值和收益需要买入日期、价格及数量。请先在交易记录页或 Workplace 记录买入交易。")}</p><p>{portfolio.symbols.join(" · ")}</p><Link href="/portfolio" className="pd-workplace-link">{text("Open Trade log", "前往交易记录")} ↗</Link></section> : !data || !st ? <section className="pd-pending" role="status"><h2>{error ? text("Analysis unavailable", "分析暂不可用") : text("Calculating your portfolio…", "正在计算你的组合分析…")}</h2><p>{error ?? text("Loading historical prices and reconstructing recorded positions.", "正在获取历史行情，按已录入交易重建持仓。")}</p>{error && <button className="pd-button" onClick={() => setRetry((value) => value + 1)}>{text("Retry", "重试")}</button>}</section> : <>
      {unrecorded.length > 0 && <p className="pd-muted">{text("Excluded: no trades recorded", "未录入交易，未计入分析")}: {unrecorded.join(", ")}</p>}

      {view === "overview" && (() => {
        const [whole, fraction] = data.value.toFixed(2).split(".");
        const rangeLabel = ({ "1M": text("Over the past month", "近 1 个月"), "3M": text("Over 3 months", "近 3 个月"), "6M": text("Over 6 months", "近 6 个月"), YTD: text("Year to date", "今年以来"), "1Y": text("Over the past year", "近 1 年"), ALL: text("Since the first trade", "自首笔交易以来") } as Record<string, string>)[range];
        const beat = data.excess >= 0;
        const maxContribution = Math.max(1, ...contributions.map((holding) => Math.abs(holding.contribution)));
        const months = data.months.slice(-12);
        const monthScale = Math.max(4, ...months.map((month) => Math.abs(month.portfolio)));
        const riskRows: [string, string, string?, string?][] = [
          [text("Annualized return", "年化收益"), st.annualReturn == null ? "—" : percent(st.annualReturn), undefined, toneOf(st.annualReturn)],
          [text("Annualized volatility", "年化波动"), st.volatility == null ? "—" : `${st.volatility.toFixed(1)}%`, `${benchmark} ${num(st.benchmarkVolatility, 1)}%`],
          ["Sharpe", num(st.sharpe)],
          ["Sortino", num(st.sortino)],
          [text("Max drawdown", "最大回撤"), percent(st.maxDrawdown), undefined, "pd-negative"],
          [text(`Beta vs ${benchmark}`, `β（对 ${benchmark}）`), num(st.beta), st.rSquared == null ? undefined : `R² ${num(st.rSquared)}`],
          [text("Alpha, annualized", "年化 Alpha"), st.alphaAnnual == null ? "—" : percent(st.alphaAnnual), st.alphaT == null ? undefined : Math.abs(st.alphaT) >= 2 ? text("significant", "显著") : text("not significant", "不显著")],
          [text("Up / down capture", "上 / 下行捕获"), st.upCapture == null || st.downCapture == null ? "—" : `${st.upCapture.toFixed(0)}% / ${st.downCapture.toFixed(0)}%`],
          [text("Closed trades · win rate", "已平仓 · 胜率"), `${tr?.closedCount ?? 0} · ${tr?.winRate == null ? "—" : `${tr.winRate.toFixed(0)}%`}`],
        ];
        return <>
          <section className="rd-hero">
            <div className="rd-hero-main">
              <span className="rd-label">{text("Securities value", "证券市值")} · {data.currency}</span>
              <span className="rd-big">{Number(whole).toLocaleString("en-US")}<span>.{fraction}</span></span>
              <p className="rd-sentence">{rangeLabel}{text(" ", "")}<strong className={toneOf(data.returnPercent)}>{percent(data.returnPercent)}</strong>{text(", ", "，")}{data.pnl >= 0 ? text("a gain of ", "盈利 ") : text("a loss of ", "亏损 ")}{decimal(Math.abs(data.pnl))}{text(", ", "，")}{beat ? text("ahead of ", "跑赢 ") : text("behind ", "跑输 ")}{benchmark}{text(" by ", " ")}<strong>{Math.abs(data.excess).toFixed(1)}</strong>{text(" pp.", " 个百分点。")}</p>
              <dl className="rd-inline">
                <div><dt>{text("Realized", "已实现")}</dt><dd className={toneOf(data.realized)}>{signedAmount(data.realized)}</dd></div>
                <div><dt>{text("Unrealized", "未实现")}</dt><dd className={toneOf(data.unrealized)}>{signedAmount(data.unrealized)}</dd></div>
                <div><dt>{text("As of", "截至")}</dt><dd>{data.end} {text("close", "收盘")}</dd></div>
              </dl>
            </div>
            <aside className="rd-panel rd-brief" aria-label={text("Key findings", "本期要点")}>
              <div className="rd-panel-head"><h2>{text("Key findings", "本期要点")}</h2>{insights.length > 3 && <span>{text(`${insights.length} in total`, `共 ${insights.length} 条`)}</span>}</div>
              <InsightList insights={insights} limit={3} />
            </aside>
          </section>
          {data.account && (() => {
            const account = data.account;
            const cells: [string, string, string | undefined, string | undefined][] = [
              [text("Account value", "账户总值"), decimal(account.value), text("Holdings + cash", "持仓 + 现金"), undefined],
              [text("Net contributions", "净投入"), decimal(account.netContributions), text(`Since ${account.since}`, `自 ${account.since}`), undefined],
              [text("Total gain", "总收益"), signedAmount(account.gain), account.netContributions > 0 ? percent(account.gain / account.netContributions * 100) : undefined, toneOf(account.gain)],
              [text("Account return (TWR)", "账户收益（时间加权）"), account.periodReturn == null ? "—" : percent(account.periodReturn), rangeLabel, toneOf(account.periodReturn)],
              [account.years >= 1 ? text("Money-weighted, p.a.", "资金加权年化") : text("Money-weighted", "资金加权收益"), account.years >= 1 ? (account.mwrAnnual == null ? "—" : percent(account.mwrAnnual)) : (account.mwrCumulative == null ? "—" : percent(account.mwrCumulative)), text("Your timing of deposits counts", "计入你入金出金的时点"), toneOf(account.years >= 1 ? account.mwrAnnual : account.mwrCumulative)],
              [text("Cash", "现金"), decimal(account.cash), account.cashWeight == null ? undefined : text(`${account.cashWeight.toFixed(1)}% of account`, `占账户 ${account.cashWeight.toFixed(1)}%`), account.cash < -0.01 ? "pd-negative" : undefined],
            ];
            return <section className="rd-panel rd-account" aria-label={text("Account", "账户")}>
              <div className="rd-panel-head"><h2>{text("Account, including cash", "账户（含现金）")}</h2><span>{text("Holdings return above excludes idle cash; this view includes it", "上方收益只看持仓；这里把闲置现金也算进来")}</span></div>
              <dl className="rd-account-grid">{cells.map(([label, value, note, tone]) => <div key={label}><dt>{label}</dt><dd className={tone ?? ""}>{value}</dd>{note && <small>{note}</small>}</div>)}</dl>
              {account.negativeCash && <p className="rd-account-warn">{text("Cash went negative at some point — a deposit is probably missing, so account returns are not shown. Add it in the cash ledger.", "现金余额曾为负数，很可能漏记了入金，所以账户收益暂不计算。请在现金账本里补上。")}</p>}
              {account.pendingCash > 0 && <p className="pd-table-note">{text(`${account.pendingCash} cash entr${account.pendingCash === 1 ? "y is" : "ies are"} after the last close and not counted yet.`, `${account.pendingCash} 条现金流水晚于最近收盘日，暂未计入。`)}</p>}
            </section>;
          })()}
          <section className="rd-row">
            <div className="rd-panel rd-grow">
              <div className="rd-panel-head"><h2>{text("Cumulative return and drawdown", "累计收益与回撤")}</h2><span>{data.start} — {data.end}</span></div>
              <ReturnDrawdownChart points={data.points} benchmark={benchmark} labels={{ portfolio: text("Portfolio", "组合"), drawdown: text("Drawdown", "回撤") }} />
            </div>
            <div className="rd-panel rd-side">
              <div className="rd-panel-head"><h2>{text("Risk and return", "风险与收益")}</h2></div>
              <dl className="rd-list">{riskRows.map(([label, value, note, tone]) => <div key={label}><dt>{label}</dt><dd className={tone ?? ""}>{value}{note && <small>{note}</small>}</dd></div>)}</dl>
            </div>
          </section>
          <section className="rd-row">
            <div className="rd-panel rd-half">
              <div className="rd-panel-head"><h2>{text("Weight vs risk contribution", "仓位与风险贡献")}</h2><span>{text("1-year volatility · current weights", "近一年波动 · 当前权重")}</span></div>
              <WeightRiskBars rows={data.risk.contributions} labels={{ weight: text("Weight", "仓位"), risk: text("Risk contribution", "风险贡献") }} />
            </div>
            <div className="rd-panel rd-half">
              <div className="rd-panel-head"><h2>{text("Where the P&L came from", "盈亏来源")}</h2><span>{text("Selected period · includes closed positions", "所选区间 · 含已平仓")}</span></div>
              <div className="rd-contrib">{contributions.map((holding) => <div key={holding.symbol}><button className="pd-symbol" onClick={() => onPick(holding.symbol)}>{holding.symbol}</button><span className="rd-contrib-track"><span className={holding.contribution >= 0 ? "is-up" : "is-down"} style={{ width: `${Math.abs(holding.contribution) / maxContribution * 100}%` }} /></span><strong className={toneOf(holding.contribution)}>{signedAmount(holding.contribution)}</strong></div>)}</div>
              {Math.abs(data.otherContribution) >= 0.005 && <div className="rd-contrib-other"><span>{text("Cash items without a symbol", "未指定代码的现金收支")}</span><strong className={toneOf(data.otherContribution)}>{signedAmount(data.otherContribution)}</strong></div>}
              <p className="rd-total"><span>{text("Total, reconciled to period P&L", "合计，与区间盈亏一致")}</span><strong className={toneOf(data.pnl)}>{signedAmount(data.pnl)}</strong></p>
            </div>
          </section>
          {months.length > 0 && <section className="rd-panel">
            <div className="rd-panel-head"><h2>{text("Monthly returns", "月度收益")}</h2><span>{text(`Last ${months.length} months`, `最近 ${months.length} 个月`)}</span></div>
            <div className="rd-months">{months.map((month) => { const strength = Math.min(1, Math.abs(month.portfolio) / monthScale); return <div key={month.month}><span className={`rd-month ${month.portfolio >= 0 ? "is-up" : "is-down"}`} style={{ ["--strength" as string]: (0.12 + strength * 0.6).toFixed(2) }} title={`${month.month}: ${percent(month.portfolio)} · ${benchmark} ${percent(month.benchmark)}`}>{month.portfolio >= 0 ? "+" : "−"}{Math.abs(month.portfolio).toFixed(1)}</span><small>{month.month.slice(2).replace("-", "/")}</small></div>; })}</div>
          </section>}
        </>;
      })()}

      {view === "trades" && <TradeAnalysis data={data} insights={insights} benchmark={benchmark} money={money} onPick={onPick} />}

      {view === "performance" && <>
        {metricGrid(performanceCards)}
        <div className="pd-two-columns">
          <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Where the return came from", "收益从哪来")}</h2><p>{text("Daily regression on", "日收益回归")} {benchmark} · {st.observations} {text("observations", "个样本")}</p></div></div>
            <dl className="pd-risk-snapshot">
              <div><dt>{text("Period return", "区间收益")}</dt><dd className={toneOf(st.totalReturn)}>{percent(st.totalReturn)}</dd></div>
              <div><dt>{text("Market (β × benchmark return)", "市场部分（β × 基准收益）")}</dt><dd>{st.betaComponent == null ? "—" : percent(st.betaComponent)}</dd></div>
              <div><dt>{text("Selection & timing (residual)", "选股与择时（剩余部分）")}</dt><dd className={toneOf(residual)}>{residual == null ? "—" : percent(residual)}</dd></div>
              <div><dt>{text("Correlation · R²", "相关性 · R²")}</dt><dd>{num(st.correlation)} · {num(st.rSquared)}</dd></div>
            </dl>
            <p className="pd-table-note">{text("R² close to 1 means most of the day-to-day movement is explained by the benchmark.", "R² 越接近 1，说明日常涨跌越多地由基准解释。")}</p>
          </section>
          <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Up / down capture", "上行 / 下行捕获率")}</h2><p>{text("Average portfolio return on benchmark up (down) days ÷ benchmark", "基准上涨（下跌）日组合平均收益 ÷ 基准平均收益")}</p></div></div>
            <div className="ta-bars">{[[text("Up capture", "上行捕获"), st.upCapture, "ta-bar-win"], [text("Down capture", "下行捕获"), st.downCapture, "ta-bar-loss"]].map(([label, value, className]) => <div className="ta-bar-row" key={String(label)}><span className="ta-bar-label">{label as string}</span><div className="ta-bar-tracks"><span className={`ta-bar ${className}`} style={{ width: `${Math.min(100, Math.max(0, (value as number | null) ?? 0) / 2)}%` }} /><span className="ta-bar-mark" style={{ left: "50%" }} /></div><span className="ta-bar-values"><strong>{value == null ? "—" : `${(value as number).toFixed(0)}%`}</strong></span></div>)}</div>
            <p className="pd-table-note">{text("Marker = 100% (moves one-for-one with the benchmark). Ideal: up capture high, down capture low.", "竖线 = 100%（与基准同步）。理想状态：上行捕获高、下行捕获低。")}</p>
          </section>
        </div>
        <div className="pd-two-columns">
          <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Rolling 3-month excess return", "滚动 3 个月超额收益")}</h2><p>{text("63 trading days · percentage points", "63 个交易日 · 百分点")}</p></div></div>{data.rolling.some((row) => row.excess != null) ? <InsightChart dates={data.rolling.map((row) => row.date)} unit="pp" label={text("Rolling excess return", "滚动超额收益")} series={[{ name: text("Excess", "超额"), color: "var(--ui-chart-line)", values: data.rolling.map((row) => row.excess) }]} /> : <p className="pd-muted">{text("Needs 63 trading days of history.", "需要 63 个交易日的历史。")}</p>}</section>
          <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Rolling 3-month beta", "滚动 3 个月 β")}</h2><p>{text("Is your market exposure drifting?", "市场暴露是否在漂移？")}</p></div></div>{data.rolling.some((row) => row.beta != null) ? <InsightChart dates={data.rolling.map((row) => row.date)} unit="" label={text("Rolling beta", "滚动 β")} series={[{ name: "β", color: "var(--ui-accent)", values: data.rolling.map((row) => row.beta) }]} /> : <p className="pd-muted">{text("Needs 63 trading days of history.", "需要 63 个交易日的历史。")}</p>}</section>
        </div>
        <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Monthly returns", "月度收益日历")}</h2><p>{text("All recorded history · portfolio return, excess vs", "全部历史 · 组合月收益，年度超额相对")} {benchmark}</p></div></div><MonthlyCalendar months={data.months} labels={{ year: text("Year", "年份"), total: text("Year", "全年"), excess: text("vs bench", "超额") }} /></section>
        <PerformanceInsights points={data.points} benchmark={benchmark} />
        <section className="pd-section pd-insights ta-insights-wide"><p className="pd-eyebrow">{text("ALL FINDINGS", "全部发现")}</p><InsightList insights={insights} /></section>
      </>}

      {view === "allocation" && <>
        <section className="pd-metrics" aria-label={text("Concentration", "集中度")}>{[
          [text("Open positions", "持仓数"), String(conc?.positions ?? 0), text("Securities with remaining quantity", "仍有持仓的证券")],
          [text("Top 3 weight", "前三大占比"), `${(conc?.top3 ?? 0).toFixed(1)}%`, text("Cash excluded", "不含现金")],
          [text("Effective positions", "等效持仓数"), num(conc?.effectiveCount, 1), `HHI ${Math.round(conc?.hhi ?? 0)} · 1 ÷ Σw²`],
          [text("1Y portfolio volatility", "近一年组合波动"), data.risk.volatility == null ? "—" : `${data.risk.volatility.toFixed(1)}%`, `${data.risk.observations} ${text("daily returns · current weights", "个日收益 · 当前权重")}`],
        ].map(([label, value, note]) => <article key={label} className="pd-metric"><p>{label}</p><strong>{value}</strong><small>{note}</small></article>)}</section>
        <div className="pd-two-columns">
          <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Weight vs risk contribution", "仓位 vs 风险贡献")}</h2><p>{text("RCᵢ = wᵢ(Σw)ᵢ ÷ σ²ₚ · red = risk ≥1.4× weight", "RCᵢ = wᵢ(Σw)ᵢ ÷ σ²ₚ · 红色 = 风险 ≥ 1.4 倍仓位")}</p></div><span className="pd-badge">{text("CASH EXCLUDED", "不含现金")}</span></div><WeightRiskBars rows={data.risk.contributions} labels={{ weight: text("Weight", "仓位"), risk: text("Risk contribution", "风险贡献") }} /></section>
          <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Weight vs P&L contribution", "仓位 vs 盈亏贡献")}</h2><p>{text("Dashed line = contribution proportional to weight. Above it: pulling more than its weight.", "虚线 = 按仓位等比贡献；在虚线上方 = 贡献超过仓位。")}</p></div></div><ContributionScatter points={openHoldings.map((holding) => ({ symbol: holding.symbol, weight: holding.weight, contribution: holding.contribution }))} total={data.pnl} label={text("Weight versus contribution", "仓位与贡献")} axis={{ x: text("Weight %", "仓位 %"), y: text("Period P&L", "区间盈亏") }} /></section>
        </div>
        <div className="pd-two-columns">
          <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Correlation between holdings", "持仓相关性")}</h2><p>{text("1-year daily returns · red = move together", "近一年日收益 · 红色 = 同涨同跌")}</p></div></div>{data.risk.correlation && data.risk.correlation.symbols.length > 1 ? <CorrelationHeatmap symbols={data.risk.correlation.symbols} matrix={data.risk.correlation.matrix} /> : <p className="pd-muted">{text("Needs at least two open positions with 40+ days of shared history.", "需要至少两只持仓、40 个以上共同交易日。")}</p>}</section>
          <section className="pd-section"><div className="pd-section-heading"><h2>{text("P&L drivers", "盈亏贡献")}</h2></div>{contributions.map((holding) => <div className="pd-allocation-row" key={holding.symbol}><button className="pd-symbol" onClick={() => onPick(holding.symbol)}>{holding.symbol}</button><span>{holding.weight.toFixed(1)}%</span><strong className={toneOf(holding.contribution)}>{signedAmount(holding.contribution)}</strong></div>)}<p className="pd-reconciliation">{text("Reconciled contribution total", "贡献对账合计")} <strong>{money(data.pnl)}</strong></p></section>
        </div>
      </>}

      {view === "holdings" && <section className="pd-section"><div className="pd-table-scroll"><table><thead><tr>{[text("Symbol", "股票"), text("Qty", "数量"), text("Avg cost", "平均成本"), text("Close", "收盘价"), text("vs cost", "相对成本"), text("Market value", "市值"), text("Weight", "仓位"), text("Risk contrib.", "风险贡献"), text("From 52W high", "距 52 周高"), text("Held (days)", "持有天数"), text("Unrealized P&L", "未实现盈亏"), text("Period P&L", "区间盈亏"), text("Actions", "操作")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{holdings.map((holding) => <tr key={holding.symbol}><td title={`β ${holding.beta?.toFixed(2) ?? "—"} (${benchmark}, 2Y)`}><button className="pd-symbol" onClick={() => onPick(holding.symbol)}>{holding.symbol} ↗</button><small>{holding.name}</small></td><td>{holding.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td>{holding.averageCost == null ? "—" : decimal(holding.averageCost)}</td><td>{holding.price == null ? "—" : decimal(holding.price)}</td><td className={toneOf(holding.vsCost)}>{holding.vsCost == null ? "—" : percent(holding.vsCost)}</td><td>{decimal(holding.value)}</td><td>{holding.weight.toFixed(1)}%</td><td className={holding.riskContribution != null && holding.riskContribution > holding.weight * 1.4 && holding.riskContribution >= 15 ? "pd-negative" : ""}>{holding.riskContribution == null ? "—" : `${holding.riskContribution.toFixed(1)}%`}</td><td>{holding.fromHigh == null ? "—" : `${holding.fromHigh.toFixed(1)}%`}</td><td>{holding.holdingDays ?? "—"}</td><td className={toneOf(holding.unrealized)}>{signedAmount(holding.unrealized)}</td><td className={toneOf(holding.contribution)}>{signedAmount(holding.contribution)}</td><td><button type="button" className="pd-button" aria-label={`${text("Record trade", "记录交易")} · ${holding.symbol}`} onClick={() => onUpdateHolding(holding.symbol)}>{text("Record trade", "记录交易")}</button></td></tr>)}</tbody><tfoot><tr><td>{text("Total", "合计")}</td><td colSpan={4} /><td>{decimal(data.value)}</td><td>{data.value > 0 ? "100.0%" : "—"}</td><td colSpan={3} /><td>{signedAmount(data.unrealized)}</td><td>{signedAmount(data.pnl)}</td><td /></tr></tfoot></table></div><p className="pd-table-note">{text("Weight excludes cash. Risk contribution = share of 1-year portfolio volatility at current weights (red: ≥1.4× weight). Held = calendar days since the current position was opened. Hover a symbol for its 2-year beta.", "仓位不含现金。风险贡献 = 按当前权重计算的近一年组合波动占比（红色：≥ 1.4 倍仓位）。持有天数 = 当前这段持仓建立以来的日历天数。鼠标悬停代码可查看两年 β。")}</p></section>}

      {view === "methodology" && <section className="pd-section pd-methodology"><h2>{text("Analysis methodology", "计算口径")}</h2>{[
        text("Market value uses recorded remaining quantities and Yahoo Finance daily close prices. Cash balance and external funding are unknown and excluded.", "市值采用已录入的剩余数量与 Yahoo 日收盘价，未知现金余额及外部资金流水不计入。"),
        text("Daily securities return = (closing securities value + sale proceeds) / (previous closing value + purchase amounts) − 1. Buys are treated at day start and sells at day end. Daily returns are geometrically linked. With date-only trades this is an approximation, not account TWR or IRR.", "日证券收益率 =（日末证券市值 + 当日卖出金额）/（前日证券市值 + 当日买入金额）− 1，买入视为期初、卖出视为期末，再逐日连乘。仅有日期的交易采用该近似约定，不称为账户 TWR 或 IRR。"),
        text("P&L contribution = ending market value − beginning market value + sales − purchases + dividends − fees and tax booked to that symbol. Realized P&L uses average cost across all recorded trades; period P&L follows the selected range. Account return is time-weighted (deposits and withdrawals neutralised); money-weighted return (XIRR) reflects when you added or took out money. Corporate actions are not adjusted.", "区间盈亏贡献 = 期末市值 − 期初市值 + 卖出金额 − 买入金额 + 该代码的分红 − 费用和税。已实现盈亏采用全部已录入交易的平均成本法，区间盈亏跟随筛选。账户收益为时间加权（剔除入金出金影响）；资金加权收益（XIRR）反映你入金出金的时点。拆股等公司行动暂未调整。"),
        text(`Risk-adjusted: annualized return = compounded period return ^ (252 / days) − 1; volatility = daily sample std × √252; Sharpe = (annual return − ${(RISK_FREE_RATE * 100).toFixed(0)}%) ÷ volatility; Sortino uses downside deviation; Calmar = annual return ÷ |max drawdown|. Shown only with ≥40 trading days; short windows are unstable.`, `风险调整：年化收益 = 区间复合收益 ^ (252 / 天数) − 1；年化波动 = 日收益样本标准差 × √252；Sharpe =（年化收益 − ${(RISK_FREE_RATE * 100).toFixed(0)}% 无风险利率）÷ 年化波动；Sortino 只计下行波动；Calmar = 年化收益 ÷ |最大回撤|。至少 40 个交易日才显示，短区间估计不稳定。`),
        text("Alpha & beta: OLS of daily portfolio return on benchmark return over the selected period. Alpha is the annualized intercept (×252), with its t-statistic; |t| ≥ 2 is treated as significant. Market part = β × benchmark period return; the residual is attributed to selection and timing. Up/down capture = mean portfolio return ÷ mean benchmark return on benchmark up/down days (≥5 days each).", "Alpha 与 β：所选区间内，组合日收益对基准日收益做最小二乘回归。Alpha 为截距 ×252 年化，并给出 t 值，|t| ≥ 2 视为显著。市场部分 = β × 基准区间收益，剩余部分归为选股与择时。上行 / 下行捕获率 = 基准上涨 / 下跌日组合平均收益 ÷ 基准平均收益（各需 ≥5 天）。"),
        text("Trade analytics: each sell is one closed trade; P&L and return use the average cost at the time of the sale (consistent with realized P&L). Holding days match the sold shares to the oldest lots (FIFO), weighted by quantity. Win rate, payoff ratio (avg win ÷ avg loss), profit factor (gross win ÷ gross loss) and expectancy (average P&L per closed trade) cover sells inside the selected range. After-exit and after-entry changes use the close 20 (and 5) trading days later; entry excess subtracts the benchmark over the same window.", "交易分析：每笔卖出视为一笔已平仓交易，盈亏与收益率按卖出时的平均成本计算（与已实现盈亏一致）；持有天数按先进先出（FIFO）匹配卖出股份与最早买入批次，再按数量加权。胜率、盈亏比（平均盈利 ÷ 平均亏损）、Profit Factor（总盈利 ÷ 总亏损）、期望值（每笔已平仓交易平均盈亏）统计所选区间内的卖出。卖出后 / 买入后变化取第 20（及 5）个交易日收盘；买入超额再减去同期基准收益。"),
        text("Risk contribution: covariance of the last year of daily returns for currently held securities (common trading days only), at current market-value weights. RCᵢ = wᵢ·(Σw)ᵢ ÷ wᵀΣw, summing to 100%. Effective positions = 1 ÷ Σw² (HHI shown ×10,000). Correlation uses the same window. Beta per holding uses up to two years, ≥60 matched observations.", "风险贡献：用当前持仓近一年共同交易日的日收益协方差矩阵，按当前市值权重计算 RCᵢ = wᵢ·(Σw)ᵢ ÷ wᵀΣw，合计 100%。等效持仓数 = 1 ÷ Σw²（HHI 以 ×10,000 显示）。相关性使用同一窗口。个股 β 使用最多两年、至少 60 个匹配样本。"),
        text("Findings in 'Behind the numbers' are rule-based judgements on these metrics (e.g. correlation > 0.9 with insignificant alpha; risk contribution ≥ 1.4× weight; losers held ≥ 1.3× longer than winners). They need minimum sample sizes and flag small samples.", "「数字背后的发现」是基于上述指标的规则判断（例如：相关性 > 0.9 且 Alpha 不显著；风险贡献 ≥ 1.4 倍仓位；亏损单持有时间 ≥ 盈利单 1.3 倍）。每条规则都有最低样本要求，样本少时会注明。"),
      ].map((note, index) => <article key={note}><span>{String(index + 1).padStart(2, "0")}</span><p>{note}</p></article>)}</section>}
      <footer className="pd-footer">{text("RECORDED TRADES · DAILY MARKET PRICES · NO SIMULATED HOLDINGS", "真实录入交易 · 日收盘行情 · 未使用演示持仓")}</footer>
    </>}
  </>;
}
