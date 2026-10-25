"use client";

import { hierarchy, treemap as buildTreemap } from "d3-hierarchy";
import { useEffect, useMemo, useState } from "react";
import { useStoredWatchlists } from "@/hooks/use-stored-watchlists";
import { usePortfolios } from "@/hooks/use-portfolios";
import { useLanguage } from "@/components/language-provider";
import { useStockSelection } from "@/components/stock-selection-provider";
import { ErrorState, StatePanel } from "@/components/state-panel";
import { TTL, fetchCached } from "@/lib/client-cache";
import { sectorLabel } from "@/lib/breakdowns";
import { getTradePosition } from "@/lib/portfolio-trades";
import { watchlistLabel } from "@/lib/watchlists";
import type { TimeframeKey } from "@/lib/mock-market";

type TreemapIndexKey = "sp100" | "nasdaq100";
type Item = { symbol: string; name: string; sector: string; changePercent: number; magnitude: number; price: number; marketCap?: number; currency?: string };
type Leaf = Item & { value: number; holding?: number };
type Node = { name: string; children?: Node[]; value?: number; item?: Leaf };
type Size = "cap" | "move" | "holding" | "equal";

const TIMEFRAMES: TimeframeKey[] = ["1D", "5D", "1M", "3M", "6M", "1Y"];
/** Colour saturates at this move: a 3% day is as strong as a 30% year. */
const SCALE: Partial<Record<TimeframeKey, number>> = { "1D": 3, "5D": 6, "1M": 10, "3M": 15, "6M": 20, "1Y": 30 };
// Layout is computed in a fixed coordinate space and the SVG scales to fit.
const W = 1200, H = 720;

// Tint between the panel colour and up/down, so tiles follow the active skin.
function fill(change: number, timeframe: TimeframeKey) {
  const strength = Math.min(1, Math.abs(change) / (SCALE[timeframe] ?? 10));
  const mix = Math.round(18 + strength * 70);
  return `color-mix(in srgb, ${change >= 0 ? "var(--ui-up)" : "var(--ui-down)"} ${mix}%, var(--ui-panel-2))`;
}

