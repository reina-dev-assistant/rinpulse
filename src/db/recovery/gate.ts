/**
 * A pause for the app's own queries while a repair rewrites the database (`serialize.ts` waits on it before every statement).
 * Without it a write made after the repair read the damaged file would be overwritten by the repaired copy. Statements already
 * running finish; new ones wait. The hold lets go by itself after `MAX_HOLD_MS`, so a repair that hangs (or a transaction that
 * waits on a statement queued behind the hold) cannot freeze the app.
 */
const MAX_HOLD_MS = 60_000;

let current: Promise<void> | null = null;

/** Resolves when the hold is over; immediately when there is none. */
export function waitForHold(): Promise<void> {
  return current ?? Promise.resolve();
}

/** Pauses queries until the returned function is called (calling it again does nothing). */
export function holdQueries(): () => void {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  current = hold;
  const timer = setTimeout(release, MAX_HOLD_MS);
  return () => {
    clearTimeout(timer);
    if (current === hold) current = null;
    release();
  };
}
