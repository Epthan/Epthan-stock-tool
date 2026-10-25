"use client";

import { startTransition, useEffect, useState } from "react";
import { createDefaultWatchlists, loadStoredWatchlists, type CustomWatchlist } from "@/lib/watchlists";

// Starts with the defaults (same as the server render), then loads the saved lists after mount.
// Writes are saved by the Market page itself; this hook only reads storage once.
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
