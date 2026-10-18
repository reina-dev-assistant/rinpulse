/**
 * Threads carousel fixtures, built the way the app builds them: synthetic workouts go through `analyzeWorkout` / `analyzeRide` and
 * the real subject builders, so the golden slides also test the data side. Deterministic: no clock, seeded noise only.
 */
import type { WorkoutRow } from '@/db/queries';
import { analyzeRide } from '@/features/cycling/analyzeRide';
import { rideInput, syntheticPoints, T0 as RIDE_T0 } from '@/features/cycling/rideFixtures';
import type { RideAnalysis } from '@/features/cycling/types';
import type { PersonalRecord } from '@/features/strength/calc';
import { buildCatalog } from '@/features/strength/catalog';
import type { StrengthExercise, StrengthSet, StrengthWorkout } from '@/features/strength/types';
import { analyzeWorkout, type AnalysisHistory } from '@/features/workouts/analysis/analyze';
import { straightRun, T0, workoutRow } from '@/features/workouts/analysis/fixtures';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';

import { buildThreadsRun, buildThreadsStrength, weeklyContext, type ThreadsContext } from '../data/threads';
import type { StickerSubject } from '../subject';
import { loopRoute } from './routes';

const NO_HISTORY: AnalysisHistory = { efforts: [], trimps: [], similar: [] };
const DAY = 86_400;
const MAX_HR = 188;

/** Deterministic wobble in [-1, 1]. */
const wobble = (t: number, seed: number) => Math.sin(t / 37 + seed) * 0.6 + Math.sin(t / 11 + seed * 2.3) * 0.4;

function routeOf(points: number, radiusM: number): RoutePoint[] {
  return loopRoute(points, radiusM).map(([lat, lon]) => ({ lat, lon }));
}

/** Completed runs spread over the four weeks before `anchor`: (days back, km). */
function pastWorkouts(anchor: number, sportName: string, sessions: readonly [number, number][]): Pick<WorkoutRow, 'start' | 'end' | 'duration' | 'distance' | 'sportName' | 'complete'>[] {
  return sessions.map(([back, km]) => ({ start: anchor - back * DAY, end: anchor - back * DAY + km * 360, duration: Math.round(km * 355), distance: km * 1000, sportName, complete: true }));
}

// ------------------------------------------------------------------------------------------------------------------ run

export interface RunScenario {
  sportName: string;
  /** Pace of each kilometre in seconds, the last entry may be a partial kilometre (see `lastKm`). */
  paces: number[];
  /** Length of the last entry in km (1 = whole). */
  lastKm?: number;
  hr?: boolean;
  cadence?: boolean;
  withRoute?: boolean;
  summary?: WorkoutSummary;
  context?: boolean;
  deviceName?: string | null;
}

export function runSubject(s: RunScenario): StickerSubject {
  const legs = s.paces.map((pace, i) => {
    const km = i === s.paces.length - 1 ? (s.lastKm ?? 1) : 1;
    return { sec: Math.round(pace * km), speed: 1000 / pace };
  });
  const elapsed = legs.reduce((a, l) => a + l.sec, 0);
  const synth = straightRun({
    legs,
    hr: s.hr === false ? undefined : (t) => Math.round(138 + (34 * t) / elapsed + wobble(t, 1) * 4),
    alt: (t) => 28 + Math.sin(t / 260) * 9 + t / 600,
    cadence: s.cadence === false ? undefined : (t) => Math.round(171 + wobble(t, 2) * 3),
  });
  const workout = workoutRow({
    start: T0,
    end: T0 + synth.elapsed,
    sportName: s.sportName,
    duration: synth.elapsed,
    distance: Math.round(synth.distance),
    calories: Math.round(synth.distance * 0.062),
    avgHr: s.hr === false ? null : 158,
    maxHr: s.hr === false ? null : 179,
    steps: Math.round(synth.distance * 1.22),
  });
  const summary = s.summary ?? {};
  const analysis = analyzeWorkout({ workout, summary, points: synth.points, maxHr: MAX_HR, daySamples: [], history: NO_HISTORY }, { includeHr: true, includeRoute: true, includeComparison: false });
  const context: ThreadsContext | null = s.context
    ? weeklyContext({
        workouts: pastWorkouts(T0, s.sportName, [[2, 8.1], [4, 5.2], [7, 12.4], [9, 6], [11, 5], [14, 9.6], [16, 5.3], [19, 7.5], [22, 5], [25, 14.2]]),
        strength: [],
        anchorSec: workout.end,
        kind: 'run',
      })
    : null;
  return buildThreadsRun(
    { workout, summary, analysis, route: s.withRoute === false ? [] : routeOf(520, 420), gearLine: null, ride: null, deviceName: s.deviceName === undefined ? 'HUAWEI WATCH FIT 4 Pro' : s.deviceName, context },
    'id',
  );
}

