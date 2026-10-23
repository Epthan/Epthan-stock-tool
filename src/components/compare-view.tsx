"use client";

import { useEffect, useMemo, useState } from "react";
import { TTL, fetchCached } from "@/lib/client-cache";
import { useStoredWatchlists } from "@/hooks/use-stored-watchlists";
import { usePortfolios } from "@/hooks/use-portfolios";
import { useLanguage } from "@/components/language-provider";
import { useStockSelection } from "@/components/stock-selection-provider";
import { StockChart, type ChartStyle } from "@/components/stock-chart";
import { ErrorState, StatePanel } from "@/components/state-panel";
import { movingAverageLabels, type CandlePoint, type MovingAverageKey, type TimeframeKey, type WatchlistRow } from "@/lib/mock-market";
import { getTradePosition } from "@/lib/portfolio-trades";
import { createDefaultWatchlists } from "@/lib/watchlists";

type CandleResponse = { mode: "live" | "mock"; candles: CandlePoint[]; message: string };
type QuoteResponse = { quote: WatchlistRow };
type Loaded = { symbol: string; candles: CandlePoint[] | null; quote: WatchlistRow | null; error?: string };

const TIMEFRAMES: TimeframeKey[] = ["5D", "1M", "3M", "6M", "1Y", "5Y"];
const DAILY: TimeframeKey[] = ["1M", "3M", "6M", "1Y", "5Y", "10Y", "MAX"];
const MAX_SYMBOLS = 8;

function loadSymbol(symbol: string, timeframe: TimeframeKey): Promise<Loaded> {
  const intraday = !DAILY.includes(timeframe);
  return Promise.all([
    fetchCached<QuoteResponse>(`quote:${symbol}`, `/api/market/quote?symbol=${encodeURIComponent(symbol)}`, TTL.quote).then((body) => body.quote ?? null).catch(() => null),
    fetchCached<CandleResponse>(`candles:${symbol}:${timeframe}`, `/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`, intraday ? TTL.intraday : TTL.daily)
      .then((body) => (body.mode === "live" && body.candles?.length ? { candles: body.candles } : { candles: null, error: body.message || "Chart data unavailable" }))
      .catch((error: Error) => ({ candles: null, error: error.message })),
  ]).then(([quote, chart]) => ({ symbol, quote, ...chart }));
}

/** Period statistics from a candle series (no simulated fallback). */
function stats(candles: CandlePoint[], daily: boolean) {
  const closes = candles.map((candle) => candle.close).filter((close) => close > 0);
  if (closes.length < 2) return null;
  let peak = closes[0], maxDrawdown = 0;
  const returns: number[] = [];
  for (let index = 0; index < closes.length; index++) {
    peak = Math.max(peak, closes[index]);
    maxDrawdown = Math.min(maxDrawdown, closes[index] / peak - 1);
    if (index) returns.push(closes[index] / closes[index - 1] - 1);
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1));
  const high = Math.max(...closes), low = Math.min(...closes), last = closes.at(-1)!;
  return { change: (last / closes[0] - 1) * 100, maxDrawdown: maxDrawdown * 100, volatility: daily ? sd * Math.sqrt(252) * 100 : null, fromHigh: (last / high - 1) * 100, rangePosition: high > low ? (last - low) / (high - low) * 100 : 50 };
}

