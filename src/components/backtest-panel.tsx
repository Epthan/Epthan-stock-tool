"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import type { BacktestResult, BacktestSettings } from "@/lib/backtest";

type BacktestResponse = { symbol: string; currency: string; settings: BacktestSettings; result: BacktestResult; source: string; retrievedAt: string };

export function BacktestPanel({ symbol }: { symbol: string }) {
  const { locale } = useLanguage();
  const text = (english: string, chinese: string) => locale === "zh" ? chinese : english;
  const [latestDate] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const [settings, setSettings] = useState<BacktestSettings>(() => {
    const end = new Date(Date.now() - 86400000);
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 2);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), short: 20, long: 50, capital: 10000, commission: 0.1, slippage: 0.05 };
  });
  const [response, setResponse] = useState<BacktestResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const result = response?.result;
  const changed = !!response && JSON.stringify(settings) !== JSON.stringify(response.settings);
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  const amount = (value: number) => value.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  async function run() {
    if (settings.short >= settings.long) { setError(text("Short SMA must be smaller than long SMA.", "短均线周期必须小于长均线周期。")); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const apiResponse = await fetch("/api/market/backtest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, settings }), signal: controller.signal });
      const payload = await apiResponse.json();
      if (!apiResponse.ok) throw new Error(payload.message ?? "Backtest failed.");
      if (!controller.signal.aborted) { setResponse(payload); setHover(null); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : text("Backtest failed.", "回测失败。"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const points = result?.points ?? [];
  const pointIndices = new Map(points.map((point, index) => [point.date, index]));
  const tradeMarkers = (result?.trades ?? []).flatMap((trade, tradeIndex) => [
    { id: `${tradeIndex}-buy`, side: "B", date: trade.entry, price: trade.entryPrice, quantity: trade.quantity, index: pointIndices.get(trade.entry), end: false },
    { id: `${tradeIndex}-sell`, side: "S", date: trade.exit, price: trade.exitPrice, quantity: trade.quantity, index: pointIndices.get(trade.exit), end: trade.reason === "end" },
  ]).filter((marker): marker is typeof marker & { index: number } => marker.index !== undefined);
  const current = points[Math.min(hover ?? points.length - 1, points.length - 1)];
  const capital = response?.settings.capital ?? settings.capital;
  const low = Math.min(capital, ...points.flatMap((point) => [point.equity, point.benchmark]));
  const high = Math.max(capital + 1, ...points.flatMap((point) => [point.equity, point.benchmark]));
  const x = (index: number) => 65 + index / Math.max(1, points.length - 1) * 815;
  const y = (value: number) => 20 + (high - value) / (high - low || 1) * 210;
  const path = (key: "equity" | "benchmark") => points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point[key])}`).join(" ");
  const metrics = result ? [
    [text("Strategy return", "策略累计收益"), signed(result.returnPercent)],
    [text("Buy & hold", "买入并持有"), signed(result.benchmarkReturn)],
    [text("Annualized return", "年化收益"), signed(result.annualizedReturn)],
    [text("Maximum drawdown", "最大回撤"), signed(result.maxDrawdown)],
    [text("Closed trades", "已结算交易"), String(result.trades.length)],
    [text("Win rate", "胜率"), result.winRate == null ? "—" : `${result.winRate.toFixed(1)}%`],
  ] : [];
  return <section className="bt-panel" aria-label={text("Strategy backtest", "策略回测")}>
    <header className="bt-heading"><div><span className="bt-beta">BETA</span><h2>{text("Strategy backtest", "策略回测")} · {symbol}</h2><p>{text("SMA crossover · long only · next-open execution", "双均线交叉 · 只做多 · 下一交易日开盘成交")}</p></div></header>
    <form className="bt-form" onSubmit={(event) => { event.preventDefault(); run(); }}>
      <label>{text("Start date", "开始日期")}<input type="date" required value={settings.start} onChange={(event) => setSettings({ ...settings, start: event.target.value })} /></label>
      <label>{text("End date", "结束日期")}<input type="date" required min={settings.start} max={latestDate} value={settings.end} onChange={(event) => setSettings({ ...settings, end: event.target.value })} /></label>
      {([ ["short", text("Short SMA · days", "短均线 · 日")], ["long", text("Long SMA · days", "长均线 · 日")], ["capital", text("Initial capital", "初始资金")], ["commission", text("Fee per side · %", "单边手续费 · %")], ["slippage", text("Slippage per side · %", "单边滑点 · %")] ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" required value={settings[key]} min={key === "capital" ? 1 : key === "short" || key === "long" ? 1 : 0} max={key === "capital" ? 1e9 : key === "short" || key === "long" ? 250 : 5} step={key === "short" || key === "long" ? 1 : 0.01} onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} /></label>)}
      <button className="bt-run" type="submit" disabled={loading}>{loading ? text("Running…", "回测中…") : text("Run backtest", "运行回测")}</button>
    </form>
    {error && <p role="alert" className="bt-error">{error}</p>}
    {changed && <p className="bt-notice">{text("Parameters changed. Results below belong to the previous run; run again to update.", "参数已修改。下方仍为上一次运行结果，请重新运行更新。")}</p>}
    {!response && <div className="bt-empty"><h3>{text("Test the rules, inspect the results", "先验证规则，再评估表现")}</h3><p>{text("Select your dates and parameters, then run the strategy against daily historical prices.", "设置区间和参数后运行，使用日线历史行情，与同股买入持有策略比较。")}</p></div>}
    {response && result && <>
      <p className="bt-run-meta">{response.symbol} · {result.start} — {result.end} · SMA {response.settings.short}/{response.settings.long} · {response.currency || text("Quote currency", "行情币种")} · {response.source}</p>
      <div className="bt-metrics">{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
      <section className="bt-section"><h3>{text("Equity curve", "资金曲线")}</h3><div className="bt-legend"><span>{current?.date}</span><span className="bt-strategy">{text("Strategy", "策略")} {amount(current?.equity ?? capital)}</span><span className="bt-benchmark">{text("Buy & hold", "买入持有")} {amount(current?.benchmark ?? capital)}</span></div>
        <p className="bt-marker-legend"><span><b className="bt-buy-key">B</b>{text("Buy", "买入")}</span><span><b className="bt-sell-key">S</b>{text("Sell", "卖出")}</span><small>{text("Markers follow execution dates on the strategy equity curve, not stock prices. Hover or focus for details; final liquidation is included.", "标记对应策略资金曲线上的成交日期，并非股价；悬停或聚焦查看详情，包含期末强制卖出。")}</small></p>
        <svg viewBox="0 0 910 265" role="img" aria-label={text("Strategy and buy-and-hold equity", "策略与买入持有资金曲线")} onPointerLeave={() => setHover(null)} onPointerMove={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(points.length - 1, Math.round((((event.clientX - bounds.left) / bounds.width * 910 - 65) / 815) * (points.length - 1))))); }}>
          {[0, 1, 2, 3, 4].map((index) => { const value = low + (high - low) * index / 4; return <g key={index}><line x1="65" x2="880" y1={y(value)} y2={y(value)} className="bt-grid" /><text x="58" y={y(value) + 4} textAnchor="end">{Math.round(value).toLocaleString()}</text></g>; })}
          <path d={path("benchmark")} fill="none" stroke="#a78bfa" strokeWidth="2" /><path d={path("equity")} fill="none" stroke="#14b8a6" strokeWidth="2.4" />
          {tradeMarkers.map((marker) => {
            const pointX = x(marker.index);
            const pointY = y(points[marker.index].equity);
            const labelY = Math.max(12, Math.min(238, pointY + (marker.side === "B" ? 18 : -18)));
            const description = `${marker.side} · ${text(marker.side === "B" ? "Buy" : "Sell", marker.side === "B" ? "买入" : "卖出")} · ${marker.date} · ${text("Price", "成交价")} ${amount(marker.price)} ${response.currency} · ${text("Qty", "数量")} ${marker.quantity.toFixed(4)}${marker.end ? ` · ${text("End-of-test liquidation", "期末强制结算")}` : ""}`;
            return <g key={marker.id} className={`bt-trade-marker ${marker.side === "B" ? "bt-buy-marker" : "bt-sell-marker"}`} tabIndex={0} role="img" aria-label={description} onFocus={() => setHover(marker.index)} onBlur={() => setHover(null)}>
              <title>{description}</title>
              <line x1={pointX} x2={pointX} y1={pointY} y2={labelY} />
              <circle className="bt-trade-dot" cx={pointX} cy={pointY} r="3" />
              <circle className="bt-trade-badge" cx={pointX} cy={labelY} r="9" />
              <text x={pointX} y={labelY} textAnchor="middle" dominantBaseline="central">{marker.side}</text>
            </g>;
          })}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1="20" y2="230" className="bt-grid" />}
          <text x="65" y="256">{result.start}</text><text x="880" y="256" textAnchor="end">{result.end}</text>
        </svg>
      </section>
      <section className="bt-section"><h3>{text("Strategy drawdown", "策略回撤")}</h3><svg viewBox="0 0 910 130" role="img" aria-label={text("Strategy drawdown curve", "策略回撤曲线")}><line x1="65" x2="880" y1="20" y2="20" className="bt-grid" /><text x="55" y="24" textAnchor="end">0%</text><text x="55" y="106" textAnchor="end">{result.maxDrawdown.toFixed(1)}%</text><path d={points.map((point, index) => `${index ? "L" : "M"}${x(index)},${20 + Math.abs(point.drawdown) / Math.max(0.01, Math.abs(result.maxDrawdown)) * 85}`).join(" ")} fill="none" stroke="#fb7185" strokeWidth="2" /></svg></section>
      <section className="bt-section"><h3>{text("Trade log", "交易明细")} · {result.trades.length}</h3><div className="bt-table-scroll"><table><thead><tr>{[text("Entry", "买入日期"), text("Exit", "卖出日期"), text("Quantity", "数量"), text("Buy price", "买价"), text("Sell price", "卖价"), text("Fees", "手续费"), text("Net P&L", "净盈亏"), text("Exit reason", "卖出原因")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{result.trades.map((trade, index) => <tr key={index}><td>{trade.entry}</td><td>{trade.exit}</td><td>{trade.quantity.toFixed(4)}</td><td>{amount(trade.entryPrice)}</td><td>{amount(trade.exitPrice)}</td><td>{amount(trade.fees)}</td><td>{amount(trade.pnl)}</td><td>{trade.reason === "end" ? text("End of test", "期末结算") : text("SMA cross", "均线交叉")}</td></tr>)}</tbody></table></div>{!result.trades.length && <p>{text("No entry signals during this period; strategy stayed in cash.", "该区间未出现入场信号，策略保持现金。")}</p>}</section>
    </>}
    <details className="bt-method"><summary>{text("Execution rules & limitations", "成交规则与计算口径")}</summary><p>{text("Daily SMA(20/50 by default). Start flat; only crossovers after the test starts trigger entries. Signal at close, execution at next open. Fractional shares, all-in/all-out, no leverage or shorts. Warm-up prices precede the start date. Positions are liquidated at the last close. Buy-and-hold buys at the first open and liquidates at the last close; both pay the same percentage costs. Yahoo daily OHLC price returns exclude cash dividends and interest. Annualization uses calendar days; short periods are unstable. Missing or invalid history blocks execution; no simulated fallback. Currency follows the security; no FX conversion.", "使用日线简单移动均线，默认 20/50 日。期初空仓，仅响应区间开始后的交叉信号；收盘产生信号，下一交易日开盘成交。支持碎股，全仓买入卖出，不做空、不加杠杆；预热行情位于回测开始前。期末按最后收盘价强制结算。基准于首日开盘买入、末日收盘卖出，双方使用相同费率和滑点。使用 Yahoo 日线 OHLC 价格收益，不计现金股息和利息；年化采用日历日，短区间结果不稳定。历史数据不足或异常时停止，不使用模拟行情替代。资金按股票报价币种计算，不做汇率转换。")}</p></details>
  </section>;
}
