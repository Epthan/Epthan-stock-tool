"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { usePortfolios } from "@/hooks/use-portfolios";
import { TTL, fetchCached } from "@/lib/client-cache";
import { applySplits } from "@/lib/corporate-actions";
import { auTaxReport, financialYear, fyLabel, fyRange, restateInAud, taxCsv } from "@/lib/au-tax";
import { normalizeCurrency, rateOn, type RatePoint } from "@/lib/fx";
import { tradeDate } from "@/lib/portfolio-trades";

type Quote = { price: number; currency: string };

const aud = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const signedAud = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? "—" : Math.abs(value) < 0.005 ? aud(0) : `${value > 0 ? "+" : "−"}${aud(Math.abs(value))}`);
const tone = (value: number | null | undefined) => (value == null || !Number.isFinite(value) || Math.abs(value) < 0.005 ? "" : value > 0 ? "tl-positive" : "tl-negative");
/** Quote currency from the symbol suffix when no quote is available. */
const guessCurrency = (symbol: string) => (symbol.endsWith(".AX") ? "AUD" : !symbol.includes(".") ? "USD" : null);

/** Australian tax report (CGT + investment income) for the active portfolio, one financial year at a time. */
export function TaxReportView() {
  const { locale } = useLanguage();
  const zh = locale === "zh";
  const text = (english: string, chinese: string) => (zh ? chinese : english);
  const { portfolios, activePortfolio, selectPortfolio } = usePortfolios();
  const trades = useMemo(() => applySplits(activePortfolio.trades ?? [], activePortfolio.splits), [activePortfolio]);
  const cash = useMemo(() => activePortfolio.cash ?? [], [activePortfolio]);
  const base = activePortfolio.baseCurrency ?? "USD";
  const symbols = useMemo(() => [...new Set(trades.map((trade) => trade.symbol))].sort(), [trades]);
  const symbolKey = symbols.join(",");

  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  useEffect(() => {
    if (!symbolKey) return;
    let cancelled = false;
    Promise.all(symbolKey.split(",").map(async (symbol) => {
      try {
        const body = await fetchCached<{ quote?: { price?: number; currency?: string } }>(`quote:${symbol}`, `/api/market/quote?symbol=${encodeURIComponent(symbol)}`, TTL.quote);
        return [symbol, body.quote?.price ? { price: body.quote.price, currency: body.quote.currency || "USD" } : null] as const;
      } catch { return [symbol, null] as const; }
    })).then((entries) => { if (!cancelled) setQuotes(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [symbolKey]);
  const quotesReady = symbols.every((symbol) => symbol in quotes);
  const unitOf = useMemo(() => Object.fromEntries(symbols.map((symbol) => {
    const code = quotes[symbol]?.currency ?? guessCurrency(symbol);
    return [symbol, code ? normalizeCurrency(code) : null];
  })), [symbols, quotes]);

  // FX to AUD for every currency involved, from the first record.
  const currencies = useMemo(() => [...new Set([
    ...Object.values(unitOf).filter((unit): unit is { currency: string; divisor: number } => !!unit).map((unit) => unit.currency),
    ...cash.map((entry) => entry.currency ?? base),
  ])].filter((code) => code !== "AUD").sort(), [unitOf, cash, base]);
  const firstDate = useMemo(() => [...trades.map((trade) => tradeDate(trade.tradedAt)), ...cash.map((entry) => entry.date)].sort()[0] ?? "", [trades, cash]);
  const fxKey = quotesReady && currencies.length && firstDate ? `fx:${currencies.join(",")}:AUD:${firstDate}` : "";
  const [fx, setFx] = useState<{ key: string; rates: Record<string, RatePoint[]>; failed: string[] }>({ key: "", rates: {}, failed: [] });
  useEffect(() => {
    if (!fxKey) return;
    let active = true;
    fetchCached<{ rates: Record<string, RatePoint[]>; failed?: string[] }>(fxKey, `/api/market/fx?pairs=${currencies.map((code) => `${code}:AUD`).join(",")}&from=${firstDate}`, TTL.daily)
      .then((body) => { if (active) setFx({ key: fxKey, rates: body.rates, failed: body.failed ?? [] }); })
      .catch(() => { if (active) setFx({ key: fxKey, rates: {}, failed: currencies.map((code) => `${code}:AUD`) }); });
    return () => { active = false; };
  }, [fxKey, currencies, firstDate]);
  const ready = quotesReady && (!fxKey || fx.key === fxKey);

  const result = useMemo(() => {
    if (!ready) return null;
    const rate = (currency: string, date: string) => rateOn(fx.rates[`${currency}:AUD`], date);
    const restated = restateInAud(trades, cash, base, rate, (symbol) => unitOf[symbol] ?? null);
    const report = auTaxReport({ trades: restated.trades, cash: restated.cash, isForeign: (symbol) => (unitOf[symbol]?.currency ?? guessCurrency(symbol) ?? "USD") !== "AUD" });
    return { report, missing: restated.missing };
  }, [ready, fx, trades, cash, base, unitOf]);
  const report = result?.report;

  const currentFy = financialYear(new Date().toISOString().slice(0, 10));
  const years = useMemo(() => [...new Set([...(report?.years.map((year) => year.fy) ?? []), currentFy])].sort((a, b) => b - a), [report, currentFy]);
  const [chosenFy, setFy] = useState<number | null>(null);
  const fy = chosenFy != null && years.includes(chosenFy) ? chosenFy : report?.years.at(-1)?.fy ?? currentFy;
  const year = report?.years.find((item) => item.fy === fy);
  const events = report?.events.filter((event) => event.fy === fy) ?? [];
  const dividends = report?.dividends.filter((row) => row.fy === fy) ?? [];
  const flagged = dividends.filter((row) => row.flag);

  // Open parcels: today's value at today's AUD rate, and when each becomes eligible for the discount.
  const latestRate = (currency: string) => (currency === "AUD" ? 1 : fx.rates[`${currency}:AUD`]?.at(-1)?.rate ?? null);
  const parcels = (report?.parcels ?? []).map((parcel) => {
    const unit = unitOf[parcel.symbol];
    const quote = quotes[parcel.symbol];
    const rate = unit ? latestRate(unit.currency) : null;
    const value = quote && unit && rate != null ? parcel.quantity * quote.price / unit.divisor * rate : null;
    return { ...parcel, value, gain: value == null ? null : value - parcel.costBase };
  });

  function exportCsv() {
    if (!report) return;
    const blob = new Blob(["﻿" + taxCsv(report, fy, activePortfolio.name)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activePortfolio.name.replace(/[^\w-]+/g, "-").toLowerCase()}-tax-FY${fyLabel(fy).replace("–", "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const portfolioLabel = (portfolio: typeof activePortfolio) => (zh ? portfolio.nameZh ?? portfolio.name : portfolio.name);
  const range = fyRange(fy);
  const hasRecords = trades.length > 0 || cash.some((entry) => entry.kind === "dividend" || entry.kind === "interest");

  return <main className="trade-ledger tax-report">
    <header className="tl-heading">
      <div>
        <p className="tl-eyebrow">{portfolioLabel(activePortfolio)} / {text("AUSTRALIAN TAX", "澳洲税务")}</p>
        <h1>{text("Tax report", "税务报表")} · FY {fyLabel(fy)}</h1>
        <p className="tl-muted">{text(`${range.from} to ${range.to}, in AUD. Capital gains by parcel (FIFO) and investment income, laid out like the myTax labels.`, `${range.from} 至 ${range.to}，单位 AUD。按批次（先进先出）计算资本利得，并汇总投资收入，按 myTax 栏目排列。`)}</p>
      </div>
      <div className="tl-heading-actions">
        <label className="tl-select">{text("Portfolio", "组合")}
          <select value={activePortfolio.id} onChange={(event) => selectPortfolio(event.target.value)}>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolioLabel(portfolio)}</option>)}</select>
        </label>
        <label className="tl-select tl-select-small">{text("Financial year", "财年")}
          <select value={fy} onChange={(event) => setFy(Number(event.target.value))}>{years.map((item) => <option key={item} value={item}>{fyLabel(item)}</option>)}</select>
        </label>
        <button className="tl-primary" disabled={!report} onClick={exportCsv}>{text("Export CSV for accountant", "导出 CSV（给会计）")}</button>
        <Link className="tl-link" href="/portfolio">{text("Trades", "交易记录")} ↗</Link>
      </div>
    </header>

    {!hasRecords ? <section className="tl-empty">
      <h2>{text("Nothing to report yet", "还没有可报告的记录")}</h2>
      <p>{text("Record trades (with brokerage) and dividends in the trade log; this page turns them into the CGT schedule and income totals.", "先在交易记录里录入交易（含佣金）和分红，这里会自动生成资本利得明细和收入汇总。")}</p>
      <Link className="tl-primary" href="/portfolio">{text("Go to trade log", "去录入交易")}</Link>
    </section> : !report ? <section className="tl-section"><p className="tl-muted">{text("Loading quotes and exchange rates…", "正在读取报价和汇率…")}</p></section> : <>
      {(result!.missing.length > 0 || fx.failed.length > 0) && <p className="tl-notice tl-notice-warn" role="alert">{text(`Missing exchange rates or currency for: ${[...result!.missing, ...fx.failed].join(", ")}. Affected amounts show as —; try again later.`, `缺少以下汇率或币种信息：${[...result!.missing, ...fx.failed].join("、")}。受影响的金额显示为 —，请稍后再试。`)}</p>}
      {report.tradesWithoutBrokerage > 0 && <p className="tl-notice" role="status">{text(`${report.tradesWithoutBrokerage} trade${report.tradesWithoutBrokerage === 1 ? " has" : "s have"} no brokerage recorded. Brokerage raises the cost base and lowers proceeds — add it in the trade editor to avoid overstating gains.`, `有 ${report.tradesWithoutBrokerage} 笔交易没有记录佣金。佣金会计入成本、减少卖出所得，请在交易编辑里补上，否则利得会被高估。`)}</p>}

      <section className="tl-metrics" aria-label={text("Year summary", "年度概览")}>
        <article><span>{text("Net capital gain", "净资本利得")}</span><strong className={tone(year?.netCapitalGain)}>{aud(year?.netCapitalGain ?? 0)}</strong><small>{text("After losses and the 50% discount · 18A", "扣除亏损和 50% 折扣后 · 18A")}</small></article>
        <article><span>{text("Capital losses carried forward", "结转的资本亏损")}</span><strong>{aud(year?.carriedForward ?? 0)}</strong><small>{text("To later years · 18V", "留到以后年度 · 18V")}</small></article>
        <article><span>{text("Dividends + franking credits", "分红 + Franking 抵免")}</span><strong>{aud((year?.dividends.franked ?? 0) + (year?.dividends.unfranked ?? 0) + (year?.dividends.frankingCredits ?? 0))}</strong><small>{text("Australian shares · 11S + 11T + 11U", "澳股 · 11S + 11T + 11U")}</small></article>
        <article><span>{text("Foreign income", "海外收入")}</span><strong>{aud(year?.dividends.foreignGross ?? 0)}</strong><small>{text(`Tax offset ${aud(year?.dividends.foreignTax ?? 0)} · 20E/20M, 20O`, `税收抵免 ${aud(year?.dividends.foreignTax ?? 0)} · 20E/20M、20O`)}</small></article>
      </section>

      <section className="tl-section">
        <div className="tl-section-heading"><div><h2>{text("myTax reference", "myTax 填写参考")}</h2><p>{text("Amounts to check against your broker's annual tax statement before lodging.", "报税前请与券商的年度税务结单逐项核对。")}</p></div></div>
        <div className="tl-scroll"><table className="tax-labels">
          <thead><tr><th className="tl-left">{text("Item", "栏目")}</th><th className="tl-left">{text("What it is", "内容")}</th><th>AUD</th></tr></thead>
          <tbody>{[
            ["18H", text("Total current year capital gains (before losses and discount)", "本年资本利得总额（扣亏损和折扣前）"), year?.gains.total ?? 0],
            ["18A", text("Net capital gain", "净资本利得"), year?.netCapitalGain ?? 0],
            ["18V", text("Net capital losses carried forward to later income years", "结转到以后年度的资本亏损"), year?.carriedForward ?? 0],
            ["11S", text("Unfranked dividends", "Unfranked 分红"), year?.dividends.unfranked ?? 0],
            ["11T", text("Franked dividends", "Franked 分红"), year?.dividends.franked ?? 0],
            ["11U", text("Franking credits", "Franking 抵免额"), year?.dividends.frankingCredits ?? 0],
            ["20E / 20M", text("Assessable foreign source income (dividends grossed up for tax withheld)", "海外应税收入（分红加回预扣税）"), year?.dividends.foreignGross ?? 0],
            ["20O", text("Foreign income tax offset (tax withheld)", "海外税收抵免（预扣税）"), year?.dividends.foreignTax ?? 0],
            ["10L", text("Gross interest", "利息收入"), year?.interest ?? 0],
          ].map(([code, label, value]) => <tr key={code as string}><td className="tl-left"><strong>{code}</strong></td><td className="tl-left">{label}</td><td>{aud(value as number)}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="tl-section">
        <div className="tl-section-heading"><div><h2>{text("How the net capital gain is worked out", "净资本利得怎么算出来的")}</h2><p>{text("Losses go against gains that get no discount first, so as much of the discount as possible is kept.", "亏损先抵没有折扣的利得，再抵有折扣的利得，尽量保留折扣。")}</p></div></div>
        <div className="tl-scroll"><table className="tax-steps"><tbody>
          <tr><td className="tl-left">{text("Gains on parcels held 12 months or more", "持有满 12 个月的利得")}</td><td>{aud(year?.gains.discountable ?? 0)}</td></tr>
          <tr><td className="tl-left">{text("Gains on parcels held less than 12 months", "持有不满 12 个月的利得")}</td><td>{aud(year?.gains.other ?? 0)}</td></tr>
          <tr><td className="tl-left">{text("− Capital losses this year", "− 本年资本亏损")}</td><td>{aud(year?.losses ?? 0)}</td></tr>
          <tr><td className="tl-left">{text("− Losses brought forward from earlier years", "− 以前年度结转的亏损")}</td><td>{aud(year?.priorLosses ?? 0)}</td></tr>
          <tr><td className="tl-left">{text("Losses actually used", "实际用掉的亏损")}</td><td>{aud(year?.lossesUsed ?? 0)}</td></tr>
          <tr><td className="tl-left">{text("− 50% CGT discount on remaining long-term gains", "− 剩余长期利得的 50% 折扣")}</td><td>{aud(year?.discount ?? 0)}</td></tr>
          <tr className="tax-total"><td className="tl-left">{text("Net capital gain", "净资本利得")}</td><td>{aud(year?.netCapitalGain ?? 0)}</td></tr>
          <tr><td className="tl-left">{text("Losses left to carry forward", "剩余可结转亏损")}</td><td>{aud(year?.carriedForward ?? 0)}</td></tr>
        </tbody></table></div>
      </section>

      <section className="tl-section">
        <div className="tl-section-heading"><div><h2>{text("CGT schedule", "资本利得明细")}</h2><p>{text("One row per parcel sold. Cost base includes buy brokerage; proceeds are after sell brokerage. Foreign trades at the trade-date rate.", "每个卖出批次一行。成本含买入佣金，卖出所得已扣卖出佣金。外币交易按成交日汇率折算。")}</p></div></div>
        {events.length ? <div className="tl-scroll"><table>
          <thead><tr>{[text("Symbol", "代码"), text("Acquired", "买入日"), text("Sold", "卖出日"), text("Qty", "数量"), text("Cost base", "成本基础"), text("Proceeds", "卖出所得"), text("Gain / loss", "利得/亏损"), text("Days held", "持有天数"), text("50% discount", "50% 折扣")].map((label, index) => <th key={label} className={index === 0 ? "tl-left" : undefined}>{label}</th>)}</tr></thead>
          <tbody>{events.map((event) => <tr key={`${event.saleId}:${event.buyId}`}>
            <td className="tl-left tl-symbol">{event.symbol}</td><td>{event.acquiredAt}</td><td>{event.disposedAt}</td>
            <td>{event.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td>{aud(event.costBase)}</td><td>{aud(event.proceeds)}</td>
            <td className={tone(event.gain)}>{signedAud(event.gain)}</td><td>{event.days}</td>
            <td>{event.gain <= 0 ? "—" : event.discountable ? text("Yes", "是") : text("No", "否")}</td>
          </tr>)}</tbody>
          <tfoot><tr><td className="tl-left">{text("Total", "合计")}</td><td colSpan={3} /><td>{aud(events.reduce((sum, event) => sum + event.costBase, 0))}</td><td>{aud(events.reduce((sum, event) => sum + event.proceeds, 0))}</td><td className={tone(events.reduce((sum, event) => sum + event.gain, 0))}>{signedAud(events.reduce((sum, event) => sum + event.gain, 0))}</td><td colSpan={2} /></tr></tfoot>
        </table></div> : <p className="tl-muted">{text("No sales in this financial year.", "这个财年没有卖出。")}</p>}
      </section>

      <section className="tl-section">
        <div className="tl-section-heading"><div><h2>{text("Dividends", "分红")}</h2><p>{text("Cash received plus franking credits (Australian) or tax withheld (foreign).", "到账金额加 Franking 抵免（澳股）或加回预扣税（外国股票）。")}</p></div></div>
        {flagged.length > 0 && <p className="tl-notice" role="status">{text(`${flagged.length} dividend${flagged.length === 1 ? "" : "s"} missing tax details: Australian ones need the franked % (0 if unfranked); foreign ones need the tax withheld (US shares are usually 15% with a W-8BEN). Add them in the cash ledger.`, `有 ${flagged.length} 笔分红缺少税务信息：澳股需要填 franked 比例（全部 unfranked 就填 0）；外国股票需要填预扣税（美股签了 W-8BEN 通常是 15%）。请在现金账本里补充。`)}</p>}
        {dividends.length ? <div className="tl-scroll"><table>
          <thead><tr>{[text("Date", "日期"), text("Symbol", "代码"), text("Type", "类型"), text("Cash", "到账"), text("Franked", "Franked"), text("Unfranked", "Unfranked"), text("Franking credit", "Franking 抵免"), text("Withheld", "预扣税"), text("Assessable", "应税金额")].map((label, index) => <th key={label} className={index === 1 ? "tl-left" : undefined}>{label}</th>)}</tr></thead>
          <tbody>{dividends.map((row) => <tr key={row.id} className={row.flag ? "tax-flag" : undefined}>
            <td>{row.date}</td><td className="tl-left tl-symbol">{row.symbol || "—"}</td><td>{row.foreign ? text("Foreign", "外国") : text("Australian", "澳洲")}{row.sourceCurrency && row.sourceCurrency !== "AUD" ? <small>{text(`from ${row.sourceCurrency}`, `原币 ${row.sourceCurrency}`)}</small> : null}</td>
            <td>{aud(row.cash)}</td><td>{row.foreign ? "—" : aud(row.franked)}</td><td>{row.foreign ? "—" : aud(row.unfranked)}</td><td>{row.foreign ? "—" : aud(row.frankingCredit)}</td><td>{row.foreign ? aud(row.withheld) : "—"}</td><td>{aud(row.assessable)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="tl-muted">{text("No dividends recorded in this financial year.", "这个财年没有记录分红。")}</p>}
      </section>

      <section className="tl-section">
        <div className="tl-section-heading"><div><h2>{text("Parcels still held", "仍持有的批次")}</h2><p>{text("When each parcel qualifies for the 50% discount, and the gain if sold today (today's price and rate, before brokerage). Useful before selling near 30 June or close to the 12-month mark.", "每个批次哪天起可享 50% 折扣，以及按今天价格和汇率卖出的估算利得（未扣佣金）。临近 6 月 30 日或快满 12 个月时卖出前可以先看这里。")}</p></div></div>
        {parcels.length ? <div className="tl-scroll"><table>
          <thead><tr>{[text("Symbol", "代码"), text("Acquired", "买入日"), text("Qty", "数量"), text("Cost base", "成本基础"), text("Value today", "今日市值"), text("Gain if sold", "现在卖出利得"), text("Discount from", "可享折扣日"), text("Wait", "还需等待")].map((label, index) => <th key={label} className={index === 0 ? "tl-left" : undefined}>{label}</th>)}</tr></thead>
          <tbody>{parcels.map((parcel) => <tr key={`${parcel.tradeId}`} className={parcel.daysToDiscount > 0 && parcel.daysToDiscount <= 60 && (parcel.gain ?? 0) > 0 ? "tax-soon" : undefined}>
            <td className="tl-left tl-symbol">{parcel.symbol}</td><td>{parcel.acquiredAt}</td><td>{parcel.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
            <td>{aud(parcel.costBase)}</td><td>{aud(parcel.value)}</td><td className={tone(parcel.gain)}>{signedAud(parcel.gain)}</td>
            <td>{parcel.discountFrom}</td><td>{parcel.daysToDiscount > 0 ? text(`${parcel.daysToDiscount} days`, `${parcel.daysToDiscount} 天`) : text("Eligible", "已满足")}</td>
          </tr>)}</tbody>
        </table></div> : <p className="tl-muted">{text("No open parcels.", "没有持仓批次。")}</p>}
      </section>

      <section className="tl-section tax-method">
        <h2>{text("Assumptions", "计算假设")}</h2>
        <ul>
          <li>{text("Australian resident individual holding shares as an investor (capital account). Not for traders, companies, trusts, SMSFs or non-residents (SMSFs get a one-third discount; companies none).", "适用于以投资者身份（资本账户）持股的澳洲税务居民个人。不适用于以交易为业者、公司、信托、SMSF 或非居民（SMSF 折扣为三分之一，公司没有折扣）。")}</li>
          <li>{text("Parcels are matched first-in, first-out. The ATO also accepts choosing specific parcels if your records identify them — that can lower the gain, but it is not modelled here.", "批次按先进先出匹配。如果记录能识别具体批次，ATO 也允许你指定卖出哪一批，这样有时能降低利得，本页暂未支持。")}</li>
          <li>{text("Foreign amounts use the daily reference rate (Yahoo) on the transaction date; your broker's actual rate can differ slightly. Share splits keep the original acquisition date.", "外币金额按交易当日的参考汇率（Yahoo）折算，与券商实际成交汇率可能略有差异。拆股不改变原始买入日期。")}</li>
          <li>{text("Not covered: dividend reinvestment plans, rights issues, mergers / demergers, return of capital, wash sales, and the 45-day rule for franking credits. Check with your accountant before lodging.", "未覆盖：分红再投资（DRP）、配股、合并/分拆、资本返还、洗售以及 franking 抵免的 45 天规则。报税前请与会计确认。")}</li>
        </ul>
        <p className="tl-muted">{text("This is a calculation aid, not tax advice.", "本页仅用于辅助计算，不构成税务建议。")}</p>
      </section>
    </>}
  </main>;
}
