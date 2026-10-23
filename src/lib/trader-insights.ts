import type { LivePortfolioAnalysis } from "@/lib/live-portfolio";

export type Insight = { tone: "positive" | "warning" | "neutral"; topic: { en: string; zh: string }; en: string; zh: string; score: number };

const f1 = (value: number) => value.toFixed(1);
const f2 = (value: number) => value.toFixed(2);

/**
 * Rule-based findings. Each rule fires only with enough data and states a judgement,
 * not a restatement of a KPI. Sorted by importance (score) and capped by the caller.
 */
export function buildTraderInsights(data: LivePortfolioAnalysis, benchmark: string): Insight[] {
  const out: Insight[] = [];
  const s = data.statistics;
  const t = data.trading.stats;
  const risk = data.risk;
  const topic = { performance: { en: "Performance", zh: "收益" }, risk: { en: "Risk", zh: "风险" }, behaviour: { en: "Behaviour", zh: "交易行为" }, edge: { en: "Edge", zh: "交易优势" } };

  // 0. Cash: idle-cash drag and cost of trading
  const account = data.account;
  if (account && !account.negativeCash && account.cashWeight != null && account.cashWeight > 25 && account.periodReturn != null && s.totalReturn != null && s.totalReturn - account.periodReturn > 1) {
    out.push({ tone: "warning", topic: topic.performance, score: 80,
      en: `${f1(account.cashWeight)}% of the account is idle cash. Holdings returned ${f1(s.totalReturn)}% but the whole account only ${f1(account.periodReturn)}% — the cash is diluting results. Either put it to work or count it as a deliberate defensive position.`,
      zh: `账户里 ${f1(account.cashWeight)}% 是闲置现金。持仓收益 ${f1(s.totalReturn)}%，整个账户只有 ${f1(account.periodReturn)}%，现金在稀释收益。要么投入使用，要么明确把它当作防守仓位。` });
  }
  if (account && account.negativeCash) {
    out.push({ tone: "warning", topic: topic.risk, score: 95,
      en: "Cash balance went negative at some point: a deposit is probably missing from the cash ledger, so account-level returns are withheld.",
      zh: "现金余额曾为负数：现金账本很可能漏记了入金，因此暂不计算账户层面的收益。" });
  }
  if (account && account.costs > 0 && data.pnl > 0 && account.costs / (data.pnl + account.costs) > 0.15) {
    out.push({ tone: "warning", topic: topic.behaviour, score: 72,
      en: `Fees and tax (${f2(account.costs)}) ate ${f1(account.costs / (data.pnl + account.costs) * 100)}% of gross profit. Fewer, larger trades — or a cheaper broker — would keep more of it.`,
      zh: `费用和税（${f2(account.costs)}）吃掉了 ${f1(account.costs / (data.pnl + account.costs) * 100)}% 的毛利润。减少交易次数、提高单笔金额，或换佣金更低的券商，能留住更多。` });
  }

  // 1. Index-hugging vs genuine alpha
  if (s.correlation != null && s.alphaT != null && s.alphaAnnual != null) {
    if (s.correlation > 0.9 && Math.abs(s.alphaT) < 2) {
      out.push({ tone: "warning", topic: topic.performance, score: 90,
        en: `Correlation with ${benchmark} is ${f2(s.correlation)} and alpha (${f1(s.alphaAnnual)}% p.a.) is not statistically significant (t = ${f2(s.alphaT)}). In practice you are holding the index with extra effort and concentration.`,
        zh: `与 ${benchmark} 的相关性 ${f2(s.correlation)}，年化 Alpha ${f1(s.alphaAnnual)}% 统计上不显著（t = ${f2(s.alphaT)}）。实际上相当于持有指数，却多付出了精力和集中度风险。` });
    } else if (s.alphaT >= 2) {
      out.push({ tone: "positive", topic: topic.performance, score: 85,
        en: `Alpha of ${f1(s.alphaAnnual)}% p.a. is statistically significant (t = ${f2(s.alphaT)}) after adjusting for beta ${f2(s.beta ?? 0)} — returns are not just market exposure.`,
        zh: `剔除 β ${f2(s.beta ?? 0)} 的市场暴露后，年化 Alpha ${f1(s.alphaAnnual)}% 统计显著（t = ${f2(s.alphaT)}），收益不只是跟着大盘涨。` });
    } else if (s.alphaT <= -2) {
      out.push({ tone: "warning", topic: topic.performance, score: 88,
        en: `Alpha is significantly negative (${f1(s.alphaAnnual)}% p.a., t = ${f2(s.alphaT)}): for the same market risk, ${benchmark} would have done better.`,
        zh: `Alpha 显著为负（年化 ${f1(s.alphaAnnual)}%，t = ${f2(s.alphaT)}）：承担同样的市场风险，直接持有 ${benchmark} 会更好。` });
    }
  }

  // 2. Asymmetric capture
  if (s.upCapture != null && s.downCapture != null && s.downCapture > s.upCapture + 10) {
    out.push({ tone: "warning", topic: topic.risk, score: 70,
      en: `Down-capture ${f1(s.downCapture)}% exceeds up-capture ${f1(s.upCapture)}%: the portfolio falls more on down days than it gains on up days.`,
      zh: `下行捕获率 ${f1(s.downCapture)}% 高于上行捕获率 ${f1(s.upCapture)}%：大盘跌时跌得多，涨时涨得少。` });
  } else if (s.upCapture != null && s.downCapture != null && s.upCapture > s.downCapture + 10) {
    out.push({ tone: "positive", topic: topic.risk, score: 55,
      en: `Up-capture ${f1(s.upCapture)}% vs down-capture ${f1(s.downCapture)}%: favourable asymmetry against ${benchmark}.`,
      zh: `上行捕获率 ${f1(s.upCapture)}%、下行捕获率 ${f1(s.downCapture)}%：相对 ${benchmark} 呈有利的不对称。` });
  }

  // 3. Risk concentrated beyond weight
  const outsized = risk.contributions.filter((item) => item.risk != null && item.risk >= 20 && item.risk > item.weight * 1.4).sort((left, right) => (right.risk ?? 0) - (left.risk ?? 0))[0];
  if (outsized?.risk != null) {
    out.push({ tone: "warning", topic: topic.risk, score: 80,
      en: `${outsized.symbol} is ${f1(outsized.weight)}% of the portfolio but drives ${f1(outsized.risk)}% of its volatility. Position size understates its real risk.`,
      zh: `${outsized.symbol} 仓位 ${f1(outsized.weight)}%，却贡献了 ${f1(outsized.risk)}% 的组合波动，仓位数字低估了它的真实风险。` });
  }

  // 4. Concentration / diversification
  if (risk.concentration.positions >= 2 && risk.concentration.effectiveCount < 4) {
    out.push({ tone: "neutral", topic: topic.risk, score: 50,
      en: `${risk.concentration.positions} positions, but the weighting behaves like ${f1(risk.concentration.effectiveCount)} equal bets (top 3 = ${f1(risk.concentration.top3)}%).`,
      zh: `持有 ${risk.concentration.positions} 只，但按权重相当于 ${f1(risk.concentration.effectiveCount)} 个等权仓位（前三大占 ${f1(risk.concentration.top3)}%）。` });
  }
  const pair = (() => {
    if (!risk.correlation) return null;
    let best: { a: string; b: string; value: number } | null = null;
    risk.correlation.matrix.forEach((row, i) => row.forEach((value, j) => { if (j > i && (!best || value > best.value)) best = { a: risk.correlation!.symbols[i], b: risk.correlation!.symbols[j], value }; }));
    return best as { a: string; b: string; value: number } | null;
  })();
  if (pair && pair.value > 0.75) {
    out.push({ tone: "neutral", topic: topic.risk, score: 45,
      en: `${pair.a} and ${pair.b} have a 1-year daily correlation of ${f2(pair.value)} — largely the same bet.`,
      zh: `${pair.a} 与 ${pair.b} 近一年日收益相关性 ${f2(pair.value)}，本质上是同一个赌注。` });
  }

  // 5. Edge from closed trades
  const sample = t.closedCount;
  const small = sample < 10;
  const caveat = { en: small ? ` (only ${sample} closed trades — treat as indicative)` : "", zh: small ? `（仅 ${sample} 笔已平仓交易，结论仅供参考）` : "" };
  if (sample >= 3 && t.profitFactor != null) {
    if (t.profitFactor < 1) out.push({ tone: "warning", topic: topic.edge, score: 82,
      en: `Profit factor ${Number.isFinite(t.profitFactor) ? f2(t.profitFactor) : "∞"}: closed trades lose more than they win${caveat.en}. Win rate ${f1(t.winRate ?? 0)}%, payoff ratio ${t.payoffRatio != null ? f2(t.payoffRatio) : "—"}.`,
      zh: `Profit Factor ${f2(t.profitFactor)}：已平仓交易亏的比赚的多${caveat.zh}。胜率 ${f1(t.winRate ?? 0)}%，盈亏比 ${t.payoffRatio != null ? f2(t.payoffRatio) : "—"}。` });
    else if (t.profitFactor >= 1.5) out.push({ tone: "positive", topic: topic.edge, score: 65,
      en: `Profit factor ${Number.isFinite(t.profitFactor) ? f2(t.profitFactor) : "∞"} with ${f1(t.winRate ?? 0)}% win rate — closed trades show an edge${caveat.en}.`,
      zh: `Profit Factor ${Number.isFinite(t.profitFactor) ? f2(t.profitFactor) : "∞"}，胜率 ${f1(t.winRate ?? 0)}%，已平仓交易显示出优势${caveat.zh}。` });
    if (t.winRate != null && t.winRate >= 55 && t.payoffRatio != null && t.payoffRatio < 0.8) out.push({ tone: "warning", topic: topic.edge, score: 68,
      en: `High win rate (${f1(t.winRate)}%) but average loss is ${f2(1 / t.payoffRatio)}× the average win — small gains, large losses.`,
      zh: `胜率高（${f1(t.winRate)}%），但平均亏损是平均盈利的 ${f2(1 / t.payoffRatio)} 倍——赚小钱、亏大钱。` });
  }

  // 6. Disposition effect
  if (t.winCount >= 2 && t.lossCount >= 2 && t.winHoldingDays != null && t.lossHoldingDays != null) {
    if (t.lossHoldingDays > t.winHoldingDays * 1.3) out.push({ tone: "warning", topic: topic.behaviour, score: 78,
      en: `Losing trades are held ${Math.round(t.lossHoldingDays)} days on average vs ${Math.round(t.winHoldingDays)} for winners — a classic disposition effect (cutting winners, holding losers).`,
      zh: `亏损单平均持有 ${Math.round(t.lossHoldingDays)} 天，盈利单仅 ${Math.round(t.winHoldingDays)} 天——典型的处置效应：赚了急着卖，亏了扛着不卖。` });
    else if (t.winHoldingDays > t.lossHoldingDays * 1.3) out.push({ tone: "positive", topic: topic.behaviour, score: 50,
      en: `Winners are held longer (${Math.round(t.winHoldingDays)} d) than losers (${Math.round(t.lossHoldingDays)} d): you cut losses and let profits run.`,
      zh: `盈利单持有更久（${Math.round(t.winHoldingDays)} 天 vs 亏损单 ${Math.round(t.lossHoldingDays)} 天）：止损果断、让利润奔跑。` });
  }

  // 7. Exit timing
  if (t.afterExitSamples >= 3 && t.afterExitAverage != null && t.afterExitRoseShare != null) {
    if (t.afterExitAverage > 3 && t.afterExitRoseShare >= 60) out.push({ tone: "warning", topic: topic.behaviour, score: 72,
      en: `${f1(t.afterExitRoseShare)}% of sold positions kept rising; 20 trading days after selling they were up ${f1(t.afterExitAverage)}% on average. Exits look early.`,
      zh: `${f1(t.afterExitRoseShare)}% 的卖出在之后继续上涨，卖出 20 个交易日后平均又涨了 ${f1(t.afterExitAverage)}%，卖点偏早。` });
    else if (t.afterExitAverage < -3) out.push({ tone: "positive", topic: topic.behaviour, score: 55,
      en: `Sold positions fell a further ${f1(Math.abs(t.afterExitAverage))}% on average over the next 20 trading days — exits were well timed.`,
      zh: `卖出后 20 个交易日平均又跌了 ${f1(Math.abs(t.afterExitAverage))}%，卖点把握得不错。` });
  }

  // 8. Entry timing
  if (t.entrySamples >= 3 && t.entryExcess20 != null) {
    if (t.entryExcess20 < -2) out.push({ tone: "warning", topic: topic.behaviour, score: 60,
      en: `Buys underperformed ${benchmark} by ${f1(Math.abs(t.entryExcess20))} pp on average over the following 20 trading days — entries tend to be chasing.`,
      zh: `买入后 20 个交易日平均跑输 ${benchmark} ${f1(Math.abs(t.entryExcess20))} 个百分点，买点有追高倾向。` });
    else if (t.entryExcess20 > 2) out.push({ tone: "positive", topic: topic.behaviour, score: 52,
      en: `Buys beat ${benchmark} by ${f1(t.entryExcess20)} pp on average over the next 20 trading days — good entry timing.`,
      zh: `买入后 20 个交易日平均跑赢 ${benchmark} ${f1(t.entryExcess20)} 个百分点，买点质量较好。` });
  }

  // 9. Overtrading after losses
  const activity = data.activity;
  if (activity.tradesAfterLoss != null && activity.tradesAfterGain != null && activity.tradesAfterGain > 0 && activity.tradesAfterLoss > activity.tradesAfterGain * 1.5 && activity.tradesAfterLoss >= 2) {
    out.push({ tone: "warning", topic: topic.behaviour, score: 58,
      en: `After a losing month you trade ${f1(activity.tradesAfterLoss)} times on average vs ${f1(activity.tradesAfterGain)} after a winning month — possible revenge trading.`,
      zh: `亏损月份之后平均交易 ${f1(activity.tradesAfterLoss)} 次，盈利月份之后仅 ${f1(activity.tradesAfterGain)} 次，可能存在亏损后的报复性交易。` });
  }

  // 10. Risk-adjusted summary
  if (s.sharpe != null && s.observations >= 120) {
    out.push({ tone: s.sharpe >= 1 ? "positive" : s.sharpe < 0.3 ? "warning" : "neutral", topic: topic.performance, score: 40,
      en: `Sharpe ${f2(s.sharpe)} and max drawdown ${f1(s.maxDrawdown)}% over the period (volatility ${f1(s.volatility ?? 0)}% vs ${f1(s.benchmarkVolatility ?? 0)}% for ${benchmark}).`,
      zh: `区间 Sharpe ${f2(s.sharpe)}，最大回撤 ${f1(s.maxDrawdown)}%（年化波动 ${f1(s.volatility ?? 0)}%，${benchmark} 为 ${f1(s.benchmarkVolatility ?? 0)}%）。` });
  }

  return out.sort((left, right) => right.score - left.score);
}
