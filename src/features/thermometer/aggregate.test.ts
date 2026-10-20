import { describe, expect, it } from 'bun:test';

import { buildNights } from '@/features/sleep/nights';
import { buildRogoNights } from '@/features/sleep/rogoNights';
import { startOfLocalDay } from '@/features/today/stats';
import type { SleepSegment } from '@/wear';

import { MAX_SAMPLE_SPAN_MS, MIN_SAMPLES, roomAggregateForNight, roomEnvByWakeDate } from './aggregate';
import type { EnvSample } from './store';

const MIN = 60_000;
const HOUR = 60 * MIN;
const ONSET = 1_700_000_000_000;
const WAKE = ONSET + 8 * HOUR;

const sample = (ts: number, tempC: number, rhPct: number, sensorId = 'S1'): EnvSample => ({ sensorId, ts, tempC, rhPct, batteryPct: 80 });

/** A night of five-minute samples, temperature falling from 28 to 26 C and humidity 60 to 70 %. */
function fullNight(sensorId = 'S1'): EnvSample[] {
  const out: EnvSample[] = [];
  const n = (8 * HOUR) / (5 * MIN);
  for (let i = 0; i < n; i++) out.push(sample(ONSET + i * 5 * MIN, 28 - (2 * i) / n, 60 + (10 * i) / n, sensorId));
  return out;
}

describe('roomAggregateForNight', () => {
  it('summarises a night of five-minute samples in the server shape', () => {
    const env = roomAggregateForNight(fullNight(), ONSET, WAKE);
    expect(env).toEqual({
      tempCMean: 27,
      tempCMin: 26,
      tempCMax: 28,
      rhPctMean: 64.9,
      rhPctMin: 60,
      rhPctMax: 69.9,
      samples: 96,
      source: 'lywsd03mmc',
    });
    expect(env).not.toHaveProperty('pm25Mean');
  });

  it('uses only samples inside the window, ends included', () => {
    const samples = [sample(ONSET - 1, 40, 99), ...fullNight(), sample(WAKE, 25, 50), sample(WAKE + 1, 40, 99)];
    expect(roomAggregateForNight(samples, ONSET, WAKE)).toMatchObject({ tempCMax: 28, rhPctMax: 69.9, samples: 97 });
  });

  it('needs at least six samples', () => {
    // A one-hour window with a sample every ten minutes: five of them cover 50 of 60 minutes, six cover all of it.
    const hour = ONSET + HOUR;
    const at10 = (n: number) => Array.from({ length: n }, (_, i) => sample(ONSET + i * 10 * MIN, 25, 50));
    expect(roomAggregateForNight(at10(MIN_SAMPLES - 1), ONSET, hour)).toBeUndefined();
    expect(roomAggregateForNight(at10(MIN_SAMPLES), ONSET, hour)?.samples).toBe(MIN_SAMPLES);
  });

  it('needs the samples to cover half the window: a sensor that dropped out leaves a hole', () => {
    // Samples every 5 min for the first 3 h only: 180 of 480 minutes covered (37.5 %).
    const early = fullNight().filter((s) => s.ts < ONSET + 3 * HOUR);
    expect(roomAggregateForNight(early, ONSET, WAKE)).toBeUndefined();
    // For the first 4 h plus the last 10 minutes: just over half.
    const half = fullNight().filter((s) => s.ts < ONSET + 4 * HOUR || s.ts >= WAKE - 10 * MIN);
    expect(roomAggregateForNight(half, ONSET, WAKE)?.samples).toBeGreaterThan(40);
    // Samples every 20 minutes cover 10 of each 20 minutes: exactly half passes, a little less does not.
    const sparse = Array.from({ length: 24 }, (_, i) => sample(ONSET + i * 20 * MIN, 25, 50));
    expect(roomAggregateForNight(sparse, ONSET, WAKE)).toBeDefined();
    const thin = Array.from({ length: 8 }, (_, i) => sample(ONSET + i * 60 * MIN, 25, 50));
    expect(roomAggregateForNight(thin, ONSET, WAKE)).toBeUndefined();
  });

  it('caps what one sample speaks for', () => {
    expect(MAX_SAMPLE_SPAN_MS).toBe(10 * MIN);
  });

  it('is undefined for an empty or inverted window', () => {
    expect(roomAggregateForNight(fullNight(), WAKE, ONSET)).toBeUndefined();
    expect(roomAggregateForNight([], ONSET, WAKE)).toBeUndefined();
  });

  it('is indifferent to the order the samples come in', () => {
    const shuffled = fullNight().reverse();
    expect(roomAggregateForNight(shuffled, ONSET, WAKE)?.samples).toBe(96);
  });
});

describe('roomEnvByWakeDate', () => {
  const nights = [
    { wakeDate: '2026-10-19', onsetMs: ONSET, wakeMs: WAKE },
    { wakeDate: '2026-10-20', onsetMs: ONSET + 24 * HOUR, wakeMs: WAKE + 24 * HOUR },
  ];

  it('maps each covered night by its wake date and leaves the others out', () => {
    const env = roomEnvByWakeDate(nights, fullNight());
    expect([...env.keys()]).toEqual(['2026-10-19']);
  });

  it('never mixes two sensors: the one that heard the most of the night wins', () => {
    const samples = [...fullNight('S1'), ...fullNight('S2').filter((_, i) => i % 2 === 0).map((s) => ({ ...s, tempC: 20 }))];
    const env = roomEnvByWakeDate(nights, samples).get('2026-10-19');
    expect(env?.samples).toBe(96);
    expect(env?.tempCMax).toBe(28);
  });

  it('feeds buildRogoNights, which attaches it to the night of that wake date', () => {
    const midnight = startOfLocalDay(Date.UTC(2026, 9, 14, 12) / 1000);
    const segment = (from: number, to: number): SleepSegment => ({ start: midnight + from * 3600, end: midnight + to * 3600, type: 0, stage: null });
    const night = buildNights([segment(-1, 6.5)], []);
    const base = buildRogoNights(night, [], new Map());
    expect(base[0]).not.toHaveProperty('env');

    const { onsetMs, wakeMs } = base[0]!;
    const samples = Array.from({ length: Math.floor((wakeMs - onsetMs) / (5 * MIN)) }, (_, i) => sample(onsetMs + i * 5 * MIN, 26, 62));
    const env = roomEnvByWakeDate(base, samples);
    const withEnv = buildRogoNights(night, [], new Map(), Infinity, env);
    expect(withEnv[0]?.env).toMatchObject({ tempCMean: 26, rhPctMean: 62, samples: 90, source: 'lywsd03mmc' });
  });
});
