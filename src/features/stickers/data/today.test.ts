import { afterEach, describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';
import type { Readiness } from '@/features/today/readiness';
import type { SleepSummary } from '@/features/today/stats';
import type { DayStrain } from '@/features/today/strain';
import { buildTodaySubject, type TodaySubjectInput } from '@/features/stickers/data/today';

const H = 3600;
const NOW = new Date(2026, 9, 17, 14, 30).getTime();

const readiness = (over: Partial<Readiness> = {}): Readiness => ({
  headline: 'Primed',
  signals: [
    { key: 'hrv', title: 'HRV', value: '62 ms', detail: '', tone: 'good', amount: 1 },
    { key: 'rhr', title: 'Detak istirahat', value: '+1', detail: '', tone: 'neutral', amount: 1 },
    { key: 'sleep', title: 'Tidur', value: '90%', detail: '', tone: 'bad', amount: 0.9 },
    { key: 'load', title: 'Beban', value: '1,1', detail: '', tone: 'neutral', amount: 1.1 },
    { key: 'load', title: 'Fifth', value: 'x', detail: '', tone: 'good', amount: 1 },
  ],
  missing: [],
  recovery: { percent: 78.4, band: 'green', rmssd: 61.6, source: 'night', baselineRmssd: 55, z: 0.9, baselineCount: 20 },
  hrvNote: null,
  ...over,
});

const stagedSleep: SleepSummary = {
  start: 0,
  end: 8 * H,
  totalSeconds: 8 * H,
  dayAsleepSeconds: 7 * H,
  naps: [],
  byType: [],
  byStage: [
    { stage: 'light', count: 1, seconds: 4 * H },
    { stage: 'deep', count: 1, seconds: 2 * H },
    { stage: 'rem', count: 1, seconds: 1 * H },
    { stage: 'awake', count: 1, seconds: 1 * H },
  ],
};

const strain: DayStrain = { day: 0, trimp: 100, strain: 8.46, zoneMinutes: [0, 0, 0, 0, 0], coveredMinutes: 600 };

const input = (over: Partial<TodaySubjectInput> = {}): TodaySubjectInput => ({
  steps: 8421,
  sleep: stagedSleep,
  readiness: readiness(),
  strain,
  stepGoal: 10000,
  restingHr: 54.4,
  nowMs: NOW,
  ...over,
});

const build = (over: Partial<TodaySubjectInput> = {}, locale: 'id' | 'en' = 'id') => buildTodaySubject(input(over), locale);
const ready = (over: Partial<TodaySubjectInput> = {}) => build(over).data.ready as Record<string, any>;
const watch = (over: Partial<TodaySubjectInput> = {}) => build(over).data.watch as Record<string, any>;

afterEach(() => applyLocale('id'));

describe('buildTodaySubject', () => {
  test('full day', () => {
    const subject = build();
    const r = subject.data.ready as Record<string, any>;
    expect(subject.id).toBe('today:2026-10-17');
    expect(subject.kinds).toEqual(['ready', 'watch']);
    expect(subject.date).toBe(NOW);
    expect(subject.heading).toBe('Bagikan hari ini');
    expect(subject.caption).toBe('Dicatat dengan JoyoFit · https://fit.joyorogo.com');
    expect(r.recovery).toBe(78);
    expect(r.headlineKey).toBe('Primed');
    expect(typeof r.headline).toBe('string');
    expect(r.headline.length).toBeGreaterThan(0);
    expect(r.strain).toBe(8.5);
    expect(r.strainPct).toBeCloseTo(8.5 / 21, 10);
    expect(r.sleepSec).toBe(7 * H); // awake excluded when staged
    expect(r.sleepPct).toBeCloseTo(7 / 8, 10);
    expect(r.steps).toBe(8421);
    expect(r.stepGoal).toBe(10000);
    expect(r.stepPct).toBeCloseTo(0.8421, 10);
    expect(r.rhr).toBe(54);
    expect(r.hrvMs).toBe(62);
    expect(r.signals).toHaveLength(4);
    expect(r.signals[0]).toEqual({ title: 'HRV', value: '62 ms', tone: 'good' });
    expect(JSON.parse(JSON.stringify(subject))).toEqual(subject);
  });

  test('watch namespace repeats the shared values', () => {
    const w = watch();
    const r = ready();
    for (const key of ['steps', 'stepGoal', 'stepPct', 'strain', 'strainPct', 'recovery', 'sleepSec', 'sleepPct', 'rhr']) {
      expect(w[key]).toEqual(r[key]);
    }
    expect('headline' in w).toBe(false);
    expect('signals' in w).toBe(false);
  });

  test('unstaged sleep counts all of it', () => {
    const r = ready({ sleep: { ...stagedSleep, byStage: [], totalSeconds: 6 * H, dayAsleepSeconds: 6 * H } });
    expect(r.sleepSec).toBe(6 * H);
  });

  test('sleep above the 8 h target clamps at 1.2', () => {
    const r = ready({ sleep: { ...stagedSleep, byStage: [], totalSeconds: 11 * H, dayAsleepSeconds: 11 * H } });
    expect(r.sleepPct).toBe(1.2);
  });

  test('no readiness recovery', () => {
    const r = ready({ readiness: readiness({ recovery: null }) });
    expect('recovery' in r).toBe(false);
    expect('hrvMs' in r).toBe(false);
    expect('recovery' in watch({ readiness: readiness({ recovery: null }) })).toBe(false);
  });

  test('no headline and no signals', () => {
    const r = ready({ readiness: readiness({ headline: null, signals: [] }) });
    expect('headline' in r).toBe(false);
    expect('headlineKey' in r).toBe(false);
    expect('signals' in r).toBe(false);
  });

  test('every headline translates', async () => {
    for (const headline of ['Primed', 'Balanced', 'Strained', 'Run down'] as const) {
      const r = buildTodaySubject(input({ readiness: readiness({ headline }) }), 'id').data.ready as Record<string, any>;
      expect(r.headlineKey).toBe(headline);
      expect(r.headline).not.toContain('readiness.headline');
    }
  });

  test('no strain', () => {
    const r = ready({ strain: null });
    expect('strain' in r).toBe(false);
    expect('strainPct' in r).toBe(false);
  });

  test('no step goal', () => {
    for (const stepGoal of [null, 0, NaN, -5]) {
      const r = ready({ stepGoal });
      expect(r.steps).toBe(8421);
      expect('stepGoal' in r).toBe(false);
      expect('stepPct' in r).toBe(false);
    }
  });

  test('steps over the goal give stepPct above 1', () => {
    const r = ready({ steps: 15000 });
    expect(r.stepPct).toBe(1.5);
  });

  test('no resting HR', () => {
    for (const restingHr of [null, 0, NaN]) expect('rhr' in ready({ restingHr })).toBe(false);
  });

  test('no sleep', () => {
    const r = ready({ sleep: null });
    expect('sleepSec' in r).toBe(false);
    expect('sleepPct' in r).toBe(false);
  });

  test('NaN and Infinity inputs leave keys out', () => {
    const subject = build({
      steps: NaN,
      strain: { ...strain, strain: Infinity },
      restingHr: Infinity,
      stepGoal: Infinity,
      sleep: { ...stagedSleep, byStage: [], totalSeconds: NaN, dayAsleepSeconds: NaN },
      readiness: readiness({ recovery: { percent: NaN, band: 'green', rmssd: NaN, source: 'night', baselineRmssd: 1, z: 0, baselineCount: 1 } }),
    });
    for (const ns of ['ready', 'watch'] as const) {
      const o = subject.data[ns] as Record<string, any>;
      for (const key of ['steps', 'stepPct', 'strain', 'strainPct', 'rhr', 'sleepSec', 'sleepPct', 'recovery', 'hrvMs']) expect(key in o).toBe(false);
      for (const key of ['stepGoal']) expect(key in o).toBe(false);
    }
  });

  test('zero steps are left out, not shown as 0', () => {
    const r = ready({ steps: 0 });
    expect('steps' in r).toBe(false);
    expect('stepPct' in r).toBe(false);
  });

  test('signal text is clipped to 60 characters and blanks are dropped', () => {
    const long = 'a'.repeat(100);
    const r = ready({
      readiness: readiness({
        signals: [
          { key: 'hrv', title: `  ${long}  `, value: 'ok 🙂', detail: '', tone: 'good', amount: 0 },
          { key: 'rhr', title: '   ', value: 'x', detail: '', tone: 'good', amount: 0 },
        ],
      }),
    });
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].title).toHaveLength(60);
    expect(r.signals[0].title.endsWith('...')).toBe(true);
    expect(r.signals[0].value).toBe('ok 🙂');
  });

  test('english texts', async () => {
    await applyLocale('en');
    const subject = build({}, 'en');
    expect(subject.heading).toBe('Share today');
    expect(subject.caption).toBe('Tracked with JoyoFit · https://fit.joyorogo.com');
    const r = subject.data.ready as Record<string, any>;
    expect(r.headline).toBe('Primed');
    expect(r.headlineKey).toBe('Primed');
  });
});
