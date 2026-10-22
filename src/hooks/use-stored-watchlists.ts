"use client";

import { startTransition, useEffect, useState } from "react";
import { createDefaultWatchlists, loadStoredWatchlists, type CustomWatchlist } from "@/lib/watchlists";

export function useStoredWatchlists() {
  const [watchlists, setWatchlists] = useState<CustomWatchlist[]>(createDefaultWatchlists());
  const [activeWatchlistId, setActiveWatchlistId] = useState("default");

  useEffect(() => {
    const storedState = loadStoredWatchlists();

    startTransition(() => {
      setWatchlists(storedState.watchlists);
      setActiveWatchlistId(storedState.activeWatchlistId);
    });
  }, []);

  return {
    watchlists,
    setWatchlists,
    activeWatchlistId,
    setActiveWatchlistId,
  };
}
