"use client";

import { useState } from "react";

// Colours resolve from the active skin (theme.css); SVG needs them as CSS (style), not attributes.
const LINE = "var(--ui-chart-line)";
const BENCH = "var(--ui-chart-bench)";
const UP = "var(--ui-up)";
const DOWN = "var(--ui-down)";

const signed = (value: number, digits = 1, unit = "%") => `${value > 0 ? "+" : ""}${value.toFixed(digits)}${unit}`;

/** Cumulative return vs benchmark with an underwater (drawdown) pane sharing the x-axis. */
export function ReturnDrawdownChart({ points, benchmark, labels }: { points: { date: string; portfolio: number; benchmark: number; drawdown: number }[]; benchmark: string; labels: { portfolio: string; drawdown: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const values = points.flatMap((point) => [point.portfolio, point.benchmark, 0]);
  const low = Math.min(...values) - 0.5;
  const high = Math.max(...values) + 0.5;
  const ddLow = Math.min(-0.5, ...points.map((point) => point.drawdown));
  const x = (index: number) => 60 + index / (points.length - 1) * 810;
  const y = (value: number) => 18 + (high - value) / (high - low) * 190;
  const yd = (value: number) => 236 + (0 - value) / (0 - ddLow) * 64;
  const path = (key: "portfolio" | "benchmark", scale: (value: number) => number) => points.map((point, index) => `${index ? "L" : "M"}${x(index)},${scale(point[key])}`).join(" ");
  const ddPath = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${yd(point.drawdown)}`).join(" ");
  const index = Math.min(hover ?? points.length - 1, points.length - 1);
  const current = points[index];
  return <div className="pd-chart">
    <div className="pd-chart-readout"><span>{current.date}</span>
      <span className="pd-series-legend"><i style={{ background: LINE }} />{labels.portfolio} <strong>{signed(current.portfolio, 2)}</strong></span>
      <span className="pd-series-legend"><i style={{ background: BENCH }} />{benchmark} <strong>{signed(current.benchmark, 2)}</strong></span>
      <span className="pd-series-legend"><i style={{ background: DOWN }} />{labels.drawdown} <strong>{current.drawdown.toFixed(2)}%</strong></span>
    </div>
    <svg viewBox="0 0 900 330" role="img" aria-label={`${labels.portfolio} vs ${benchmark}; ${labels.drawdown}`} onPointerLeave={() => setHover(null)} onPointerMove={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width * 900 - 60) / 810 * (points.length - 1))))); }}>
      {[0, 1, 2, 3].map((level) => { const value = low + (high - low) * level / 3; return <g key={level}><line x1="60" x2="870" y1={y(value)} y2={y(value)} className="pd-grid-line" /><text x="52" y={y(value) + 4} textAnchor="end" className="pd-chart-label">{value.toFixed(1)}%</text></g>; })}
      <line x1="60" x2="870" y1={y(0)} y2={y(0)} className="pd-grid-line" strokeDasharray="4 4" />
      <path d={path("benchmark", y)} fill="none" style={{ stroke: BENCH }} strokeWidth="1.6" strokeDasharray="5 4" />
      <path d={path("portfolio", y)} fill="none" style={{ stroke: LINE }} strokeWidth="2.2" />
      <line x1="60" x2="870" y1="236" y2="236" className="pd-grid-line" />
      <text x="52" y="240" textAnchor="end" className="pd-chart-label">0%</text>
      <text x="52" y="304" textAnchor="end" className="pd-chart-label">{ddLow.toFixed(1)}%</text>
      <path d={`${ddPath} L870,236 L60,236 Z`} style={{ fill: "var(--ui-dd)" }} />
      <path d={ddPath} fill="none" style={{ stroke: DOWN }} strokeWidth="1.6" />
      {hover != null && <line x1={x(index)} x2={x(index)} y1="18" y2="300" className="pd-grid-line" />}
      <text x="60" y="322" className="pd-chart-label">{points[0].date}</text><text x="870" y="322" textAnchor="end" className="pd-chart-label">{points.at(-1)!.date}</text>
    </svg>
  </div>;
}

export function Histogram({ bins, label, unit = "%" }: { bins: { from: number; to: number; count: number }[]; label: string; unit?: string }) {
  const max = Math.max(1, ...bins.map((bin) => bin.count));
  const width = 810 / bins.length;
  return <div className="pd-chart"><svg viewBox="0 0 900 220" role="img" aria-label={label}>
    {[0, 0.5, 1].map((level) => <g key={level}><line x1="60" x2="870" y1={180 - level * 150} y2={180 - level * 150} className="pd-grid-line" /><text x="52" y={184 - level * 150} textAnchor="end" className="pd-chart-label">{Math.round(max * level)}</text></g>)}
    {bins.map((bin, index) => { const height = bin.count / max * 150; const mid = (bin.from + bin.to) / 2; return <g key={index}><rect x={60 + index * width + 2} y={180 - height} width={width - 4} height={height} rx="2" style={{ fill: mid < 0 ? DOWN : UP }} opacity={bin.count ? 0.85 : 0}><title>{`${bin.from}${unit} … ${bin.to}${unit}: ${bin.count}`}</title></rect>{bin.count > 0 && <text x={60 + index * width + width / 2} y={174 - height} textAnchor="middle" className="pd-chart-label">{bin.count}</text>}</g>; })}
    {bins.map((bin, index) => index % 2 === 0 ? <text key={`l${index}`} x={60 + index * width} y="200" textAnchor="middle" className="pd-chart-label">{index === 0 ? `≤${bin.to}` : bin.from}{unit}</text> : null)}
    <text x="870" y="200" textAnchor="end" className="pd-chart-label">≥{bins.at(-1)!.from}{unit}</text>
  </svg></div>;
}

/** Dot strip: one dot per observation on a symmetric percentage axis, with the mean marked. */
export function DotStrip({ values, label, average, limit = 30 }: { values: { key: string; value: number; title: string }[]; label: string; average: number | null; limit?: number }) {
  const span = Math.max(limit, ...values.map((item) => Math.abs(item.value)).filter(Number.isFinite).map((value) => Math.min(100, Math.ceil(value / 10) * 10)));
  const x = (value: number) => 60 + (value + span) / (2 * span) * 810;
  return <div className="pd-chart"><svg viewBox="0 0 900 110" role="img" aria-label={label} style={{ minHeight: 0 }}>
    <line x1="60" x2="870" y1="50" y2="50" className="pd-grid-line" />
    <line x1={x(0)} x2={x(0)} y1="20" y2="80" className="pd-grid-line" strokeDasharray="4 4" />
    {values.map((item, index) => <circle key={item.key} cx={x(item.value)} cy={50 + ((index % 5) - 2) * 7} r="7" style={{ fill: item.value >= 0 ? UP : DOWN }} opacity=".75"><title>{item.title}</title></circle>)}
    {average != null && <g><line x1={x(average)} x2={x(average)} y1="18" y2="82" stroke="currentColor" strokeWidth="2" /><text x={x(average)} y="14" textAnchor="middle" className="pd-chart-label">avg {signed(average)}</text></g>}
    <text x="60" y="100" className="pd-chart-label">−{span}%</text><text x={x(0)} y="100" textAnchor="middle" className="pd-chart-label">0</text><text x="870" y="100" textAnchor="end" className="pd-chart-label">+{span}%</text>
  </svg></div>;
}

export function WeightRiskBars({ rows, labels }: { rows: { symbol: string; weight: number; risk: number | null }[]; labels: { weight: string; risk: string } }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.weight, row.risk ?? 0]));
  return <div className="ta-bars">
    <div className="ta-bars-legend"><span><i className="ta-swatch ta-swatch-weight" />{labels.weight}</span><span><i className="ta-swatch ta-swatch-risk" />{labels.risk}</span></div>
    {rows.map((row) => { const hot = row.risk != null && row.risk > row.weight * 1.4 && row.risk >= 15; return <div className="ta-bar-row" key={row.symbol}>
      <span className="ta-bar-label">{row.symbol}</span>
      <div className="ta-bar-tracks"><span className="ta-bar ta-bar-weight" style={{ width: `${row.weight / max * 100}%` }} /><span className={`ta-bar ta-bar-risk ${hot ? "is-hot" : ""}`} style={{ width: `${(row.risk ?? 0) / max * 100}%` }} /></div>
      <span className="ta-bar-values">{row.weight.toFixed(1)}%<strong className={hot ? "pd-negative" : ""}>{row.risk == null ? "—" : `${row.risk.toFixed(1)}%`}</strong></span>
    </div>; })}
  </div>;
}

/** Weight (x) vs P&L contribution (y). The dashed line is "contribution proportional to weight". */
export function ContributionScatter({ points, total, label, axis }: { points: { symbol: string; weight: number; contribution: number }[]; total: number; label: string; axis: { x: string; y: string } }) {
  if (!points.length) return null;
  const maxX = Math.max(10, ...points.map((point) => point.weight)) * 1.1;
  const values = [...points.map((point) => point.contribution), 0, total * maxX / 100];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.12 || 1;
  const x = (value: number) => 70 + value / maxX * 790;
  const y = (value: number) => 20 + (high + pad - value) / (high - low + 2 * pad) * 220;
  return <div className="pd-chart"><svg viewBox="0 0 900 280" role="img" aria-label={label}>
    <line x1="70" x2="860" y1={y(0)} y2={y(0)} className="pd-grid-line" />
    <line x1="70" x2="70" y1="20" y2="240" className="pd-grid-line" />
    <line x1={x(0)} y1={y(0)} x2={x(maxX)} y2={y(total * maxX / 100)} stroke="currentColor" opacity=".35" strokeDasharray="5 5" />
    {points.map((point) => { const fair = total * point.weight / 100; const better = point.contribution >= fair; return <g key={point.symbol}><circle cx={x(point.weight)} cy={y(point.contribution)} r="7" style={{ fill: better ? UP : DOWN }} opacity=".85"><title>{`${point.symbol}: ${point.weight.toFixed(1)}% · ${point.contribution.toFixed(2)}`}</title></circle><text x={x(point.weight) + 10} y={y(point.contribution) + 4} className="pd-chart-label ta-scatter-label">{point.symbol}</text></g>; })}
    <text x="860" y="268" textAnchor="end" className="pd-chart-label">{axis.x} →</text>
    <text x="74" y="16" className="pd-chart-label">↑ {axis.y}</text>
    <text x="64" y={y(0) + 4} textAnchor="end" className="pd-chart-label">0</text>
  </svg></div>;
}

function heat(value: number, scale: number) {
  const intensity = Math.min(1, Math.abs(value) / scale);
  const base = value >= 0 ? "20,184,166" : "251,113,133";
  return `rgba(${base},${(0.08 + intensity * 0.62).toFixed(2)})`;
}

export function CorrelationHeatmap({ symbols, matrix }: { symbols: string[]; matrix: number[][] }) {
  return <div className="pd-table-scroll"><table className="ta-heatmap"><thead><tr><th />{symbols.map((symbol) => <th key={symbol}>{symbol}</th>)}</tr></thead><tbody>{matrix.map((row, i) => <tr key={symbols[i]}><th>{symbols[i]}</th>{row.map((value, j) => <td key={j} style={{ background: i === j ? "transparent" : value >= 0 ? `rgba(251,113,133,${(Math.min(1, value) * 0.7 + 0.05).toFixed(2)})` : `rgba(96,165,250,${(Math.min(1, -value) * 0.7 + 0.05).toFixed(2)})` }}>{i === j ? "—" : value.toFixed(2)}</td>)}</tr>)}</tbody></table></div>;
}

export function MonthlyCalendar({ months, labels }: { months: { month: string; portfolio: number; benchmark: number }[]; labels: { year: string; total: string; excess: string } }) {
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))].sort();
  const scale = Math.max(3, ...months.map((month) => Math.abs(month.portfolio)));
  return <div className="pd-table-scroll"><table className="ta-heatmap ta-calendar"><thead><tr><th>{labels.year}</th>{Array.from({ length: 12 }, (_, index) => <th key={index}>{index + 1}</th>)}<th>{labels.total}</th><th>{labels.excess}</th></tr></thead><tbody>{years.map((year) => {
    const rows = months.filter((month) => month.month.startsWith(year));
    const total = (rows.reduce((product, month) => product * (1 + month.portfolio / 100), 1) - 1) * 100;
    const bench = (rows.reduce((product, month) => product * (1 + month.benchmark / 100), 1) - 1) * 100;
    return <tr key={year}><th>{year}</th>{Array.from({ length: 12 }, (_, index) => { const month = rows.find((row) => Number(row.month.slice(5)) === index + 1); return <td key={index} style={{ background: month ? heat(month.portfolio, scale) : "transparent" }} title={month ? `${month.month}: ${signed(month.portfolio)} · bench ${signed(month.benchmark)}` : ""}>{month ? signed(month.portfolio) : ""}</td>; })}<td className={total >= 0 ? "pd-positive" : "pd-negative"}><strong>{signed(total)}</strong></td><td className={total - bench >= 0 ? "pd-positive" : "pd-negative"}>{signed(total - bench, 1, " pp")}</td></tr>;
  })}</tbody></table></div>;
}

export function ActivityChart({ rows, label, legend }: { rows: { month: string; trades: number; portfolio: number }[]; label: string; legend: { gain: string; loss: string } }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((row) => row.trades));
  const width = 810 / rows.length;
  return <div className="pd-chart">
    <div className="pd-chart-readout"><span className="pd-series-legend"><i style={{ background: UP }} />{legend.gain}</span><span className="pd-series-legend"><i style={{ background: DOWN }} />{legend.loss}</span></div>
    <svg viewBox="0 0 900 200" role="img" aria-label={label}>
      {[0, 0.5, 1].map((level) => <g key={level}><line x1="60" x2="870" y1={160 - level * 130} y2={160 - level * 130} className="pd-grid-line" /><text x="52" y={164 - level * 130} textAnchor="end" className="pd-chart-label">{Math.round(max * level)}</text></g>)}
      {rows.map((row, index) => { const height = row.trades / max * 130; return <g key={row.month}><rect x={60 + index * width + Math.max(1, width * 0.15)} y={160 - height} width={Math.max(2, width * 0.7)} height={Math.max(height, 1)} rx="2" style={{ fill: row.portfolio >= 0 ? UP : DOWN }} opacity={row.trades ? 0.85 : 0.25}><title>{`${row.month}: ${row.trades} · ${signed(row.portfolio)}`}</title></rect></g>; })}
      {rows.map((row, index) => (rows.length <= 12 || index % Math.ceil(rows.length / 12) === 0) ? <text key={`t${row.month}`} x={60 + index * width + width / 2} y="180" textAnchor="middle" className="pd-chart-label">{row.month.slice(2)}</text> : null)}
    </svg>
  </div>;
}
