import { useCallback, useEffect, useState } from 'react';

import { listRouteCards, type RouteCard } from '@/features/routes/routeStore';

import { chosenRoute } from '../settings';

export interface ChosenRoute {
  /** The route the next ride follows, null for none (or when the saved route was deleted). */
  card: RouteCard | null;
  /** Every saved route, newest first; null while loading. */
  cards: RouteCard[] | null;
  choose: (id: string | null) => void;
}

/** The route chosen for the next ride and the library it is chosen from. `refresh` whenever the screen takes focus is the caller's call. */
export function useChosenRoute(): ChosenRoute {
  const [cards, setCards] = useState<RouteCard[] | null>(null);
  const [id, setId] = useState<string | null>(() => chosenRoute.get());

  useEffect(() => {
    let cancelled = false;
    listRouteCards().then(
      (list) => {
        if (!cancelled) setCards(list);
      },
      () => {
        if (!cancelled) setCards([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback((next: string | null) => {
    chosenRoute.set(next);
    setId(next);
  }, []);

  return { card: cards?.find((c) => c.route.id === id) ?? null, cards, choose };
}
