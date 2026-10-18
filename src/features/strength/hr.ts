/**
 * The heart rate of a strength session from a paired chest strap: samples, the energy they give and the crash journal.
 *
 * The strap's raw `2a37` notifications go through `SensorTracker` (contact flag, a value is held for at most `VALUE_FRESH_MS`), and
 * `tick` keeps one reading per `HR_SAMPLE_SEC`. A reading is skipped while the strap says it has no skin contact or has been silent
 * for longer than the hold, so a gap shows as a gap in the points and counts as uncovered time in the energy.
 *
 * Energy: Keytel (`keytelKcalPerMin`) over the seconds the samples cover, the MET estimate (`estimateKcal`) for the rest of the session.
 * The heart rate figure is only used from `HR_COVERAGE_MIN` of the session up; below it the whole session stays the MET estimate.
 *
 * No React Native imports: runs under bun test. The live wiring (hub, native session, timer) is `hrSession.ts`.
 */
import { appendJournal, clearJournal, loadJournal, saveJournalState, type JournalDb } from '../record/journal';
import { HR_COVERAGE_MIN, keytelKcalPerMin, type EnergyProfile } from '../record/energy';
import type { RecordedSample } from '../record/recorder';
import { DEFAULT_WHEEL_CIRCUMFERENCE_MM, SensorTracker } from '../sensors/gatt';
import type { SavedSensor, WorkoutSensor } from '../sensors/store';
import { estimateKcal } from './calc';
import type { StrengthWorkout } from './types';

/** Seconds between two samples, and the seconds of the session one sample stands for. */
export const HR_SAMPLE_SEC = 5;
/** The journal gets the new samples about this often. */
export const HR_FLUSH_SEC = 15;

/** One heart rate reading: unix seconds and bpm. */
export interface HrSample {
  ts: number;
  hr: number;
}

/** The strap a strength session uses: the first paired sensor with a heart rate service that connects when a workout starts. */
export function pickStrap<T extends Pick<SavedSensor, 'kinds' | 'autoConnect'>>(saved: readonly T[]): T | null {
  return saved.find((s) => s.autoConnect && s.kinds.includes('hr')) ?? null;
}

export class HrCollector {
  private readonly tracker = new SensorTracker(DEFAULT_WHEEL_CIRCUMFERENCE_MM / 1000);
  private readonly list: HrSample[];
  private drained: number;

  /** `restored` are the samples of the crash journal when the app was reopened mid-session. */
  constructor(restored: readonly HrSample[] = []) {
    this.list = [...restored];
    this.drained = this.list.length;
  }

  /** A raw characteristic value from the strap; true when it was a heart rate measurement. `tsMs` is the radio timestamp. */
  ingest(characteristic: string, hex: string, tsMs: number): boolean {
    return characteristic.toLowerCase() === '2a37' && this.tracker.ingest(characteristic, hex, tsMs);
  }

  /** The heart rate right now: null when the strap has no contact or has not sent for longer than the hold. */
  live(nowMs: number): number | null {
    const r = this.tracker.read(nowMs);
    return r.hr === undefined || r.hrContact === 'lost' ? null : r.hr;
  }

  /** Takes a sample when `HR_SAMPLE_SEC` have passed since the last one and there is a heart rate to take. */
  tick(nowMs: number): HrSample | null {
    const ts = Math.floor(nowMs / 1000);
    const last = this.list[this.list.length - 1];
    if (last && ts - last.ts < HR_SAMPLE_SEC) return null;
    const hr = this.live(nowMs);
    if (hr === null) return null;
    const sample = { ts, hr };
    this.list.push(sample);
    return sample;
  }

  get samples(): readonly HrSample[] {
    return this.list;
  }

  /** Samples not handed out yet (for the journal); each is returned once. */
  drainNew(): HrSample[] {
    const out = this.list.slice(this.drained);
    this.drained = this.list.length;
    return out;
  }

  avg(): number | null {
    return hrStats(this.list)?.avgHr ?? null;
  }

  max(): number | null {
    return hrStats(this.list)?.maxHr ?? null;
  }

  min(): number | null {
    return hrStats(this.list)?.minHr ?? null;
  }

  /** Share of the session (0..1) the samples cover. */
  coverage(durationSec: number): number {
    return coverageOf(this.list, durationSec);
  }

  /** The session's energy (see `strengthEnergy`). */
  kcal(workout: Pick<StrengthWorkout, 'exercises' | 'durationSec'>, profile: EnergyProfile): StrengthEnergy {
    return strengthEnergy(this.list, workout, profile);
  }
}

