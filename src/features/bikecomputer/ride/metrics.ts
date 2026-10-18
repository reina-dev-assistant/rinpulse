/**
 * Rolling figures of a ride for the bike computer fields, fed one `RecordedSample` per second (the recorder's own samples, so a
 * restored ride can be replayed with `BikeMetrics.from`). Every step is O(1) or O(window): nothing is recomputed from the whole ride.
 *
 * No React Native imports: runs under bun test. Time comes from the samples, never from a clock.
 *
 * Definitions (Garmin Edge conventions where they are documented, the repo's cycling rules otherwise):
 * - Average speed: distance covered at speed (m/s x seconds) over the moving seconds only. A second is moving at `STOP_SPEED_MS`
 *   (1 m/s, the ride analysis' own floor) and above; slower seconds add neither distance nor time.
 * - Max speed: the fastest mean of three consecutive 1 Hz samples (the recorder's summary smooths by 3 s too).
 * - Average cadence over the seconds the rider pedalled (cadence above 0); average power over every second with a power reading,
 *   zeros included. A second with no reading (null) is not a second of zero: it is left out of every power figure.
 * - Normalised power: Coggan's 30 s rolling mean raised to the 4th power, averaged and rooted; null under 30 samples.
 * - Ascent and descent: the same method as the ride analysis (`RIDE_ELEVATION_*`: 15 s centred mean, 2.5 m hysteresis), computed
 *   incrementally. The centred mean needs 7 s of future samples, so the last 7 samples use the window cut at the newest sample,
 *   exactly what `elevationProfile` does at the end of a series: a snapshot equals the batch result for the samples so far.
 * - Grade: smoothed altitude (5 s mean) rise over the run of the last 150 m of distance covered; null under 5 km/h, without
 *   altitude or before 50 m of run; clamped to +-30 %.
 */
import { STOP_SPEED_MS } from '@/features/cycling/series';
import { RIDE_ELEVATION_HYSTERESIS_M, RIDE_ELEVATION_SMOOTH_SEC } from '@/features/cycling/analyzeRide';
import type { RecordedSample } from '@/features/record/recorder';

import type { BikeMetricsSnapshot } from '../types';

export interface BikeMetricsConfig {
  /** Rider weight in kg (the estimated power needs it). */
  weightKg: number;
  /**
   * The rider's maximum heart rate. No figure here depends on it (zones and alerts read it from the profile); it is part of the
   * config so a caller builds one object for every ride engine.
   */
  maxHr?: number;
}

const GRAVITY = 9.81;
// The physics of `virtualSpeedMs` (features/cycling/series.ts, docs/cycling-metrics.md); that module keeps them private.
const AIR_DENSITY = 1.2;
const CDA = 0.35;
const CRR = 0.004;
const DRIVETRAIN_EFFICIENCY = 0.976;

/** Below 5 km/h the grade of a GPS track says nothing. */
const MIN_GRADE_SPEED_MS = 5 / 3.6;
const GRADE_RUN_M = 150;
const GRADE_MIN_RUN_M = 50;
const GRADE_MAX_PCT = 30;
const ALT_SMOOTH_SAMPLES = 5;
const NP_WINDOW = 30;
const MAX_SPEED_WINDOW_SEC = 3;
const MAX_BELIEVABLE_SPEED_MS = 30;
const MAX_POWER_W = 4000;
const MAX_CADENCE_RPM = 250;
const MIN_BPM = 20;
const MAX_BPM = 250;
const MIN_ALT_M = -500;
const MAX_ALT_M = 9000;
/** A gap between two samples longer than this is a pause or a dropout: the sample counts as one second. */
const MAX_GAP_SEC = 10;
const ELEVATION_HALF = Math.floor(RIDE_ELEVATION_SMOOTH_SEC / 2);

/**
 * Watts a rider at `speedMps` on `gradePct` implies: P = (1/2 rho CdA v^3 + Crr m g v + m g sin(atan(grade)) v) / 0.976, the flat-road
 * model of `virtualSpeedMs` plus the climbing term. A downhill that the model says needs no power gives 0, never a negative.
 * Null while the speed is unknown or under 1 m/s; an unknown grade is taken as flat. `weightKg` is the rider, `bikeKg` the bike.
 */
