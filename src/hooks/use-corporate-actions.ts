"use client";

import { useEffect, useMemo, useState } from "react";
import { TTL, fetchCached } from "@/lib/client-cache";
import type { StockSplit } from "@/lib/corporate-actions";
import { tradeDate } from "@/lib/portfolio-trades";
import type { ManagedPortfolio } from "@/hooks/use-portfolios";

export type DividendEvent = { symbol: string; date: string; amount: number };
export type CorporateActions = { splits: StockSplit[]; dividends: DividendEvent[]; failed: string[] };

/** Request for one portfolio's corporate actions; null when it has no trades. Shared cache key so every caller reuses one fetch. */
export function corporateActionsRequest(portfolio: Pick<ManagedPortfolio, "trades">) {
  const trades = portfolio.trades ?? [];
  if (!trades.length) return null;
  const symbols = [...new Set(trades.map((trade) => trade.symbol))].sort().join(",");
  // Events before the first trade can't affect any position, so there is no need to fetch them.
  const from = trades.map((trade) => tradeDate(trade.tradedAt)).sort()[0];
  return { key: `corporate:${symbols}:${from}`, url: `/api/market/corporate-actions?symbols=${encodeURIComponent(symbols)}&from=${from}` };
}

export function fetchCorporateActions(portfolio: Pick<ManagedPortfolio, "trades">) {
  const request = corporateActionsRequest(portfolio);
  return request ? fetchCached<CorporateActions>(request.key, request.url, TTL.company) : Promise.resolve(null);
}

export function useCorporateActions(portfolio: ManagedPortfolio) {
  const request = useMemo(() => corporateActionsRequest(portfolio), [portfolio]);
  const [state, setState] = useState<{ key: string; data: CorporateActions | null }>({ key: "", data: null });
  useEffect(() => {
    if (!request) return;
    let active = true;
    fetchCached<CorporateActions>(request.key, request.url, TTL.company).then((data) => { if (active) setState({ key: request.key, data }); }).catch(() => undefined);
    return () => { active = false; };
  }, [request]);
  return request && state.key === request.key ? state.data : null;
}
