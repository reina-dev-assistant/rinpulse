import { describe, expect, it } from 'bun:test';

import { openMemoryDb } from '@/cloud/syncTestKit';
import { listDayHeartLoad } from '@/db/queries';
import { heartZone } from '@/features/live/liveWorkout';
import { hrZoneName } from './names';
import { workoutStrain } from '@/features/today/strain';
import { hrZones } from '@/features/workouts/analysis/zones';

import {
  DEFAULT_HR_ZONE_SETTINGS,
  estimateLthr,
  HR_ZONE_COUNT,
  LTHR_MIN,
  MAX_HR_MAX,
  MAX_HR_MIN,
  REST_HR_GAP,
  REST_HR_MAX,
  REST_HR_MIN,
  ZONE_MIN_BPM,
  hrZonesForMax,
  isDefaultSettings,
  maxHrFromAge,
  maxHrTanaka,
  methodLimits,
  moveLimit,
  normalizeLimits,
  parseHrZoneSettings,
  peakHeartRate,
  resolveHrZones,
  suggestZones,
  typicalResting,
  watchConfig,
  zoneCount,
  zoneIndex,
  zoneRange,
  type HrZoneSettings,
} from './zones';

const settings = (over: Partial<HrZoneSettings>): HrZoneSettings => ({ ...DEFAULT_HR_ZONE_SETTINGS, ...over });

/** The rule every figure of the app followed before zones were editable: 50, 60, 70, 80, 90 percent of the maximum. */
function legacyZone(heartRate: number, maxHr: number): number {
  const pct = (100 * heartRate) / maxHr;
  if (pct < 50) return 0;
  return Math.min(5, Math.floor((pct - 50) / 10) + 1);
}

describe('limits by method', () => {
  it('max: 50, 60, 70, 80 and 90 percent, to the whole bpm at or above', () => {
    expect(methodLimits('max', 190, 60)).toEqual([95, 114, 133, 152, 171]);
    expect(methodLimits('max', 185, 60)).toEqual([93, 111, 130, 148, 167]);
  });

  it('hrr: 59, 74, 84, 88 and 95 percent of the reserve on top of the resting rate', () => {
    // reserve 135: 79.65, 99.9, 113.4, 118.8, 128.25 -> 80, 100, 114, 119, 129; plus 55
    expect(methodLimits('hrr', 190, 55)).toEqual([135, 155, 169, 174, 184]);
  });

  it('hrr: the warm-up zone sits under the aerobic base, from 50 percent of the reserve', () => {
    // Reserve 135 (max 190, rest 55): 50 percent is 67.5 -> 68, plus 55 = 123.
    const zones = resolveHrZones(settings({ method: 'hrr', maxHr: 190, restingHr: 55 }), 35);
    expect(zones.bounds).toEqual([123, 135, 155, 169, 174, 184]);
    expect([...zones.limits]).toEqual([135, 155, 169, 174, 184]);
    expect(zoneCount('hrr')).toBe(6);
    expect(zoneCount('max')).toBe(5);
  });

  it('hrr with a higher resting rate lifts every limit', () => {
    const low = methodLimits('hrr', 190, 50);
    const high = methodLimits('hrr', 190, 70);
    low.forEach((limit, i) => expect(high[i]).toBeGreaterThan(limit));
  });

  it('is strictly rising, at least 30 and below the maximum for every maximum and resting rate allowed', () => {
    for (const method of ['max', 'hrr'] as const) {
      for (let max = MAX_HR_MIN; max <= MAX_HR_MAX; max++) {
        for (let rest = REST_HR_MIN; rest <= Math.min(REST_HR_MAX, max - REST_HR_GAP); rest += 5) {
          const limits = methodLimits(method, max, rest);
          expect(limits[0]).toBeGreaterThanOrEqual(ZONE_MIN_BPM);
          expect(limits[HR_ZONE_COUNT - 1]).toBeLessThan(max);
          for (let i = 1; i < HR_ZONE_COUNT; i++) expect(limits[i]).toBeGreaterThan(limits[i - 1] as number);
        }
      }
    }
  });
});

describe('the default zones keep every earlier figure', () => {
  it('puts every heart rate in the zone the old percentage rule did, for every maximum', () => {
    for (let max = MAX_HR_MIN; max <= MAX_HR_MAX; max++) {
      const zones = hrZonesForMax(max);
      for (let hr = 30; hr <= 230; hr++) expect(zoneIndex(hr, zones)).toBe(legacyZone(hr, max));
    }
  });
});

