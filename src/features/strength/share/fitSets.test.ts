import { describe, expect, it } from 'bun:test';

import { buildFit, buildUploadForm, type StravaWorkout } from '@/features/strava/activityFile';
import { FIT_EPOCH_OFFSET } from '@/features/strava/fitEncoder';
import { decodeFit } from '@/features/strava/testDecode';

import { buildCatalog } from '../catalog';
import type { StrengthExercise, StrengthSet } from '../types';
import { ACTIVE_SET_MS, exerciseCategory, FIT_CATEGORY, fitSetsOf } from './fitSets';

const START = 1_760_000_000;
const catalog = buildCatalog([
  { id: 'custom_a', name: 'Wrist roller', primary: ['forearms'], equipment: 'other', timed: false, updatedAt: 0, deletedAt: null },
  { id: 'custom_b', name: 'Mystery', primary: [], equipment: 'other', timed: false, updatedAt: 0, deletedAt: null },
]);

const workout: StravaWorkout = { start: START, end: START + 3000, sportType: 140, sportName: 'Strength Training', duration: 2700, distance: 0, calories: 250, avgHr: 110, maxHr: 150 };
const points = [
  { ts: START + 10, lat: null, lon: null, alt: null, hr: 90 },
  { ts: START + 1500, lat: null, lon: null, alt: null, hr: 120 },
];

const set = (id: string, over: Partial<StrengthSet>): StrengthSet => ({
  id,
  type: 'normal',
  weightKg: null,
  reps: null,
  seconds: null,
  rpe: null,
  done: true,
  doneAt: null,
  ...over,
});
const exercise = (exerciseId: string, sets: StrengthSet[]): StrengthExercise => ({ key: `k${exerciseId}`, exerciseId, note: '', restSec: null, supersetGroup: null, sets });

describe('exerciseCategory', () => {
  const cat = (id: string) => exerciseCategory(id, catalog.get(id));

  it('matches the FIT profile numbers', () => {
    expect(FIT_CATEGORY).toMatchObject({ benchPress: 0, calfRaise: 1, deadlift: 8, lunge: 17, pullUp: 21, row: 23, squat: 28, unknown: 65534 });
  });

  it('maps by movement pattern', () => {
    expect(cat('barbell_bench_press')).toBe(FIT_CATEGORY.benchPress);
    expect(cat('barbell_overhead_press')).toBe(FIT_CATEGORY.shoulderPress);
    expect(cat('barbell_bent_over_row')).toBe(FIT_CATEGORY.row);
    expect(cat('lat_pulldown')).toBe(FIT_CATEGORY.pullUp);
    expect(cat('barbell_back_squat')).toBe(FIT_CATEGORY.squat);
    expect(cat('barbell_deadlift')).toBe(FIT_CATEGORY.deadlift);
    expect(cat('barbell_rdl')).toBe(FIT_CATEGORY.deadlift);
    expect(cat('reverse_lunge')).toBe(FIT_CATEGORY.lunge);
    expect(cat('calf_raise')).toBe(FIT_CATEGORY.calfRaise);
    expect(cat('barbell_hip_thrust')).toBe(FIT_CATEGORY.hipRaise);
    expect(cat('jumping_jacks')).toBe(FIT_CATEGORY.cardio);
  });

  it('picks the arm exercise by muscle and special-cases slugs', () => {
    expect(cat('barbell_curl')).toBe(FIT_CATEGORY.curl);
    expect(cat('triceps_pushdown')).toBe(FIT_CATEGORY.tricepsExtension);
    expect(cat('bench_dip')).toBe(FIT_CATEGORY.tricepsExtension);
    expect(cat('push_up')).toBe(FIT_CATEGORY.pushUp);
    expect(cat('pike_push_up')).toBe(FIT_CATEGORY.shoulderPress);
    expect(cat('plank')).toBe(FIT_CATEGORY.plank);
    expect(cat('db_lateral_raise')).toBe(FIT_CATEGORY.lateralRaise);
    expect(cat('seated_leg_curl')).toBe(FIT_CATEGORY.legCurl);
    expect(cat('cable_crunch')).toBe(FIT_CATEGORY.crunch);
    expect(cat('hanging_leg_raise')).toBe(FIT_CATEGORY.legRaise);
    expect(cat('back_extension')).toBe(FIT_CATEGORY.hyperextension);
    expect(cat('cable_crossover')).toBe(FIT_CATEGORY.flye);
    expect(cat('kettlebell_swing')).toBe(FIT_CATEGORY.hipSwing);
  });

  it('uses the primary muscle of a custom exercise, unknown without one or for an id nothing knows', () => {
    expect(cat('custom_a')).toBe(FIT_CATEGORY.curl);
    expect(cat('custom_b')).toBe(FIT_CATEGORY.unknown);
    expect(cat('removed_exercise')).toBe(FIT_CATEGORY.unknown);
  });
});

