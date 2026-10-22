import { describe, expect, it } from 'bun:test';

import { bandLayout, bandTicks, boundaries, bpmToPercent, limitRange, percentScale, percentToBpm, tickStep, zoneGeometry } from './layout';
import { DEFAULT_HR_ZONE_SETTINGS, moveLimit, resolveHrZones, type HrZoneMethod } from './zones';

const zonesOf = (method: HrZoneMethod, extra: Partial<typeof DEFAULT_HR_ZONE_SETTINGS> = {}) =>
  resolveHrZones({ ...DEFAULT_HR_ZONE_SETTINGS, method, maxHr: 194, restingHr: 60, ...extra }, 26);

describe('percent scales', () => {
  it('is the maximum, the reserve above rest or the LTHR, by method', () => {
    expect(percentScale(zonesOf('max'))).toEqual({ base: 0, range: 194 });
    expect(percentScale(zonesOf('hrr'))).toEqual({ base: 60, range: 134 });
    expect(percentScale(zonesOf('lthr', { lthr: 170 }))).toEqual({ base: 0, range: 170 });
  });

  it('turns a percent into the limit the zone maths gives, and back', () => {
    const zones = zonesOf('hrr');
    const scale = percentScale(zones);
    expect(percentToBpm(59, scale)).toBe(zones.limits[0]);
    expect(percentToBpm(95, scale)).toBe(zones.limits[4]);
    expect(Math.abs(bpmToPercent(zones.limits[4], scale) - 95)).toBeLessThanOrEqual(1);
  });

  it('never divides by nothing', () => {
    expect(percentScale({ method: 'hrr', maxHr: 100, restingHr: 100, lthr: null }).range).toBe(1);
  });
});

describe('boundaries', () => {
  it('lists the maximum and then every zone start from the highest down', () => {
    const zones = zonesOf('max');
    const list = boundaries(zones);
    expect(list.map((b) => b.bpm)).toEqual([194, ...[...zones.limits].reverse()]);
    expect(list.map((b) => b.percent)).toEqual([100, 90, 80, 70, 60, 50]);
    expect(list.map((b) => b.limit)).toEqual([null, 4, 3, 2, 1, 0]);
  });

  it('has the fixed warm-up start last in the reserve method, and Huawei percentages for the limits', () => {
    const list = boundaries(zonesOf('hrr'));
    expect(list).toHaveLength(7);
    expect(list.map((b) => b.percent)).toEqual([100, 95, 88, 84, 74, 59, 50]);
    expect(list.map((b) => b.limit)).toEqual([null, 4, 3, 2, 1, 0, null]);
  });

  it('shows a percent of the table as the table says even when the bpm rounds the other way', () => {
    // Reserve 60: 59 % of the reserve is 35.4, rounded up to 36 bpm above rest, which is 60 % of 60 worked back.
    const zones = resolveHrZones({ ...DEFAULT_HR_ZONE_SETTINGS, method: 'hrr', maxHr: 120, restingHr: 60 }, 26);
    expect(boundaries(zones).find((b) => b.limit === 0)?.percent).toBe(59);
  });

  it('works the percent out for a limit that was moved by hand', () => {
    const base = zonesOf('max');
    const zones = resolveHrZones({ ...DEFAULT_HR_ZONE_SETTINGS, maxHr: 194, limits: moveLimit(base.limits, 4, 180, 194) }, 26);
    const top = boundaries(zones)[1];
    expect(top?.bpm).toBe(180);
    expect(top?.percent).toBe(93);
  });

  it('puts the LTHR zones over 100 percent at the maximum', () => {
    const list = boundaries(zonesOf('lthr', { lthr: 170 }));
    expect(list[0]?.percent).toBe(114);
    expect(list.map((b) => b.percent).slice(1)).toEqual([100, 95, 90, 85, 67]);
  });
});

describe('limit ranges', () => {
  it('keeps a limit between its neighbours, the first above the floor and the last under the maximum', () => {
    const limits = [97, 117, 136, 156, 175];
    expect(limitRange(limits, 0, 194)).toEqual({ min: 30, max: 116 });
    expect(limitRange(limits, 2, 194)).toEqual({ min: 118, max: 155 });
    expect(limitRange(limits, 4, 194)).toEqual({ min: 157, max: 193 });
  });
});

