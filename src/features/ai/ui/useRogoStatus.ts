import { useEffect, useState } from 'react';

import { coachChatStatus } from '@/features/coach/chat/api';

export interface RogoUsage {
  used: number;
  cap: number;
}

/** How many of the day's hosted messages are used, read from JoyoRogo while `enabled` (a Pro account). Null until it answers or when it cannot. */
export function useRogoStatus(enabled: boolean): [RogoUsage | null, (usage: RogoUsage) => void] {
  const [usage, setUsage] = useState<RogoUsage | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    coachChatStatus()
      .then((status) => {
        if (!cancelled) setUsage({ used: status.chatUsedToday, cap: status.chatDailyCap });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return [usage, setUsage];
}
