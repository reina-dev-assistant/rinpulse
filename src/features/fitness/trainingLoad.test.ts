import { describe, expect, it } from 'bun:test';

import { readiness } from '@/features/today/readiness';
import type { RecoveryState } from '@/features/today/recovery';
import { loadBalance, MIN_LOAD_DAYS, statusOfRatio } from './trainingLoad';

const DAY = 86400;
const TODAY = 100 * DAY;
const day = (back: number, trimp: number) => ({ day: TODAY - back * DAY, trimp });
/** `count` days ending yesterday, all with the same TRIMP. */
const flat = (count: number, trimp: number) => Array.from({ length: count }, (_, i) => day(i + 1, trimp));

describe('statusOfRatio', () => {
  it('cuts at 0.5, 0.8, 1.1 and 1.5, upper edge of each band included', () => {
    expect(statusOfRatio(0.49)).toBe('detraining');
    expect(statusOfRatio(0.5)).toBe('recovery');
    expect(statusOfRatio(0.79)).toBe('recovery');
    expect(statusOfRatio(0.8)).toBe('maintaining');
    expect(statusOfRatio(1.1)).toBe('maintaining');
    expect(statusOfRatio(1.11)).toBe('productive');
    expect(statusOfRatio(1.5)).toBe('productive');
    expect(statusOfRatio(1.51)).toBe('overreaching');
  });
});

describe('loadBalance', () => {
  it('is 1 and maintaining on a flat load', () => {
    const r = loadBalance(flat(28, 100), TODAY);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.acute).toBeCloseTo(100);
    expect(r.chronic).toBeCloseTo(100);
    expect(r.ratio).toBeCloseTo(1);
    expect(r.status).toBe('maintaining');
  });

  it('sums TRIMP, not strain: a doubled last week gives acute 200 against chronic 125', () => {
    const days = [...flat(7, 200), ...flat(28, 100).slice(7)];
    const r = loadBalance(days, TODAY);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.acute).toBeCloseTo(200);
    expect(r.chronic).toBeCloseTo((7 * 200 + 21 * 100) / 28);
    expect(r.ratio).toBeCloseTo(1.6);
    expect(r.status).toBe('overreaching');
  });

  it('leaves today and days older than 28 out', () => {
    const days = [{ day: TODAY, trimp: 9999 }, { day: TODAY - 29 * DAY, trimp: 9999 }, ...flat(20, 100)];
    const r = loadBalance(days, TODAY);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.chronic).toBeCloseTo(100);
  });

  it('divides a short history by the days since its first day, not by 28', () => {
    const r = loadBalance(flat(MIN_LOAD_DAYS, 100), TODAY);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.chronic).toBeCloseTo(100);
  });

  it('is detraining after two idle weeks', () => {
    // 14 days of load that all lie 15..28 days back: acute is 0.
    const older = Array.from({ length: 14 }, (_, i) => day(i + 15, 100));
    const r2 = loadBalance(older, TODAY);
    if (r2.kind !== 'ok') throw new Error('expected ok');
    expect(r2.acute).toBe(0);
    expect(r2.status).toBe('detraining');
  });

  it('reports short history and no load', () => {
    expect(loadBalance(flat(MIN_LOAD_DAYS - 1, 100), TODAY)).toEqual({ kind: 'short', daysWithData: MIN_LOAD_DAYS - 1 });
    expect(loadBalance([], TODAY)).toEqual({ kind: 'short', daysWithData: 0 });
    expect(loadBalance(flat(20, 0), TODAY).kind).toBe('none');
  });
});

describe('readiness load signal', () => {
  const rest = { dayStart: TODAY, resting: new Map<number, number>(), sleep: null, hrv: { missing: 'x', wait: { kind: 'none' } } as RecoveryState };
  const strainDay = (back: number, trimp: number) => ({ ...day(back, trimp), strain: 0, zoneMinutes: [0, 0, 0, 0, 0] as [number, number, number, number, number], coveredMinutes: 0 });

  it('uses the same ratio as loadBalance, from TRIMP and not from the saturated strain', () => {
    const strain = [...flat(7, 200), ...flat(28, 100).slice(7)].map((d) => strainDay((TODAY - d.day) / DAY, d.trimp));
    const signal = readiness({ ...rest, strain }).signals.find((s) => s.key === 'load');
    expect(signal?.amount).toBeCloseTo(1.6);
    expect(signal?.tone).toBe('bad');
    expect(signal?.value).toBe('1,60');
  });

  it('lists the missing days when the history is short', () => {
    const strain = flat(5, 100).map((d) => strainDay((TODAY - d.day) / DAY, d.trimp));
    expect(readiness({ ...rest, strain }).missing).toContain('Beban latihan: baru 5 dari 14 hari dengan data detak jantung.');
  });
});
