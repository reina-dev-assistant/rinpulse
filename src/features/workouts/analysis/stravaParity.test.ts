import { describe, expect, it } from 'bun:test';

import type { WorkoutRow } from '@/db/queries';
import { buildRunSubject } from '@/features/stickers/data/run';
import { buildWatchPost } from '@/features/social/watchPost';
import { buildFit, type StravaPoint } from '@/features/strava/activityFile';
import { decodeFit, estimateMovingTime } from '@/features/strava/testDecode';
import { formatElapsed } from '@/features/workouts/summary';
import { workoutTimes } from '@/features/workouts/times';

import { analyzeWorkout, type AnalysisHistory } from './analyze';
import { elevationProfile, workoutElevation } from './elevation';
import { row, T0, workoutRow } from './fixtures';
import { altitudeGrid, elapsedOf, gridStep, type AnalysisPoint } from './series';
import { FLAT_WALK, GENTLE_WALK, WALK } from './stravaWalks.fixture';

/**
 * The owner's walk of 2026-10-18 07:35 against what Strava shows for it (activity 20628405451): 2.01 km, moving 25:26,
 * elapsed 25:26, 24 m, 12:39 per km, 143 kcal, 127 bpm, 2,672 steps. The app showed 25:23 in the header and 1.97 km,
 * 24:18 moving, +59/-59 m and 12:38 per km on the analysis card of the same screen. The altitude and heart rate are the
 * walk's own; the route is a straight line of the walk's GPS length, because the real one is a home address.
 */

/** Metres per degree of latitude on the sphere `haversineM` uses. */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;
/** The GPS path the app measured for the walk: its distance card read 1.97 km. */
const GPS_PATH_M = WALK.before.distanceM;
const NO_HISTORY: AnalysisHistory = { efforts: [], trimps: [], similar: [] };
const ALL = { includeHr: true, includeRoute: true, includeComparison: true };

const workout: WorkoutRow = workoutRow({
  start: T0,
  end: T0 + WALK.elapsedSec,
  sportType: 4,
  sportName: 'Outdoor walk',
  duration: WALK.durationSec,
  distance: WALK.distanceM,
  calories: WALK.calories,
  steps: WALK.steps,
  avgHr: WALK.avgHr,
  maxHr: WALK.maxHr,
});

/** One GPS fix per second from the first to the last fix, rows of altitude and heart rate every 5 s, as in `workout_points`. */
function walkPoints(): AnalysisPoint[] {
  const points: AnalysisPoint[] = [];
  for (let t = WALK.firstFixSec; t <= WALK.lastFixSec; t++) {
    const along = (GPS_PATH_M * (t - WALK.firstFixSec)) / (WALK.lastFixSec - WALK.firstFixSec);
    points.push(row(T0 + t, { lat: -7.9 + along / M_PER_DEG, lon: 112.6 }));
  }
  WALK.alt.forEach((alt, i) => {
    const hr = WALK.hr[i] as number;
    points.push(row(T0 + WALK.firstSampleSec + 5 * i, { alt, hr: hr > 0 ? hr : null }));
  });
  return points.sort((a, b) => a.ts - b.ts);
}

const points = walkPoints();
const summary = {
  avgPaceSecPerKm: WALK.before.paceSecKm,
  avgSpeed: WALK.distanceM / WALK.durationSec,
  elevationGain: WALK.before.gainM,
  elevationLoss: WALK.before.lossM,
};
const analysis = analyzeWorkout({ workout, summary, points, maxHr: 190, daySamples: [], history: NO_HISTORY }, ALL);

/** The `run.*` numbers of the sticker for the walk. */
const sticker = () => buildRunSubject({ workout, summary, analysis, route: [], gearLine: null }, 'id').data.run as Record<string, unknown>;

