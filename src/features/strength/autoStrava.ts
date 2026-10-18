import { isImported } from './link';
import type { StrengthWorkout } from './types';

/** Strava gets a workout by itself only when it was finished lately: editing an old one later does not post it. */
export const AUTO_STRAVA_WINDOW_MS = 6 * 3_600_000;

export interface AutoStravaFacts {
  /** "Send to Strava automatically" in the strength settings. */
  setting: boolean;
  /** Strava is connected on this account. */
  connected: boolean;
  /** Strava was already sent this workout (an upload row exists, whatever its status). */
  alreadySent: boolean;
}

/**
 * Should a saved workout go to Strava by itself: the setting is on, Strava is connected, the workout is a real finished one (not
 * deleted, not history imported from JoyoRogo, with a `workouts` row), it ended within `AUTO_STRAVA_WINDOW_MS`, and Strava has not
 * been sent it yet.
 */
export function autoStravaWanted(workout: StrengthWorkout, facts: AutoStravaFacts, now: number): boolean {
  if (workout.deletedAt !== null || isImported(workout) || workout.workoutStart === null) return false;
  if (now - workout.endedAt > AUTO_STRAVA_WINDOW_MS) return false;
  return facts.setting && facts.connected && !facts.alreadySent;
}