const pct = (value: number | null | undefined, digits = 1) => (value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`);
const tone = (value: number | null | undefined) => (value == null || Math.abs(value) < 0.05 ? "" : value > 0 ? "is-up" : "is-down");

/** Every symbol rebased to 0% at the start of the window, on one time axis. */
function RebasedChart({ rows, labels }: { rows: (Loaded & { color: string })[]; labels: { start: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const lines = rows.filter((row) => row.candles && row.candles.length > 1).map((row) => {
    const base = row.candles![0].close;
    return { ...row, points: row.candles!.map((candle) => ({ time: candle.time, value: (candle.close / base - 1) * 100 })) };
  });
  if (!lines.length) return null;
  const times = [...new Set(lines.flatMap((line) => line.points.map((point) => point.time)))].sort((a, b) => a - b);
  const t0 = times[0], t1 = times.at(-1)!;
  const values = lines.flatMap((line) => line.points.map((point) => point.value));
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const W = 920, H = 300, L = 52, R = 16, T = 14, B = 26;
  const x = (time: number) => L + (time - t0) / Math.max(1, t1 - t0) * (W - L - R);
  const y = (value: number) => T + (high - value) / Math.max(1e-9, high - low) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4);
  const hoverTime = hover == null ? null : times[hover];
  const at = (line: (typeof lines)[number], time: number) => { let value: number | null = null; for (const point of line.points) { if (point.time <= time) value = point.value; else break; } return value; };
  const date = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);
  return <div className="cmp-chart">
    <div className="cmp-legend">{hoverTime != null && <span className="cmp-legend-date">{date(hoverTime)}</span>}{lines.map((line) => { const value = hoverTime != null ? at(line, hoverTime) : line.points.at(-1)!.value; return <span key={line.symbol}><i style={{ background: line.color }} />{line.symbol} <strong className={tone(value)}>{pct(value)}</strong></span>; })}</div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={labels.start} onPointerLeave={() => setHover(null)} onPointerMove={(event) => {
      const box = event.currentTarget.getBoundingClientRect();
      const time = t0 + ((event.clientX - box.left) / box.width * W - L) / (W - L - R) * (t1 - t0);
      let best = 0; for (let index = 0; index < times.length; index++) if (Math.abs(times[index] - time) < Math.abs(times[best] - time)) best = index;
      setHover(best);
    }}>
      {ticks.map((tick) => <g key={tick}><line x1={L} x2={W - R} y1={y(tick)} y2={y(tick)} className="cmp-grid" /><text x={L - 8} y={y(tick) + 4} textAnchor="end" className="cmp-axis">{tick.toFixed(0)}%</text></g>)}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="cmp-zero" />
      {lines.map((line) => <path key={line.symbol} d={line.points.map((point, index) => `${index ? "L" : "M"}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")} fill="none" stroke={line.color} strokeWidth="1.8" strokeLinejoin="round" />)}
      {hoverTime != null && <line x1={x(hoverTime)} x2={x(hoverTime)} y1={T} y2={H - B} className="cmp-cross" />}
      <text x={L} y={H - 6} className="cmp-axis">{date(t0)}</text><text x={W - R} y={H - 6} textAnchor="end" className="cmp-axis">{date(t1)}</text>
    </svg>
  </div>;
}

