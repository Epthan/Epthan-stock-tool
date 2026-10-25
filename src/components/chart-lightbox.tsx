"use client";

import { useRef, useState } from "react";
import { StockChart, type ChartStyle, type StockChartHandle } from "@/components/stock-chart";
import type { CandlePoint, MovingAverageKey, TimeframeKey } from "@/lib/mock-market";
import type { Locale } from "@/components/language-provider";

// Full-screen chart. Two modes: the live chart (with the same temporary drawing tools as the
// research page), and a snapshot editor where you scribble on a PNG of the chart and save it.
type Point = {
  x: number;
  y: number;
};

type Stroke = {
  id: string;
  color: string;
  points: Point[];
};

type CapturedSnapshot = {
  src: string;
  width: number;
  height: number;
};

type ToolMode = "draw" | "erase";

type ChartLightboxProps = {
  candles: CandlePoint[];
  chartStyle: ChartStyle;
  locale: Locale;
  movingAverages: MovingAverageKey[];
  onClose: () => void;
  onTimeframeChange?: (timeframe: TimeframeKey) => void;
  symbol: string;
  timeframe?: TimeframeKey;
};

// Pen colours chosen to read on both light and dark chart backgrounds. They end up baked into
// the exported PNG, so they are fixed values rather than theme tokens.
const strokeColors = ["#f8fafc", "#38bdf8", "#34d399", "#f59e0b", "#fb7185"];
const penCursor =
  'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path fill="%23f8fafc" d="M20.5 3.8a2.8 2.8 0 0 1 4 4L11.2 21.1l-5.4 1.3 1.3-5.4z"/><path fill="%2307111f" d="M7.5 20.5l2 2-3 .7z"/></svg>\') 4 24, crosshair';
const eraserCursor =
  'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path fill="%23e2e8f0" d="M8.8 17.8 16.6 10a2.5 2.5 0 0 1 3.5 0l3 3a2.5 2.5 0 0 1 0 3.5l-5.1 5.1H11z"/><path fill="%2394a3b8" d="M5 21h18v2H5z"/></svg>\') 6 22, cell';

function getText(locale: Locale) {
  if (locale === "zh") {
    return {
      title: "放大图表",
      subtitle: "先截图，再在静态图片上标注和保存",
      capture: "截图",
      newCapture: "重新截图",
      draw: "画笔",
      erase: "橡皮擦",
      clear: "清空标注",
      save: "保存图片",
      close: "关闭",
      chartHint: "先调整图表视图，然后点击“截图”进入编辑模式。",
      editorHint: "已进入截图编辑模式。拖动画线，或用橡皮擦删除线条。",
      backToChart: "返回图表",
      colors: "颜色",
      liveChart: "实时图表",
      snapshotEditor: "截图编辑",
    };
  }

  return {
    title: "Expanded Chart",
    subtitle: "Capture first, then annotate and save the static image",
    capture: "Capture",
    newCapture: "Recapture",
    draw: "Pen",
    erase: "Eraser",
    clear: "Clear",
    save: "Save Image",
    close: "Close",
    chartHint: "Adjust the chart view, then capture to enter image editing mode.",
    editorHint: "Snapshot editor is ready. Drag to draw, or erase strokes.",
    backToChart: "Back to Chart",
    colors: "Colors",
    liveChart: "Live Chart",
    snapshotEditor: "Snapshot Editor",
  };
}

function createStroke(color: string, point: Point): Stroke {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    color,
    points: [point],
  };
}

// The eraser removes whole strokes, not pixels: any stroke passing within `threshold` of the pointer.
function isPointNearStroke(point: Point, stroke: Stroke, threshold: number) {
  return stroke.points.some((strokePoint) => {
    const dx = strokePoint.x - point.x;
    const dy = strokePoint.y - point.y;
    return Math.hypot(dx, dy) <= threshold;
  });
}

