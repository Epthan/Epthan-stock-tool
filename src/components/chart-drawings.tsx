"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { IChartApi, ISeriesApi, Logical, SeriesType } from "lightweight-charts";
import { TOOL_POINTS, fibLevels, snapPrice, timeMapper, type AnchorPoint, type Drawing, type DrawingTool } from "@/lib/chart-drawing";
import type { CandlePoint } from "@/lib/mock-market";

const TOOLS: { tool: DrawingTool; label: [string, string]; icon: string }[] = [
  { tool: "trend", label: ["Trend line", "趋势线"], icon: "M4 18L20 6" },
  { tool: "ray", label: ["Ray", "射线"], icon: "M4 18L14 10.5M14 10.5L20 6" },
  { tool: "hline", label: ["Horizontal line", "水平线"], icon: "M3 12h18" },
  { tool: "rect", label: ["Rectangle", "矩形"], icon: "M5 7h14v10H5z" },
  { tool: "fib", label: ["Fibonacci retracement", "斐波那契回撤"], icon: "M4 5h16M4 9.5h16M4 13h16M4 19h16" },
];

/** Toolbar above a drawable chart. */
export function ChartDrawingToolbar({ zh, tool, setTool, magnet, setMagnet, count, selected, onUndo, onDelete, onClear }: {
  zh: boolean; tool: DrawingTool | null; setTool: (tool: DrawingTool | null) => void; magnet: boolean; setMagnet: (on: boolean) => void;
  count: number; selected: boolean; onUndo: () => void; onDelete: () => void; onClear: () => void;
}) {
  const text = (english: string, chinese: string) => (zh ? chinese : english);
  return <div className="cd-toolbar" role="toolbar" aria-label={text("Drawing tools", "画线工具")}>
    {TOOLS.map((item) => <button key={item.tool} type="button" className="cd-tool" aria-pressed={tool === item.tool} title={item.label[zh ? 1 : 0]} aria-label={item.label[zh ? 1 : 0]} onClick={() => setTool(tool === item.tool ? null : item.tool)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg><span>{item.label[zh ? 1 : 0]}</span>
    </button>)}
    <span className="cd-sep" />
    <button type="button" className="cd-tool" aria-pressed={magnet} title={text("Snap to open / high / low / close", "吸附到开高低收")} onClick={() => setMagnet(!magnet)}>{text("Magnet", "磁吸")}</button>
    <button type="button" className="cd-tool" disabled={!count} onClick={onUndo}>{text("Undo", "撤销")}</button>
    <button type="button" className="cd-tool" disabled={!selected} onClick={onDelete}>{text("Delete", "删除")}</button>
    <button type="button" className="cd-tool" disabled={!count} onClick={onClear}>{text("Clear", "清除")}</button>
    <span className="cd-hint">{tool
      ? text("Drag on the chart (or click two points) · Esc to cancel", "在图上拖动画线（或点两下）· Esc 取消")
      : count ? text("Click a line to select; drag its handles to adjust. Lines clear when you change stock or leave the page.", "点线条可选中，拖动端点可调整。换股票或离开页面后自动清除。") : text("Lines are temporary: they clear when you change stock or leave the page.", "画线为临时内容：换股票或离开页面后自动清除。")}</span>
  </div>;
}

type Props = {
  chart: IChartApi | null; series: ISeriesApi<SeriesType> | null; candles: CandlePoint[]; tick: number;
  drawings: Drawing[]; setDrawings: (update: (list: Drawing[]) => Drawing[]) => void;
  tool: DrawingTool | null; setTool: (tool: DrawingTool | null) => void; magnet: boolean;
  selectedId: string | null; setSelectedId: (id: string | null) => void;
};

/** SVG layer over the chart pane: renders drawings, captures pointer input while a tool is active. */
export function ChartDrawingLayer({ chart, series, candles, tick, drawings, setDrawings, tool, setTool, magnet, selectedId, setSelectedId }: Props) {
  const [draft, setDraft] = useState<Drawing | null>(null);
  const drag = useRef<{ id: string; index: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const clipId = `cd-clip-${useId().replace(/:/g, "")}`;
  void tick; // re-render when the chart scrolls / zooms / resizes

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDraft(null); setTool(null); setSelectedId(null); }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault(); setDrawings((list) => list.filter((item) => item.id !== selectedId)); setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, setDrawings, setSelectedId, setTool]);

  if (!chart || !series || !candles.length) return null;
  const scale = chart.timeScale();
  let pane: { width: number; height: number };
  try { pane = chart.paneSize(0); } catch { return null; }
  if (!pane.width || !pane.height) return null;
  const mapper = timeMapper(candles.map((candle) => candle.time));
  const toXY = (point: AnchorPoint) => {
    const x = scale.logicalToCoordinate(mapper.toLogical(point.time) as Logical);
    const y = series.priceToCoordinate(point.price);
    return x == null || y == null ? null : { x, y };
  };
  const toPoint = (x: number, y: number): AnchorPoint | null => {
    const logical = scale.coordinateToLogical(x);
    const raw = series.coordinateToPrice(y);
    if (logical == null || raw == null) return null;
    const bar = candles[Math.round(logical)];
    const price = magnet ? snapPrice(raw, bar, (value) => series.priceToCoordinate(value), y) : raw;
    // Snap time to the bar under the pointer inside the data; free-floating past the ends.
    const time = logical >= 0 && logical <= candles.length - 1 ? candles[Math.round(logical)].time : mapper.toTime(logical);
    return { time, price };
  };
  const local = (event: ReactPointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  function down(event: ReactPointerEvent<SVGSVGElement>) {
    if (!tool) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const { x, y } = local(event);
    const point = toPoint(x, y);
    if (!point) return;
    if (TOOL_POINTS[tool] === 1) { commit({ id: crypto.randomUUID(), tool, points: [point] }); return; }
    if (draft) { commit({ ...draft, points: [draft.points[0], point] }); return; } // second click
    start.current = { x, y };
    setDraft({ id: crypto.randomUUID(), tool, points: [point, point] });
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const { x, y } = local(event);
    if (drag.current) {
      const point = toPoint(x, y);
      const { id, index } = drag.current;
      if (point) setDrawings((list) => list.map((item) => item.id === id ? { ...item, points: item.points.map((old, at) => (at === index ? point : old)) } : item));
      return;
    }
    if (draft) { const point = toPoint(x, y); if (point) setDraft({ ...draft, points: [draft.points[0], point] }); }
  }
  function up(event: ReactPointerEvent<SVGSVGElement>) {
    if (drag.current) { drag.current = null; return; }
    if (!draft || !start.current) return;
    const { x, y } = local(event);
    const moved = Math.hypot(x - start.current.x, y - start.current.y) > 6;
    start.current = null;
    if (moved) commit(draft); // drag-to-draw; otherwise wait for the second click
  }
  function commit(drawing: Drawing) {
    setDrawings((list) => [...list, drawing]);
    setDraft(null);
    setSelectedId(drawing.id);
    setTool(null);
  }

  const width = pane.width, height = pane.height;
  const render = (drawing: Drawing, isDraft: boolean) => {
    const selected = !isDraft && drawing.id === selectedId;
    const className = `cd-shape${selected ? " is-selected" : ""}${isDraft ? " is-draft" : ""}`;
    const pick = isDraft ? undefined : (event: ReactPointerEvent) => { if (tool) return; event.stopPropagation(); setSelectedId(drawing.id); };
    const [a, b] = drawing.points.map(toXY);
    if (!a) return null;
    const handles = selected ? drawing.points.map((_, index) => { const at = toXY(drawing.points[index]); return at ? <circle key={index} className="cd-handle" cx={at.x} cy={at.y} r={5} onPointerDown={(event) => { event.stopPropagation(); (event.target as Element).setPointerCapture?.(event.pointerId); drag.current = { id: drawing.id, index }; }} /> : null; }) : null;
    const line = (x1: number, y1: number, x2: number, y2: number, key?: string | number) => <g key={key}><line className="cd-hit" x1={x1} y1={y1} x2={x2} y2={y2} onPointerDown={pick} /><line className="cd-line" x1={x1} y1={y1} x2={x2} y2={y2} /></g>;
    let body: ReactNode = null;
    if (drawing.tool === "hline") {
      body = <>{line(0, a.y, width, a.y)}<text className="cd-label" x={width - 4} y={a.y - 4} textAnchor="end">{drawing.points[0].price.toFixed(2)}</text></>;
    } else if (b && drawing.tool === "trend") {
      body = line(a.x, a.y, b.x, b.y);
    } else if (b && drawing.tool === "ray") {
      const dx = b.x - a.x, dy = b.y - a.y;
      const k = dx === 0 ? 0 : (dx > 0 ? width - a.x : -a.x) / dx;
      body = line(a.x, a.y, dx === 0 ? b.x : a.x + dx * k, dx === 0 ? (dy > 0 ? height : 0) : a.y + dy * k);
    } else if (b && drawing.tool === "rect") {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      body = <rect className="cd-rect" x={x} y={y} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} onPointerDown={pick} />;
    } else if (b && drawing.tool === "fib") {
      const left = Math.min(a.x, b.x);
      body = <>{fibLevels(drawing.points[0].price, drawing.points[1].price).map(({ level, price }) => {
        const y = series.priceToCoordinate(price);
        if (y == null) return null;
        return <g key={level}>{line(left, y, width, y, level)}<text className="cd-label" x={left + 4} y={y - 3}>{`${(level * 100).toFixed(1)}%  ${price.toFixed(2)}`}</text></g>;
      })}<line className="cd-guide" x1={a.x} y1={a.y} x2={b.x} y2={b.y} /></>;
    }
    return <g key={drawing.id}>{body}{handles}</g>;
  };

  return <svg ref={svg} className={`cd-layer${tool ? " is-drawing" : ""}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
    onPointerDown={(event) => { if (tool) down(event); }} onPointerMove={move} onPointerUp={up}>
    <defs><clipPath id={clipId}><rect x={0} y={0} width={width} height={height} /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>{drawings.map((drawing) => render(drawing, false))}{draft && render(draft, true)}</g>
  </svg>;
}
