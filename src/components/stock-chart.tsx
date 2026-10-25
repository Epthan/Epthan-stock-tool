"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChartDrawingLayer, ChartDrawingToolbar } from "@/components/chart-drawings";
import type { Drawing, DrawingTool } from "@/lib/chart-drawing";
import { useTheme } from "@/components/theme-provider";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type SeriesType,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import { timeframeLabels, type CandlePoint, type MovingAverageKey, type TimeframeKey } from "@/lib/mock-market";

export type ChartStyle = "line" | "candles";
export type StockChartHandle = {
  captureSnapshot: () => string | null;
};

type StockChartProps = {
  candles: CandlePoint[];
  chartStyle: ChartStyle;
  heightClassName?: string;
  movingAverages: MovingAverageKey[];
  onTimeframeChange?: (timeframe: TimeframeKey) => void;
  timeframe?: TimeframeKey;
  /** Show the drawing toolbar. Drawings live in memory only and are cleared when `drawingKey` changes or the chart unmounts. */
  drawable?: boolean;
  drawingKey?: string;
  zh?: boolean;
};

type MovingAveragePoint = {
  time: UTCTimestamp;
  value: number;
};

// Fixed MA colours (not theme tokens) so a given average looks the same in every skin and in the legend.
const movingAverageColors: Record<MovingAverageKey, string> = {
  5: "#f59e0b",
  10: "#22c55e",
  20: "#38bdf8",
  50: "#a78bfa",
  200: "#f472b6",
};

// lightweight-charts takes rgba() strings; theme tokens are hex.
function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return hex;
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

// Running-sum SMA of closes; null until `period` bars are available.
function calculateMovingAverage(candles: CandlePoint[], period: MovingAverageKey) {
  let sum = 0;

  return candles.map((candle, index) => {
    sum += candle.close;

    if (index >= period) {
      sum -= candles[index - period].close;
    }

    if (index < period - 1) {
      return null;
    }

    return {
      time: candle.time as UTCTimestamp,
      value: Number((sum / period).toFixed(2)),
    };
  });
}

function isMovingAveragePoint(point: MovingAveragePoint | null): point is MovingAveragePoint {
  return point !== null;
}

// Wheel zoom past the data steps to the neighbouring range (6M → 3M when zooming in, → 1Y when zooming out).
function getNextTimeframe(timeframe: TimeframeKey, direction: "in" | "out") {
  const index = timeframeLabels.indexOf(timeframe);

  if (index === -1) {
    return timeframe;
  }

  if (direction === "in") {
    return timeframeLabels[Math.max(0, index - 1)];
  }

  return timeframeLabels[Math.min(timeframeLabels.length - 1, index + 1)];
}

function captureChartSnapshot(chart: IChartApi | null) {
  if (!chart) {
    return null;
  }

  return chart.takeScreenshot(false, true).toDataURL("image/png");
}

