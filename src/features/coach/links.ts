import type { SQLiteDatabase } from 'expo-sqlite';

import { listStrengthWorkoutsByPlanKey } from '@/features/strength/store';
import type { SessionLinks } from './actions';
import type { CoachPlan } from './doc';
import { sessionsOf } from './plans/adapt';

/**
 * The strength sessions the logger has finished for this plan: each plan session key with a logged workout maps to that
 * workout's start (the `workouts` row it is stored as, else its own start), unix seconds. Empty for a running plan.
 */
export async function strengthLinks(db: SQLiteDatabase, plan: CoachPlan): Promise<SessionLinks> {
  if (plan.kind !== 'strength') return {};
  const links: Record<string, number> = {};
  for (const session of sessionsOf(plan)) {
    const [latest] = await listStrengthWorkoutsByPlanKey(db, session.key);
    if (latest) links[session.key] = latest.workoutStart ?? Math.floor(latest.startedAt / 1000);
  }
  return links;
}
