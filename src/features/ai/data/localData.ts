import type { SQLiteDatabase } from 'expo-sqlite';

import { listDayStrainLoad, listDayTotals, listHrvReadingsSince, listRestingHeartRateByDay, listSleepScores, listSleepSince, listWorkoutPoints, listWorkoutsSince, type WorkoutRow } from '@/db/queries';
import { withRideLoad } from '@/features/cycling/load';
import { userMaxHr } from '@/features/hrzones/settings';
import { localDate } from '@/features/meals/mealMap';
import { buildNights, nightHasStages, sleepByDay } from '@/features/sleep/nights';
import { startOfLocalDay } from '@/features/today/stats';
import { strainFromLoads, workoutStrain } from '@/features/today/strain';
import { cleanActiveKcal } from '@/features/today/rogoActive';
import { dayBounds, dayStarts } from '@/features/trends/series';
import { parseSummary } from '@/features/workouts/summary';
import type { DigestDay, DigestWorkout } from '../digest';
import type { SleepNight } from '../tools';

const DAY_SEC = 86400;

/** Local midnight (unix seconds) of a `YYYY-MM-DD`. */
export function dayStartOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return startOfLocalDay(Math.floor(new Date(y!, m! - 1, d!, 12).getTime() / 1000));
}

const round = (n: number, digits = 0): number => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * One row per local day in `[from, to]` from the phone's database: sleep, resting heart rate, overnight HRV, strain, steps, the
 * watch's active energy and minutes of workout. A value the phone has not recorded is null, never 0. Food and weight are not here
 * (JoyoRogo), they stay null. Cycle data is not read: no table of it is touched by this file.
 */
export async function readDailyRows(db: SQLiteDatabase, from: string, to: string): Promise<DigestDay[]> {
  const first = dayStartOf(from);
  const last = dayStartOf(to);
  const count = Math.max(1, Math.min(120, Math.round((last - first) / DAY_SEC) + 1));
  const starts = dayStarts(last, count);
  const bounds = dayBounds(starts);
  const maxHr = userMaxHr();
  const windowStart = starts[0]!;
  const [loads, resting, totals, hrv, sleep, scores, workouts] = await Promise.all([
    listDayStrainLoad(db, bounds, maxHr),
    listRestingHeartRateByDay(db, bounds),
    listDayTotals(db, bounds),
    listHrvReadingsSince(db, windowStart),
    // A night that ends on the first day started the evening before.
    listSleepSince(db, windowStart - 12 * 3600),
    listSleepScores(db),
    listWorkoutsSince(db, windowStart, windowStart + count * DAY_SEC + 3600, -1),
  ]);
  const strain = new Map((await withRideLoad(db, strainFromLoads(loads), Math.floor(Date.now() / 1000))).map((s) => [s.day, s.strain]));
  const nights = buildNights(sleep, scores);
  const sleepDays = sleepByDay(nights);
  const scoreByDay = new Map<number, number>();
  for (const n of nights) if (!n.nap && n.score) scoreByDay.set(startOfLocalDay(n.end), n.score.score);
  const hrvByDay = new Map<number, number[]>();
  for (const r of hrv) {
    if (r.source !== 'night' || !(r.rmssd > 0)) continue;
    const key = startOfLocalDay(r.end);
    hrvByDay.set(key, [...(hrvByDay.get(key) ?? []), r.rmssd]);
  }
  const exercise = new Map<number, number>();
  for (const { workout } of workouts) {
    const key = startOfLocalDay(workout.start);
    exercise.set(key, (exercise.get(key) ?? 0) + workout.duration / 60);
  }
  return starts.map((start): DigestDay => {
    const s = sleepDays.get(start);
    const h = hrvByDay.get(start);
    const t = totals.get(start);
    const active = t ? cleanActiveKcal(t.calories / 1000) : null;
    return {
      d: localDate(start * 1000),
      sleepMin: s?.hasNight ? round(s.asleepSeconds / 60) : null,
      sleepScore: scoreByDay.get(start) ?? null,
      restBpm: resting.get(start) ?? null,
      hrvMs: h && h.length > 0 ? round(h.reduce((a, b) => a + b, 0) / h.length) : null,
      strain: strain.get(start) ?? null,
      steps: t && t.steps > 0 ? t.steps : null,
      activeKcal: active,
      exerciseMin: exercise.has(start) ? round(exercise.get(start)!) : null,
      weightKg: null,
      eatKcal: null,
      proteinG: null,
    };
  });
}

export const workoutId = (start: number): string => `w:${start}`;

