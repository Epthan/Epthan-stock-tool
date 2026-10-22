"use client";

import { useEffect, useState } from "react";
import { TTL, fetchCached } from "@/lib/client-cache";
import { useStoredWatchlists } from "@/hooks/use-stored-watchlists";
import { useLanguage } from "@/components/language-provider";
import { StockChart, type ChartStyle } from "@/components/stock-chart";
import {
  mockCandles,
  movingAverageLabels,
  timeframeLabels,
  type CandlePoint,
  type MovingAverageKey,
  type TimeframeKey,
  type WatchlistRow,
} from "@/lib/mock-market";
import { createDefaultWatchlists } from "@/lib/watchlists";

type CandleResponse = {
  symbol: string;
  candles: CandlePoint[];
  message: string;
};

type QuoteResponse = {
  quote: WatchlistRow;
};

type ChartMode = "auto" | ChartStyle;

function getRecommendedChartStyle(timeframe: TimeframeKey): ChartStyle {
  return timeframe === "1D" || timeframe === "2D" ? "line" : "candles";
}

function formatPrice(value?: number) {
  if (typeof value !== "number") {
    return "--";
  }

  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type CompareCardProps = {
  chartStyle: ChartStyle;
  movingAverages: MovingAverageKey[];
  onTimeframeChange: (timeframe: TimeframeKey) => void;
  symbol: string;
  timeframe: TimeframeKey;
};

function CompareCard({ chartStyle, movingAverages, onTimeframeChange, symbol, timeframe }: CompareCardProps) {
  const { messages } = useLanguage();
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [quote, setQuote] = useState<WatchlistRow | null>(null);
  const [message, setMessage] = useState(messages.compare.loadingMessage);

  useEffect(() => {
    let ignore = false;

    async function loadCard() {
      try {
        const intraday = ["1D", "2D", "5D", "1W"].includes(timeframe);
        const [quotePayload, candlePayload] = await Promise.all([
          fetchCached<QuoteResponse>(`quote:${symbol}`, `/api/market/quote?symbol=${encodeURIComponent(symbol)}`, TTL.quote).catch(() => ({} as QuoteResponse)),
          fetchCached<CandleResponse>(`candles:${symbol}:${timeframe}`, `/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`, intraday ? TTL.intraday : TTL.daily),
        ]);

        if (!ignore) {
          setQuote(quotePayload.quote ?? null);
          setCandles(candlePayload.candles ?? mockCandles);
          setMessage(candlePayload.message ?? "Loaded");
        }
      } catch {
        if (!ignore) {
          setQuote(null);
          setCandles(mockCandles);
          setMessage("Failed to load comparison data.");
        }
      }
    }

    loadCard();

    return () => {
      ignore = true;
    };
  }, [symbol, timeframe]);

  return (
    <article className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{symbol}</p>
            {quote ? (
              <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {quote.market} · {quote.exchange || "--"} · {quote.currency || "--"}
              </p>
            ) : null}
            <p className="mt-2 text-2xl font-semibold text-white">{formatPrice(quote?.price)}</p>
            <p className="mt-1 text-sm text-slate-400">{quote?.name ?? messages.compare.loadingQuote}</p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
            {timeframe}
          </div>
        </div>
        <div>
          <StockChart
            candles={candles}
            chartStyle={chartStyle}
            movingAverages={movingAverages}
            onTimeframeChange={onTimeframeChange}
            timeframe={timeframe}
          />
        </div>
        <p className="text-xs text-slate-400">{message}</p>
      </div>
    </article>
  );
}

export function CompareView() {
  const { messages } = useLanguage();
  const { watchlists, activeWatchlistId, setActiveWatchlistId } = useStoredWatchlists();
  const [activeTimeframe, setActiveTimeframe] = useState<TimeframeKey>("6M");
  const [enabledMovingAverages, setEnabledMovingAverages] = useState<MovingAverageKey[]>([20, 50]);
  const [chartMode, setChartMode] = useState<ChartMode>("auto");
  const activeWatchlist =
    watchlists.find((item) => item.id === activeWatchlistId) ?? watchlists[0] ?? createDefaultWatchlists()[0];
  const symbols = activeWatchlist.symbols;
  const resolvedChartStyle = chartMode === "auto" ? getRecommendedChartStyle(activeTimeframe) : chartMode;

  function toggleMovingAverage(period: MovingAverageKey) {
    setEnabledMovingAverages((current) =>
      current.includes(period) ? current.filter((item) => item !== period) : [...current, period],
    );
  }

  function handleChartTimeframeChange(nextTimeframe: TimeframeKey) {
    if (nextTimeframe === activeTimeframe) {
      return;
    }

    setActiveTimeframe(nextTimeframe);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.14),_transparent_24%),linear-gradient(180deg,#020617_0%,#071224_42%,#020617_100%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-6">
        <section className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.28em] text-teal-300">{messages.compare.eyebrow}</p>
              <h1 className="mt-3 text-3xl font-semibold text-white">{messages.compare.title}</h1>
              <p className="mt-2 text-sm text-slate-300">{messages.compare.description}</p>
            </div>
            <div className="flex flex-col gap-3">
              <select
                value={activeWatchlistId}
                onChange={(event) => setActiveWatchlistId(event.target.value)}
                className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none"
              >
                {watchlists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2 text-xs">
                {timeframeLabels.map((timeframe) => (
                  <button
                    key={timeframe}
                    type="button"
                    onClick={() => setActiveTimeframe(timeframe)}
                    className={`rounded-full px-3 py-1.5 ${
                      timeframe === activeTimeframe ? "bg-white text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    {timeframe}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {(["auto", "line", "candles"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setChartMode(mode)}
                    className={`rounded-full px-3 py-1.5 ${
                      chartMode === mode
                        ? "bg-sky-400/20 text-sky-200 ring-1 ring-sky-300/30"
                        : "bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    {mode === "auto"
                      ? getRecommendedChartStyle(activeTimeframe) === "line"
                        ? messages.chart.autoLine
                        : messages.chart.autoCandles
                      : mode === "line"
                        ? messages.chart.line
                        : messages.chart.candles}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {movingAverageLabels.map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => toggleMovingAverage(period)}
                    className={`rounded-full px-3 py-1.5 ${
                      enabledMovingAverages.includes(period)
                        ? "bg-teal-400/20 text-teal-200 ring-1 ring-teal-300/30"
                        : "bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    MA {period}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-300 backdrop-blur">
          {messages.compare.currentWatchlist}: <span className="font-semibold text-white">{activeWatchlist.name}</span>
          {" · "}
          {symbols.length} symbols
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          {symbols.map((symbol) => (
            <CompareCard
              key={`${activeWatchlist.id}-${symbol}`}
              chartStyle={resolvedChartStyle}
              symbol={symbol}
              timeframe={activeTimeframe}
              movingAverages={enabledMovingAverages}
              onTimeframeChange={handleChartTimeframeChange}
            />
          ))}
          {symbols.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-white/5 p-8 text-sm text-slate-400">
              {messages.compare.empty}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
