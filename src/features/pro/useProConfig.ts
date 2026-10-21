import { useEffect, useState } from 'react';

import { JOYOROGO_URL } from '@/cloud/config';
import { fetchProConfig, type ProConfig } from '@/features/onboarding/pro';

/** One live config for every card on screen; a failed fetch is not cached, so the next card that mounts asks again. */
let pending: Promise<ProConfig | null> | null = null;

function loadProConfig(): Promise<ProConfig | null> {
  pending ??= fetchProConfig(JOYOROGO_URL).then((config) => {
    if (config === null) pending = null;
    return config;
  });
  return pending;
}

/** JoyoRogo's live prices, fetched only when `enabled` (a sideloaded build); null until they arrive or when offline. */
export function useProConfig(enabled: boolean): ProConfig | null {
  const [config, setConfig] = useState<ProConfig | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadProConfig().then((next) => live && setConfig(next));
    return () => {
      live = false;
    };
  }, [enabled]);
  return config;
}