export function estimatePowerW(speedMps: number | null, gradePct: number | null, weightKg: number, bikeKg = 9): number | null {
  if (speedMps === null || !(speedMps >= STOP_SPEED_MS)) return null;
  const mass = weightKg + bikeKg;
  const slope = gradePct === null ? 0 : Math.sin(Math.atan(gradePct / 100));
  const wheel = 0.5 * AIR_DENSITY * CDA * speedMps ** 3 + (CRR * mass * GRAVITY + mass * GRAVITY * slope) * speedMps;
  return Math.max(0, wheel / DRIVETRAIN_EFFICIENCY);
}

interface Timed {
  ts: number;
  v: number;
}

interface ElevationState {
  ref: number | null;
  gain: number;
  loss: number;
}

function elevationStep(s: ElevationState, a: number | null): void {
  if (a === null) return;
  if (s.ref === null) s.ref = a;
  else if (a - s.ref >= RIDE_ELEVATION_HYSTERESIS_M) {
    s.gain += a - s.ref;
    s.ref = a;
  } else if (s.ref - a >= RIDE_ELEVATION_HYSTERESIS_M) {
    s.loss += s.ref - a;
    s.ref = a;
  }
}

export class BikeMetrics {
  private readonly weightKg: number;

  private lastTs: number | null = null;

  // speed
  private movingSec = 0;
  private movingDistM = 0;
  private lapMovingSec = 0;
  private lapMovingDistM = 0;
  private lapStartSec: number | null = null;
  private totalDistM = 0;
  private speeds: Timed[] = [];
  private maxSpeed3s: number | null = null;

  // cadence, heart rate
  private cadSum = 0;
  private cadCount = 0;
  private hrSum = 0;
  private hrCount = 0;
  private hrMax: number | null = null;

  // power
  private powerSum = 0;
  private powerCount = 0;
  private powers: Timed[] = [];
  private readonly npRing = new Float64Array(NP_WINDOW);
  private npCount = 0;
  private npWindowSum = 0;
  private npSum4 = 0;
  private npWindows = 0;

  // altitude
  private recentAlt: (number | null)[] = [];
  private smoothAlt: number | null = null;
  /** Raw altitudes from index `elevBase` to the newest sample, for the centred mean of the ascent. */
  private elevAlt: (number | null)[] = [];
  private elevBase = 0;
  private elevFinal = 0;
  private readonly elev: ElevationState = { ref: null, gain: 0, loss: 0 };
  /** Distance and smoothed altitude where the altitude was known, oldest first; `gradeHead` is the first live entry. */
  private gradePts: Timed[] = [];
  private gradeHead = 0;

  constructor(cfg: BikeMetricsConfig) {
    this.weightKg = cfg.weightKg;
  }

  /** A metrics engine that has seen `samples` (restoring a ride after the app was killed). */
  static from(samples: readonly RecordedSample[], cfg: BikeMetricsConfig): BikeMetrics {
    const m = new BikeMetrics(cfg);
    for (const s of samples) m.ingest(s);
    return m;
  }

  /** Feed the next one-second sample. A sample not newer than the last one is dropped. */
  ingest(sample: RecordedSample): void {
    const ts = sample.ts;
    if (!Number.isFinite(ts)) return;
    if (this.lastTs !== null && ts <= this.lastTs) return;
    const gap = this.lastTs === null ? 1 : ts - this.lastTs;
    const dt = gap > MAX_GAP_SEC ? 1 : gap;
    this.lastTs = ts;
    if (this.lapStartSec === null) this.lapStartSec = ts;

    this.ingestSpeed(ts, dt, sample.speed);
    this.ingestHeart(sample.hr);
    this.ingestCadence(sample.cadence);
    this.ingestPower(ts, sample.power);
    this.ingestAltitude(sample.alt);
  }

  /** A lap started at `nowSec`: the lap average speed restarts. */
  lap(nowSec: number): void {
    this.lapStartSec = nowSec;
    this.lapMovingSec = 0;
    this.lapMovingDistM = 0;
  }