describe('resolveHrZones', () => {
  it('takes the maximum from the age: 220 - age, kept in range', () => {
    const zones = resolveHrZones(DEFAULT_HR_ZONE_SETTINGS, 35);
    expect(zones).toMatchObject({ method: 'max', maxHr: 185, maxHrSource: 'age', restingHr: 60, custom: false, warningEnabled: true, warningLimit: 185 });
    expect(resolveHrZones(DEFAULT_HR_ZONE_SETTINGS, 0).maxHr).toBe(MAX_HR_MAX);
    expect(resolveHrZones(DEFAULT_HR_ZONE_SETTINGS, 150).maxHr).toBe(MAX_HR_MIN);
    expect(maxHrFromAge(35)).toBe(185);
  });

  it('offers Tanaka (208 - 0.7 x age) beside the classic formula', () => {
    expect(maxHrTanaka(35)).toBe(184);
    expect(maxHrTanaka(60)).toBe(166);
  });

  it('uses an entered maximum and resting rate, clamped into Huawei Health\'s ranges', () => {
    const zones = resolveHrZones(settings({ method: 'hrr', maxHr: 192, restingHr: 52 }), 35);
    expect(zones).toMatchObject({ maxHr: 192, maxHrSource: 'setting', restingHr: 52 });
    expect(resolveHrZones(settings({ maxHr: 500 }), 35).maxHr).toBe(MAX_HR_MAX);
    expect(resolveHrZones(settings({ maxHr: 20 }), 35).maxHr).toBe(MAX_HR_MIN);
    expect(resolveHrZones(settings({ restingHr: 5 }), 35).restingHr).toBe(REST_HR_MIN);
    // 15 bpm under a 120 maximum
    expect(resolveHrZones(settings({ maxHr: 120, restingHr: 110 }), 35).restingHr).toBe(105);
  });

  it('keeps hand-edited limits (made strictly rising) and says so; limits equal to the method are not custom', () => {
    const edited = resolveHrZones(settings({ limits: [100, 120, 140, 160, 180], maxHr: 190 }), 35);
    expect(edited.custom).toBe(true);
    expect([...edited.limits]).toEqual([100, 120, 140, 160, 180]);
    const same = resolveHrZones(settings({ limits: [95, 114, 133, 152, 171], maxHr: 190 }), 35);
    expect(same.custom).toBe(false);
    const crossed = resolveHrZones(settings({ limits: [150, 120, 120, 300, 10], maxHr: 190 }), 35);
    for (let i = 1; i < HR_ZONE_COUNT; i++) expect(crossed.limits[i]).toBeGreaterThan(crossed.limits[i - 1] as number);
    expect(crossed.limits[HR_ZONE_COUNT - 1]).toBeLessThan(190);
  });

  it('ignores limits that are not five whole numbers', () => {
    expect(resolveHrZones(settings({ limits: [1, 2, 3] }), 35).custom).toBe(false);
    expect(resolveHrZones(settings({ limits: [1.5, 2, 3, 4, 5] }), 35).custom).toBe(false);
  });

  it('puts the alert limit at the maximum unless set, kept in range', () => {
    expect(resolveHrZones(settings({ maxHr: 180 }), 35).warningLimit).toBe(180);
    expect(resolveHrZones(settings({ maxHr: 180, warningLimit: 170 }), 35).warningLimit).toBe(170);
    expect(resolveHrZones(settings({ warningLimit: 40 }), 35).warningLimit).toBe(100);
  });
});

describe('editing limits', () => {
  const limits = [95, 114, 133, 152, 171];

  it('moves one limit and keeps it between its neighbours', () => {
    expect([...moveLimit(limits, 2, 140, 190)]).toEqual([95, 114, 140, 152, 171]);
    expect(moveLimit(limits, 2, 999, 190)[2]).toBe(151);
    expect(moveLimit(limits, 2, 0, 190)[2]).toBe(115);
  });

  it('keeps the first at 30 or more and the last below the maximum', () => {
    expect(moveLimit(limits, 0, 5, 190)[0]).toBe(ZONE_MIN_BPM);
    expect(moveLimit(limits, 4, 400, 190)[4]).toBe(189);
  });

  it('normalizes crossed or out-of-range sets', () => {
    expect(normalizeLimits([95, 95, 95, 95, 95], 190)).toEqual([95, 96, 97, 98, 99]);
    expect(normalizeLimits([10, 20, 30, 40, 50], 190)).toEqual([30, 31, 32, 40, 50]);
    expect(normalizeLimits([100, 150, 189, 189, 189], 190)).toEqual([100, 150, 187, 188, 189]);
  });
});