describe('fitSetsOf', () => {
  const startedAt = START * 1000;

  it('ends each set when it was checked and keeps a rest gap out of it', () => {
    const sets = fitSetsOf(
      { startedAt, exercises: [exercise('barbell_back_squat', [set('a', { weightKg: 100, reps: 5, doneAt: startedAt + 300_000 }), set('b', { weightKg: 100, reps: 5, doneAt: startedAt + 330_000 })])] },
      catalog,
    );
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ endMs: startedAt + 300_000, durationMs: ACTIVE_SET_MS, startMs: startedAt + 300_000 - ACTIVE_SET_MS, reps: 5, weightKg: 100, category: FIT_CATEGORY.squat });
    // Only 30 s since the previous set: the second one cannot last 40 s.
    expect(sets[1]).toMatchObject({ startMs: startedAt + 300_000, endMs: startedAt + 330_000, durationMs: 30_000 });
  });

  it('orders by time across exercises, counts warm-ups, drops undone and untimed sets', () => {
    const sets = fitSetsOf(
      {
        startedAt,
        exercises: [
          exercise('barbell_curl', [set('c1', { weightKg: 20, reps: 10, doneAt: startedAt + 200_000 }), set('c2', { weightKg: 20, reps: 10, done: false })]),
          exercise('barbell_bench_press', [set('b0', { type: 'warmup', weightKg: 20, reps: 10, doneAt: startedAt + 100_000 }), set('b1', { weightKg: 60, reps: 8, doneAt: null })]),
        ],
      },
      catalog,
    );
    expect(sets.map((s) => s.category)).toEqual([FIT_CATEGORY.benchPress, FIT_CATEGORY.curl]);
    expect(sets[1]!.startMs).toBeGreaterThanOrEqual(sets[0]!.endMs);
  });

  it('writes a timed set with its seconds and no reps, and never starts before the workout', () => {
    const [plank, early] = fitSetsOf(
      { startedAt, exercises: [exercise('plank', [set('p', { seconds: 45, reps: null, doneAt: startedAt + 120_000 }), set('q', { seconds: 60, doneAt: startedAt + 125_000 })])] },
      catalog,
    );
    expect(plank).toMatchObject({ reps: null, durationMs: 45_000 });
    expect(early!.durationMs).toBe(5_000);
    expect(early!.startMs).toBe(plank!.endMs);
    const first = fitSetsOf({ startedAt, exercises: [exercise('push_up', [set('x', { reps: 10, doneAt: startedAt - 5_000 })])] }, catalog);
    expect(first[0]).toMatchObject({ startMs: startedAt, endMs: startedAt, durationMs: 0 });
  });
});

