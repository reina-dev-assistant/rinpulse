import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { paceTarget, SCORED_PACE_TYPES } from './pace';
import type { PlannedSession } from './plans/types';

/**
 * Post-workout feedback: the finished workout against the target of the plan session it was matched to, from the workout
 * analysis the detail screen already computes (heart-rate zones, moving time, distance, pace and the threshold pace).
 * `docs/coach.md` lists the same tolerances.
 *
 *  - Duration: within 15 % of the planned minutes is on target; shorter is `under`, longer `over`.
 *  - Heart-rate zone, by session type. Easy, long and recovery: time above zone 2 (zone 1 for recovery) under 15 % is
 *    on target, 35 % or more is `over` (too hard). Tempo: 45 % or more of the time in zones 3 and 4 is on target, with
 *    20 % or more in zone 5 `over`. Intervals: time in zones 4 and 5 of at least 60 % of the planned hard time. Walk/run:
 *    only flags 40 % or more of the time above zone 3. Race: no zone check.
 *  - Pace, when your threshold pace is known (a one-hour effort): easy and long runs aim at 1.14 to 1.29 times the
 *    threshold pace (the endurance zone of the analysis), tempo at 1.06 to 1.14 times. A pace more than 3 % faster than
 *    the fast edge is `over`, more than 5 % slower than the slow edge is `under`.
 *  - Distance, for a session that names one (the race): 95 % or more is on target.
 */

export type Verdict = 'on' | 'under' | 'over';
export type FeedbackKey = 'duration' | 'zone' | 'pace' | 'distance';

export interface FeedbackLine {
  key: FeedbackKey;
  verdict: Verdict;
  /** Numbers the sentence needs: planned/actual seconds, shares in percent, pace seconds per km, distance metres. */
  values: Record<string, number>;
}

export type Overall = 'onTarget' | 'tooHard' | 'tooEasy' | 'short' | 'long';

export interface Feedback {
  lines: FeedbackLine[];
  overall: Overall;
}

const DURATION_TOLERANCE = 0.15;

const EASY_ABOVE_OVER = 0.35;
const TEMPO_IN_ON = 0.45;
const TEMPO_Z5_OVER = 0.2;
const INTERVAL_HARD_SHARE = 0.6;
const WALKRUN_OVER = 0.4;
const PACE_FAST_TOLERANCE = 0.97;
const PACE_SLOW_TOLERANCE = 1.05;
const DISTANCE_ON = 0.95;


function share(sec: readonly number[], below: number, from: number, to: number): number {
  const total = sec.reduce((a, b) => a + b, 0) + below;
  if (total <= 0) return 0;
  let part = 0;
  for (let zone = from; zone <= to; zone++) part += sec[zone - 1] ?? 0;
  return part / total;
}

function zoneLine(session: PlannedSession, analysis: WorkoutAnalysis): FeedbackLine | null {
  const zones = analysis.hrZones;
  const run = session.run;
  if (!zones || !run) return null;
  const { sec, belowSec } = zones;
  switch (run.type) {
    case 'easy':
    case 'long':
    case 'recovery': {
      const limit = run.type === 'recovery' ? 1 : 2;
      const above = share(sec, belowSec, limit + 1, sec.length);
      const verdict: Verdict = above >= EASY_ABOVE_OVER ? 'over' : 'on';
      return { key: 'zone', verdict, values: { target: limit, aboveShare: Math.round(above * 100) } };
    }
    case 'tempo': {
      const inRange = share(sec, belowSec, 3, 4);
      const z5 = share(sec, belowSec, 5, sec.length);
      const verdict: Verdict = z5 >= TEMPO_Z5_OVER ? 'over' : inRange >= TEMPO_IN_ON ? 'on' : 'under';
      return { key: 'zone', verdict, values: { target: 3, inShare: Math.round(inRange * 100), z5Share: Math.round(z5 * 100) } };
    }
    case 'intervals': {
      const spec = run.intervals;
      if (!spec) return null;
      const planned = spec.reps * spec.workSec;
      const hard = sec.slice(3).reduce((a, b) => a + b, 0);
      const verdict: Verdict = hard >= planned * INTERVAL_HARD_SHARE ? 'on' : 'under';
      return { key: 'zone', verdict, values: { target: 4, hardSec: Math.round(hard), plannedSec: planned } };
    }
    case 'walkrun': {
      const above = share(sec, belowSec, 4, sec.length);
      return { key: 'zone', verdict: above >= WALKRUN_OVER ? 'over' : 'on', values: { target: 3, aboveShare: Math.round(above * 100) } };
    }
    default:
      return null;
  }
}

function paceLine(session: PlannedSession, analysis: WorkoutAnalysis): FeedbackLine | null {
  const threshold = analysis.paceZones?.thresholdSecKm;
  const pace = analysis.stats.avgPaceSecKm;
  if (!SCORED_PACE_TYPES.includes(session.type) || !threshold || !pace) return null;
  const target = paceTarget(session.type, threshold);
  if (!target) return null;
  const { fast, slow } = target;
  const verdict: Verdict = pace < fast * PACE_FAST_TOLERANCE ? 'over' : pace > slow * PACE_SLOW_TOLERANCE ? 'under' : 'on';
  return { key: 'pace', verdict, values: { actual: Math.round(pace), fast: Math.round(fast), slow: Math.round(slow) } };
}

/** The finished workout against the session's target; null for a session that has no target to compare. */
export function sessionFeedback(session: PlannedSession, analysis: WorkoutAnalysis): Feedback | null {
  if (session.kind !== 'run' || !session.run) return null;
  const lines: FeedbackLine[] = [];

  const plannedSec = session.minutes * 60;
  const actualSec = analysis.elapsedSec > 0 ? analysis.elapsedSec : analysis.movingSec;
  const ratio = plannedSec > 0 ? actualSec / plannedSec : 1;
  const duration: Verdict = ratio < 1 - DURATION_TOLERANCE ? 'under' : ratio > 1 + DURATION_TOLERANCE ? 'over' : 'on';
  lines.push({ key: 'duration', verdict: duration, values: { plannedSec, actualSec: Math.round(actualSec) } });

  const zone = zoneLine(session, analysis);
  if (zone) lines.push(zone);
  const pace = paceLine(session, analysis);
  if (pace) lines.push(pace);

  const distanceM = session.run.distanceM;
  if (distanceM && analysis.distanceM !== null) {
    const verdict: Verdict = analysis.distanceM >= distanceM * DISTANCE_ON ? 'on' : 'under';
    lines.push({ key: 'distance', verdict, values: { plannedM: distanceM, actualM: Math.round(analysis.distanceM) } });
  }

  const tooHard = lines.some((l) => (l.key === 'zone' || l.key === 'pace') && l.verdict === 'over');
  const tooEasy = lines.some((l) => (l.key === 'zone' || l.key === 'pace') && l.verdict === 'under' && session.hard);
  const overall: Overall = tooHard ? 'tooHard' : duration === 'under' ? 'short' : duration === 'over' ? 'long' : tooEasy ? 'tooEasy' : 'onTarget';
  return { lines, overall };
}