describe('zone ranges and indexes', () => {
  const zones = hrZonesForMax(190);

  it('counts the limits a reading has reached: 0 under zone 1', () => {
    expect([94, 95, 113, 114, 170, 171, 250].map((hr) => zoneIndex(hr, zones))).toEqual([0, 1, 1, 2, 4, 5, 5]);
  });

  it('ends each zone one bpm under the next; zone 5 ends at the maximum', () => {
    expect(zoneRange(1, zones)).toEqual({ from: 95, to: 113 });
    expect(zoneRange(4, zones)).toEqual({ from: 152, to: 170 });
    expect(zoneRange(5, zones)).toEqual({ from: 171, to: 190 });
  });
});

describe('zones feed the zone-time displays', () => {
  const hrr = resolveHrZones(settings({ method: 'hrr', maxHr: 190, restingHr: 55 }), 35);
  const points = Array.from({ length: 11 }, (_, i) => ({ ts: 1_760_000_000 + i * 60, hr: 140 as number | null }));

  it('workout zone time follows the limits: 140 bpm is zone 3 by max%, zone 2 (aerobic base) by reserve', () => {
    expect(hrZones(points, hrZonesForMax(190)).sec).toEqual([0, 0, 600, 0, 0]);
    expect(hrZones(points, hrr).sec).toEqual([0, 600, 0, 0, 0, 0]);
  });

  it('hand-edited limits move the same minutes to another zone', () => {
    const edited = resolveHrZones(settings({ maxHr: 190, limits: [95, 114, 145, 155, 171] }), 35);
    expect(hrZones(points, edited).sec).toEqual([0, 600, 0, 0, 0]);
  });

  it('the SQL day load counts seconds in whatever zones it is given', async () => {
    const { raw, db } = openMemoryDb();
    const day = 1_760_000_000 - (1_760_000_000 % 86400);
    const rates = [60, 100, 120, 135, 150, 165, 175, 185];
    rates.forEach((hr, i) => raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate) VALUES (?, 0, 0, 0, ?)').run(day + i * 60, hr));
    for (const zones of [hrZonesForMax(190), hrr, resolveHrZones(settings({ maxHr: 190, limits: [90, 110, 130, 150, 170] }), 35)]) {
      const sql = await listDayHeartLoad(db, [day, day + 86400], zones.bounds);
      const expected = zones.bounds.map((_, i) => rates.filter((hr) => zoneIndex(hr, zones) === i + 1).length * 60);
      expect(sql[0]?.zoneSeconds).toEqual(expected);
    }
  });

  it('the live zone label follows the limits', () => {
    expect(heartZone(120, hrZonesForMax(190))?.zone).toBe(2);
    expect(heartZone(120, resolveHrZones(settings({ maxHr: 190, limits: [95, 125, 140, 155, 171] }), 35))?.zone).toBe(1);
    expect(heartZone(80, hrZonesForMax(190))).toBeNull();
  });
});

describe('stored settings', () => {
  it('reads what was written and falls back field by field', () => {
    expect(parseHrZoneSettings({ method: 'hrr', maxHr: 190, restingHr: 52, limits: [95, 114, 133, 152, 171], warningEnabled: false, warningLimit: 180 })).toEqual({
      method: 'hrr',
      maxHr: 190,
      restingHr: 52,
      lthr: null,
      limits: [95, 114, 133, 152, 171],
      warningEnabled: false,
      warningLimit: 180,
    });
    expect(parseHrZoneSettings({ method: 'banana', maxHr: 'x', restingHr: 5, limits: [1], warningEnabled: 1 })).toEqual(DEFAULT_HR_ZONE_SETTINGS);
    expect(parseHrZoneSettings(null)).toBeNull();
    expect(parseHrZoneSettings([1, 2])).toBeNull();
  });

  it('knows when everything is the default', () => {
    expect(isDefaultSettings(DEFAULT_HR_ZONE_SETTINGS)).toBe(true);
    expect(isDefaultSettings(settings({ warningEnabled: false }))).toBe(false);
    expect(isDefaultSettings(settings({ limits: [1, 2, 3, 4, 5] }))).toBe(false);
  });
});

