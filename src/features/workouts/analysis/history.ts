import type { SQLiteDatabase } from 'expo-sqlite';

import { listWorkoutPoints, listWorkoutsSince, type WorkoutRow } from '@/db/queries';
import type { HrZones } from '@/features/hrzones/zones';
import { workoutStrain } from '@/features/today/strain';
import { parseSummary, type WorkoutSummary } from '@/features/workouts/summary';

import type { AnalysisHistory } from './analyze';
import type { EffortSeconds } from './efforts';
import type { TrimpEntry } from './effort';
import type { SimilarCandidate } from './similar';
import { isFootKind, sportKind } from './sport';
import { cachedEfforts, effortsOf, inEffortWindow, THRESHOLD_WINDOW_DAYS } from './threshold';

const DAY_SEC = 86400;
const HISTORY_DAYS = 120;
const TRIMP_DAYS = 28;
const MAX_SAME_SPORT = 40;
const MAX_EFFORT_WORKOUTS = THRESHOLD_WINDOW_DAYS;
const MAX_TRIMP_WORKOUTS = 60;
const MIN_BPM = 20;
const MAX_BPM = 250;

/**
 * What `analyzeWorkout` needs from the workouts before this one: best-effort seconds of the on-foot workouts of the same
 * kind in the last 90 days (every run for a run, whatever its sport name; `THRESHOLD_WINDOW_DAYS`, the window the coach's
 * threshold pace uses too), similar-workout candidates from the last 120 days of the same sport (newest 40), and the TRIMP
 * of every workout of the last 28 days (newest 60). One summary query, then each workout's points once and in turn: only
 * for the best efforts not read before and for the TRIMP set.
 */
export async function loadAnalysisHistory(db: SQLiteDatabase, workout: WorkoutRow, summary: WorkoutSummary, zones: HrZones): Promise<AnalysisHistory> {
  const rows = (await listWorkoutsSince(db, workout.start - HISTORY_DAYS * DAY_SEC, workout.start, workout.id)).map((r) => ({
    ...r,
    summary: parseSummary(r.summaryJson),
  }));
  const sameSport = rows.filter((r) => r.workout.sportName === workout.sportName).slice(0, MAX_SAME_SPORT);
  const recent = rows.filter((r) => r.workout.start > workout.start - TRIMP_DAYS * DAY_SEC).slice(0, MAX_TRIMP_WORKOUTS);

  const similar: SimilarCandidate[] = sameSport.map(({ workout: w, summary: s }) => ({
    id: w.id,
    start: w.start,
    duration: w.duration,
    distance: w.distance,
    sportName: w.sportName,
    kind: sportKind(w.sportName, s.kind),
    avgHr: w.avgHr,
    gain: typeof s.elevationGain === 'number' ? s.elevationGain : null,
  }));

  const kind = sportKind(workout.sportName, summary.kind);
  const effortIds = new Set<number>(
    isFootKind(kind)
      ? rows
          .filter((r) => inEffortWindow(r.workout, r.summary.kind, kind, workout.start))
          .slice(0, MAX_EFFORT_WORKOUTS)
          .map((r) => r.workout.id)
      : [],
  );
  const trimpIds = new Set(recent.map((r) => r.workout.id));
  const efforts: EffortSeconds[] = [];
  const trimps: TrimpEntry[] = [];
  for (const { workout: w } of rows) {
    const wantsEffort = effortIds.has(w.id);
    const wantsTrimp = trimpIds.has(w.id);
    if (!wantsEffort && !wantsTrimp) continue;
    let best = wantsEffort ? cachedEfforts(w) : undefined;
    if (best !== undefined && !wantsTrimp) {
      if (Object.keys(best).length > 0) efforts.push(best);
      continue;
    }
    const points = await listWorkoutPoints(db, w.id);
    if (wantsEffort) {
      best = best ?? effortsOf(w, points);
      if (Object.keys(best).length > 0) efforts.push(best);
    }
    if (wantsTrimp) {
      const strain = workoutStrain(
        points.filter((p) => p.hr !== null && p.hr >= MIN_BPM && p.hr <= MAX_BPM),
        zones,
      );
      if (strain) trimps.push({ start: w.start, trimp: strain.trimp });
    }
  }
  return { efforts, trimps, similar };
}