export function ChartLightbox({
  candles,
  chartStyle,
  locale,
  movingAverages,
  onClose,
  onTimeframeChange,
  symbol,
  timeframe,
}: ChartLightboxProps) {
  const text = getText(locale);
  const chartRef = useRef<StockChartHandle | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const [capturedSnapshot, setCapturedSnapshot] = useState<CapturedSnapshot | null>(null);
  const [activeTool, setActiveTool] = useState<ToolMode>("draw");
  const [strokeColor, setStrokeColor] = useState(strokeColors[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);

  function resetEditor() {
    setStrokes([]);
    setDraftStroke(null);
    setActiveTool("draw");
  }

  function handleReturnToChart() {
    setCapturedSnapshot(null);
    resetEditor();
  }

  function handleCapture() {
    resetEditor();

    const nextImage = chartRef.current?.captureSnapshot() ?? null;

    if (!nextImage) {
      setCapturedSnapshot(null);
      return;
    }

    const previewImage = new window.Image();
    previewImage.onload = () => {
      setCapturedSnapshot({
        src: nextImage,
        width: previewImage.naturalWidth || previewImage.width,
        height: previewImage.naturalHeight || previewImage.height,
      });
    };
    previewImage.src = nextImage;
  }

  // Strokes are stored in image pixels, not screen pixels, so they line up in the saved PNG
  // whatever size the preview is shown at.
  function getPointFromEvent(clientX: number, clientY: number) {
    const container = imageContainerRef.current;

    if (!container || !capturedSnapshot) {
      return null;
    }

    const rect = container.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      point: {
        x: ((clientX - rect.left) / rect.width) * capturedSnapshot.width,
        y: ((clientY - rect.top) / rect.height) * capturedSnapshot.height,
      },
      scale: capturedSnapshot.width / rect.width,
    };
  }

  function eraseAt(clientX: number, clientY: number) {
    const resolved = getPointFromEvent(clientX, clientY);

    if (!resolved) {
      return;
    }

    // 16 screen pixels, converted to image pixels.
    const threshold = 16 * resolved.scale;
    setStrokes((current) => current.filter((stroke) => !isPointNearStroke(resolved.point, stroke, threshold)));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!capturedSnapshot) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    if (activeTool === "erase") {
      eraseAt(event.clientX, event.clientY);
      return;
    }

    const resolved = getPointFromEvent(event.clientX, event.clientY);

    if (!resolved) {
      return;
    }

    setDraftStroke(createStroke(strokeColor, resolved.point));
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!capturedSnapshot) {
      return;
    }

    if (activeTool === "erase") {
      if ((event.buttons & 1) === 1) {
        eraseAt(event.clientX, event.clientY);
      }
      return;
    }

    if (!draftStroke) {
      return;
    }

    const resolved = getPointFromEvent(event.clientX, event.clientY);

    if (!resolved) {
      return;
    }

    setDraftStroke((current) =>
      current
        ? {
            ...current,
            points: [...current.points, resolved.point],
          }
        : current,
    );
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!draftStroke) {
      return;
    }

    setStrokes((current) => [...current, draftStroke]);
    setDraftStroke(null);
  }

  // Redraw the snapshot and the strokes onto a canvas at the original resolution, then download it.
  async function handleSave() {
    if (!capturedSnapshot) {
      return;
    }

    const image = new window.Image();
    image.src = capturedSnapshot.src;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Snapshot image failed to load."));
    });

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = capturedSnapshot.width;
    outputCanvas.height = capturedSnapshot.height;
    const context = outputCanvas.getContext("2d");

    if (!context) {
      return;
    }

    context.drawImage(image, 0, 0);
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";

    [...strokes, ...(draftStroke ? [draftStroke] : [])].forEach((stroke) => {
      if (stroke.points.length === 0) {
        return;
      }

      context.strokeStyle = stroke.color;
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);

      stroke.points.slice(1).forEach((point) => {
        context.lineTo(point.x, point.y);
      });

      if (stroke.points.length === 1) {
        context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y + 0.01);
      }

      context.stroke();
    });

    const link = document.createElement("a");
    link.href = outputCanvas.toDataURL("image/png");
    link.download = `${symbol.toLowerCase()}-${timeframe?.toLowerCase() ?? "chart"}-snapshot.png`;
    link.click();
  }

  const renderedStrokes = [...strokes, ...(draftStroke ? [draftStroke] : [])];
  const editorCursor = activeTool === "draw" ? penCursor : eraserCursor;

  return (
    <div className="fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--ui-bg)_90%,transparent)] ">
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6">
          <div className="flex flex-col gap-4 rounded-[14px] border border-[var(--ui-line)] bg-[var(--ui-panel)] p-5 shadow-[var(--ui-overlay)] lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm text-[var(--ui-accent)]">{symbol}</p>
              <h2 className="mt-3 text-2xl font-semibold text-[var(--ui-ink)]">{text.title}</h2>
              <p className="mt-2 text-sm text-[var(--ui-ink-2)]">{text.subtitle}</p>
              <p className="mt-2 text-xs text-[var(--ui-muted)]">{capturedSnapshot ? text.editorHint : text.chartHint}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {capturedSnapshot ? (
                <>
                  <button
                    type="button"
                    onClick={handleReturnToChart}
                    className="rounded-full bg-[var(--ui-panel-2)] px-4 py-2 text-sm text-[var(--ui-ink-2)] transition hover:bg-[var(--ui-seg)]"
                  >
                    {text.backToChart}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetEditor();
                      setCapturedSnapshot(null);
                    }}
                    className="rounded-full bg-[var(--ui-accent)] px-4 py-2 text-sm font-semibold text-[var(--ui-on-accent)] transition hover:bg-[var(--ui-accent-hover)]"
                  >
                    {text.newCapture}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool("draw")}
                    className={`rounded-full px-4 py-2 text-sm transition ${ activeTool === "draw" ? "bg-[var(--ui-accent-soft)] text-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)]" : "bg-[var(--ui-panel-2)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-seg)]" }`}
                  >
                    {text.draw}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool("erase")}
                    className={`rounded-full px-4 py-2 text-sm transition ${ activeTool === "erase" ? "bg-[var(--ui-panel-2)] text-[var(--ui-warn)] ring-1 ring-[var(--ui-warn)]" : "bg-[var(--ui-panel-2)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-seg)]" }`}
                  >
                    {text.erase}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStrokes([]);
                      setDraftStroke(null);
                    }}
                    className="rounded-full bg-[var(--ui-panel-2)] px-4 py-2 text-sm text-[var(--ui-ink-2)] transition hover:bg-[var(--ui-seg)]"
                  >
                    {text.clear}
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="rounded-full bg-[var(--ui-panel-2)] px-4 py-2 text-sm text-[var(--ui-ink-2)] transition hover:bg-[var(--ui-seg)]"
                  >
                    {text.save}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleCapture}
                  className="rounded-full bg-[var(--ui-accent)] px-4 py-2 text-sm font-semibold text-[var(--ui-on-accent)] transition hover:bg-[var(--ui-accent-hover)]"
                >
                  {text.capture}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[var(--ui-panel-2)] px-4 py-2 text-sm text-[var(--ui-ink-2)] transition hover:bg-[var(--ui-seg)]"
              >
                {text.close}
              </button>
            </div>
          </div>

          <div className="rounded-[14px] border border-[var(--ui-line)] bg-[var(--ui-panel)] p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-[var(--ui-faint)]">
                  {capturedSnapshot ? text.snapshotEditor : text.liveChart}
                </p>
                <p className="mt-2 text-sm text-[var(--ui-ink-2)]">{capturedSnapshot ? text.editorHint : text.chartHint}</p>
              </div>
              {capturedSnapshot ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--ui-faint)]">{text.colors}</span>
                  {strokeColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`${text.colors} ${color}`}
                      onClick={() => {
                        setStrokeColor(color);
                        setActiveTool("draw");
                      }}
                      className={`h-8 w-8 rounded-full border transition ${ strokeColor === color ? "border-[var(--ui-ink)] scale-105" : "border-[var(--ui-line)]" }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            {capturedSnapshot ? (
              <div
                ref={imageContainerRef}
                className="relative overflow-hidden rounded-[14px] border border-[var(--ui-line)] bg-[var(--ui-panel-2)]"
                style={{ cursor: editorCursor }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturedSnapshot.src} alt={`${symbol} snapshot`} className="block h-auto w-full select-none" draggable={false} />
                <svg
                  viewBox={`0 0 ${capturedSnapshot.width} ${capturedSnapshot.height}`}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  preserveAspectRatio="none"
                >
                  {renderedStrokes.map((stroke) =>
                    stroke.points.length > 0 ? (
                      <polyline
                        key={stroke.id}
                        points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke={stroke.color}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null,
                  )}
                </svg>
              </div>
            ) : (
              <StockChart
                ref={chartRef}
                candles={candles}
                chartStyle={chartStyle}
                heightClassName="h-[420px] sm:h-[520px] xl:h-[680px]"
                movingAverages={movingAverages}
                onTimeframeChange={onTimeframeChange}
                timeframe={timeframe}
                drawable
                drawingKey={symbol}
                zh={locale === "zh"}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