describe('zone band', () => {
  it('covers the whole band: the lead and the zones make 1, in proportion to bpm', () => {
    const zones = zonesOf('max');
    const band = bandLayout(zones);
    const total = band.lead + band.segments.reduce((sum, s) => sum + s.share, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(band.segments).toHaveLength(5);
    // Z2 and Z3 are the same width in bpm (20 and 19 of the 20 wide steps), Z5 is the narrowest.
    const widest = Math.max(...band.segments.map((s) => s.share));
    expect(band.segments[4]?.share).toBeLessThan(widest);
  });

  it('starts at 30 percent, unless a limit was set lower', () => {
    const zones = zonesOf('max');
    expect(bandLayout(zones).start).toBeCloseTo(58.2, 5);
    const low = resolveHrZones({ ...DEFAULT_HR_ZONE_SETTINGS, maxHr: 194, limits: [40, 60, 80, 100, 120] }, 26);
    expect(bandLayout(low).start).toBe(40);
    expect(bandLayout(low).lead).toBe(0);
  });

  it('has six segments in the reserve method and none negative on odd limits', () => {
    const band = bandLayout(zonesOf('hrr'));
    expect(band.segments).toHaveLength(6);
    for (const s of band.segments) expect(s.share).toBeGreaterThanOrEqual(0);
  });
});

describe('band ticks', () => {
  it('labels every tenth percent from 30 to 100, the first at the start and the last at the end', () => {
    const ticks = bandTicks(zonesOf('max'), 10);
    expect(ticks.map((t) => t.percent)).toEqual([30, 40, 50, 60, 70, 80, 90, 100]);
    expect(ticks[0]?.at).toBeCloseTo(0, 9);
    expect(ticks[7]?.at).toBeCloseTo(1, 9);
  });

  it('keeps multiples of the step only', () => {
    expect(bandTicks(zonesOf('max'), 20).map((t) => t.percent)).toEqual([40, 60, 80, 100]);
  });

  it('runs past 100 percent for the LTHR zones, whose top zone starts at 100', () => {
    const percents = bandTicks(zonesOf('lthr', { lthr: 170 }), 10).map((t) => t.percent);
    expect(percents[0]).toBe(30);
    expect(percents.at(-1)).toBe(110);
  });

  it('gives nothing for a step that is not positive', () => {
    expect(bandTicks(zonesOf('max'), 0)).toEqual([]);
    expect(bandTicks(zonesOf('max'), Number.NaN)).toEqual([]);
  });
});

describe('tick step', () => {
  it('is 10 percent when the labels fit, wider as the room or the text scale tightens', () => {
    expect(tickStep(288, 70, 1)).toBe(10);
    expect(tickStep(288, 70, 1.3)).toBe(20);
    expect(tickStep(150, 70, 1.3)).toBe(25);
    expect(tickStep(120, 70, 1.3)).toBe(50);
  });

  it('has a safe answer before the band is measured', () => {
    expect(tickStep(0, 70, 1)).toBe(20);
    expect(tickStep(Number.NaN, 70, 1)).toBe(20);
    expect(tickStep(288, 0, 1)).toBe(20);
  });
});

describe('zone geometry', () => {
  it('holds a 48 dp box and two lines of a name at normal text', () => {
    expect(zoneGeometry(1)).toEqual({ box: 48, row: 60 });
  });

  it('grows with the font scale, and is capped and safe for odd values', () => {
    expect(zoneGeometry(1.3).box).toBeGreaterThan(48);
    expect(zoneGeometry(1.3).row).toBeGreaterThan(zoneGeometry(1).row);
    expect(zoneGeometry(1.3).row).toBeGreaterThanOrEqual(zoneGeometry(1.3).box + 12);
    expect(zoneGeometry(9)).toEqual(zoneGeometry(2));
    expect(zoneGeometry(Number.NaN)).toEqual(zoneGeometry(1));
    expect(zoneGeometry(0.5)).toEqual(zoneGeometry(1));
  });
});