/** A 10.4 km run with a negative split, heart rate, cadence, route, load and four weeks of history. */
export const RUN_SPLITS = (): StickerSubject =>
  runSubject({
    sportName: 'Running',
    paces: [372, 366, 361, 358, 352, 355, 349, 346, 341, 333, 322],
    lastKm: 0.4,
    context: true,
    summary: { vo2max: 49, aerobicEffect: 3.4, anaerobicEffect: 1.2, recoveryHours: 38, workoutLoad: 142 },
  });

const longPaces = (km: number) => Array.from({ length: km }, (_, i) => 330 + Math.round(i * 0.9 + Math.sin(i) * 6));

/** A 30 km long run: 30 rows, so the table needs three pages. */
export const RUN_LONG = (): StickerSubject => runSubject({ sportName: 'Running', paces: longPaces(31), lastKm: 0.2, context: true, deviceName: 'COROS PACE 3' });

/** A marathon: 43 rows are more than three pages hold, so the builder merges kilometres in pairs. Not a golden fixture. */
export const RUN_MARATHON = (): StickerSubject => runSubject({ sportName: 'Running', paces: longPaces(43), lastKm: 0.2 });

/** A walk with a distance and a time and nothing else: no heart rate, no cadence, no route, no device. */
export const WALK_SPARSE = (): StickerSubject =>
  runSubject({ sportName: 'Walking', paces: [640, 655, 648], lastKm: 0.6, hr: false, cadence: false, withRoute: false, deviceName: null });

// ----------------------------------------------------------------------------------------------------------------- ride

function rideScenario(): { analysis: WorkoutAnalysis; ride: RideAnalysis; workout: WorkoutRow; summary: WorkoutSummary } {
  const secs = 5400;
  // Two ten-minute climbs on a 9 m/s road: 2.4 km at 4 m/s, about 5 percent.
  const climbing = (t: number) => (t >= 1200 && t < 1800) || (t >= 3300 && t < 3900);
  const speed = (t: number) => (climbing(t) ? 4 + wobble(t, 3) * 0.4 : 9 + wobble(t, 4) * 1.2);
  const alt = (t: number) => {
    let a = 120;
    for (let s = 0; s < t; s += 10) a += (climbing(s) ? 0.2 : -0.04) * 10 + 0.0;
    return a + wobble(t, 5) * 0.8;
  };
  const opts = {
    secs,
    gps: true,
    speedChannel: true,
    speed,
    alt,
    power: (t: number) => Math.round(climbing(t) ? 262 + wobble(t, 6) * 22 : 168 + wobble(t, 7) * 45),
    hr: (t: number) => Math.round(128 + (climbing(t) ? 32 : 10) + wobble(t, 8) * 4),
    cadence: (t: number) => Math.round(climbing(t) ? 78 + wobble(t, 9) * 4 : 90 + wobble(t, 10) * 5),
  };
  const input = rideInput(opts, { profile: { ftp: 245 }, workout: { sportName: 'Outdoor Cycling', calories: 1180 } });
  const ride = analyzeRide(input);
  const workout = workoutRow({
    start: RIDE_T0,
    end: RIDE_T0 + secs,
    sportName: 'Outdoor Cycling',
    sportType: 3,
    duration: secs,
    distance: input.workout.distance,
    calories: 1180,
    avgHr: 142,
    maxHr: 176,
  });
  const points = syntheticPoints(opts).map((p) => ({ ...p, stride: null }));
  const analysis = analyzeWorkout({ workout, summary: {}, points, maxHr: MAX_HR, daySamples: [], history: NO_HISTORY }, { includeHr: true, includeRoute: true, includeComparison: false });
  return { analysis, ride, workout, summary: {} };
}