describe('distance: the watch total, everywhere', () => {
  it('is 2.01 km on the card, in the series and in the post, not the 1.97 km of the GPS path', () => {
    expect(analysis.distanceM).toBe(WALK.strava.distanceM);
    const dist = analysis.series!.dist!;
    expect(dist[dist.length - 1]).toBe(WALK.strava.distanceM);
    const post = buildWatchPost(workout, points, { caption: '', visibility: 'grup', includeHr: true, includeRoute: true, includeComparison: true }, analysis);
    expect(post.workout.distanceM).toBe(WALK.strava.distanceM);
    expect(post.detail && 'analysis' in post.detail ? post.detail.analysis.distanceM : null).toBe(WALK.strava.distanceM);
    expect(sticker().distanceM).toBe(WALK.strava.distanceM);
  });

  it('spreads the watch distance as the Strava file does: the unrecorded start and end move at the average speed', () => {
    // 47 s before the first fix at 2010 m / 1526 s, then the GPS path scaled to what is left.
    const speed = WALK.distanceM / WALK.elapsedSec;
    const stepSec = analysis.series!.stepSec;
    const dist = analysis.series!.dist!;
    expect(dist[Math.round(WALK.firstFixSec / stepSec)]).toBeCloseTo(speed * WALK.firstFixSec, -1);
    // Two splits of a kilometre each, as Strava lists them; the 10 m left is under the 100 m a split needs.
    expect(analysis.splits.map((s) => s.distM)).toEqual([1000, 1000]);
    const total = analysis.splits.reduce((sum, s) => sum + s.sec, 0);
    expect(total).toBeGreaterThan(1500);
    expect(total).toBeLessThan(WALK.elapsedSec);
    // Strava: 12:36 and 12:42 for the two kilometres; this straight route walks them at one speed.
    for (const s of analysis.splits) expect(Math.abs(s.paceSecKm! - WALK.strava.paceSecKm)).toBeLessThan(12);
  });

  it('keeps the GPS track for the map', () => {
    expect(analysis.series!.track!.filter((p) => p !== null).length).toBeGreaterThan(400);
  });

  it('is in the Strava file too: session, lap and the last record', () => {
    const stravaPoints: StravaPoint[] = points.map((p) => ({ ts: p.ts, lat: p.lat, lon: p.lon, alt: p.alt ?? null, hr: p.hr }));
    const decoded = decodeFit(buildFit({ ...workout, elevationGain: 24, elevationLoss: 25 }, stravaPoints, { utcOffsetSeconds: 7 * 3600 }).bytes);
    expect(decoded.errors).toEqual([]);
    const session = decoded.messages.sessionMesgs?.[0];
    const records = decoded.messages.recordMesgs ?? [];
    expect(session?.totalDistance).toBe(WALK.strava.distanceM);
    expect(records[records.length - 1]?.distance).toBe(WALK.strava.distanceM);
    // The timer time of the file is the moving time shown: no 3 s shorter than the timer events and the elapsed time.
    expect(session?.totalElapsedTime).toBe(WALK.elapsedSec);
    expect(session?.totalTimerTime).toBe(WALK.strava.movingSec);
    // What Strava makes of it: no pause events, so its own estimate from the record stream, which sees it moving throughout.
    const strava = estimateMovingTime(records, decoded.messages.eventMesgs ?? []);
    expect(strava.from).toBe('record stream');
    expect(Math.abs(strava.seconds - WALK.strava.movingSec)).toBeLessThanOrEqual(15);
  });
});

