import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import type { SleepEnvPayload } from '@/cloud/sleepInsightsClient';

import { roomEnvByWakeDate } from './aggregate';
import { useEnvVersion } from './events';
import { listEnvSamples } from './store';

interface NightWindow {
  /** Unix seconds, as `Night.start` and `Night.end`. */
  start: number;
  end: number;
  /** Local `YYYY-MM-DD` of the wake-up. */
  day: string;
  nap: boolean;
}

/**
 * The bedroom summary of one night, the same one Wawasan tidur gets (`roomEnvByWakeDate`: at least 6 samples and half of the sleep window
 * covered, from the sensor that heard the most of it), or null while it loads, for a nap, or when the samples did not cover the night.
 */
export function useNightRoom(night: NightWindow | null): SleepEnvPayload | null {
  const db = useSQLiteContext();
  const version = useEnvVersion();
  const start = night && !night.nap ? night.start : null;
  const end = night && !night.nap ? night.end : null;
  const day = night && !night.nap ? night.day : null;
  const [state, setState] = useState<{ start: number; end: number; env: SleepEnvPayload | null } | null>(null);

  useEffect(() => {
    if (start === null || end === null || day === null) return;
    let cancelled = false;
    const onsetMs = start * 1000;
    const wakeMs = end * 1000;
    listEnvSamples(db, onsetMs, wakeMs).then(
      (samples) => {
        if (!cancelled) setState({ start, end, env: roomEnvByWakeDate([{ wakeDate: day, onsetMs, wakeMs }], samples).get(day) ?? null });
      },
      () => {
        // The room summary is a bonus: a failed read shows no row.
        if (!cancelled) setState({ start, end, env: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, start, end, day, version]);

  return state && state.start === start && state.end === end ? state.env : null;
}
