import { describe, expect, it } from 'bun:test';

import type { SleepNightPayload } from '@/cloud/sleepInsightsClient';

import { pendingSleepBatches, serializeNight, sleepBackoffActive, SLEEP_UNSUPPORTED_BACKOFF_MS } from './sleepPush';

const night = (i: number, asleepS = 25_000): SleepNightPayload => ({
  wakeDate: `2026-01-${String(i).padStart(2, '0')}`,
  onsetMs: i,
  wakeMs: i + 1,
  tzOffsetMin: 420,
  asleepS,
  awakeS: 0,
  awakenings: 0,
  hasStages: false,
  deepS: null,
  remS: null,
  lightS: null,
  watchScore: null,
  hrvMs: null,
  rhrBpm: null,
  naps: [],
});
const many = (n: number) => Array.from({ length: n }, (_, i) => night(i + 1));
const accept = (ns: SleepNightPayload[]) => new Map(ns.map((n) => [n.wakeDate, serializeNight(n)]));

describe('pendingSleepBatches', () => {
  it('sends the newest 14 nights once, in one call', () => {
    const batches = pendingSleepBatches(many(30), new Map(), false);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(14);
    expect(batches[0][13].wakeDate).toBe('2026-01-30');
  });

  it('backfills up to 90 nights in calls of 14', () => {
    const nights = Array.from({ length: 100 }, (_, i) => ({ ...night(1), wakeDate: `d${String(i).padStart(3, '0')}` }));
    const batches = pendingSleepBatches(nights, new Map(), true);
    expect(batches.map((b) => b.length)).toEqual([14, 14, 14, 14, 14, 14, 6]);
    expect(batches[0][0].wakeDate).toBe('d010');
  });

  it('skips accepted nights and sends only a changed one', () => {
    const nights = many(5);
    const accepted = accept(nights);
    expect(pendingSleepBatches(nights, accepted, false)).toEqual([]);
    const changed = [...nights.slice(0, 4), night(5, 26_000)];
    expect(pendingSleepBatches(changed, accepted, false)).toEqual([[changed[4]]]);
  });
});

describe('sleepBackoffActive', () => {
  it('holds for the backoff window only', () => {
    expect(sleepBackoffActive(0, 1_000)).toBe(false);
    expect(sleepBackoffActive(1_000, 2_000)).toBe(true);
    expect(sleepBackoffActive(1_000, 1_000 + SLEEP_UNSUPPORTED_BACKOFF_MS)).toBe(false);
  });
});