describe('time: moving and elapsed as Strava has them', () => {
  it('is 25:26 in the header, the analysis, the share card and the post; the watch timer 25:23 is not a pause', () => {
    const times = workoutTimes(workout);
    expect(times).toEqual({ elapsedSec: WALK.strava.elapsedSec, movingSec: WALK.strava.movingSec });
    expect(formatElapsed(times.movingSec)).toBe('25:26');
    expect(analysis.elapsedSec).toBe(WALK.strava.elapsedSec);
    expect(analysis.movingSec).toBe(WALK.strava.movingSec);
    expect(sticker().movingSec).toBe(WALK.strava.movingSec);
    const post = buildWatchPost(workout, points, { caption: '', visibility: 'grup', includeHr: true, includeRoute: true, includeComparison: true }, analysis);
    expect(post.workout.durationMin).toBe(25);
  });

  it('shows elapsed separately only when a pause of 30 s or more explains it', () => {
    expect(workoutTimes({ ...workout, duration: WALK.elapsedSec - 29 }).movingSec).toBe(WALK.elapsedSec);
    expect(workoutTimes({ ...workout, duration: WALK.elapsedSec - 30 })).toEqual({ elapsedSec: WALK.elapsedSec, movingSec: WALK.elapsedSec - 30 });
    expect(analysis.elapsedSec).toBe(analysis.movingSec);
  });
});

describe('pace, calories, heart rate', () => {
  it('pace is the watch distance over the moving time: 12:39 per km as Strava, not 12:38', () => {
    expect(analysis.stats.avgPaceSecKm).toBe(WALK.strava.paceSecKm);
    expect(formatElapsed(analysis.stats.avgPaceSecKm!)).toBe('12:39');
    expect(formatElapsed(sticker().paceSecKm as number)).toBe('12:39');
  });

  it('calories, heart rate and steps are the watch totals Strava shows', () => {
    expect(analysis.calories?.kcal).toBe(WALK.strava.kcal);
    expect(analysis.stats.avgHr).toBe(WALK.strava.avgHr);
    expect(analysis.stats.maxHr).toBe(WALK.strava.maxHr);
    expect(workout.steps).toBe(WALK.strava.steps);
  });
});

describe('elevation gain: smoothed, near Strava, not the barometer sum', () => {
  it('is 24 m on the card, the header and the share card, not 59 m', () => {
    const e = analysis.elevation!;
    expect(Math.round(e.gainM)).toBe(24);
    expect(Math.abs(e.gainM - WALK.strava.gainM)).toBeLessThan(1.5);
    const header = workoutElevation(workout, summary, points)!;
    expect(Math.round(header.gainM * 10) / 10).toBe(e.gainM);
    expect(Math.round(header.lossM * 10) / 10).toBe(e.lossM);
    // The same walk is down by about as much as it climbed (net -4.6 m over the 5 s samples).
    expect(Math.abs(e.lossM - e.gainM)).toBeLessThan(8);
  });

  it('the raw barometer reading really climbs 53 m (59 m by the watch) on a 29 m span, which is what was wrong', () => {
    let rises = 0;
    for (let i = 1; i < WALK.alt.length; i++) rises += Math.max(0, (WALK.alt[i] as number) - (WALK.alt[i - 1] as number));
    expect(rises).toBeGreaterThan(50);
    expect(Math.max(...WALK.alt) - Math.min(...WALK.alt)).toBeLessThan(30);
  });

  /** The gain the method gives a series of `[seconds, altitude]` readings of a workout `elapsed` seconds long. */
  const gainOf = (alt: readonly [number, number][], elapsed: number) => {
    const rows = alt.map(([t, a]) => row(T0 + t, { alt: a }));
    const stepSec = gridStep(elapsedOf({ start: T0, end: T0 + elapsed, duration: elapsed, points: rows }));
    return elevationProfile(altitudeGrid(rows, T0, stepSec, Math.ceil(elapsed / stepSec) + 1), stepSec).gain;
  };

  it('is within a few metres of Strava on the other two JoyoFit walks it was fitted on', () => {
    // Strava's own figure is its terrain model's, so these differ in places: the gentle walk it counts 18.2 m, the flat one 2.1 m.
    const gentle = gainOf(GENTLE_WALK.alt, GENTLE_WALK.elapsedSec);
    expect(gentle).toBeGreaterThan(8);
    expect(gentle).toBeLessThan(11);
    const flat = gainOf(FLAT_WALK.alt, FLAT_WALK.elapsedSec);
    expect(flat).toBeGreaterThan(0);
    expect(flat).toBeLessThan(FLAT_WALK.stravaGainM + 3);
  });
});