/** A 48 km hilly ride with a power meter, heart rate, cadence, two climbs and four weeks of rides. */
export const RIDE_POWER = (): StickerSubject => {
  const { analysis, ride, workout, summary } = rideScenario();
  const context = weeklyContext({
    workouts: pastWorkouts(workout.start, 'Outdoor Cycling', [[2, 38], [5, 52], [8, 24], [12, 61], [15, 33], [19, 44], [23, 28], [26, 70]]),
    strength: [],
    anchorSec: workout.end,
    kind: 'ride',
  });
  return buildThreadsRun({ workout, summary, analysis, route: routeOf(540, 1800), gearLine: null, ride, deviceName: 'Magene C506', context }, 'id');
};

// -------------------------------------------------------------------------------------------------------------- strength

let n = 0;
const set = (weightKg: number | null, reps: number | null, over: Partial<StrengthSet> = {}): StrengthSet => ({
  id: `s${n++}`,
  type: 'normal',
  weightKg,
  reps,
  seconds: null,
  rpe: null,
  done: true,
  doneAt: 1,
  ...over,
});
const lift = (exerciseId: string, sets: StrengthSet[]): StrengthExercise => ({ key: `k${n++}`, exerciseId, note: '', restSec: null, supersetGroup: null, sets });

export const STRENGTH_STARTED = Date.UTC(2026, 9, 14, 3, 5);

/** Eight exercises with warm-ups, drop sets, a bodyweight exercise and a timed one, two records, four weeks of history. */
export const STRENGTH_PUSH = (): StickerSubject => {
  const bench = lift('barbell_bench_press', [set(40, 10, { type: 'warmup' }), set(80, 5, { rpe: 7 }), set(82.5, 5, { rpe: 8 }), set(82.5, 5, { rpe: 8.5 }), set(82.5, 4, { rpe: 9 })]);
  const workout: StrengthWorkout = {
    id: 'wfixture',
    name: 'Push day',
    startedAt: STRENGTH_STARTED,
    endedAt: STRENGTH_STARTED + 3720_000,
    durationSec: 3720,
    note: '',
    routineId: null,
    planKey: null,
    exercises: [
      bench,
      lift('barbell_overhead_press', [set(50, 6), set(52.5, 6), set(52.5, 5)]),
      lift('incline_db_press', [set(30, 10), set(30, 10), set(30, 9), set(24, 12, { type: 'drop' })]),
      lift('db_lateral_raise', [set(10, 15), set(10, 15), set(10, 14), set(8, 15)]),
      lift('triceps_pushdown', [set(35, 12), set(35, 12), set(35, 11)]),
      lift('bench_dip', [set(null, 12), set(null, 10), set(null, 9)]),
      lift('db_overhead_triceps_extension', [set(20, 12), set(20, 12)]),
      lift('plank', [set(null, null, { seconds: 60 }), set(null, null, { seconds: 55 })]),
    ],
    workoutStart: null,
    kcal: 310,
    kcalSource: 'estimate',
    updatedAt: STRENGTH_STARTED,
    deletedAt: null,
  };
  const records: PersonalRecord[] = [
    { exerciseId: 'barbell_bench_press', kind: 'e1rm', setId: bench.sets[2]!.id, value: 96, previous: 92 },
    { exerciseId: 'barbell_overhead_press', kind: 'weight', setId: workout.exercises[1]!.sets[1]!.id, value: 52.5, previous: 50 },
  ];
  const catalog = buildCatalog([]);
  const prior = (daysBack: number, volume: number): StrengthWorkout => ({
    ...workout,
    id: `w${daysBack}`,
    startedAt: STRENGTH_STARTED - daysBack * DAY * 1000,
    exercises: [lift('barbell_bench_press', [set(volume / 10, 10), set(volume / 10, 10)])],
  });
  const context = weeklyContext({ workouts: [], strength: [workout, prior(3, 1800), prior(6, 2100), prior(10, 1900), prior(13, 2300), prior(17, 2200), prior(20, 2400), prior(24, 2000)], anchorSec: Math.floor(workout.endedAt / 1000), kind: 'strength' });
  return buildThreadsStrength({ workout, catalog, records, resolveMuscles: catalog.muscles, context, deviceName: null }, 'id');
};

