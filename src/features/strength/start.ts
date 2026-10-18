/**
 * The way into the logger from other screens. The logger itself (`/strength/active`) creates the draft, so a caller needs no
 * database handle: this only navigates. The active screen asks what to do when a workout is already in progress.
 */
import { router } from 'expo-router';

import type { PlannedInput } from './draft';

export interface StartInput {
  /** Start from a saved routine (`r...`) or a built-in starter (`builtin:<slug>`). */
  routineId?: string | null;
  /** Start for a coach plan session (`<planId>:<week>:<slot>`) with the planned exercises. */
  planKey?: string | null;
  exercises?: readonly PlannedInput[];
  /** Name of the workout; the logger proposes one when missing. */
  name?: string;
  /** Start from a finished workout (the "repeat" action). */
  repeatWorkoutId?: string | null;
}

/** Opens the logger with a new workout: empty, from a routine, from a plan session or a copy of an earlier workout. */
export function startStrengthWorkout(input: StartInput = {}): void {
  router.push({
    pathname: '/strength/active',
    params: {
      ...(input.routineId ? { routineId: input.routineId } : {}),
      ...(input.planKey ? { planKey: input.planKey } : {}),
      ...(input.exercises && input.exercises.length > 0 ? { planned: JSON.stringify(input.exercises) } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.repeatWorkoutId ? { repeatWorkoutId: input.repeatWorkoutId } : {}),
    },
  });
}

/** Opens the workout in progress, if any. */
export const resumeStrengthWorkout = (): void => router.push('/strength/active');