export function TreemapView({ initialIndex = "sp100" }: { initialIndex?: TreemapIndexKey }) {
  const { locale } = useLanguage();
  const zh = locale === "zh";
  const text = (english: string, chinese: string) => (zh ? chinese : english);
  const { pickSymbol } = useStockSelection();
  const { watchlists, activeWatchlistId } = useStoredWatchlists();
  const { portfolios, activePortfolio } = usePortfolios();
  const [source, setSource] = useState<string>(`index:${initialIndex}`);
  const [timeframe, setTimeframe] = useState<TimeframeKey>("1D");
  const [size, setSize] = useState<Size>("cap");
  const [hover, setHover] = useState<Leaf | null>(null);
  const [retry, setRetry] = useState(0);

  const holdings = useMemo(() => {
    const out = new Map<string, number>();
    const portfolio = source.startsWith("portfolio:") ? portfolios.find((item) => `portfolio:${item.id}` === source) : activePortfolio;
    for (const symbol of new Set((portfolio?.trades ?? []).map((trade) => trade.symbol))) {
      const quantity = getTradePosition(portfolio!.trades!, symbol, portfolio!.splits).quantity;
      if (quantity > 1e-8) out.set(symbol, quantity);
    }
    return out;
  }, [source, portfolios, activePortfolio]);

  const sources = [
    { id: "index:sp100", label: "S&P 100" }, { id: "index:nasdaq100", label: "Nasdaq 100" },
    ...watchlists.map((list) => ({ id: `watch:${list.id}`, label: `${text("Watch list", "自选")} · ${watchlistLabel(list.name, zh)}` })),
    ...portfolios.filter((portfolio) => portfolio.trades?.length).map((portfolio) => ({ id: `portfolio:${portfolio.id}`, label: `${text("Holdings", "持仓")} · ${zh ? portfolio.nameZh ?? portfolio.name : portfolio.name}` })),
  ];
  const sizeMode: Size = source.startsWith("portfolio:") && size === "cap" ? "holding" : size;
  const symbols = source.startsWith("watch:") ? (watchlists.find((list) => `watch:${list.id}` === source) ?? watchlists.find((list) => list.id === activeWatchlistId))?.symbols ?? []
    : source.startsWith("portfolio:") ? [...holdings.keys()] : [];
  const symbolKey = symbols.join(",");
  const url = source.startsWith("index:") ? `/api/market/treemap?index=${source.slice(6)}&timeframe=${timeframe}` : `/api/market/treemap?symbols=${encodeURIComponent(symbolKey)}&timeframe=${timeframe}`;
  const requestKey = `${url}:${retry}`;
  const [state, setState] = useState<{ key: string; items: Item[]; error?: string }>({ key: "", items: [] });
  useEffect(() => {
    if (!source.startsWith("index:") && !symbolKey) return;
    let active = true;
    fetchCached<{ items: Item[]; message?: string }>(`treemap:${url}`, url, timeframe === "1D" ? TTL.quote * 4 : TTL.daily)
      .then((body) => { if (active) setState({ key: requestKey, items: body.items ?? [], error: body.items?.length ? undefined : body.message }); })
      .catch((error: Error) => { if (active) setState({ key: requestKey, items: [], error: error.message }); });
    return () => { active = false; };
  }, [url, requestKey, source, symbolKey, timeframe]);
  const loading = state.key !== requestKey && (source.startsWith("index:") || !!symbolKey);

  const leaves: Leaf[] = useMemo(() => state.items.map((item) => {
    const holding = holdings.get(item.symbol);
    const value = sizeMode === "holding" ? (holding ?? 0) * item.price : sizeMode === "cap" ? item.marketCap ?? 0 : sizeMode === "move" ? item.magnitude : 1;
    return { ...item, holding, value };
  }).filter((leaf) => leaf.value > 0), [state.items, holdings, sizeMode]);

  const layout = useMemo(() => {
    const sectors = new Map<string, Leaf[]>();
    for (const leaf of leaves) sectors.set(leaf.sector || "Other", [...(sectors.get(leaf.sector || "Other") ?? []), leaf]);
    const root = hierarchy<Node>({ name: "root", children: [...sectors].map(([name, items]) => ({ name, children: items.map((item) => ({ name: item.symbol, value: item.value, item })) })) })
      .sum((node) => node.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const tree = buildTreemap<Node>().size([W, H]).paddingOuter(4).paddingTop(22).paddingInner(2).round(true)(root);
    const total = leaves.reduce((sum, leaf) => sum + leaf.value, 0);
    const sectorRows = (tree.children ?? []).map((node) => {
      const items = node.leaves().map((leaf) => leaf.data.item!);
      const weight = items.reduce((sum, item) => sum + item.value, 0);
      return { name: node.data.name, node, share: total ? weight / total * 100 : 0, change: weight ? items.reduce((sum, item) => sum + item.changePercent * item.value, 0) / weight : 0, count: items.length };
    });
    return { sectors: sectorRows, tiles: tree.leaves() };
  }, [leaves]);
  const advancers = leaves.filter((leaf) => leaf.changePercent > 0).length;
  const weighted = (() => { const total = leaves.reduce((sum, leaf) => sum + leaf.value, 0); return total ? leaves.reduce((sum, leaf) => sum + leaf.changePercent * leaf.value, 0) / total : null; })();
  const pct = (value: number | null | undefined, digits = 2) => (value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`);
  const sizeLabels: Record<Size, string> = { cap: text("Market cap", "市值"), move: text("Move size", "涨跌幅度"), holding: text("My position value", "我的持仓市值"), equal: text("Equal", "等大") };

  return <main className="pg-page tm-page">
    <header className="pg-head">
      <div><p className="pg-eyebrow">{text("Heatmap", "热力图")}</p><h1>{text("Where the market moved", "资金往哪儿走")}</h1><p className="pg-sub">{text("Tiles grouped by sector; colour is the move over the window, size is what you choose.", "按行业分组；颜色是区间涨跌，大小按你选的口径。")}</p></div>
      <div className="pg-controls">
        <label className="pg-field">{text("Universe", "范围")}<select value={source} onChange={(event) => { setSource(event.target.value); setHover(null); }}>{sources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <div className="pg-seg" role="group" aria-label={text("Window", "区间")}>{TIMEFRAMES.map((item) => <button key={item} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>{item}</button>)}</div>
        <label className="pg-field">{text("Tile size", "方块大小")}<select value={sizeMode} onChange={(event) => setSize(event.target.value as Size)}>{(["cap", "move", "equal", ...(holdings.size ? ["holding"] : [])] as Size[]).map((key) => <option key={key} value={key}>{sizeLabels[key]}</option>)}</select></label>
      </div>
    </header>

    {!source.startsWith("index:") && !symbols.length ? <StatePanel kind="empty" title={text("No symbols in this list", "这个范围里没有股票")}><p>{text("Pick another universe, or add symbols / record trades first.", "换一个范围，或先添加自选、录入交易。")}</p></StatePanel>
    : loading && !state.items.length ? <StatePanel kind="loading" title={text("Building the heatmap…", "正在生成热力图…")}><p>{text("Index heatmaps fetch ~100 quotes; the first load can take 20–40 seconds, later ones are cached.", "指数热力图需要获取约 100 只股票行情，首次加载约 20–40 秒，之后走缓存。")}</p></StatePanel>
    : !leaves.length ? <ErrorState message={state.error ?? text("No heatmap data available", "暂无热力图数据")} zh={zh} onRetry={() => setRetry((value) => value + 1)} />
    : <div className="tm-layout">
      <section className="pg-panel tm-map">
        <div className="pg-panel-head"><h2>{sources.find((item) => item.id === source)?.label} · {timeframe}</h2>
          <span className="tm-scale"><i style={{ background: fill(-(SCALE[timeframe] ?? 10), timeframe) }} />−{SCALE[timeframe]}%<i style={{ background: fill(0, timeframe) }} />0<i style={{ background: fill(SCALE[timeframe] ?? 10, timeframe) }} />+{SCALE[timeframe]}%{loading && <span className="pd-updating">{text("Updating…", "更新中…")}</span>}</span></div>
        <div className="tm-canvas" onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={text("Heatmap", "热力图")}>
            {layout.sectors.map(({ name, node }) => <g key={name}><rect x={node.x0} y={node.y0} width={node.x1 - node.x0} height={node.y1 - node.y0} rx={8} className="tm-sector" />{node.x1 - node.x0 > 70 && <text x={node.x0 + 8} y={node.y0 + 15} className="tm-sector-label">{sectorLabel(name, zh)}</text>}</g>)}
            {layout.tiles.map((tile) => {
              const item = tile.data.item!;
              const w = tile.x1 - tile.x0, h = tile.y1 - tile.y0;
              const big = w > 70 && h > 46, small = w > 34 && h > 20;
              const fontSize = Math.max(10, Math.min(22, Math.sqrt(w * h) / 6));
              return <g key={item.symbol} className="tm-tile" tabIndex={0} role="button" aria-label={`${item.symbol} ${pct(item.changePercent)}`} onPointerEnter={() => setHover(item)} onFocus={() => setHover(item)} onClick={() => pickSymbol(item.symbol)} onKeyDown={(event) => { if (event.key === "Enter") pickSymbol(item.symbol); }}>
                <rect x={tile.x0} y={tile.y0} width={w} height={h} rx={4} style={{ fill: fill(item.changePercent, timeframe) }} className={hover?.symbol === item.symbol ? "is-hover" : ""} />
                {small && <text x={tile.x0 + w / 2} y={tile.y0 + h / 2 + (big ? -fontSize * 0.25 : fontSize * 0.35)} textAnchor="middle" className="tm-symbol" style={{ fontSize }}>{item.symbol}</text>}
                {big && <text x={tile.x0 + w / 2} y={tile.y0 + h / 2 + fontSize * 0.85} textAnchor="middle" className="tm-change" style={{ fontSize: fontSize * 0.62 }}>{pct(item.changePercent)}</text>}
              </g>;
            })}
          </svg>
          {hover && <div className="tm-tip"><strong>{hover.symbol}</strong><span>{hover.name}</span><span>{sectorLabel(hover.sector, zh)}</span><span>{hover.price.toFixed(2)} {hover.currency ?? ""} · <b className={hover.changePercent >= 0 ? "is-up" : "is-down"}>{pct(hover.changePercent)}</b></span>{hover.holding != null && <span>{text("You hold", "你持有")} {hover.holding.toLocaleString(undefined, { maximumFractionDigits: 4 })} · {(hover.holding * hover.price).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}<small>{text("Click to open in Market", "点击在行情页打开")}</small></div>}
        </div>
      </section>
      <aside className="pg-panel tm-side">
        <div className="pg-panel-head"><h2>{text("Breadth", "市场宽度")}</h2></div>
        <dl className="tm-breadth"><div><dt>{text("Up / down", "涨 / 跌")}</dt><dd><span className="is-up">{advancers}</span> / <span className="is-down">{leaves.length - advancers}</span></dd></div><div><dt>{text(`Weighted (${sizeLabels[sizeMode]})`, `加权（${sizeLabels[sizeMode]}）`)}</dt><dd className={weighted == null ? "" : weighted >= 0 ? "is-up" : "is-down"}>{pct(weighted)}</dd></div></dl>
        <div className="pg-panel-head"><h2>{text("Sectors", "行业")}</h2></div>
        <ul className="tm-sectors">{[...layout.sectors].sort((a, b) => b.change - a.change).map((row) => <li key={row.name}><span>{sectorLabel(row.name, zh)}<small>{row.count} · {row.share.toFixed(0)}%</small></span><span className="tm-bar"><span style={{ width: `${Math.min(100, Math.abs(row.change) / (SCALE[timeframe] ?? 10) * 100)}%`, background: row.change >= 0 ? "var(--ui-up)" : "var(--ui-down)" }} /></span><b className={row.change >= 0 ? "is-up" : "is-down"}>{pct(row.change)}</b></li>)}</ul>
      </aside>
    </div>}
  </main>;
}
