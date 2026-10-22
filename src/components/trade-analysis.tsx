"use client";

import { useLanguage } from "@/components/language-provider";
import { ActivityChart, DotStrip, Histogram } from "@/components/trader-charts";
import type { LivePortfolioAnalysis } from "@/lib/live-portfolio";
import { returnHistogram } from "@/lib/trader-analytics";
import type { Insight } from "@/lib/trader-insights";

const num = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const pct = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
const tone = (value: number | null | undefined) => value == null || !Number.isFinite(value) || Math.abs(value) < 1e-9 ? "" : value > 0 ? "pd-positive" : "pd-negative";

export function InsightList({ insights, limit }: { insights: Insight[]; limit?: number }) {
  const { locale } = useLanguage();
  const items = limit ? insights.slice(0, limit) : insights;
  if (!items.length) return <p className="pd-muted">{locale === "zh" ? "数据量还不足以得出可靠结论。随着交易和持有时间增加，这里会出现具体发现。" : "Not enough data for reliable findings yet. Findings appear as trades and history accumulate."}</p>;
  return <div className="ta-insights">{items.map((insight, index) => <article key={index} className={`ta-insight ta-insight-${insight.tone}`}><small>{String(index + 1).padStart(2, "0")} / {locale === "zh" ? insight.topic.zh : insight.topic.en.toUpperCase()}</small><p>{locale === "zh" ? insight.zh : insight.en}</p></article>)}</div>;
}

