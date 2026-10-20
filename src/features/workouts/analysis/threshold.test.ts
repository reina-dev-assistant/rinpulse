import { beforeEach, describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openMemoryDb } from '@/cloud/syncTestKit';
import { getWorkout, listWorkoutPoints, listWorkoutsSince } from '@/db/queries';
import { loadRunEfforts, recentRuns } from '@/features/fitness/runEfforts';
import type { FitnessWorkout } from '@/features/fitness/useFitnessData';
import { parseSummary } from '@/features/workouts/summary';

import { analyzeWorkout } from './analyze';
import { straightRun, T0, type Leg } from './fixtures';
import { loadAnalysisHistory } from './history';
import { clearEffortCache } from './threshold';
import { thresholdPaceFromEfforts } from './zones';

const DAY = 86400;
const MAX_HR = 190;
const ALL = { includeHr: true, includeRoute: true, includeComparison: true };

interface Run {
  name: string;
  summary?: Record<string, unknown>;
  legs: Leg[];
  day: number;
}

/** Salim's sequence: a hard first run (a fast mile at the start), then two easy jogs. */
const FAST_FIRST: Leg[] = [
  { sec: 560, speed: 2.9 },
  { sec: 700, speed: 2.0 },
];
const EASY_JOG: Leg[] = [{ sec: 1800, speed: 1.85 }];

interface Seeded {
  db: SQLiteDatabase;
  ids: number[];
}

function seed(runs: readonly Run[]): Seeded {
  const { raw, db } = openMemoryDb();
  const ids: number[] = [];
  for (const r of runs) {
    const start = T0 + r.day * DAY;
    const synth = straightRun({ legs: r.legs, start, hr: () => 150 });
    const inserted = raw
      .query(
        `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete)
         VALUES (0, ?, ?, 1, ?, ?, ?, 0, 0, ?, 1)`,
      )
      .run(start, start + synth.elapsed, r.name, synth.elapsed, Math.round(synth.distance), JSON.stringify(r.summary ?? {}));
    const id = Number(inserted.lastInsertRowid);
    ids.push(id);
    for (const p of synth.points) {
      raw
        .query('INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, p.ts, p.lat, p.lon, p.alt, p.hr, p.speed, p.cadence, p.stride, p.power);
    }
  }
  return { db, ids };
}

/** The detail screen's own pipeline: stored row, its points, its history, the analysis. */
async function thresholdOf(db: SQLiteDatabase, id: number): Promise<number | null> {
  const found = await getWorkout(db, id);
  if (!found) throw new Error('missing');
  const points = await listWorkoutPoints(db, id);
  const summary = parseSummary(found.summaryJson);
  const history = await loadAnalysisHistory(db, found.workout, summary, MAX_HR);
  const a = analyzeWorkout({ workout: found.workout, summary, points, maxHr: MAX_HR, daySamples: [], history }, ALL);
  return a.paceZones?.thresholdSecKm ?? null;
}

async function sequence(runs: readonly Run[]): Promise<(number | null)[]> {
  const { db, ids } = seed(runs);
  const out: (number | null)[] = [];
  for (const id of ids) out.push(await thresholdOf(db, id));
  return out;
}

beforeEach(clearEffortCache);

describe('threshold pace never drifts slower because recent runs were easy', () => {
  it('same sport name: the later easy runs keep the first run\'s threshold', async () => {
    const [gb1, gb2, gb3] = await sequence([
      { name: 'Running', legs: FAST_FIRST, day: 0 },
      { name: 'Running', legs: EASY_JOG, day: 1 },
      { name: 'Running', legs: EASY_JOG, day: 2 },
    ]);
    expect(gb1).not.toBeNull();
    expect(gb2).toBe(gb1 as number);
    expect(gb3).toBe(gb1 as number);
  });

  it('sport names of different sources (watch "Running", phone "Run", "Trail run") share one threshold', async () => {
    const [gb1, gb2, gb3] = await sequence([
      { name: 'Running', legs: FAST_FIRST, day: 0 },
      { name: 'Run', legs: EASY_JOG, day: 1 },
      { name: 'Trail run', legs: EASY_JOG, day: 2 },
    ]);
    expect(gb2).toBe(gb1 as number);
    expect(gb3).toBe(gb1 as number);
  });

  it('a run whose name the table does not know but whose summary kind is a run still counts', async () => {
    const [gb1, gb2] = await sequence([
      { name: 'Workout (Huawei type 264)', summary: { kind: 'RUNNING' }, legs: FAST_FIRST, day: 0 },
      { name: 'Running', legs: EASY_JOG, day: 1 },
    ]);
    expect(gb2).toBe(gb1 as number);
  });

  it('an unnamed run analysed after a named one finds the history too', async () => {
    const [, gb2] = await sequence([
      { name: 'Running', legs: FAST_FIRST, day: 0 },
      { name: 'Workout (Huawei type 264)', summary: { kind: 'RUNNING' }, legs: EASY_JOG, day: 1 },
    ]);
    const alone = (await sequence([{ name: 'Running', legs: EASY_JOG, day: 1 }]))[0];
    expect(gb2).toBeLessThan(alone as number);
  });
});

describe('one threshold for the workout analysis and the coach', () => {
  it('gives the coach the figure the next run is analysed with', async () => {
    const runs: Run[] = [
      { name: 'Running', legs: FAST_FIRST, day: 0 },
      { name: 'Run', legs: EASY_JOG, day: 1 },
      { name: 'Trail run', legs: EASY_JOG, day: 2 },
      { name: 'Running', legs: EASY_JOG, day: 3 },
    ];
    const { db, ids } = seed(runs);
    const next = await thresholdOf(db, ids[3]);
    const nowSec = T0 + 3 * DAY;
    const loaded = await listWorkoutsSince(db, nowSec - 120 * DAY, nowSec, -1);
    const workouts: FitnessWorkout[] = loaded.map((r) => ({ workout: r.workout, summary: parseSummary(r.summaryJson) }));
    const coach = thresholdPaceFromEfforts([], await loadRunEfforts(db, recentRuns(workouts, nowSec)));
    expect(coach).not.toBeNull();
    expect(Math.round(coach as number)).toBe(next as number);
    expect(next).toBe((await thresholdOf(db, ids[0])) as number);
  });
});

describe('which runs count', () => {
  it('forgets runs older than 90 days: the threshold follows the recent best, not an old one', async () => {
    const [, recent] = await sequence([
      { name: 'Running', legs: FAST_FIRST, day: 0 },
      { name: 'Running', legs: EASY_JOG, day: 100 },
    ]);
    const [, inside] = await sequence([
      { name: 'Running', legs: FAST_FIRST, day: 0 },
      { name: 'Running', legs: EASY_JOG, day: 80 },
    ]);
    const [first] = await sequence([{ name: 'Running', legs: FAST_FIRST, day: 0 }]);
    expect(inside).toBe(first as number);
    expect(recent).toBeGreaterThan(first as number);
  });

  it('never takes the threshold from walks or hikes', async () => {
    const [, run] = await sequence([
      { name: 'Walking', legs: FAST_FIRST, day: 0 },
      { name: 'Running', legs: EASY_JOG, day: 1 },
    ]);
    const [alone] = await sequence([{ name: 'Running', legs: EASY_JOG, day: 1 }]);
    expect(run).toBe(alone as number);
  });
});
