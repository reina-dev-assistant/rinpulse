import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { useWatchPresence } from '@/features/device/useWatchPresence';
import { useWatch } from '@/state/WatchProvider';
import { hasNative, HuaweiWear, type WatchWorkoutOutcome } from '@/wear';

import { endStrengthWatch, startStrengthWatch, startStrengthWatchOnce, strengthWatch, WATCH_START_MAX_AGE_MS } from './watchWorkoutInstance';
import { watchWorkoutAvailability, type WatchSessionPhase, type WatchWorkoutAvailability, type WatchWorkoutNative } from './watchWorkout';

/**
 * Whether the screens may offer the watch start (`watchWorkoutAvailability`), refreshed when the watch link changes. `unavailable` hides
 * the setting; `unsupported` replaces the switch with an info line.
 */
export function useWatchWorkoutAvailability(): WatchWorkoutAvailability {
  const presence = useWatchPresence();
  const { linkState } = useWatch();
  // The link state is what makes the native answer (connected, the commands the watch lists) change.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the link changes
  return useMemo(() => watchWorkoutAvailability(hasNative('getWatchWorkout') ? (HuaweiWear as WatchWorkoutNative) : null, presence === 'watch'), [presence, linkState]);
}

/**
 * What the logger shows about the watch for workout `workoutId`: nothing (`none`: switched off, no watch, or a watch that cannot be
 * started from the phone), `offline` (wanted, but the watch is not connected: it starts by itself once it is), or the session's phase.
 */
export type WatchView =
  | { view: 'none' | 'offline'; outcome: null; code: null; worn: null }
  | { view: WatchSessionPhase; outcome: WatchWorkoutOutcome | null; code: number | null; worn: boolean | null };

/**
 * Starts the watch's workout for the logger: once per workout, when the logger is ready, the setting is on, the workout is fresh (`startedAt`
 * is less than `WATCH_START_MAX_AGE_MS` before the screen opened: an old draft is a forgotten one) and the watch is connected and lists
 * the command. Only one small component uses it (`WatchNotice`), like the strap card: the session changes with the watch, which
 * must not redraw the workout. `retry` asks again after a failure.
 */
export function useStrengthWatchStart(workoutId: string | null, wanted: boolean, startedAt: number | null): { watch: WatchView; retry: () => void } {
  const db = useSQLiteContext();
  const availability = useWatchWorkoutAvailability();
  const session = useSyncExternalStore(strengthWatch.subscribe, strengthWatch.getSnapshot);
  const [openedAt] = useState(() => Date.now());
  const active = wanted && workoutId !== null && startedAt !== null && openedAt - startedAt < WATCH_START_MAX_AGE_MS;

  useEffect(() => {
    if (!active || availability !== 'ready') return;
    void startStrengthWatchOnce(db, workoutId);
  }, [active, availability, db, workoutId]);

  // A session that belongs to another workout (the person replaced the one in progress) is over.
  useEffect(() => {
    if (workoutId !== null && session.workoutId !== null && session.workoutId !== workoutId) void endStrengthWatch(db);
  }, [db, workoutId, session.workoutId]);

  const retry = useCallback(() => {
    if (workoutId !== null) void startStrengthWatch(db, workoutId);
  }, [db, workoutId]);

  if (!active) return { watch: { view: 'none', outcome: null, code: null, worn: null }, retry };
  if (session.workoutId === workoutId && session.phase !== 'idle') {
    return { watch: { view: session.phase, outcome: session.outcome, code: session.code, worn: session.worn }, retry };
  }
  return { watch: { view: availability === 'offline' ? 'offline' : 'none', outcome: null, code: null, worn: null }, retry };
}

/** The phase of the watch session of workout `workoutId`, for the header chip; null when it has none. Redraws on its own, not the screen. */
export function useWatchChip(workoutId: string | null): WatchSessionPhase | null {
  const session = useSyncExternalStore(strengthWatch.subscribe, strengthWatch.getSnapshot);
  if (workoutId === null || session.workoutId !== workoutId) return null;
  return session.phase === 'running' || session.phase === 'paused' || session.phase === 'unconfirmed' ? session.phase : null;
}
