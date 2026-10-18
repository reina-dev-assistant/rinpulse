/**
 * Workouts the cloud refused as a document (400, or too big even alone), kept in `cloud_state` so they are not sent
 * again on every run. A refused workout waits until it changes (its `rev` moves), the app is a different build or JS
 * update, or `RETRY_REFUSED_MS` has passed since the first refusal: a server-side fix needs no app change at all.
 */
export interface WorkoutFailures {
  /** App build the failures were recorded by; failures of another build are forgotten. */
  build: string;
  /** `start` to the local `rev` that was refused. */
  items: Record<string, number>;
  lastError: string | null;
  /** When the first of these failures was recorded (ms); the set is forgotten `RETRY_REFUSED_MS` later. */
  since?: number;
}

/** Refused workouts are sent again once a day, in case the server learned to take them. */
export const RETRY_REFUSED_MS = 24 * 60 * 60 * 1000;

export const noFailures = (build: string): WorkoutFailures => ({ build, items: {}, lastError: null });

export function parseFailures(raw: string | null, build: string, now: number = Date.now()): WorkoutFailures {
  if (!raw) return noFailures(build);
  try {
    const value = JSON.parse(raw) as Partial<WorkoutFailures> | null;
    if (value?.build !== build || typeof value.items !== 'object' || value.items === null) return noFailures(build);
    const since = typeof value.since === 'number' ? value.since : undefined;
    if (since === undefined || now - since >= RETRY_REFUSED_MS) return noFailures(build);
    return { build, items: value.items, lastError: typeof value.lastError === 'string' ? value.lastError : null, since };
  } catch {
    return noFailures(build);
  }
}

export function recordFailure(
  failures: WorkoutFailures,
  start: number,
  rev: number,
  message: string,
  now: number = Date.now(),
): WorkoutFailures {
  return { ...failures, items: { ...failures.items, [start]: rev }, lastError: message, since: failures.since ?? now };
}

/** The workout uploaded after all, or is gone: it is no longer a failure. */
export function clearFailure(failures: WorkoutFailures, start: number): WorkoutFailures {
  if (!(start in failures.items)) return failures;
  const { [start]: _removed, ...items } = failures.items;
  if (Object.keys(items).length === 0) return noFailures(failures.build);
  return { ...failures, items };
}

/** The cloud refused this very state of the workout. */
export function isFailed(failures: WorkoutFailures, start: number, rev: number): boolean {
  return failures.items[start] === rev;
}

/** Pending workouts split into the ones to send and the ones the cloud refused in their current state. */
export function partitionPending<T extends { start: number; rev: number }>(
  pending: readonly T[],
  failures: WorkoutFailures,
): { todo: T[]; refused: T[] } {
  const todo: T[] = [];
  const refused: T[] = [];
  for (const p of pending) (isFailed(failures, p.start, p.rev) ? refused : todo).push(p);
  return { todo, refused };
}
