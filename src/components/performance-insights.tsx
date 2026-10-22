"use client";

import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { buildPerformanceInsights, type ReturnPoint } from "@/lib/performance-insights";

type Series = { name: string; color: string; values: (number | null)[] };
export function InsightChart({ dates, series, unit, label }: { dates: string[]; series: Series[]; unit: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = series.flatMap((line) => line.values.filter((value): value is number => value != null && Number.isFinite(value)));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const padding = Math.max((max - min) * 0.08, 0.1);
  const low = min - padding;
  const high = max + padding;
  const x = (index: number) => 65 + index / Math.max(1, dates.length - 1) * 805;
  const y = (value: number) => 20 + (high - value) / (high - low) * 195;
  const index = Math.min(hover ?? dates.length - 1, dates.length - 1);
  return <div className="pd-chart"><div className="pd-chart-readout"><span>{dates[index]}</span>{series.map((line) => <span className="pd-series-legend" key={line.name}><i style={{ background: line.color }} aria-hidden="true" />{line.name}<strong>{line.values[index] == null ? "—" : `${line.values[index]!.toFixed(2)} ${unit}`}</strong></span>)}</div><svg viewBox="0 0 900 250" role="img" aria-label={label} onPointerLeave={() => setHover(null)} onPointerMove={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(dates.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width * 900 - 65) / 805 * (dates.length - 1))))); }}>
    {[0, 1, 2, 3, 4].map((level) => { const value = low + (high - low) * level / 4; return <g key={level}><line x1="65" x2="870" y1={y(value)} y2={y(value)} className="pd-grid-line" /><text x="55" y={y(value) + 4} textAnchor="end" className="pd-chart-label">{value.toFixed(unit === "%" || unit === "pp" ? 1 : 2)}{unit === "pp" ? "pp" : unit === "%" ? "%" : ""}</text></g>; })}
    <line x1="65" x2="870" y1={y(0)} y2={y(0)} className="pd-grid-line" strokeDasharray="4 4" />
    {series.map((line) => { let open = false; const path = line.values.map((value, pointIndex) => { if (value == null || !Number.isFinite(value)) { open = false; return ""; } const segment = `${open ? "L" : "M"}${x(pointIndex)},${y(value)}`; open = true; return segment; }).join(" "); return <path key={line.name} d={path} fill="none" stroke={line.color} strokeWidth="2.3" />; })}
    {hover != null && <line x1={x(index)} x2={x(index)} y1="20" y2="215" className="pd-grid-line" />}
    <text x="65" y="242" className="pd-chart-label">{dates[0]}</text><text x="870" y="242" textAnchor="end" className="pd-chart-label">{dates.at(-1)}</text>
  </svg></div>;
}

export function PerformanceInsights({ points, benchmark, weekly = false }: { points: ReturnPoint[]; benchmark: string; weekly?: boolean }) {
  const { locale } = useLanguage();
  const text = (english: string, chinese: string) => locale === "zh" ? chinese : english;
  const window = weekly ? 12 : 20;
  const data = buildPerformanceInsights(points, window, weekly ? 52 : 252);
  const dates = points.map((point) => point.date);
  const name = text("Portfolio", "组合");
  const enough = data.series.some((point) => point.portfolioVolatility != null);
  const unitName = weekly ? text("weekly observations", "周度观测") : text("trading days", "交易日");
  return <>
    <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Drawdown comparison", "组合与基准回撤对比")}</h2><p>{text("Decline from each series’ own peak within the selected period", "相对各自在所选区间内前高的下跌幅度")}</p></div></div><InsightChart dates={dates} label={text("Portfolio and benchmark drawdown", "组合与基准回撤")} unit="%" series={[{ name, color: "#14b8a6", values: data.series.map((point) => point.portfolioDrawdown) }, { name: benchmark, color: "#a78bfa", values: data.series.map((point) => point.benchmarkDrawdown) }]} />
      <div className="pd-drawdown-facts"><div><span>{text("Maximum drawdown", "最大回撤")}</span><strong>{data.maxDrawdown.toFixed(2)}%</strong><small>{data.maxDrawdown < 0 ? `${data.maxPeakDate} → ${data.troughDate}` : text("No drawdown", "无回撤")}</small></div><div><span>{text("Current drawdown", "当前距前高跌幅")}</span><strong>{data.currentDrawdown.toFixed(2)}%</strong><small>{data.currentUnderwater === 0 ? text("At period high", "已回到区间前高") : text("Not yet recovered", "尚未恢复前高")}</small></div><div><span>{text("Current underwater duration", "当前回撤持续")}</span><strong>{data.currentUnderwater}</strong><small>{unitName}</small></div><div><span>{text("Longest underwater duration", "最长回撤持续")}</span><strong>{data.longestUnderwater}</strong><small>{unitName}</small></div></div>
    </section>
    <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Rolling annualized volatility", "滚动年化波动率")}</h2><p>{window} {unitName} · {text("sample standard deviation, annualized", "样本标准差年化")}</p></div></div>{enough ? <InsightChart dates={dates} label={text("Rolling portfolio and benchmark volatility", "组合与基准滚动波动率")} unit="%" series={[{ name, color: "#14b8a6", values: data.series.map((point) => point.portfolioVolatility) }, { name: benchmark, color: "#a78bfa", values: data.series.map((point) => point.benchmarkVolatility) }]} /> : <p className="pd-empty">{text(`At least ${window + 1} price observations are required. Choose a longer period.`, `至少需要 ${window + 1} 个净值观测点，请选择更长区间。`)}</p>}<p className="pd-muted">{text(`Uses only returns inside the selected period; the first ${window} observations are left blank. Annualization factor: √${weekly ? 52 : 252}.`, `仅使用所选区间内收益，前 ${window} 个观测点留空，年化系数为 √${weekly ? 52 : 252}。`)}</p></section>
    <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Excess return trend", "超额收益走势")}</h2><p>{text("Portfolio cumulative return minus benchmark return · percentage points", "组合累计收益率 − 基准累计收益率 · 单位：百分点")}</p></div><span className="pd-badge">vs {benchmark}</span></div><InsightChart dates={dates} label={text("Excess return trend", "超额收益走势")} unit="pp" series={[{ name: text("Excess return", "超额收益"), color: "#14b8a6", values: data.series.map((point) => point.excess) }]} /></section>
  </>;
}