/** Mean (rounded), highest and lowest bpm of the samples; null without samples. */
export function hrStats(samples: readonly HrSample[]): { avgHr: number; maxHr: number; minHr: number } | null {
  if (samples.length === 0) return null;
  let total = 0;
  let maxHr = -Infinity;
  let minHr = Infinity;
  for (const p of samples) {
    total += p.hr;
    maxHr = Math.max(maxHr, p.hr);
    minHr = Math.min(minHr, p.hr);
  }
  return { avgHr: Math.round(total / samples.length), maxHr, minHr };
}

/** Share of `durationSec` (0..1) the samples cover; each stands for `HR_SAMPLE_SEC`. */
export function coverageOf(samples: readonly HrSample[], durationSec: number): number {
  return durationSec <= 0 ? 0 : Math.min(1, (samples.length * HR_SAMPLE_SEC) / durationSec);
}

export interface StrengthEnergy {
  kcal: number;
  /** `hr`: from the strap (the uncovered time at the MET rate); `estimate`: MET only. */
  source: 'hr' | 'estimate';
  coverage: number;
}

/** Energy of a finished session from its samples. Below `HR_COVERAGE_MIN` (or without samples) it is the MET estimate alone. */
export function strengthEnergy(samples: readonly HrSample[], workout: Pick<StrengthWorkout, 'exercises' | 'durationSec'>, profile: EnergyProfile): StrengthEnergy {
  const met = estimateKcal(workout, profile.weightKg);
  const coverage = coverageOf(samples, workout.durationSec);
  if (samples.length === 0 || coverage < HR_COVERAGE_MIN) return { kcal: met, source: 'estimate', coverage };
  const coveredSec = Math.min(workout.durationSec, samples.length * HR_SAMPLE_SEC);
  const perSec = samples.reduce((a, p) => a + keytelKcalPerMin(p.hr, profile) / 60, 0) / samples.length;
  const metShare = (met * (workout.durationSec - coveredSec)) / workout.durationSec;
  return { kcal: Math.round(perSec * coveredSec + metShare), source: 'hr', coverage };
}

/** What a finished session hands to `attachWorkoutRow`: the points to store, their statistics, the energy and the strap. */
export interface StrapResult {
  samples: HrSample[];
  avgHr: number;
  maxHr: number;
  minHr: number;
  /** The strap's energy; null when it covered too little of the session (the MET estimate stays). */
  kcal: number | null;
  sensors: WorkoutSensor[];
}

/** Null when the strap gave no heart rate at all. */
export function strapResult(
  samples: readonly HrSample[],
  workout: Pick<StrengthWorkout, 'exercises' | 'durationSec'>,
  profile: EnergyProfile,
  sensors: readonly WorkoutSensor[],
): StrapResult | null {
  const stats = hrStats(samples);
  if (!stats) return null;
  const energy = strengthEnergy(samples, workout, profile);
  return { samples: [...samples], ...stats, kcal: energy.source === 'hr' ? energy.kcal : null, sensors: [...sensors] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Crash journal (`recording_journal` / `recording_state`, session 'strength')

/** What the journal remembers besides the samples: which workout they belong to. */
export interface HrJournalMeta {
  workoutId: string;
  sensorId: string;
}

/** The samples as the rows of `workout_points` / the recording journal (everything but the time and the heart rate empty). */
export function recordedSamplesOf(samples: readonly HrSample[]): RecordedSample[] {
  return samples.map((s) => ({ ts: s.ts, lat: null, lon: null, alt: null, hr: s.hr, speed: null, cadence: null, stride: null, power: null }));
}

/** Appends new samples and rewrites the state; the journal then holds every sample of the session so far. */
export async function saveHrJournal(db: JournalDb, fresh: readonly HrSample[], meta: HrJournalMeta, nowMs: number): Promise<void> {
  await appendJournal(db, 'strength', recordedSamplesOf(fresh));
  await saveJournalState(db, 'strength', meta, nowMs);
}

/** The samples of workout `workoutId` from the journal, or null when there is none for it (a journal of another workout is dropped). */
export async function loadHrJournal(db: JournalDb, workoutId: string): Promise<HrSample[] | null> {
  const journal = await loadJournal<HrJournalMeta>(db, 'strength');
  if (!journal) return null;
  if (journal.meta.workoutId !== workoutId) {
    await clearJournal(db, 'strength');
    return null;
  }
  return journal.samples.flatMap((s) => (s.hr === null ? [] : [{ ts: s.ts, hr: s.hr }]));
}

export const clearHrJournal = (db: JournalDb): Promise<void> => clearJournal(db, 'strength');
