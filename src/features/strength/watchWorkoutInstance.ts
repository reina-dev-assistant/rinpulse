import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog as log } from '@/cloud/log';
import { hasNative, HuaweiWear, WATCH_SPORT_STRENGTH_TRAINING } from '@/wear';

import { getStrengthMeta, setStrengthMeta } from './store';
import { isGatedRefusal, StrengthWatchSession, type WatchSessionPhase, type WatchWorkoutNative } from './watchWorkout';

/** The one watch workout of the strength logger. It outlives the logger screen: minimizing the workout leaves the watch recording. */
export const strengthWatch = new StrengthWatchSession({
  native: () => (hasNative('getWatchWorkout') && hasNative('startWatchWorkout') ? (HuaweiWear as WatchWorkoutNative) : null),
  log: (message) => log(`strength: ${message}`),
});

/** `strength_meta` key: the workout the watch was last told to start for, so an app restart does not start it a second time. */
const STARTED_META = 'watch_workout';

/** `strength_meta` key: the address of a watch that refused the phone-started workout command while worn; the start is not tried on it again. */
const REFUSED_META = 'watch_start_refused';

/** The watch the link is on now (or the remembered one), null when none is known. */
function currentWatchAddress(): string | null {
  if (!hasNative('getWatchWorkout')) return null;
  return HuaweiWear.getDevice()?.address ?? HuaweiWear.getBackgroundStatus().address ?? null;
}

/** True when the watch in use refused the phone-started workout command earlier (`isGatedRefusal`). */
export async function watchStartRefused(db: SQLiteDatabase): Promise<boolean> {
  const address = currentWatchAddress();
  if (address === null) return false;
  return (await getStrengthMeta(db, REFUSED_META).catch(() => null)) === address;
}

/** A draft older than this is a forgotten one, not a workout that is starting now: the watch is not started for it. */
export const WATCH_START_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** Workouts the watch was already asked about in this app run; a retry is the person's tap (`startStrengthWatch` directly). */
const attempted = new Set<string>();

/** The first call per workout starts it; later ones (a redraw, the reopened screen) do nothing and return null. */
export async function startStrengthWatchOnce(db: SQLiteDatabase, workoutId: string): Promise<WatchSessionPhase | null> {
  if (attempted.has(workoutId)) return null;
  return startStrengthWatch(db, workoutId);
}

/** Tells the watch to start the strength workout `workoutId`. */
export async function startStrengthWatch(db: SQLiteDatabase, workoutId: string): Promise<WatchSessionPhase> {
  attempted.add(workoutId);
  const startedBefore = (await getStrengthMeta(db, STARTED_META).catch(() => null)) === workoutId;
  const phase = await strengthWatch.begin({ workoutId, sport: WATCH_SPORT_STRENGTH_TRAINING, startedBefore });
  const snap = strengthWatch.getSnapshot();
  const address = currentWatchAddress();
  if (phase === 'failed' && address !== null && isGatedRefusal(snap.outcome, snap.worn)) {
    await setStrengthMeta(db, REFUSED_META, address).catch(() => undefined);
    log(`strength: watch ${address} refuses the phone-started workout (code ${snap.code}); not tried again on it`);
  }
  if (phase === 'running' || phase === 'paused' || phase === 'unconfirmed') await setStrengthMeta(db, STARTED_META, workoutId).catch(() => undefined);
  return phase;
}

/** The workout was finished or discarded: stops the watch's workout and forgets it. */
export async function endStrengthWatch(db: SQLiteDatabase): Promise<void> {
  await strengthWatch.end();
  await setStrengthMeta(db, STARTED_META, null).catch(() => undefined);
}