  /** Unix seconds the current lap started (the first sample's time before any lap). */
  get lapStart(): number | null {
    return this.lapStartSec;
  }

  snapshot(): BikeMetricsSnapshot {
    const speed3 = this.recentSpeed();
    const grade = this.gradePct(speed3);
    const { ascent, descent } = this.elevationTotals();
    return {
      avgSpeedMps: this.movingSec > 0 ? this.movingDistM / this.movingSec : null,
      maxSpeedMps: this.maxSpeed3s,
      lapAvgSpeedMps: this.lapMovingSec > 0 ? this.lapMovingDistM / this.lapMovingSec : null,
      avgCadence: this.cadCount > 0 ? this.cadSum / this.cadCount : null,
      avgHr: this.hrCount > 0 ? this.hrSum / this.hrCount : null,
      maxHr: this.hrMax,
      avgPower: this.powerCount > 0 ? this.powerSum / this.powerCount : null,
      power3s: this.windowMean(this.powers, 3),
      power10s: this.windowMean(this.powers, 10),
      normPower: this.npWindows > 0 ? (this.npSum4 / this.npWindows) ** 0.25 : null,
      altitudeM: this.smoothAlt,
      ascentM: ascent,
      descentM: descent,
      gradePct: grade,
      estPowerW: estimatePowerW(speed3, grade, this.weightKg),
    };
  }

  private ingestSpeed(ts: number, dt: number, raw: number | null): void {
    const speed = raw !== null && raw >= 0 && raw <= MAX_BELIEVABLE_SPEED_MS ? raw : null;
    if (speed !== null && speed >= STOP_SPEED_MS) {
      this.movingSec += dt;
      this.movingDistM += speed * dt;
      this.lapMovingSec += dt;
      this.lapMovingDistM += speed * dt;
      this.totalDistM += speed * dt;
    }
    if (speed !== null) {
      this.speeds.push({ ts, v: speed });
      // Three consecutive seconds: the window holds the samples newer than ts - 3.
      while (this.speeds.length > 0 && (this.speeds[0] as Timed).ts <= ts - MAX_SPEED_WINDOW_SEC) this.speeds.shift();
      if (this.speeds.length >= 3) {
        const mean = this.speeds.reduce((a, s) => a + s.v, 0) / this.speeds.length;
        if (this.maxSpeed3s === null || mean > this.maxSpeed3s) this.maxSpeed3s = mean;
      }
    } else {
      // A second without a reading breaks the run of consecutive seconds.
      this.speeds.length = 0;
    }
  }

  private ingestHeart(raw: number | null): void {
    if (raw === null || !(raw >= MIN_BPM && raw <= MAX_BPM)) return;
    this.hrSum += raw;
    this.hrCount += 1;
    if (this.hrMax === null || raw > this.hrMax) this.hrMax = raw;
  }

  private ingestCadence(raw: number | null): void {
    if (raw === null || !(raw > 0 && raw <= MAX_CADENCE_RPM)) return;
    this.cadSum += raw;
    this.cadCount += 1;
  }

  private ingestPower(ts: number, raw: number | null): void {
    if (raw === null || !(raw >= 0 && raw <= MAX_POWER_W)) return;
    this.powerSum += raw;
    this.powerCount += 1;
    this.powers.push({ ts, v: raw });
    while (this.powers.length > 0 && (this.powers[0] as Timed).ts <= ts - 10) this.powers.shift();

    const slot = this.npCount % NP_WINDOW;
    if (this.npCount >= NP_WINDOW) this.npWindowSum -= this.npRing[slot] as number;
    this.npRing[slot] = raw;
    this.npWindowSum += raw;
    this.npCount += 1;
    if (this.npCount >= NP_WINDOW) {
      this.npSum4 += (this.npWindowSum / NP_WINDOW) ** 4;
      this.npWindows += 1;
    }
  }