describe('what the watch gets', () => {
  it('is the zones as computed here, nothing for the watch to recompute', () => {
    const zones = resolveHrZones(settings({ method: 'hrr', maxHr: 190, restingHr: 55, warningLimit: 185 }), 35);
    expect(watchConfig(zones)).toEqual({ method: 'hrr', maxHr: 190, restingHr: 55, zones: [135, 155, 169, 174, 184], warningEnabled: true, warningLimit: 185 });
  });
});

describe('suggestions from data', () => {
  it('takes the highest workout maximum, unless it towers over the rest (a sensor spike)', () => {
    expect(peakHeartRate([178, 182, 175])).toBe(182);
    expect(peakHeartRate([215, 182, 175])).toBe(182);
    expect(peakHeartRate([190])).toBe(190);
    expect(peakHeartRate([250, 40])).toBeNull();
    expect(peakHeartRate([])).toBeNull();
  });

  it('takes the median of the plausible resting rates', () => {
    expect(typicalResting([52, 50, 55, 51, 90])).toBe(52);
    expect(typicalResting([50, 54])).toBe(52);
    expect(typicalResting([5, 200])).toBeNull();
  });

  it('offers a maximum only when the highest rate is above the age estimate', () => {
    expect(suggestZones(192, 52, 35)).toEqual({ maxHr: 192, peak: 192, restingHr: 52 });
    expect(suggestZones(170, 52, 35)).toEqual({ maxHr: null, peak: 170, restingHr: 52 });
    expect(suggestZones(null, null, 35)).toEqual({ maxHr: null, peak: null, restingHr: null });
  });
});

describe('reserve method zones, numbered as the watch and Huawei Health do (a runner with max 190, resting 55)', () => {
  const zones = resolveHrZones(settings({ method: 'hrr', maxHr: 190, restingHr: 55 }), 35);
  const named = (hr: number) => {
    const z = heartZone(hr, zones);
    return z ? `Z${z.zone}` : null;
  };

  it('puts the warm-up at Z1, the aerobic base at Z2 and runs to Z6', () => {
    expect(named(110)).toBeNull();
    expect(named(123)).toBe('Z1');
    expect(named(134)).toBe('Z1');
    expect(named(135)).toBe('Z2');
    expect(named(154)).toBe('Z2');
    expect(named(155)).toBe('Z3');
    expect(named(169)).toBe('Z4');
    expect(named(174)).toBe('Z5');
    expect(named(184)).toBe('Z6');
    expect(named(190)).toBe('Z6');
  });

  it('gives the ranges of the zones, the last one up to the maximum', () => {
    expect(zoneRange(1, zones)).toEqual({ from: 123, to: 134 });
    expect(zoneRange(2, zones)).toEqual({ from: 135, to: 154 });
    expect(zoneRange(6, zones)).toEqual({ from: 184, to: 190 });
  });

  it('does not weight strain by the zone number: an hour at 140 bpm is Edwards zone 3, TRIMP 180, under the reserve zones too', () => {
    const points = Array.from({ length: 61 }, (_, i) => ({ ts: 1_760_000_000 + i * 60, hr: 140 as number | null }));
    expect(workoutStrain(points, zones.maxHr)?.trimp).toBeCloseTo(180, 6);
    expect(hrZones(points, zones).sec).toEqual([0, 3600, 0, 0, 0, 0]);
  });

  it('a limit edited under the warm-up pulls the warm-up start down; the watch still gets Huawei\'s five limits', () => {
    const edited = resolveHrZones(settings({ method: 'hrr', maxHr: 190, restingHr: 55, limits: [110, 155, 169, 174, 184] }), 35);
    expect(edited.bounds).toEqual([109, 110, 155, 169, 174, 184]);
    expect(watchConfig(zones).zones).toEqual([135, 155, 169, 174, 184]);
  });

  it('the SQL day load counts the six zones', async () => {
    const { raw, db } = openMemoryDb();
    const day = 1_760_000_000 - (1_760_000_000 % 86400);
    [125, 140, 160, 170, 180, 188].forEach((hr, i) => raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate) VALUES (?, 0, 0, 0, ?)').run(day + i * 60, hr));
    const load = await listDayHeartLoad(db, [day, day + 86400], zones.bounds);
    expect(load[0]?.zoneSeconds).toEqual([60, 60, 60, 60, 60, 60]);
  });
});

