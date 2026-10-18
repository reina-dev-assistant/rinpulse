import { describe, expect, it } from 'bun:test';

import { AutoLap, type AutoLapInput } from './autoLap';

const LAT0 = -7.98;
const LON0 = 112.63;
/** Degrees of latitude per metre (6371 km sphere, as haversineM uses). */
const DEG_PER_M = 180 / (Math.PI * 6_371_000);

/** A fix `northM` metres north of the start. */
function at(distanceM: number, northM: number | null, lapNow = false): AutoLapInput {
  return {
    distanceM,
    lat: northM === null ? null : LAT0 + northM * DEG_PER_M,
    lon: northM === null ? null : LON0,
    lapNow,
  };
}

function dist(distanceM: number, lapNow = false): AutoLapInput {
  return { distanceM, lat: null, lon: null, lapNow };
}

describe('off', () => {
  it('never laps', () => {
    const lap = new AutoLap({ mode: 'off' });
    for (let d = 0; d < 50_000; d += 500) expect(lap.update(at(d, d % 1000))).toBe(false);
  });
});

describe('distance', () => {
  it('fires every everyM of distance', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 5000 });
    const fired: number[] = [];
    for (let d = 0; d <= 16_000; d += 100) {
      if (lap.update(dist(d))) {
        fired.push(d);
        lap.notifyLap(d);
      }
    }
    expect(fired).toEqual([5000, 10_000, 15_000]);
  });

  it('does not fire a metre early', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 1000 });
    expect(lap.update(dist(999.9))).toBe(false);
    expect(lap.update(dist(1000))).toBe(true);
  });

  it('a manual lap resets the distance counter', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 5000 });
    expect(lap.update(dist(3000))).toBe(false);
    lap.notifyLap(3000);
    // 5000 would have fired from the start; it counts from 3000 now.
    expect(lap.update(dist(5000))).toBe(false);
    expect(lap.update(dist(7999))).toBe(false);
    expect(lap.update(dist(8000))).toBe(true);
  });

  it('lapNow in the update is the manual lap and returns false', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 5000 });
    // The manual lap and the automatic point coincide: only one lap, the manual one.
    expect(lap.update(dist(5000, true))).toBe(false);
    expect(lap.update(dist(5001))).toBe(false);
    expect(lap.update(dist(9999))).toBe(false);
    expect(lap.update(dist(10_000))).toBe(true);
  });

  it('a jump over several multiples fires once and re-arms at the next multiple', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 1000 });
    expect(lap.update(dist(3600))).toBe(true);
    // The caller did not notify (say the lap failed): the grid still moves on, no burst.
    expect(lap.update(dist(3700))).toBe(false);
    expect(lap.update(dist(3999))).toBe(false);
    expect(lap.update(dist(4000))).toBe(true);
  });

  it('a jump followed by notifyLap counts from the real lap', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 1000 });
    expect(lap.update(dist(3600))).toBe(true);
    lap.notifyLap(3600);
    expect(lap.update(dist(4500))).toBe(false);
    expect(lap.update(dist(4600))).toBe(true);
  });

  it('standing still does not lap', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 1000 });
    expect(lap.update(dist(1000))).toBe(true);
    lap.notifyLap(1000);
    for (let i = 0; i < 100; i++) expect(lap.update(dist(1000))).toBe(false);
  });

  it('is not bothered by GPS null', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 1000 });
    expect(lap.update({ distanceM: 1000, lat: null, lon: null, lapNow: false })).toBe(true);
  });

  it('a distance that goes back restarts the count', () => {
    const lap = new AutoLap({ mode: 'distance', everyM: 1000 });
    lap.notifyLap(5000);
    expect(lap.update(dist(0))).toBe(false);
    expect(lap.update(dist(999))).toBe(false);
    expect(lap.update(dist(1000))).toBe(true);
  });

  it('a non-positive interval never fires', () => {
    expect(new AutoLap({ mode: 'distance', everyM: 0 }).update(dist(1_000_000))).toBe(false);
    expect(new AutoLap({ mode: 'distance', everyM: -5 }).update(dist(1_000_000))).toBe(false);
  });
});

describe('start position', () => {
  it('arms after 200 m and fires when back within 30 m', () => {
    const lap = new AutoLap({ mode: 'start' });
    expect(lap.update(at(0, 0))).toBe(false);
    expect(lap.update(at(150, 150))).toBe(false);
    // Back within 30 m but never 200 m away: not a loop.
    expect(lap.update(at(300, 20))).toBe(false);
    expect(lap.update(at(600, 250))).toBe(false);
    expect(lap.update(at(900, 100))).toBe(false);
    expect(lap.update(at(1000, 31))).toBe(false);
    expect(lap.update(at(1010, 29))).toBe(true);
  });

  it('199 m away does not arm, 200 m does', () => {
    const lap = new AutoLap({ mode: 'start' });
    lap.update(at(0, 0));
    lap.update(at(199, 199));
    expect(lap.update(at(400, 0))).toBe(false);
    lap.update(at(600, 200.5));
    expect(lap.update(at(800, 0))).toBe(true);
  });

  it('laps twice on two loops, and not while waiting at the start', () => {
    const lap = new AutoLap({ mode: 'start' });
    const fired: number[] = [];
    // Loop: out 0 -> 1000 -> back 0 in steps of 50 m, twice, then idle at the start.
    const path = [
      ...Array.from({ length: 21 }, (_, i) => i * 50),
      ...Array.from({ length: 21 }, (_, i) => 1000 - i * 50),
      ...Array.from({ length: 21 }, (_, i) => i * 50),
      ...Array.from({ length: 21 }, (_, i) => 1000 - i * 50),
      0,
      0,
      0,
      10,
      0,
    ];
    path.forEach((n, i) => {
      if (lap.update(at(i * 50, n))) fired.push(i);
    });
    // The first fix (index 0) is the start; the loops return to it at indices 41 and 83 (50 m steps, the first fix within 30 m is the one at 0 m).
    expect(fired).toEqual([41, 83]);
  });

  it('a lap needs the rider to leave 200 m again before the next one', () => {
    const lap = new AutoLap({ mode: 'start' });
    lap.update(at(0, 0));
    lap.update(at(500, 500));
    expect(lap.update(at(1000, 10))).toBe(true);
    // Hovering around the start line after the lap.
    expect(lap.update(at(1010, 5))).toBe(false);
    expect(lap.update(at(1020, 190))).toBe(false);
    expect(lap.update(at(1030, 10))).toBe(false);
    expect(lap.update(at(1500, 400))).toBe(false);
    expect(lap.update(at(2000, 15))).toBe(true);
  });

  it('ignores GPS null, before and after the start fix', () => {
    const lap = new AutoLap({ mode: 'start' });
    expect(lap.update(at(0, null))).toBe(false);
    // The start is the first real fix, not the first call.
    expect(lap.update(at(10, 0))).toBe(false);
    expect(lap.update(at(500, null))).toBe(false);
    expect(lap.update(at(600, 400))).toBe(false);
    expect(lap.update(at(700, null))).toBe(false);
    expect(lap.update(at(800, 10))).toBe(true);
  });

  it('a manual lap does not touch the loop state', () => {
    const lap = new AutoLap({ mode: 'start' });
    lap.update(at(0, 0));
    lap.update(at(500, 500));
    expect(lap.update(at(600, 450, true))).toBe(false);
    expect(lap.update(at(1000, 10))).toBe(true);
    lap.notifyLap(1000);
    expect(lap.update(at(1100, 400))).toBe(false);
  });
});
