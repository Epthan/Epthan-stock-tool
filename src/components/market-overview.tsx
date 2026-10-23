"use client";

import { useEffect, useState } from "react";
import { fetchCached, forgetCached } from "@/lib/client-cache";
import { OVERVIEW_GROUPS, formatOverview, overviewName } from "@/lib/market-overview";
import { ErrorState, StatePanel } from "@/components/state-panel";

type Row = { symbol: string; price: number; change: number; changePercent: number };
type Payload = { groups: { id: string; items: Row[] }[]; updatedAt: string };
const KEY = "market-overview";

/** Broad market, S&P 500 sectors and macro gauges. Click any tile to open it in the chart. */
export function MarketOverview({ zh, onPick }: { zh: boolean; onPick: (symbol: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => fetchCached<Payload>(KEY, "/api/market/overview", 30_000, undefined, (fresh) => { if (active) setData(fresh); })
      .then((payload) => { if (active) { setData(payload); setError(""); } })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [retry]);

  if (!data) return error ? <ErrorState compact message={error} zh={zh} onRetry={() => { forgetCached(KEY); setRetry((value) => value + 1); }} /> : <StatePanel compact kind="loading" title={zh ? "正在加载指数…" : "Loading indexes…"} />;
  const rows = (id: string) => data.groups.find((group) => group.id === id)?.items ?? [];
  const tone = (value: number) => (Math.abs(value) < 0.005 ? "" : value > 0 ? "is-up" : "is-down");
  const tile = (row: Row) => { const shown = formatOverview(row.symbol, row.price, row.change, row.changePercent); return <button key={row.symbol} className="mo-tile" onClick={() => onPick(row.symbol)} title={row.symbol}>
    <span className="mo-name">{overviewName(row.symbol, zh)}</span><span className="mo-value wpx-num">{shown.value}</span><span className={`mo-change wpx-num ${tone(row.change)}`}>{shown.change}</span>
  </button>; };

  const sectors = [...rows("sectors")].sort((left, right) => right.changePercent - left.changePercent);
  const scale = Math.max(1, ...sectors.map((row) => Math.abs(row.changePercent)));
  const spx = rows("broad").find((row) => row.symbol === "^GSPC");
  const equal = rows("broad").find((row) => row.symbol === "RSP");
  const value = rows("broad").find((row) => row.symbol === "IWD"), growth = rows("broad").find((row) => row.symbol === "IWF");
  const up = sectors.filter((row) => row.changePercent > 0).length;
  const reads: string[] = [];
  if (spx && equal) reads.push(zh ? `等权标普 ${equal.changePercent >= spx.changePercent ? "强于" : "弱于"}市值加权 ${Math.abs(equal.changePercent - spx.changePercent).toFixed(2)} 个百分点：${equal.changePercent >= spx.changePercent ? "上涨扩散到更多股票" : "涨跌主要由大市值股驱动"}。` : `Equal-weight S&P ${equal.changePercent >= spx.changePercent ? "beat" : "lagged"} cap-weight by ${Math.abs(equal.changePercent - spx.changePercent).toFixed(2)} pp — ${equal.changePercent >= spx.changePercent ? "breadth is broad" : "moves are led by mega-caps"}.`);
  if (value && growth) reads.push(zh ? `${value.changePercent > growth.changePercent ? "价值跑赢成长" : "成长跑赢价值"} ${Math.abs(value.changePercent - growth.changePercent).toFixed(2)} 个百分点。` : `${value.changePercent > growth.changePercent ? "Value beat growth" : "Growth beat value"} by ${Math.abs(value.changePercent - growth.changePercent).toFixed(2)} pp.`);
  if (sectors.length) reads.push(zh ? `${sectors.length} 个行业中 ${up} 个上涨；最强 ${overviewName(sectors[0].symbol, true)}，最弱 ${overviewName(sectors.at(-1)!.symbol, true)}。` : `${up} of ${sectors.length} sectors up; strongest ${overviewName(sectors[0].symbol, false)}, weakest ${overviewName(sectors.at(-1)!.symbol, false)}.`);

  return <section className="mo-panel" aria-label={zh ? "美股市场概览" : "US market overview"}>
    <header className="mo-head"><div><h2>{zh ? "美股市场概览" : "US market overview"}</h2><p>{zh ? "大盘、风格、行业与宏观，一页看清今天的市场。" : "Broad market, style, sectors and macro on one page."}</p></div><span className="mo-stamp">{zh ? "约延迟 15 分钟 · 30 秒刷新" : "~15 min delayed · refreshes every 30 s"}</span></header>
    {reads.length > 0 && <ul className="mo-read">{reads.map((line) => <li key={line}>{line}</li>)}</ul>}
    <div className="mo-grid">
      <div className="mo-group"><h3>{zh ? OVERVIEW_GROUPS[0].zh : OVERVIEW_GROUPS[0].en}</h3><div className="mo-tiles">{rows("broad").map(tile)}</div></div>
      <div className="mo-group"><h3>{zh ? OVERVIEW_GROUPS[2].zh : OVERVIEW_GROUPS[2].en}</h3><div className="mo-tiles">{rows("macro").map(tile)}</div></div>
      <div className="mo-group mo-sectors"><h3>{zh ? OVERVIEW_GROUPS[1].zh : OVERVIEW_GROUPS[1].en}<small>{zh ? "SPDR 行业 ETF · 今日" : "SPDR sector ETFs · today"}</small></h3>
        <ul>{sectors.map((row) => <li key={row.symbol}><button onClick={() => onPick(row.symbol)}><span className="mo-name">{overviewName(row.symbol, zh)}<small>{row.symbol}</small></span><span className="mo-bar"><span className={row.changePercent >= 0 ? "is-up-bg" : "is-down-bg"} style={{ width: `${Math.abs(row.changePercent) / scale * 50}%`, [row.changePercent >= 0 ? "left" : "right"]: "50%" }} /></span><span className={`wpx-num ${tone(row.changePercent)}`}>{formatOverview(row.symbol, row.price, row.change, row.changePercent).change}</span></button></li>)}</ul>
      </div>
    </div>
    <p className="mo-foot">{zh ? "数据来自 Yahoo · 点击任意一项，在“个股研究”中打开图表" : "Data from Yahoo · click any item to open its chart in Research"}</p>
  </section>;
}
