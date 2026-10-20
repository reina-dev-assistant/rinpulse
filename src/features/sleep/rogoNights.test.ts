import { describe, expect, it } from 'bun:test';

import type { HrvReadingRow, SleepScoreRow } from '@/db/queries';
import { buildNights } from '@/features/sleep/nights';
import { startOfLocalDay } from '@/features/today/stats';
import type { SleepSegment } from '@/wear';

import { buildRogoNights } from './rogoNights';

const H = 3600;
/** A local midnight, so the nights below end on a known local date regardless of the machine's zone. */
const MIDNIGHT = startOfLocalDay(Date.UTC(2026, 9, 14, 12) / 1000);
const at = (hours: number) => MIDNIGHT + Math.round(hours * H);
const seg = (from: number, to: number, stage: SleepSegment['stage']): SleepSegment => ({ start: at(from), end: at(to), type: 0, stage });
const none: ReadonlyMap<number, number> = new Map();

/** Previous evening 23:00 to 06:30 (7.5 h in bed), staged. */
const stagedNight = [seg(-1, 1.5, 'light'), seg(1.5, 3, 'deep'), seg(3, 3.25, 'awake'), seg(3.25, 5, 'rem'), seg(5, 6.5, 'light')];

describe('buildRogoNights', () => {
  it('maps a staged night', () => {
    const scores: SleepScoreRow[] = [{ start: at(-1), end: at(6.5), score: 82.4, efficiency: 95 }];
    const nights = buildNights(stagedNight, scores);
    const [row] = buildRogoNights(nights, [], new Map([[MIDNIGHT, 52]]));
    const wake = new Date(at(6.5) * 1000);
    expect(row.wakeDate).toBe(nights[0].day);
    expect(row.onsetMs).toBe(at(-1) * 1000);
    expect(row.wakeMs).toBe(at(6.5) * 1000);
    expect(row.tzOffsetMin).toBe(-wake.getTimezoneOffset() || 0);
    expect(row.hasStages).toBe(true);
    expect(row.deepS).toBe(1.5 * H);
    expect(row.remS).toBe(1.75 * H);
    expect(row.lightS).toBe(4 * H);
    expect(row.awakeS).toBe(0.25 * H);
    expect(row.asleepS).toBe(7.25 * H);
    expect(row.awakenings).toBe(1);
    expect(row.watchScore).toBe(82);
    expect(row.rhrBpm).toBe(52);
    expect(row.hrvMs).toBeNull();
    expect(row.naps).toEqual([]);
  });

  it('sends a stage-less watch without stage seconds', () => {
    const [row] = buildRogoNights(buildNights([seg(-1, 6, null)], []), [], none);
    expect(row.hasStages).toBe(false);
    expect([row.deepS, row.remS, row.lightS]).toEqual([null, null, null]);
    expect(row.asleepS).toBe(7 * H);
  });

  it('takes the newest night HRV that ended during the night, ignoring spot readings', () => {
    const hrv: HrvReadingRow[] = [
      { start: at(2), end: at(3), source: 'night', rmssd: 40, beats: 10 },
      { start: at(5), end: at(6), source: 'night', rmssd: 48.26, beats: 10 },
      { start: at(7), end: at(7.1), source: 'spot', rmssd: 99, beats: 10 },
      { start: at(-20), end: at(-19), source: 'night', rmssd: 70, beats: 10 },
    ];
    const [row] = buildRogoNights(buildNights(stagedNight, []), hrv, none);
    expect(row.hrvMs).toBe(48.3);
  });

  it('leaves out-of-range HRV and heart rate empty', () => {
    const hrv: HrvReadingRow[] = [{ start: at(5), end: at(6), source: 'night', rmssd: 900, beats: 10 }];
    const [row] = buildRogoNights(buildNights(stagedNight, []), hrv, new Map([[MIDNIGHT, 10]]));
    expect(row.hrvMs).toBeNull();
    expect(row.rhrBpm).toBeNull();
  });

  it('turns the other sessions of the wake date into naps, the longest night being the main one', () => {
    const nap = seg(13, 14, 'light');
    const [row, ...rest] = buildRogoNights(buildNights([...stagedNight, nap], []), [], none);
    expect(rest).toEqual([]);
    expect(row.onsetMs).toBe(at(-1) * 1000);
    expect(row.naps).toEqual([[at(13) * 1000, at(14) * 1000]]);
  });

  it('keeps at most 4 naps', () => {
    const naps = [7, 10.6, 14.2, 17.8, 21.4].map((h) => seg(h, h + 0.5, 'light'));
    const [row] = buildRogoNights(buildNights([...stagedNight, ...naps], []), [], none);
    expect(row.naps).toHaveLength(4);
  });

  it('sends nothing for a day that only has naps', () => {
    expect(buildRogoNights(buildNights([seg(13, 14, 'light')], []), [], none)).toEqual([]);
  });

  it('drops a night that is in bed for more than 20 h', () => {
    expect(buildRogoNights(buildNights([seg(-20, 3, 'light')], []), [], none)).toEqual([]);
  });

  it('returns oldest first and keeps only the newest maxNights', () => {
    const day = 24 * H;
    const segs = [0, 1, 2].flatMap((d) => stagedNight.map((s) => ({ ...s, start: s.start - d * day, end: s.end - d * day })));
    const all = buildRogoNights(buildNights(segs, []), [], none);
    expect(all).toHaveLength(3);
    expect(all[0].wakeMs).toBeLessThan(all[2].wakeMs);
    const two = buildRogoNights(buildNights(segs, []), [], none, 2);
    expect(two.map((n) => n.wakeMs)).toEqual(all.slice(1).map((n) => n.wakeMs));
  });

  it('passes a valid thermometer summary through and omits an invalid one', () => {
    const nights = buildNights(stagedNight, []);
    const env = { tempCMean: 26, tempCMin: 25, tempCMax: 27, rhPctMean: 60, rhPctMin: 55, rhPctMax: 65, samples: 90, source: 'lywsd03mmc' as const };
    const day = nights[0].day;
    expect(buildRogoNights(nights, [], none, Infinity, new Map([[day, env]]))[0].env).toEqual(env);
    expect(buildRogoNights(nights, [], none, Infinity, new Map([[day, { ...env, rhPctMax: 120 }]]))[0].env).toBeUndefined();
    expect(buildRogoNights(nights, [], none)[0].env).toBeUndefined();
  });
});