  private ingestAltitude(raw: number | null): void {
    const alt = raw !== null && raw >= MIN_ALT_M && raw <= MAX_ALT_M ? raw : null;

    // Display altitude and grade: 5 s trailing mean.
    this.recentAlt.push(alt);
    if (this.recentAlt.length > ALT_SMOOTH_SAMPLES) this.recentAlt.shift();
    let sum = 0;
    let n = 0;
    for (const a of this.recentAlt) {
      if (a !== null) {
        sum += a;
        n += 1;
      }
    }
    if (n > 0) {
      this.smoothAlt = sum / n;
      this.pushGradePoint(this.smoothAlt);
    }

    // Ascent: finalise every index whose centred window is complete.
    this.elevAlt.push(alt);
    const count = this.elevBase + this.elevAlt.length;
    while (this.elevFinal + ELEVATION_HALF <= count - 1) {
      elevationStep(this.elev, this.elevatedMean(this.elevFinal, count));
      this.elevFinal += 1;
    }
    const keepFrom = Math.max(0, this.elevFinal - ELEVATION_HALF);
    if (keepFrom > this.elevBase) {
      this.elevAlt.splice(0, keepFrom - this.elevBase);
      this.elevBase = keepFrom;
    }
  }

  /** Centred mean of the raw altitude around index `i`, the window cut at both ends of the `count` samples seen; null for a null sample. */
  private elevatedMean(i: number, count: number): number | null {
    if (this.elevAlt[i - this.elevBase] === null) return null;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - ELEVATION_HALF); j <= Math.min(count - 1, i + ELEVATION_HALF); j++) {
      const a = this.elevAlt[j - this.elevBase];
      if (a !== null && a !== undefined) {
        sum += a;
        n += 1;
      }
    }
    return n > 0 ? sum / n : null;
  }

  private elevationTotals(): { ascent: number; descent: number } {
    const count = this.elevBase + this.elevAlt.length;
    if (this.elevFinal >= count) return { ascent: this.elev.gain, descent: this.elev.loss };
    const tail: ElevationState = { ...this.elev };
    for (let i = this.elevFinal; i < count; i++) elevationStep(tail, this.elevatedMean(i, count));
    return { ascent: tail.gain, descent: tail.loss };
  }

  private pushGradePoint(alt: number): void {
    const last = this.gradePts[this.gradePts.length - 1];
    if (last !== undefined && last.ts >= this.totalDistM) {
      // Standing still: the newest altitude replaces the point instead of growing the list.
      last.v = alt;
      return;
    }
    this.gradePts.push({ ts: this.totalDistM, v: alt });
    // Keep the newest point at or before 150 m back as the anchor; drop what is older.
    while (this.gradePts.length - this.gradeHead > 1 && (this.gradePts[this.gradeHead + 1] as Timed).ts <= this.totalDistM - GRADE_RUN_M) {
      this.gradeHead += 1;
    }
    if (this.gradeHead > 256) {
      this.gradePts.splice(0, this.gradeHead);
      this.gradeHead = 0;
    }
  }

  private gradePct(speed3: number | null): number | null {
    if (speed3 === null || speed3 < MIN_GRADE_SPEED_MS || this.smoothAlt === null) return null;
    const anchor = this.gradePts[this.gradeHead];
    if (anchor === undefined) return null;
    const run = this.totalDistM - anchor.ts;
    if (run < GRADE_MIN_RUN_M) return null;
    return Math.min(GRADE_MAX_PCT, Math.max(-GRADE_MAX_PCT, ((this.smoothAlt - anchor.v) / run) * 100));
  }

  /** Mean speed of the last 3 s of samples. */
  private recentSpeed(): number | null {
    if (this.lastTs === null) return null;
    const lastTs = this.lastTs;
    let sum = 0;
    let n = 0;
    for (const s of this.speeds) {
      if (s.ts > lastTs - MAX_SPEED_WINDOW_SEC) {
        sum += s.v;
        n += 1;
      }
    }
    return n > 0 ? sum / n : null;
  }

  /** Mean of the readings newer than `lastTs - sec`; null with none. */
  private windowMean(window: readonly Timed[], sec: number): number | null {
    if (this.lastTs === null) return null;
    const limit = this.lastTs - sec;
    let sum = 0;
    let n = 0;
    for (const s of window) {
      if (s.ts > limit) {
        sum += s.v;
        n += 1;
      }
    }
    return n > 0 ? sum / n : null;
  }
}