describe('buildFit with sets', () => {
  const sets = fitSetsOf(
    {
      startedAt: START * 1000,
      exercises: [
        exercise('barbell_bench_press', [
          set('a', { weightKg: 62.5, reps: 8, doneAt: (START + 200) * 1000 }),
          set('b', { weightKg: 65, reps: 6, doneAt: (START + 400) * 1000 }),
        ]),
        exercise('plank', [set('p', { seconds: 45, doneAt: (START + 600) * 1000 })]),
        exercise('push_up', [set('u', { reps: 15, doneAt: (START + 9999) * 1000 })]),
      ],
    },
    catalog,
  );

  it('decodes without errors and carries every set', () => {
    const built = buildFit(workout, points, { utcOffsetSeconds: 0, sets });
    const decoded = decodeFit(built.bytes);
    expect(decoded.errors).toEqual([]);
    expect(decoded.integrity).toBe(true);
    const out = decoded.messages.setMesgs ?? [];
    expect(out).toHaveLength(4);
    expect(out.map((s) => s.repetitions)).toEqual([8, 6, undefined, 15]);
    expect(out.map((s) => s.weight)).toEqual([62.5, 65, undefined, undefined]);
    expect(out.map((s) => s.setType)).toEqual([1, 1, 1, 1]);
    expect(out.map((s) => s.messageIndex)).toEqual([0, 1, 2, 3]);
    expect(out.map((s) => s.category)).toEqual([[0], [0], [19], [22]]);
    expect(out[2]!.duration).toBe(45);
    expect(out[0]!.duration).toBe(40);
  });

  it('keeps the sets in time order inside the workout and before lap and session', () => {
    const decoded = decodeFit(buildFit(workout, points, { utcOffsetSeconds: 0, sets }).bytes);
    const out = decoded.messages.setMesgs ?? [];
    const fitStart = START - FIT_EPOCH_OFFSET;
    for (const s of out) {
      expect(Number(s.timestamp)).toBeGreaterThanOrEqual(Number(s.startTime));
      expect(Number(s.startTime)).toBeGreaterThanOrEqual(fitStart);
      expect(Number(s.timestamp)).toBeLessThanOrEqual(fitStart + 3000);
    }
    expect(out.map((s) => Number(s.timestamp))).toEqual([...out.map((s) => Number(s.timestamp))].sort((a, b) => a - b));
    expect(Object.keys(decoded.messages)).toEqual(['fileIdMesgs', 'deviceInfoMesgs', 'eventMesgs', 'recordMesgs', 'setMesgs', 'lapMesgs', 'sessionMesgs', 'activityMesgs']);
  });

  it('leaves a workout without sets exactly as before', () => {
    const hash = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const bytes = buildFit(workout, points, { utcOffsetSeconds: 25200 }).bytes;
    // Hashes of the output of the version before `sets` existed.
    expect(hash(bytes)).toBe('8231ef6d8c3356d09c14cd44d1734ebee4c2034ed227415a1f7ffc0420c81fa6');
    expect(buildFit(workout, points, { utcOffsetSeconds: 25200, sets: [] }).bytes).toEqual(bytes);
    expect(hash(buildUploadForm(workout, bytes, { addLink: true }).body)).toBe('e69a1f02a0b8aa15b662f214d479315ed8477c5967d584115d0000fb290e11ea');
  });
});

describe('buildUploadForm for a strength workout', () => {
  const text = (name: string | undefined, description: string | undefined, addLink: boolean) =>
    new TextDecoder().decode(buildUploadForm(workout, new Uint8Array(0), { addLink, name, description }).body);

  it('uses the workout name and description, with the link below when allowed', () => {
    const withLink = text('Push day', 'Total volume 5.000 kg.', true);
    expect(withLink).toContain('name="name"\r\n\r\nPush day\r\n');
    expect(withLink).toMatch(/name="description"\r\n\r\nTotal volume 5\.000 kg\.\n\nfit\.joyorogo\.com/);
    const without = text('Push day', 'Total volume 5.000 kg.', false);
    expect(without).toContain('name="description"\r\n\r\nTotal volume 5.000 kg.\r\n');
    expect(without).not.toContain('joyorogo');
  });

  it('keeps the sport name and the plain link without them', () => {
    expect(text(undefined, undefined, true)).toContain('name="name"\r\n\r\nStrength Training\r\n');
    expect(text(undefined, undefined, true)).toMatch(/name="description"\r\n\r\nfit\.joyorogo\.com/);
  });
});