export function CompareView() {
  const { locale } = useLanguage();
  const zh = locale === "zh";
  const text = (english: string, chinese: string) => (zh ? chinese : english);
  const { pickSymbol } = useStockSelection();
  const { watchlists, activeWatchlistId } = useStoredWatchlists();
  const { portfolios } = usePortfolios();
  const [source, setSource] = useState<string>("");
  const [timeframe, setTimeframe] = useState<TimeframeKey>("6M");
  const [view, setView] = useState<"rebased" | "grid">("rebased");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  const [averages, setAverages] = useState<MovingAverageKey[]>([50]);
  const [retry, setRetry] = useState(0);

  // Sources: every watch list, plus every portfolio's open positions.
  const sources = useMemo(() => [
    ...(watchlists.length ? watchlists : createDefaultWatchlists()).map((list) => ({ id: `w:${list.id}`, label: `${text("Watch list", "自选")} · ${list.name}`, symbols: list.symbols })),
    ...portfolios.filter((portfolio) => portfolio.trades?.length).map((portfolio) => ({ id: `p:${portfolio.id}`, label: `${text("Holdings", "持仓")} · ${zh ? portfolio.nameZh ?? portfolio.name : portfolio.name}`, symbols: [...new Set(portfolio.trades!.map((trade) => trade.symbol))].filter((symbol) => getTradePosition(portfolio.trades!, symbol, portfolio.splits).quantity > 1e-8) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- labels follow locale
  ], [watchlists, portfolios, zh]);
  const active = sources.find((item) => item.id === source) ?? sources.find((item) => item.id === `w:${activeWatchlistId}`) ?? sources[0];
  const symbols = useMemo(() => (active?.symbols ?? []).slice(0, MAX_SYMBOLS), [active]);
  const symbolKey = symbols.join(",");

  const [loaded, setLoaded] = useState<{ key: string; rows: Loaded[] }>({ key: "", rows: [] });
  const requestKey = `${symbolKey}:${timeframe}:${retry}`;
  useEffect(() => {
    if (!symbolKey) return;
    let active = true;
    Promise.all(symbolKey.split(",").map((symbol) => loadSymbol(symbol, timeframe))).then((rows) => { if (active) setLoaded({ key: requestKey, rows }); });
    return () => { active = false; };
  }, [symbolKey, timeframe, requestKey]);
  const loading = !!symbolKey && loaded.key !== requestKey;
  const rows = useMemo(() => loaded.rows.map((row, index) => ({ ...row, color: `var(--cmp-${(index % MAX_SYMBOLS) + 1})`, stats: row.candles ? stats(row.candles, DAILY.includes(timeframe)) : null })), [loaded.rows, timeframe]);
  const failed = rows.filter((row) => !row.candles);
  const ranked = [...rows].sort((left, right) => (right.stats?.change ?? -Infinity) - (left.stats?.change ?? -Infinity));

  return <main className="pg-page cmp-page">
    <header className="pg-head">
      <div><p className="pg-eyebrow">{text("Compare", "多股对比")}</p><h1>{text("Who led, who lagged", "谁领涨，谁拖后腿")}</h1><p className="pg-sub">{text("Each stock rebased to 0% at the start of the window, so returns line up directly.", "每只股票在区间起点归零，收益可以直接横向比较。")}</p></div>
      <div className="pg-controls">
        <label className="pg-field">{text("Symbols from", "股票来源")}<select value={active?.id ?? ""} onChange={(event) => setSource(event.target.value)}>{sources.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.symbols.length})</option>)}</select></label>
        <div className="pg-seg" role="group" aria-label={text("Window", "区间")}>{TIMEFRAMES.map((item) => <button key={item} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>{item}</button>)}</div>
        <div className="pg-seg" role="group" aria-label={text("View", "视图")}><button aria-pressed={view === "rebased"} onClick={() => setView("rebased")}>{text("Rebased", "归一化")}</button><button aria-pressed={view === "grid"} onClick={() => setView("grid")}>{text("Charts", "分图")}</button></div>
      </div>
    </header>

    {!symbols.length ? <StatePanel kind="empty" title={text("Nothing to compare yet", "还没有可对比的股票")}><p>{text("Add symbols to a watch list on the Market page, or record trades in a portfolio.", "先在行情页把股票加入自选，或在组合里录入交易。")}</p></StatePanel>
    : loading && !rows.length ? <StatePanel kind="loading" title={text("Loading prices…", "正在加载行情…")} />
    : failed.length === rows.length ? <ErrorState message={failed[0]?.error ?? "Chart data unavailable"} zh={zh} onRetry={() => setRetry((value) => value + 1)} />
    : <>
      {(active?.symbols.length ?? 0) > MAX_SYMBOLS && <p className="pg-note">{text(`Showing the first ${MAX_SYMBOLS} of ${active!.symbols.length} symbols.`, `只显示前 ${MAX_SYMBOLS} 只（共 ${active!.symbols.length} 只）。`)}</p>}
      {view === "rebased" ? <section className="pg-panel">
        <div className="pg-panel-head"><h2>{text("Cumulative return", "累计涨跌")} · {timeframe}</h2>{loading && <span className="pd-updating">{text("Updating…", "更新中…")}</span>}</div>
        <RebasedChart rows={rows} labels={{ start: text("Rebased returns", "归一化收益") }} />
      </section> : <>
        <div className="pg-toolbar">
          <div className="pg-seg" role="group" aria-label={text("Chart type", "图表类型")}><button aria-pressed={chartStyle === "line"} onClick={() => setChartStyle("line")}>{text("Line", "折线")}</button><button aria-pressed={chartStyle === "candles"} onClick={() => setChartStyle("candles")}>{text("Candles", "K 线")}</button></div>
          <div className="pg-seg" role="group" aria-label={text("Moving averages", "均线")}>{movingAverageLabels.map((period) => <button key={period} aria-pressed={averages.includes(period)} onClick={() => setAverages((current) => current.includes(period) ? current.filter((item) => item !== period) : [...current, period])}>MA{period}</button>)}</div>
        </div>
        <section className="cmp-grid-view">{rows.map((row) => <article key={row.symbol} className="pg-panel cmp-card">
          <header><button className="cmp-symbol" onClick={() => pickSymbol(row.symbol)}><i style={{ background: row.color }} />{row.symbol} ↗</button><span className="cmp-name">{row.quote?.name ?? ""}</span><strong className={tone(row.stats?.change)}>{pct(row.stats?.change)}</strong></header>
          {row.candles ? <StockChart candles={row.candles} chartStyle={chartStyle} movingAverages={averages} timeframe={timeframe} onTimeframeChange={setTimeframe} /> : <ErrorState compact message={row.error ?? ""} zh={zh} />}
        </article>)}</section>
      </>}

      <section className="pg-panel">
        <div className="pg-panel-head"><h2>{text("Side by side", "横向对比")}</h2><span>{text("Sorted by return in the window", "按区间涨跌排序")}</span></div>
        <div className="pg-table"><table>
          <thead><tr>{[text("Symbol", "代码"), text("Last", "现价"), text("Today", "今日"), text("Window return", "区间涨跌"), text("Max drawdown", "最大回撤"), text("Volatility (ann.)", "年化波动"), text("From high", "距区间高点"), text("Range position", "区间位置")].map((label, index) => <th key={label} className={index === 0 ? "pg-left" : ""}>{label}</th>)}</tr></thead>
          <tbody>{ranked.map((row) => <tr key={row.symbol}>
            <td className="pg-left"><button className="cmp-symbol" onClick={() => pickSymbol(row.symbol)}><i style={{ background: row.color }} />{row.symbol}</button><small>{row.quote?.name ?? ""}</small></td>
            <td>{row.quote?.price != null ? row.quote.price.toFixed(2) : "—"}<small>{row.quote?.currency ?? ""}</small></td>
            <td className={tone(row.quote?.changePercent)}>{pct(row.quote?.changePercent, 2)}</td>
            <td className={tone(row.stats?.change)}><strong>{pct(row.stats?.change)}</strong></td>
            <td className="is-down">{row.stats ? pct(row.stats.maxDrawdown) : "—"}</td>
            <td>{row.stats?.volatility == null ? "—" : `${row.stats.volatility.toFixed(1)}%`}</td>
            <td>{pct(row.stats?.fromHigh)}</td>
            <td>{row.stats ? <span className="cmp-range" title={`${row.stats.rangePosition.toFixed(0)}%`}><span style={{ left: `${row.stats.rangePosition}%` }} /></span> : row.error ? <span className="pg-muted">{text("No data", "无数据")}</span> : "—"}</td>
          </tr>)}</tbody>
        </table></div>
        {failed.length > 0 && failed.length < rows.length && <p className="pg-note">{text(`No chart data for ${failed.map((row) => row.symbol).join(", ")}; no simulated prices are substituted.`, `${failed.map((row) => row.symbol).join("、")} 暂无行情数据，不使用模拟数据替代。`)}</p>}
      </section>
    </>}
  </main>;
}
