"use client";

import { useMemo, useSyncExternalStore } from "react";
import { demoPortfolios } from "@/lib/portfolio-analytics";
import { validatePortfolioTrades, type PortfolioTrade } from "@/lib/portfolio-trades";

export type ManagedPortfolio = { id: string; name: string; nameZh?: string; initials: string; symbols: string[]; demoId?: string; trades?: PortfolioTrade[] };
const symbolOrder = ["AAPL", "MSFT", "NVDA", "JPM", "JNJ", "XOM"];
export const initialPortfolios: ManagedPortfolio[] = demoPortfolios.map((portfolio) => ({
  id: portfolio.id, name: portfolio.name, nameZh: portfolio.nameZh, initials: portfolio.initials, demoId: portfolio.id,
  symbols: symbolOrder.filter((_, index) => portfolio.quantities[index] > 0),
}));
const portfoliosKey = "stock-tool.portfolios.v1";
const activeKey = "stock-tool.active-portfolio.v1";
const changeEvent = "portfolio-selection-change";
const defaultSnapshot = JSON.stringify({ portfolios: initialPortfolios, activeId: "balanced" });

function readState() {
  let portfolios = initialPortfolios;
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(portfoliosKey) ?? "null");
    if (Array.isArray(stored) && stored.length > 0) {
      const clean = stored.filter((item): item is ManagedPortfolio => !!item && typeof item.id === "string" && typeof item.name === "string" && item.name.trim().length > 0 && typeof item.initials === "string" && Array.isArray(item.symbols) && item.symbols.every((symbol: unknown) => typeof symbol === "string"));
      if (clean.length) portfolios = clean;
    }
  } catch {}
  const saved = window.localStorage.getItem(activeKey);
  return { portfolios, activeId: portfolios.find((portfolio) => portfolio.id === saved)?.id ?? portfolios[0].id };
}
function snapshot() { return JSON.stringify(readState()); }
function serverSnapshot() { return defaultSnapshot; }
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changeEvent, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(changeEvent, listener); };
}
function save(state: { portfolios: ManagedPortfolio[]; activeId: string }) {
  window.localStorage.setItem(portfoliosKey, JSON.stringify(state.portfolios));
  window.localStorage.setItem(activeKey, state.activeId);
  window.dispatchEvent(new Event(changeEvent));
}

export function usePortfolios() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const state = useMemo(() => JSON.parse(raw) as { portfolios: ManagedPortfolio[]; activeId: string }, [raw]);
  const activePortfolio = state.portfolios.find((portfolio) => portfolio.id === state.activeId) ?? state.portfolios[0];
  return {
    ...state, activePortfolio,
    selectPortfolio(id: string) { const current = readState(); if (current.portfolios.some((portfolio) => portfolio.id === id)) save({ ...current, activeId: id }); },
    createPortfolio(name: string) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a portfolio name.");
      const current = readState();
      if (current.portfolios.some((portfolio) => portfolio.name.toLowerCase() === trimmed.toLowerCase())) throw new Error("A portfolio with this name already exists.");
      const portfolio = { id: crypto.randomUUID(), name: trimmed, initials: trimmed.slice(0, 2).toUpperCase(), symbols: [] };
      save({ portfolios: [...current.portfolios, portfolio], activeId: portfolio.id });
    },
    renamePortfolio(id: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a portfolio name.");
      const current = readState();
      if (current.portfolios.some((portfolio) => portfolio.id !== id && portfolio.name.toLowerCase() === trimmed.toLowerCase())) throw new Error("A portfolio with this name already exists.");
      save({ ...current, portfolios: current.portfolios.map((portfolio) => portfolio.id === id ? { ...portfolio, name: trimmed, nameZh: undefined, initials: trimmed.slice(0, 2).toUpperCase() } : portfolio) });
    },
    deletePortfolio(id: string) {
      const current = readState();
      if (current.portfolios.length <= 1) throw new Error("Keep at least one portfolio.");
      const portfolios = current.portfolios.filter((portfolio) => portfolio.id !== id);
      save({ portfolios, activeId: current.activeId === id ? portfolios[0].id : current.activeId });
    },
    addSymbol(id: string, symbol: string) {
      const normalized = symbol.trim().toUpperCase();
      if (!/^[A-Z0-9^][A-Z0-9.^=\-]{0,24}$/.test(normalized)) throw new Error("Enter a valid stock symbol.");
      const current = readState();
      save({ ...current, portfolios: current.portfolios.map((portfolio) => portfolio.id === id ? { ...portfolio, symbols: [...new Set([...portfolio.symbols, normalized])] } : portfolio) });
    },
    removeSymbol(id: string, symbol: string) {
      const current = readState();
      if (current.portfolios.find((portfolio) => portfolio.id === id)?.trades?.some((trade) => trade.symbol === symbol)) throw new Error("This security has trade history. Remove its trade records before removing the security.");
      save({ ...current, portfolios: current.portfolios.map((portfolio) => portfolio.id === id ? { ...portfolio, symbols: portfolio.symbols.filter((item) => item !== symbol) } : portfolio) });
    },
    saveTrade(portfolioId: string, trade: PortfolioTrade) {
      trade = { ...trade, price: Math.round((trade.price + Number.EPSILON) * 100) / 100 };
      const current = readState();
      const portfolio = current.portfolios.find((item) => item.id === portfolioId);
      if (!portfolio) throw new Error("PORTFOLIO_NOT_FOUND");
      const previous = portfolio.trades ?? [];
      const trades = previous.some((item) => item.id === trade.id) ? previous.map((item) => item.id === trade.id ? trade : item) : [...previous, trade];
      validatePortfolioTrades(trades);
      save({ ...current, portfolios: current.portfolios.map((item) => item.id === portfolioId ? { ...item, trades, symbols: [...new Set([...item.symbols, trade.symbol])] } : item) });
    },
    deleteTrade(portfolioId: string, tradeId: string) {
      const current = readState();
      const portfolio = current.portfolios.find((item) => item.id === portfolioId);
      if (!portfolio) throw new Error("PORTFOLIO_NOT_FOUND");
      const trades = (portfolio.trades ?? []).filter((trade) => trade.id !== tradeId);
      validatePortfolioTrades(trades);
      save({ ...current, portfolios: current.portfolios.map((item) => item.id === portfolioId ? { ...item, trades } : item) });
    },
  };
}
