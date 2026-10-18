/**
 * What to tell a person who signs out. JoyoFit works without an account and a free account never uploads, so the data on the
 * phone is often the only copy: signing out must never delete it unasked, and it may only offer deletion when the cloud
 * provably holds everything.
 */

/** What exists only on this phone right now. */
export interface PendingLocal {
  /** Step samples and sleep segments the cloud does not have. */
  rows: number;
  /** Workouts not uploaded, plus the ones the cloud refused as a document (they are not in the cloud either). */
  workouts: number;
  /** Strength records changed here and not uploaded. */
  strength: number;
  /** Preference, template, route and health records not uploaded (`recordSyncPending`). */
  records: number;
}

export interface SignOutFacts {
  /** The server accepts uploads from this account (its status said Pro and no sync was refused as locked); null while that is not known yet. Only `true` allows deleting. */
  pro: boolean | null;
  /** The last sync finished without an error, and there was one. */
  synced: boolean;
  pending: PendingLocal;
}

/** `offer-delete`: everything is in the cloud, deleting from this phone loses nothing. `warn-keep`: some of it is only here; keeping is the default. */
export type SignOutPlan = 'offer-delete' | 'warn-keep';

export const pendingTotal = (pending: PendingLocal): number => pending.rows + pending.workouts + pending.strength + pending.records;

export function signOutPlan({ pro, synced, pending }: Pick<SignOutFacts, 'pro' | 'synced' | 'pending'>): SignOutPlan {
  return pro === true && synced && pendingTotal(pending) === 0 ? 'offer-delete' : 'warn-keep';
}

/** Why the data may exist only on this phone, for the wording of `warn-keep`: not Pro, things waiting, or a sync that did not finish. */
export type KeepReason = 'free' | 'pending' | 'unsynced';

export function keepReason(facts: Pick<SignOutFacts, 'pro' | 'synced' | 'pending'>): KeepReason {
  if (facts.pro === false) return 'free';
  return pendingTotal(facts.pending) > 0 ? 'pending' : 'unsynced';
}