describe('zone names follow Huawei Health', () => {
  it('names five zones for the maximum method and six for the reserve method', () => {
    expect(hrZoneName('max', 1)).toBe(hrZoneName('max', 1));
    expect(hrZoneName('max', 6)).toBe('');
    expect(hrZoneName('hrr', 6)).not.toBe('');
    expect(new Set([1, 2, 3, 4, 5, 6].map((z) => hrZoneName('hrr', z))).size).toBe(6);
    expect(hrZoneName('hrr', 2)).not.toBe(hrZoneName('max', 2));
  });
});

describe('lthr method (Friel zones from the lactate threshold heart rate)', () => {
  it('starts the zones at 67, 85, 90, 95 and 100 percent of the LTHR, to the whole bpm at or above', () => {
    // 168 x .67 = 112.56, x .85 = 142.8, x .90 = 151.2, x .95 = 159.6, x 1.0 = 168
    expect(methodLimits('lthr', 190, 55, 168)).toEqual([113, 143, 152, 160, 168]);
    const zones = resolveHrZones(settings({ method: 'lthr', lthr: 168, maxHr: 190 }), 35);
    expect(zones).toMatchObject({ method: 'lthr', lthr: 168, custom: false });
    expect(zones.bounds).toEqual([113, 143, 152, 160, 168]);
    expect(zoneCount('lthr')).toBe(5);
  });

  it('falls back to Huawei Health\'s estimate (85 percent of the reserve over rest) until a threshold is set', () => {
    expect(estimateLthr(190, 55)).toBe(170);
    const zones = resolveHrZones(settings({ method: 'lthr', maxHr: 190, restingHr: 55 }), 35);
    expect(zones.lthr).toBe(170);
    expect(resolveHrZones(settings({ method: 'max' }), 35).lthr).toBeNull();
  });

  it('keeps the threshold under the maximum and stays strictly rising for every threshold allowed', () => {
    for (let lthr = LTHR_MIN; lthr <= 189; lthr++) {
      const zones = resolveHrZones(settings({ method: 'lthr', lthr, maxHr: 190 }), 35);
      expect(zones.lthr).toBe(lthr);
      for (let i = 1; i < 5; i++) expect(zones.limits[i]).toBeGreaterThan(zones.limits[i - 1] as number);
      expect(zones.limits[4]).toBeLessThan(190);
    }
    expect(resolveHrZones(settings({ method: 'lthr', lthr: 215, maxHr: 190 }), 35).lthr).toBe(189);
  });

  it('sorts a run into the zones by the threshold, and names them with Friel\'s words', () => {
    const zones = resolveHrZones(settings({ method: 'lthr', lthr: 168, maxHr: 190 }), 35);
    expect([100, 120, 145, 155, 165, 175].map((hr) => zoneIndex(hr, zones))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set([1, 2, 3, 4, 5].map((z) => hrZoneName('lthr', z))).size).toBe(5);
    expect(heartZone(160, zones)?.zone).toBe(4);
  });

  it('goes to the watch as the maximum-heart-rate set with the zones as computed', () => {
    const zones = resolveHrZones(settings({ method: 'lthr', lthr: 168, maxHr: 190 }), 35);
    expect(watchConfig(zones)).toMatchObject({ method: 'max', maxHr: 190, zones: [113, 143, 152, 160, 168] });
    expect(watchConfig(resolveHrZones(settings({ method: 'hrr', maxHr: 190, restingHr: 55 }), 35)).method).toBe('hrr');
  });

  it('is stored and read back, and an unknown method reads as the maximum', () => {
    const parsed = parseHrZoneSettings({ method: 'lthr', lthr: 168 });
    expect(parsed).toMatchObject({ method: 'lthr', lthr: 168 });
    expect(parseHrZoneSettings({ method: 'lthr', lthr: 5 })?.lthr).toBeNull();
    expect(parseHrZoneSettings({ method: 'x' })?.method).toBe('max');
    expect(isDefaultSettings(settings({ lthr: 168 }))).toBe(false);
  });
});
