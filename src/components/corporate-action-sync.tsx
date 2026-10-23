"use client";

import { useEffect } from "react";
import { fetchCorporateActions } from "@/hooks/use-corporate-actions";
import { usePortfolios } from "@/hooks/use-portfolios";

/** Detects share splits for every portfolio with trades and stores them, so positions stay on today's share basis everywhere. */
export function CorporateActionSync() {
  const { portfolios, setSplits } = usePortfolios();
  const signature = portfolios.map((portfolio) => `${portfolio.id}:${(portfolio.trades ?? []).map((trade) => `${trade.symbol}@${trade.tradedAt}`).join(",")}`).join("|");
  useEffect(() => {
    let active = true;
    for (const portfolio of portfolios) {
      fetchCorporateActions(portfolio).then((data) => {
        if (!active || !data) return;
        const symbols = new Set((portfolio.trades ?? []).map((trade) => trade.symbol));
        // A failed lookup must not wipe splits already known for that symbol.
        const kept = (portfolio.splits ?? []).filter((split) => data.failed.includes(split.symbol));
        setSplits(portfolio.id, [...kept, ...data.splits.filter((split) => symbols.has(split.symbol))]);
      }).catch(() => undefined);
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the set of trades changes
  }, [signature]);
  return null;
}
