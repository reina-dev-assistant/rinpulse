import { useEffect, useState, useSyncExternalStore } from "react";

import type { Game } from "../game.ts";

/** Re-renders when the game bumps its version (screen change, HUD tick, source state). */
export function useGame(game: Game): Game {
  useSyncExternalStore(game.subscribe, game.getVersion, game.getVersion);
  return game;
}

/** Ticks once a second while [active], for countdowns shown in the UI. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