/** Workouts that started in `[from, to]`, newest first, in the digest's shape. `planTitle` names the plan session a workout was matched to. */
export async function readWorkouts(
  db: SQLiteDatabase,
  from: string,
  to: string,
  sport: string | null,
  planTitle: (start: number) => string | null,
): Promise<DigestWorkout[]> {
  const rows = await listWorkoutsSince(db, dayStartOf(from), dayStartOf(to) + DAY_SEC, -1);
  const wanted = sport?.toLowerCase() ?? null;
  return rows
    .filter(({ workout }) => wanted === null || workout.sportName.toLowerCase().includes(wanted))
    .map(({ workout }) => ({
      id: workoutId(workout.start),
      d: localDate(workout.start * 1000),
      sport: workout.sportName,
      min: round(workout.duration / 60),
      km: workout.distance > 0 ? round(workout.distance / 1000, 2) : null,
      avgBpm: workout.avgHr,
      plan: planTitle(workout.start),
    }));
}

/** The details of one workout by id `w:<start>`: heart rate zones, effect, recovery, splits and laps from what the phone stored. No GPS, no per-second series. */
export async function readWorkoutDetail(db: SQLiteDatabase, id: string): Promise<Record<string, unknown> | null> {
  const start = Number(id.replace(/^w:/, ''));
  if (!Number.isInteger(start)) return null;
  const [row] = await listWorkoutsSince(db, start, start + 1, -1);
  if (!row) return null;
  const { workout }: { workout: WorkoutRow } = row;
  const summary = parseSummary(row.summaryJson);
  const points = await listWorkoutPoints(db, workout.id);
  const strain = workoutStrain(points.map((p) => ({ ts: p.ts, hr: p.hr })), userMaxHr());
  const splits = (summary.paceBlocks ?? [])
    .filter((b) => b.type === 0 && b.correction === null)
    .slice(0, 25)
    .map((b) => ({ km: b.distance, paceSec: b.pace }));
  return {
    id,
    d: localDate(workout.start * 1000),
    sport: workout.sportName,
    min: round(workout.duration / 60),
    km: workout.distance > 0 ? round(workout.distance / 1000, 2) : null,
    avgBpm: workout.avgHr,
    maxBpm: workout.maxHr,
    calories: workout.calories > 0 ? workout.calories : null,
    avgPaceSecPerKm: summary.avgPaceSecPerKm ?? null,
    elevationGainM: summary.elevationGain ?? null,
    effect: { aerobic: summary.aerobicEffect ?? null, anaerobic: summary.anaerobicEffect ?? null, load: summary.workoutLoad ?? null },
    recoveryHours: summary.recoveryHours ?? null,
    zoneMinutes: strain ? strain.zoneMinutes.map((m) => round(m, 1)) : null,
    strain: strain ? round(strain.strain, 1) : null,
    splitsPerKm: splits,
    laps: (summary.laps ?? []).length,
  };
}

/** One night, the one that ended on `date`, with its stages when the watch gave any. */
export async function readSleepNight(db: SQLiteDatabase, date: string): Promise<SleepNight | null> {
  const dayStart = dayStartOf(date);
  const [sleep, scores, hrv, resting] = await Promise.all([
    listSleepSince(db, dayStart - 12 * 3600),
    listSleepScores(db),
    listHrvReadingsSince(db, dayStart),
    listRestingHeartRateByDay(db, dayBounds([dayStart, dayStart + DAY_SEC])),
  ]);
  const night = buildNights(sleep, scores).find((n) => !n.nap && startOfLocalDay(n.end) === dayStart);
  if (!night) return null;
  const clock = (sec: number) => {
    const d = new Date(sec * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const rmssd = hrv.filter((r) => r.source === 'night' && r.end >= night.start - 3600 && r.end <= night.end + 3600 && r.rmssd > 0).map((r) => r.rmssd);
  return {
    date,
    onset: clock(night.start),
    wake: clock(night.end),
    asleepMin: round(night.asleepSeconds / 60),
    awakeMin: round(night.seconds.awake / 60),
    stages: nightHasStages(night) ? { rem: round(night.seconds.rem / 60), light: round(night.seconds.light / 60), deep: round(night.seconds.deep / 60) } : 'none',
    awakenings: night.awakenings,
    hrvMs: rmssd.length > 0 ? round(rmssd.reduce((a, b) => a + b, 0) / rmssd.length) : null,
    restBpm: resting.get(dayStart) ?? null,
    score: night.score?.score ?? null,
  };
}
