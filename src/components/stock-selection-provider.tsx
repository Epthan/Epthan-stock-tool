"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { normalizeSymbol } from "@/lib/market-symbols";

type StockSelectionContextValue = {
  selectedSymbol: string | null;
  pickSymbol: (symbol: string) => void;
};

const StockSelectionContext = createContext<StockSelectionContextValue | null>(null);

export function StockSelectionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const value = useMemo<StockSelectionContextValue>(
    () => ({
      selectedSymbol,
      pickSymbol(symbol) {
        const normalized = normalizeSymbol(symbol);

        if (!normalized) {
          return;
        }

        setSelectedSymbol(normalized);

        if (pathname !== "/") {
          router.push("/");
        }
      },
    }),
    [pathname, router, selectedSymbol],
  );

  return <StockSelectionContext.Provider value={value}>{children}</StockSelectionContext.Provider>;
}

export function useStockSelection() {
  const context = useContext(StockSelectionContext);

  if (!context) {
    throw new Error("useStockSelection must be used inside StockSelectionProvider");
  }

  return context;
}
