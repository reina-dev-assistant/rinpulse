import type { CoachDoc, DoneEntry, StrengthLog } from './doc';

/** Key order does not matter for equality: two phones that built the same state must compare equal. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function sameCoachDoc(a: CoachDoc, b: CoachDoc): boolean {
  return stable(a) === stable(b);
}

function newest<T extends { at: number }>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [key, entry] of Object.entries(b)) {
    const mine = out[key];
    if (!mine || entry.at > mine.at) out[key] = entry;
  }
  return out;
}

/** Keeps only what belongs to `planId`: a new plan starts without the old one's progress. */
function ofPlan<T>(records: Record<string, T>, planId: string): Record<string, T> {
  return Object.fromEntries(Object.entries(records).filter(([key]) => key.startsWith(`${planId}:`)));
}

/**
 * Merges two copies of the coach document. The plan (and its end) with the newer `planUpdatedAt` wins as a whole;
 * finished sessions and strength logs merge per key, the later mark winning. Progress of a plan that is no longer the
 * active one is dropped.
 */
export function mergeCoachDocs(a: CoachDoc, b: CoachDoc): CoachDoc {
  const winner = b.planUpdatedAt > a.planUpdatedAt ? b : a;
  const done = newest<DoneEntry>(a.done, b.done);
  const logs = newest<StrengthLog>(a.logs, b.logs);
  const plan = winner.plan;
  return {
    version: 1,
    plan,
    planUpdatedAt: winner.planUpdatedAt,
    done: plan ? ofPlan(done, plan.id) : done,
    logs: plan ? ofPlan(logs, plan.id) : logs,
  };
}
