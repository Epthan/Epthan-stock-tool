"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
/** false during server render and hydration, true once the browser state (localStorage) is in use. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