export function TradeAnalysis({ data, insights, benchmark, money, onPick }: { data: LivePortfolioAnalysis; insights: Insight[]; benchmark: string; money: (value: number) => string; onPick: (symbol: string) => void }) {
  const { locale } = useLanguage();
  const text = (english: string, chinese: string) => locale === "zh" ? chinese : english;
  const { stats, closed, entries } = data.trading;
  const behaviour = insights.filter((insight) => insight.topic.en === "Edge" || insight.topic.en === "Behaviour");
  if (!closed.length && !entries.length) return <section className="pd-pending"><h2>{text("No trades in this period", "所选区间内没有交易")}</h2><p>{text("Trade analytics use sells (closed trades) and buys inside the selected range. Choose a longer range, or record a sell to see win rate, payoff and holding behaviour.", "交易分析基于所选区间内的卖出（已平仓）和买入。请选择更长的区间，或记录卖出交易以查看胜率、盈亏比和持有行为。")}</p></section>;
  const cards: [string, string, string, string?][] = [
    [text("Closed trades", "已平仓交易"), String(stats.closedCount), `${stats.winCount} ${text("wins", "盈")} · ${stats.lossCount} ${text("losses", "亏")}`],
    [text("Win rate", "胜率"), stats.winRate == null ? "—" : `${stats.winRate.toFixed(1)}%`, text("Sells with positive P&L", "盈利卖出占比")],
    [text("Payoff ratio", "盈亏比"), num(stats.payoffRatio), `${text("Avg win", "平均盈利")} ${stats.averageWin == null ? "—" : money(stats.averageWin)} · ${text("avg loss", "平均亏损")} ${stats.averageLoss == null ? "—" : money(stats.averageLoss)}`],
    [text("Profit factor", "Profit Factor"), stats.profitFactor === Infinity ? "∞" : num(stats.profitFactor), text("Gross win ÷ gross loss · >1.5 suggests an edge", "总盈利 ÷ 总亏损 · >1.5 通常视为有优势"), stats.profitFactor == null ? undefined : stats.profitFactor >= 1 ? "pd-positive" : "pd-negative"],
    [text("Expectancy per trade", "单笔期望值"), stats.expectancy == null ? "—" : money(stats.expectancy), `${text("Average return", "平均收益率")} ${pct(stats.expectancyPercent)}`, tone(stats.expectancy)],
    [text("Holding: winners vs losers", "持有天数：盈 vs 亏"), `${num(stats.winHoldingDays, 0)} / ${num(stats.lossHoldingDays, 0)}`, text("Calendar days · FIFO-weighted", "日历天 · 按 FIFO 加权")],
    [text("20 days after selling", "卖出后 20 日"), pct(stats.afterExitAverage), `${stats.afterExitRoseShare == null ? "—" : stats.afterExitRoseShare.toFixed(0)}% ${text("kept rising", "继续上涨")} · n=${stats.afterExitSamples}`, tone(stats.afterExitAverage == null ? null : -stats.afterExitAverage)],
    [text("Entry excess, 20 days", "买入后 20 日超额"), stats.entryExcess20 == null ? "—" : `${stats.entryExcess20 > 0 ? "+" : ""}${stats.entryExcess20.toFixed(1)} pp`, `vs ${benchmark} · ${stats.entryBeatShare == null ? "—" : stats.entryBeatShare.toFixed(0)}% ${text("beat", "跑赢")} · n=${stats.entrySamples}`, tone(stats.entryExcess20)],
  ];
  const maxDays = Math.max(1, stats.winHoldingDays ?? 0, stats.lossHoldingDays ?? 0);
  const activity = data.activity;
  return <>
    {stats.closedCount > 0 && stats.closedCount < 10 && <p className="ta-notice">{text(`Only ${stats.closedCount} closed trades in this period — treat rates and ratios as indicative.`, `本区间仅 ${stats.closedCount} 笔已平仓交易，胜率和比率仅供参考。`)}</p>}
    <section className="pd-metrics" aria-label={text("Trade statistics", "交易统计")}>{cards.map(([label, value, note, className]) => <article key={label} className="pd-metric"><p>{label}</p><strong className={className ?? ""}>{value}</strong><small>{note}</small></article>)}</section>
    <div className="pd-primary-grid">
      <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Closed-trade return distribution", "已平仓交易收益分布")}</h2><p>{text("Return vs average cost per sell · 5% buckets, tails grouped", "每笔卖出相对平均成本的收益率 · 5% 分组，两端合并")}</p></div></div>
        {closed.length ? <Histogram bins={returnHistogram(closed.map((trade) => trade.returnPercent))} label={text("Distribution of closed-trade returns", "已平仓交易收益分布")} /> : <p className="pd-muted">{text("No sells in this period.", "本区间没有卖出。")}</p>}
      </section>
      <section className="pd-section pd-insights"><p className="pd-eyebrow">{text("BEHAVIOUR FINDINGS", "交易行为发现")}</p><h2>{text("What your trades say", "交易记录告诉你什么")}</h2><InsightList insights={behaviour} /></section>
    </div>
    <div className="pd-two-columns">
      <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Holding period: winners vs losers", "持有期：盈利单 vs 亏损单")}</h2><p>{text("Longer losers than winners = disposition effect", "亏损单持有更久 = 处置效应")}</p></div></div>
        <div className="ta-bars">{[[text("Winners", "盈利单"), stats.winHoldingDays, stats.winCount, "ta-bar-win"], [text("Losers", "亏损单"), stats.lossHoldingDays, stats.lossCount, "ta-bar-loss"]].map(([label, value, count, className]) => <div className="ta-bar-row" key={String(label)}><span className="ta-bar-label">{label as string}</span><div className="ta-bar-tracks"><span className={`ta-bar ${className}`} style={{ width: `${((value as number | null) ?? 0) / maxDays * 100}%` }} /></div><span className="ta-bar-values"><strong>{num(value as number | null, 0)} {text("days", "天")}</strong>n={count as number}</span></div>)}</div>
      </section>
      <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Monthly activity", "月度交易活跃度")}</h2><p>{text("Trades per month, coloured by that month's return", "每月交易笔数，颜色表示当月组合收益正负")}</p></div></div>
        <ActivityChart rows={activity.rows} label={text("Trades per month", "每月交易笔数")} legend={{ gain: text("Positive month", "当月收益为正"), loss: text("Negative month", "当月收益为负") }} />
        <p className="pd-table-note">{text("Average trades in the month after a losing month", "亏损月之后一个月平均交易")} <strong>{num(activity.tradesAfterLoss, 1)}</strong> · {text("after a winning month", "盈利月之后")} <strong>{num(activity.tradesAfterGain, 1)}</strong></p>
      </section>
    </div>
    <div className="pd-two-columns">
      <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("After selling: did it keep going?", "卖出之后：卖早了吗？")}</h2><p>{text("Price change 20 trading days after each sell, vs the sell price", "每笔卖出后第 20 个交易日相对卖出价的涨跌")}</p></div></div>
        {stats.afterExitSamples ? <DotStrip label={text("Price change after selling", "卖出后价格变化")} average={stats.afterExitAverage} values={closed.filter((trade) => trade.afterExit20 != null).map((trade) => ({ key: trade.id, value: trade.afterExit20!, title: `${trade.symbol} ${trade.exitDate}: ${pct(trade.afterExit20)}` }))} /> : <p className="pd-muted">{text("Needs 20 trading days after a sell.", "卖出后需满 20 个交易日。")}</p>}
        <p className="pd-table-note">{text("Right of zero: the stock kept rising after you sold.", "零线右侧：卖出后股票继续上涨。")}</p>
      </section>
      <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("After buying: entry quality", "买入之后：买点质量")}</h2><p>{text(`Stock return minus ${benchmark} over 20 trading days after each buy`, `每笔买入后 20 个交易日，个股收益减 ${benchmark} 收益`)}</p></div></div>
        {stats.entrySamples ? <DotStrip label={text("Excess return after buying", "买入后超额收益")} average={stats.entryExcess20} values={entries.filter((entry) => entry.excess20 != null).map((entry) => ({ key: entry.id, value: entry.excess20!, title: `${entry.symbol} ${entry.date}: ${pct(entry.excess20)} (5d ${pct(entry.excess5)})` }))} /> : <p className="pd-muted">{text("Needs 20 trading days after a buy.", "买入后需满 20 个交易日。")}</p>}
        <p className="pd-table-note">{text("5-day average excess", "5 日平均超额")} <strong>{stats.entryExcess5 == null ? "—" : `${stats.entryExcess5 > 0 ? "+" : ""}${stats.entryExcess5.toFixed(1)} pp`}</strong></p>
      </section>
    </div>
    {closed.length > 0 && <section className="pd-section"><div className="pd-section-heading"><div><h2>{text("Closed trades", "已平仓交易明细")}</h2><p>{text("Each sell, matched to average cost", "每笔卖出，按平均成本计算盈亏")}</p></div></div><div className="pd-table-scroll"><table><thead><tr>{[text("Exit date", "卖出日期"), text("Symbol", "代码"), text("Qty", "数量"), text("Avg cost", "平均成本"), text("Exit price", "卖出价"), text("P&L", "盈亏"), text("Return", "收益率"), text("Held (days)", "持有天数"), text("+20d after exit", "卖出后 20 日"), text("Note", "备注")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{[...closed].sort((left, right) => right.exitDate.localeCompare(left.exitDate)).map((trade) => <tr key={trade.id}><td>{trade.exitDate}</td><td><button className="pd-symbol" onClick={() => onPick(trade.symbol)}>{trade.symbol} ↗</button></td><td>{trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td>{trade.averageCost.toFixed(2)}</td><td>{trade.exitPrice.toFixed(2)}</td><td className={tone(trade.pnl)}>{trade.pnl > 0 ? "+" : ""}{trade.pnl.toFixed(2)}</td><td className={tone(trade.returnPercent)}>{pct(trade.returnPercent)}</td><td>{Math.round(trade.holdingDays)}</td><td className={tone(trade.afterExit20 == null ? null : -trade.afterExit20)}>{pct(trade.afterExit20)}</td><td className="ta-note">{trade.note ?? ""}</td></tr>)}</tbody></table></div></section>}
  </>;
}