/** Twenty exercises: the third exercises slide and its "+ more" line. */
export const STRENGTH_FULLBODY = (): StickerSubject => {
  const ids = ['barbell_back_squat', 'barbell_deadlift', 'barbell_bench_press', 'barbell_overhead_press', 'lat_pulldown', 'seated_cable_row', 'goblet_squat', 'hammer_curl', 'triceps_pushdown', 'db_lateral_raise', 'machine_row', 'incline_db_press'];
  const workout: StrengthWorkout = {
    id: 'wfull',
    name: 'Full body',
    startedAt: STRENGTH_STARTED,
    endedAt: STRENGTH_STARTED + 5400_000,
    durationSec: 5400,
    note: '',
    routineId: null,
    planKey: null,
    exercises: Array.from({ length: 20 }, (_, i) => lift(ids[i % ids.length]!, [set(20 + i * 2.5, 10), set(20 + i * 2.5, 8)])),
    workoutStart: null,
    kcal: 420,
    kcalSource: 'estimate',
    updatedAt: STRENGTH_STARTED,
    deletedAt: null,
  };
  const catalog = buildCatalog([]);
  return buildThreadsStrength({ workout, catalog, records: [], resolveMuscles: catalog.muscles, context: null, deviceName: null }, 'id');
};

/** A bodyweight session: no volume, no records, no history. */
export const STRENGTH_SPARSE = (): StickerSubject => {
  const workout: StrengthWorkout = {
    id: 'wsparse',
    name: 'Rumah',
    startedAt: STRENGTH_STARTED,
    endedAt: STRENGTH_STARTED + 1500_000,
    durationSec: 1500,
    note: '',
    routineId: null,
    planKey: null,
    exercises: [lift('bodyweight_squat', [set(null, 20), set(null, 20), set(null, 18)]), lift('incline_push_up', [set(null, 15), set(null, 12)])],
    workoutStart: null,
    kcal: null,
    kcalSource: null,
    updatedAt: STRENGTH_STARTED,
    deletedAt: null,
  };
  const catalog = buildCatalog([]);
  return buildThreadsStrength({ workout, catalog, records: [], resolveMuscles: catalog.muscles, context: null, deviceName: null }, 'id');
};

export interface ThreadsFixture {
  /** `threads.<variant>`: the key in golden file names. */
  key: string;
  label: string;
  subject: () => StickerSubject;
}

export const THREADS_FIXTURES: readonly ThreadsFixture[] = [
  { key: 'threads.run', label: 'Run with splits, heart rate, cadence, route, load and four weeks', subject: RUN_SPLITS },
  { key: 'threads.ride', label: 'Ride with power, climbs and four weeks', subject: RIDE_POWER },
  { key: 'threads.strength', label: 'Push day with records and four weeks', subject: STRENGTH_PUSH },
  { key: 'threads.longrun', label: 'Long run: three pages of splits', subject: RUN_LONG },
  { key: 'threads.fullbody', label: 'Twenty exercises: three pages of exercises', subject: STRENGTH_FULLBODY },
  { key: 'threads.walk', label: 'Sparse walk: distance and time only', subject: WALK_SPARSE },
  { key: 'threads.bodyweight', label: 'Sparse bodyweight session', subject: STRENGTH_SPARSE },
];