export const StockChart = forwardRef<StockChartHandle, StockChartProps>(function StockChart(
  { candles, chartStyle, heightClassName = "h-[320px]", movingAverages, onTimeframeChange, timeframe, drawable = false, drawingKey = "", zh = false }: StockChartProps,
  ref,
) {
  const { skin } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const lastSuggestedAtRef = useRef(0);
  const pendingZoomDirectionRef = useRef<"in" | "out" | null>(null);
  const pendingZoomExpiresAtRef = useRef(0);

  // ---- Drawings (temporary): kept across re-creation of the chart, reset when the key (symbol) changes ----
  const [api, setApi] = useState<{ chart: IChartApi; series: ISeriesApi<SeriesType> } | null>(null);
  const [tick, setTick] = useState(0);
  const frame = useRef(0);
  const bump = useCallback(() => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => setTick((value) => value + 1)); }, []);
  const [drawStore, setDrawStore] = useState<{ key: string; list: Drawing[] }>({ key: drawingKey, list: [] });
  // Drawings are tagged with the key they were made under; a different key simply reads as an empty list,
  // which clears them on a symbol change without an effect.
  const drawings = drawStore.key === drawingKey ? drawStore.list : [];
  const setDrawings = useCallback((update: (list: Drawing[]) => Drawing[]) => setDrawStore((current) => ({ key: drawingKey, list: update(current.key === drawingKey ? current.list : []) })), [drawingKey]);
  const [tool, setTool] = useState<DrawingTool | null>(null);
  const [magnet, setMagnet] = useState(true);
  const [selected, setSelected] = useState<{ key: string; id: string | null }>({ key: drawingKey, id: null });
  const selectedId = selected.key === drawingKey ? selected.id : null;
  const setSelectedId = useCallback((id: string | null) => setSelected({ key: drawingKey, id }), [drawingKey]);

  useImperativeHandle(ref, () => ({
    captureSnapshot: () => captureChartSnapshot(chartApiRef.current),
  }));

  // The chart is rebuilt from scratch whenever data, style, MAs or the skin change. That is cheap at these
  // sizes and avoids keeping series in sync by hand. Drawings survive because they live in React state.
  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    // Colours come from the active skin's CSS tokens (theme.css).
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const colors = {
      panel: token("--ui-panel", "#ffffff"), muted: token("--ui-muted", "#4a5462"), grid: token("--ui-grid", "#e1e6eb"),
      line: token("--ui-line", "#c5cdd5"), ink: token("--ui-chart-line", "#0e1620"), up: token("--ui-up", "#0b7a55"), down: token("--ui-down", "#c23a2b"),
    };
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: colors.panel },
        textColor: colors.muted,
        fontFamily: "var(--font-plex), system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: {
        vertLine: { color: colors.muted },
        horzLine: { color: colors.muted },
      },
      rightPriceScale: {
        borderColor: colors.line,
      },
      timeScale: {
        borderColor: colors.line,
      },
    });
    chartApiRef.current = chart;

    // Remember the wheel direction briefly so the range-change handler knows the user zoomed (vs. panned).
    const handleWheel = (event: WheelEvent) => {
      pendingZoomDirectionRef.current = event.deltaY < 0 ? "in" : "out";
      pendingZoomExpiresAtRef.current = Date.now() + 1200;
    };

    container.addEventListener("wheel", handleWheel, { passive: true });

    const priceSeries =
      chartStyle === "candles"
        ? chart.addSeries(CandlestickSeries, {
            upColor: colors.up,
            downColor: colors.down,
            borderVisible: false,
            wickUpColor: colors.up,
            wickDownColor: colors.down,
          })
        : chart.addSeries(LineSeries, {
            color: colors.ink,
            lineWidth: 2,
            crosshairMarkerRadius: 4,
            priceLineVisible: false,
          });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume",
      },
      // Empty id = overlay scale: volume sits in the bottom ~20% of the price pane.
      priceScaleId: "",
      color: colors.line,
    });

    if (chartStyle === "candles") {
      priceSeries.setData(
        candles.map((candle) => ({
          time: candle.time as UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })),
      );
    } else {
      priceSeries.setData(
        candles.map((candle) => ({
          time: candle.time as UTCTimestamp,
          value: candle.close,
        })),
      );
    }

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });

    volumeSeries.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color:
          withAlpha(candle.close >= candle.open ? colors.up : colors.down, 0.35),
      })),
    );

    movingAverages.forEach((period) => {
      const lineSeries = chart.addSeries(LineSeries, {
        color: movingAverageColors[period],
        lineWidth: period === 200 ? 2 : 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      lineSeries.setData(
        calculateMovingAverage(candles, period).filter(isMovingAveragePoint),
      );
    });

    const handleVisibleRangeChange = (range: LogicalRange | null) => {
      if (!range || !onTimeframeChange || !timeframe || candles.length < 10) {
        return;
      }

      const pendingDirection = pendingZoomDirectionRef.current;
      const pendingExpiresAt = pendingZoomExpiresAtRef.current;

      if (!pendingDirection || Date.now() > pendingExpiresAt) {
        pendingZoomDirectionRef.current = null;
        return;
      }

      const visibleBars = range.to - range.from;

      if (!Number.isFinite(visibleBars) || visibleBars <= 0) {
        return;
      }

      // Zoomed in to under ~60% of the bars, or out beyond the data: switch range.
      // The 900 ms guard stops one long wheel gesture from skipping several ranges.
      const ratio = visibleBars / candles.length;
      const now = Date.now();

      if (now - lastSuggestedAtRef.current < 900) {
        return;
      }

      if (pendingDirection === "in" && ratio < 0.62) {
        const nextTimeframe = getNextTimeframe(timeframe, pendingDirection);

        if (nextTimeframe !== timeframe) {
          lastSuggestedAtRef.current = now;
          pendingZoomDirectionRef.current = null;
          onTimeframeChange(nextTimeframe);
        }

        return;
      }

      if (pendingDirection === "out" && ratio > 1.18) {
        const nextTimeframe = getNextTimeframe(timeframe, pendingDirection);

        if (nextTimeframe !== timeframe) {
          lastSuggestedAtRef.current = now;
          pendingZoomDirectionRef.current = null;
          onTimeframeChange(nextTimeframe);
        }
      }
    };

    if (onTimeframeChange && timeframe) {
      chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    }

    chart.timeScale().fitContent();
    // Drawings follow the chart: re-render the overlay when it scrolls, zooms or resizes.
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    chart.timeScale().subscribeSizeChange(bump);
    container.addEventListener("pointermove", bump, { passive: true });
    container.addEventListener("wheel", bump, { passive: true });
    setApi({ chart, series: priceSeries });
    bump();

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bump);
      chart.timeScale().unsubscribeSizeChange(bump);
      container.removeEventListener("pointermove", bump);
      container.removeEventListener("wheel", bump);
      setApi(null);
      container.removeEventListener("wheel", handleWheel);
      if (onTimeframeChange && timeframe) {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      }
      chartApiRef.current = null;
      chart.remove();
    };
  }, [candles, chartStyle, movingAverages, onTimeframeChange, timeframe, skin, bump]);

  return (
    <div className="space-y-3">
      {drawable && <ChartDrawingToolbar zh={zh} tool={tool} setTool={setTool} magnet={magnet} setMagnet={setMagnet} count={drawings.length} selected={!!selectedId}
        onUndo={() => setDrawings((list) => list.slice(0, -1))} onDelete={() => { setDrawings((list) => list.filter((item) => item.id !== selectedId)); setSelectedId(null); }} onClear={() => { setDrawings(() => []); setSelectedId(null); }} />}
      <div className={`${heightClassName} w-full cd-host`} onPointerDown={drawable && !tool ? () => setSelectedId(null) : undefined}>
        <div ref={containerRef} className="h-full w-full" />
        {drawable && <ChartDrawingLayer chart={api?.chart ?? null} series={api?.series ?? null} candles={candles} tick={tick} drawings={drawings} setDrawings={setDrawings}
          tool={tool} setTool={setTool} magnet={magnet} selectedId={selectedId} setSelectedId={setSelectedId} />}
      </div>
      {movingAverages.length > 0 && (
        <div className="chart-ma-legend">
          {movingAverages.map((period) => <span key={period}><i style={{ background: movingAverageColors[period] }} />MA {period}</span>)}
        </div>
      )}
    </div>
  );
});
