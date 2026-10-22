/**
 * The setup checklist on Today: what a watch owner still has to do for JoyoFit to be fully useful, worked out from the app's own state
 * (nothing is ticked by hand). Only real prerequisites are rows; each one is detected, never promoted. Pure: the facts come in,
 * the ordered rows come out, so the rules are plain tests.
 *
 * - Rows that cannot apply on this phone or build are left out (no cloud server in this build, no Health Connect on the phone).
 * - Pending rows keep their natural order and sit on top; finished rows sink to the bottom, so the next thing to do is always first.
 * - The card shows while a row is pending and has not been dismissed; once every row is done it is gone for good (`complete`).
 */
export const SETUP_STEPS = ['pair', 'sync', 'health', 'account', 'profile'] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

export interface SetupFacts {
  /** A watch is linked, remembered or was connected before. */
  paired: boolean;
  /** A sync has stored data for the active watch. */
  synced: boolean;
  /** `enabled` and at least one write permission, or null when the platform store is missing on this phone (the row does not apply). */
  healthStoreOn: boolean | null;
  /** Signed in to JoyoRogo, or null when this build has no cloud server (the row does not apply). */
  signedIn: boolean | null;
  /** A body profile (height, weight, birth year, step goal) has been saved. */
  profileSaved: boolean;
}

export interface SetupRow {
  id: SetupStepId;
  done: boolean;
}

export function setupRows(facts: SetupFacts): SetupRow[] {
  const done: Record<SetupStepId, boolean | null> = {
    pair: facts.paired,
    sync: facts.synced,
    health: facts.healthStoreOn,
    account: facts.signedIn,
    profile: facts.profileSaved,
  };
  const rows = SETUP_STEPS.flatMap((id) => (done[id] === null ? [] : [{ id, done: done[id] }]));
  return [...rows.filter((r) => !r.done), ...rows.filter((r) => r.done)];
}

export function setupProgress(rows: readonly SetupRow[]): { done: number; total: number } {
  return { done: rows.filter((r) => r.done).length, total: rows.length };
}

/** What is stored: nothing yet, the person hid the card, or every row was seen done. */
export type SetupMemory = 'dismissed' | 'complete' | null;

export function showsSetup(rows: readonly SetupRow[], memory: SetupMemory): boolean {
  return memory === null && rows.some((r) => !r.done);
}

/** True when every row is done and that has not been remembered yet: the card is finished and writes `complete` once. */
export function finishedSetup(rows: readonly SetupRow[], memory: SetupMemory): boolean {
  return memory === null && rows.length > 0 && rows.every((r) => r.done);
}
