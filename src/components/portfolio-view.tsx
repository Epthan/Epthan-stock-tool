"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/language-provider";

type TradeSide = "buy" | "sell";
type PortfolioTimeframe = "1M" | "3M" | "6M" | "1Y" | "MAX";

type TradeRecord = {
  id: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  tradedAt: string;
  note: string;
};

type QuoteRow = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  trend: "up" | "down";
};

type DashboardResponse = {
  watchlist: QuoteRow[];
};

type PositionRow = {
  symbol: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
};

type PortfolioPoint = {
  date: string;
  equity: number;
};

const storageKey = "stock-tool.portfolio-trades.v1";
const timeframeOptions: PortfolioTimeframe[] = ["1M", "3M", "6M", "1Y", "MAX"];

function createTradeId() {
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatMoney(value: number | null) {
  if (value === null) {
    return "--";
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatSignedMoney(value: number | null) {
  if (value === null) {
    return "--";
  }

  return `${value >= 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;
}

function formatDate(value: string, locale: "en" | "zh") {
  const date = new Date(value);
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function filterByTimeframe<T extends { tradedAt?: string; date?: string }>(
  items: T[],
  timeframe: PortfolioTimeframe,
) {
  if (timeframe === "MAX") {
    return items;
  }

  const now = new Date();
  const start = new Date(now);

  switch (timeframe) {
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1Y":
      start.setFullYear(start.getFullYear() - 1);
      break;
  }

  return items.filter((item) => {
    const value = item.tradedAt ?? item.date;
    return value ? new Date(value) >= start : true;
  });
}

function buildEquityCurve(trades: TradeRecord[], quotesBySymbol: Map<string, QuoteRow>) {
  const sortedTrades = [...trades].sort(
    (left, right) => new Date(left.tradedAt).getTime() - new Date(right.tradedAt).getTime(),
  );
  const state = new Map<string, { quantity: number; averageCost: number }>();
  const curve: PortfolioPoint[] = [];

  for (const trade of sortedTrades) {
    const current = state.get(trade.symbol) ?? { quantity: 0, averageCost: 0 };

    if (trade.side === "buy") {
      const nextQuantity = current.quantity + trade.quantity;
      const nextCost =
        nextQuantity === 0
          ? 0
          : (current.quantity * current.averageCost + trade.quantity * trade.price) / nextQuantity;
      state.set(trade.symbol, { quantity: nextQuantity, averageCost: nextCost });
    } else {
      const nextQuantity = Math.max(0, current.quantity - trade.quantity);
      state.set(trade.symbol, {
        quantity: nextQuantity,
        averageCost: nextQuantity === 0 ? 0 : current.averageCost,
      });
    }

    let equity = 0;
    state.forEach((position, symbol) => {
      const marketPrice = quotesBySymbol.get(symbol)?.price ?? position.averageCost;
      equity += position.quantity * marketPrice;
    });

    curve.push({
      date: trade.tradedAt,
      equity,
    });
  }

  return curve;
}

function EquityLineChart({
  emptyMessage,
  locale,
  points,
}: {
  emptyMessage: string;
  locale: "en" | "zh";
  points: PortfolioPoint[];
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-slate-950/30 px-6 text-center sm:h-[280px]">
        <p className="text-sm font-medium text-slate-300">{emptyMessage}</p>
        <p className="mt-2 text-xs text-slate-500">
          {locale === "zh"
            ? "先记录一笔交易，或者切换到包含交易的时间范围。"
            : "Add a trade first, or switch to a timeframe that includes your trades."}
        </p>
      </div>
    );
  }

  const width = 960;
  const height = 280;
  const paddingX = 24;
  const paddingY = 20;
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = points.length > 1 ? (width - paddingX * 2) / (points.length - 1) : 0;

  const path = points
    .map((point, index) => {
      const x = paddingX + index * step;
      const y = height - paddingY - ((point.equity - min) / range) * (height - paddingY * 2);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");

  const areaPath = `${path} L ${paddingX + (points.length - 1) * step} ${height - paddingY} L ${paddingX} ${height - paddingY} Z`;
  const lastPoint = points[points.length - 1];
  const lastX = paddingX + (points.length - 1) * step;
  const lastY = height - paddingY - ((lastPoint.equity - min) / range) * (height - paddingY * 2);

  return (
    <div className="rounded-[24px] border border-white/8 bg-[#07111f] p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full sm:h-[280px]">
        <defs>
          <linearGradient id="portfolio-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(45,212,191,0.35)" />
            <stop offset="100%" stopColor="rgba(45,212,191,0.04)" />
          </linearGradient>
        </defs>
        <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} stroke="rgba(255,255,255,0.08)" />
        <path d={areaPath} fill="url(#portfolio-area)" />
        <path d={path} fill="none" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastX} cy={lastY} r="4" fill="#99f6e4" />
        <text x={paddingX} y={18} fill="#94a3b8" fontSize="11">
          {formatMoney(max)}
        </text>
        <text x={paddingX} y={height - 6} fill="#94a3b8" fontSize="11">
          {formatDate(points[0].date, locale)}
        </text>
        <text x={width - paddingX} y={height - 6} fill="#94a3b8" fontSize="11" textAnchor="end">
          {formatDate(lastPoint.date, locale)}
        </text>
      </svg>
    </div>
  );
}

export function PortfolioView() {
  const { locale } = useLanguage();
  const [trades, setTrades] = useState<TradeRecord[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const candidate = item as Partial<TradeRecord>;
          if (
            typeof candidate.id !== "string" ||
            typeof candidate.symbol !== "string" ||
            (candidate.side !== "buy" && candidate.side !== "sell") ||
            typeof candidate.quantity !== "number" ||
            typeof candidate.price !== "number" ||
            typeof candidate.tradedAt !== "string"
          ) {
            return null;
          }

          return {
            id: candidate.id,
            symbol: candidate.symbol.toUpperCase(),
            side: candidate.side,
            quantity: candidate.quantity,
            price: candidate.price,
            tradedAt: candidate.tradedAt,
            note: typeof candidate.note === "string" ? candidate.note : "",
          } satisfies TradeRecord;
        })
        .filter(Boolean) as TradeRecord[];
    } catch {
      return [];
    }
  });
  const [timeframe, setTimeframe] = useState<PortfolioTimeframe>("6M");
  const [fetchedQuotesBySymbol, setFetchedQuotesBySymbol] = useState<Map<string, QuoteRow>>(new Map());
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const [form, setForm] = useState({
    symbol: "",
    side: "buy" as TradeSide,
    quantity: "",
    price: "",
    tradedAt: new Date().toISOString().slice(0, 10),
    note: "",
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(trades));
  }, [trades]);

  const uniqueSymbols = useMemo(
    () => Array.from(new Set(trades.map((trade) => trade.symbol))).sort(),
    [trades],
  );

  const quotesBySymbol = useMemo(() => {
    if (uniqueSymbols.length === 0) {
      return new Map<string, QuoteRow>();
    }

    return fetchedQuotesBySymbol;
  }, [fetchedQuotesBySymbol, uniqueSymbols.length]);

  useEffect(() => {
    if (uniqueSymbols.length === 0) {
      return;
    }

    let ignore = false;

    async function loadQuotes() {
      try {
        setIsLoadingQuotes(true);
        const response = await fetch(
          `/api/market/dashboard?symbols=${encodeURIComponent(uniqueSymbols.join(","))}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as DashboardResponse;

        if (!ignore) {
          setFetchedQuotesBySymbol(
            new Map((payload.watchlist ?? []).map((quote) => [quote.symbol, quote])),
          );
        }
      } catch {
        if (!ignore) {
          setFetchedQuotesBySymbol(new Map());
        }
      } finally {
        if (!ignore) {
          setIsLoadingQuotes(false);
        }
      }
    }

    loadQuotes();

    return () => {
      ignore = true;
    };
  }, [uniqueSymbols]);

  const portfolio = useMemo(() => {
    const positions = new Map<string, { quantity: number; averageCost: number }>();
    let realizedPnl = 0;

    [...trades]
      .sort((left, right) => new Date(left.tradedAt).getTime() - new Date(right.tradedAt).getTime())
      .forEach((trade) => {
        const current = positions.get(trade.symbol) ?? { quantity: 0, averageCost: 0 };

        if (trade.side === "buy") {
          const nextQuantity = current.quantity + trade.quantity;
          const nextAverageCost =
            nextQuantity === 0
              ? 0
              : (current.quantity * current.averageCost + trade.quantity * trade.price) / nextQuantity;
          positions.set(trade.symbol, { quantity: nextQuantity, averageCost: nextAverageCost });
          return;
        }

        const sellQuantity = Math.min(trade.quantity, current.quantity);
        realizedPnl += (trade.price - current.averageCost) * sellQuantity;
        const nextQuantity = Math.max(0, current.quantity - trade.quantity);
        positions.set(trade.symbol, {
          quantity: nextQuantity,
          averageCost: nextQuantity === 0 ? 0 : current.averageCost,
        });
      });

    const rows: PositionRow[] = Array.from(positions.entries())
      .filter(([, position]) => position.quantity > 0)
      .map(([symbol, position]) => {
        const marketPrice = quotesBySymbol.get(symbol)?.price ?? null;
        const costBasis = position.quantity * position.averageCost;
        const marketValue = marketPrice === null ? null : position.quantity * marketPrice;
        const unrealizedPnl = marketValue === null ? null : marketValue - costBasis;

        return {
          symbol,
          quantity: position.quantity,
          averageCost: position.averageCost,
          costBasis,
          marketPrice,
          marketValue,
          unrealizedPnl,
        };
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol));

    const unrealizedPnl = rows.reduce((sum, row) => sum + (row.unrealizedPnl ?? 0), 0);
    const marketValue = rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
    const costBasis = rows.reduce((sum, row) => sum + row.costBasis, 0);

    return {
      positions: rows,
      realizedPnl,
      unrealizedPnl,
      marketValue,
      costBasis,
    };
  }, [quotesBySymbol, trades]);

  const filteredTrades = useMemo(
    () =>
      [...filterByTimeframe(trades, timeframe)].sort(
        (left, right) => new Date(right.tradedAt).getTime() - new Date(left.tradedAt).getTime(),
      ),
    [timeframe, trades],
  );

  const equityCurve = useMemo(
    () => filterByTimeframe(buildEquityCurve(trades, quotesBySymbol), timeframe),
    [quotesBySymbol, timeframe, trades],
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const symbol = form.symbol.trim().toUpperCase();
    const quantity = Number(form.quantity);
    const price = Number(form.price);

    if (!symbol || quantity <= 0 || price <= 0 || !form.tradedAt) {
      return;
    }

    setTrades((current) => [
      ...current,
      {
        id: createTradeId(),
        symbol,
        side: form.side,
        quantity,
        price,
        tradedAt: new Date(form.tradedAt).toISOString(),
        note: form.note.trim(),
      },
    ]);

    setForm((current) => ({
      ...current,
      symbol: "",
      quantity: "",
      price: "",
      note: "",
    }));
  }

  function removeTrade(id: string) {
    setTrades((current) => current.filter((trade) => trade.id !== id));
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.14),_transparent_24%),linear-gradient(180deg,#020617_0%,#071224_42%,#020617_100%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-6">
        <section className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.28em] text-teal-300">
                {locale === "zh" ? "Portfolio" : "Portfolio"}
              </p>
              <h1 className="mt-3 text-3xl font-semibold text-white">
                {locale === "zh" ? "交易记录与持仓" : "Trade Log & Holdings"}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
                {locale === "zh"
                  ? "数据保存在当前浏览器本地。已实现盈亏按平均成本法计算，未实现盈亏按最新市场价格估值。"
                  : "Data stays in this browser only. Realized P&L uses average cost, and unrealized P&L is marked to the latest market price."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[560px]">
              <div className="rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {locale === "zh" ? "未实现盈亏" : "Unrealized P&L"}
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {formatSignedMoney(portfolio.unrealizedPnl)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {locale === "zh" ? "已实现盈亏" : "Realized P&L"}
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {formatSignedMoney(portfolio.realizedPnl)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {locale === "zh" ? "当前市值" : "Market Value"}
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {formatMoney(portfolio.marketValue)}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
            <p className="text-sm font-semibold text-white">
              {locale === "zh" ? "新增交易" : "Add Trade"}
            </p>
            <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={form.symbol}
                  onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))}
                  placeholder={locale === "zh" ? "股票代码" : "Symbol"}
                  className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                />
                <select
                  value={form.side}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, side: event.target.value as TradeSide }))
                  }
                  className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="buy">{locale === "zh" ? "买入" : "Buy"}</option>
                  <option value="sell">{locale === "zh" ? "卖出" : "Sell"}</option>
                </select>
                <input
                  value={form.quantity}
                  onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                  placeholder={locale === "zh" ? "数量" : "Quantity"}
                  inputMode="decimal"
                  className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                />
                <input
                  value={form.price}
                  onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  placeholder={locale === "zh" ? "成交价" : "Price"}
                  inputMode="decimal"
                  className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                />
              </div>
              <input
                type="date"
                value={form.tradedAt}
                onChange={(event) => setForm((current) => ({ ...current, tradedAt: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                placeholder={locale === "zh" ? "备注（可选）" : "Note (optional)"}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <button
                type="submit"
                className="w-full rounded-full bg-teal-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-200 sm:w-auto"
              >
                {locale === "zh" ? "记录交易" : "Save Trade"}
              </button>
            </form>

            <div className="mt-6">
              <p className="text-sm font-semibold text-white">
                {locale === "zh" ? "当前持仓" : "Open Positions"}
              </p>
              <div className="mt-3 space-y-2">
                {portfolio.positions.length > 0 ? (
                  portfolio.positions.map((position) => (
                    <article key={position.symbol} className="rounded-2xl bg-slate-950/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{position.symbol}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {locale === "zh" ? "数量" : "Qty"} {position.quantity} ·
                            {" "}
                            {locale === "zh" ? "成本" : "Avg Cost"} {formatMoney(position.averageCost)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-white">
                            {formatMoney(position.marketValue)}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {formatSignedMoney(position.unrealizedPnl)}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 px-4 py-6 text-sm text-slate-400">
                    {locale === "zh" ? "还没有持仓，先记录第一笔交易吧。" : "No open positions yet. Add your first trade to get started."}
                  </div>
                )}
              </div>
            </div>
          </aside>

          <section className="space-y-6">
            <div className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {locale === "zh" ? "权益曲线" : "Equity Curve"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {locale === "zh"
                      ? "按当前持仓市值重估的本地权益曲线。"
                      : "Local equity curve marked to current prices."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {timeframeOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTimeframe(option)}
                      className={`rounded-full px-3 py-1.5 ${
                        option === timeframe ? "bg-white text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                <EquityLineChart
                  emptyMessage={
                    locale === "zh"
                      ? "当前时间范围内还没有可绘制的权益曲线"
                      : "No equity curve is available for this timeframe yet"
                  }
                  locale={locale}
                  points={equityCurve}
                />
              </div>
            </div>

            <div className="rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {locale === "zh" ? "交易记录" : "Trade Ledger"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {locale === "zh"
                      ? "本地保存，不上传服务器。"
                      : "Stored locally in this browser only."}
                  </p>
                </div>
                <div className="text-xs text-slate-400">
                  {isLoadingQuotes
                    ? locale === "zh" ? "正在刷新报价..." : "Refreshing quotes..."
                    : uniqueSymbols.length > 0
                      ? `${uniqueSymbols.length} ${locale === "zh" ? "只股票" : "symbols"}`
                      : "--"}
                </div>
              </div>
              <div className="mt-4 space-y-3 sm:hidden">
                {filteredTrades.length > 0 ? (
                  filteredTrades.map((trade) => (
                    <article key={trade.id} className="rounded-[24px] border border-white/8 bg-slate-950/35 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{trade.symbol}</p>
                          <p className="mt-1 text-xs text-slate-400">{formatDate(trade.tradedAt, locale)}</p>
                        </div>
                        <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                          {trade.side === "buy"
                            ? locale === "zh" ? "买入" : "Buy"
                            : locale === "zh" ? "卖出" : "Sell"}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-slate-500">{locale === "zh" ? "数量" : "Qty"}</p>
                          <p className="mt-1 text-slate-200">{trade.quantity}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">{locale === "zh" ? "价格" : "Price"}</p>
                          <p className="mt-1 text-slate-200">{formatMoney(trade.price)}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 text-xs text-slate-400">{trade.note || "--"}</p>
                        <button
                          type="button"
                          onClick={() => removeTrade(trade.id)}
                          className="rounded-full bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                        >
                          {locale === "zh" ? "删除" : "Delete"}
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 px-4 py-6 text-center text-sm text-slate-400">
                    {locale === "zh"
                      ? "这个时间范围内还没有交易记录。"
                      : "No trades recorded in this timeframe."}
                  </div>
                )}
              </div>
              <div className="mt-4 hidden overflow-hidden rounded-[24px] border border-white/8 sm:block">
                <table className="w-full min-w-[760px] divide-y divide-white/8 text-sm">
                  <thead className="bg-slate-950/55 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">{locale === "zh" ? "日期" : "Date"}</th>
                      <th className="px-4 py-3">{locale === "zh" ? "股票" : "Symbol"}</th>
                      <th className="px-4 py-3">{locale === "zh" ? "方向" : "Side"}</th>
                      <th className="px-4 py-3">{locale === "zh" ? "数量" : "Qty"}</th>
                      <th className="px-4 py-3">{locale === "zh" ? "价格" : "Price"}</th>
                      <th className="px-4 py-3">{locale === "zh" ? "备注" : "Note"}</th>
                      <th className="px-4 py-3">{locale === "zh" ? "操作" : "Action"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6 bg-white/3">
                    {filteredTrades.length > 0 ? (
                      filteredTrades.map((trade) => (
                        <tr key={trade.id}>
                          <td className="px-4 py-3 text-slate-300">{formatDate(trade.tradedAt, locale)}</td>
                          <td className="px-4 py-3 font-semibold text-white">{trade.symbol}</td>
                          <td className="px-4 py-3 text-slate-300">
                            {trade.side === "buy"
                              ? locale === "zh" ? "买入" : "Buy"
                              : locale === "zh" ? "卖出" : "Sell"}
                          </td>
                          <td className="px-4 py-3 text-slate-300">{trade.quantity}</td>
                          <td className="px-4 py-3 text-slate-300">{formatMoney(trade.price)}</td>
                          <td className="px-4 py-3 text-slate-400">{trade.note || "--"}</td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => removeTrade(trade.id)}
                              className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
                            >
                              {locale === "zh" ? "删除" : "Delete"}
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                          {locale === "zh"
                            ? "这个时间范围内还没有交易记录。"
                            : "No trades recorded in this timeframe."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
