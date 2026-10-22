import { CONSENT_VERSION } from './consent';
import type { Person } from './person';

/**
 * The data digest (`joyofit.digest` v1): what the phone sends to the person's provider with every question, built from the same
 * numbers Readiness and Coach show. Units are in the key names. Missing is `null`, never 0. Nothing identifying: no name, email,
 * GPS, photos or device serial; the birth year becomes an age; free text from imports is flattened and capped.
 *
 * NOT in it, on purpose: menstrual cycle data and pregnancy / breastfeeding mode (the owner's rule: no AI path reads either, see
 * `docs/coach.md`), Strava data, per-minute
 * heart rate, sleep stages, GPS. A test builds a digest from a source that carries cycle fields and checks they cannot appear.
 * Every key below is listed in `DIGEST_FIELDS`, and `digest.test.ts` ties that list to `CONSENT_VERSION`.
 */

export const DIGEST_VERSION = 1;
/** About 2,000 to 2,500 tokens at 3.5 characters a token; sections are trimmed to stay under it. */
export const DIGEST_MAX_CHARS = 8_500;
export const DIGEST_DAYS = 14;
export const DIGEST_WORKOUTS = 10;
export const NOTE_MAX_CHARS = 200;
export const MAX_NOTES = 20;

/** Every field the digest can carry (dot paths, `[]` for a list). Changing this list needs a new `CONSENT_VERSION`. */
export const DIGEST_FIELDS = [
  'v',
  'now',
  'locale',
  'units.energy',
  'units.weight',
  'units.distance',
  'person.ageYears',
  'person.sex',
  'person.heightCm',
  'person.goal',
  'goals.stepsPerDay',
  'goals.stepsIsDefault',
  'goals.sleepNeedMin',
  'goals.eatKcal',
  'goals.weightGoalKg',
  'goals.weightGoalDate',
  'state.readiness',
  'state.load',
  'state.hrv',
  'state.sleepDebtMin',
  'state.strainAvg7',
  'state.vo2max',
  'state.recoveryHoursLeft',
  'days[].d',
  'days[].sleepMin',
  'days[].sleepScore',
  'days[].restBpm',
  'days[].hrvMs',
  'days[].strain',
  'days[].steps',
  'days[].activeKcal',
  'days[].exerciseMin',
  'days[].weightKg',
  'days[].eatKcal',
  'days[].proteinG',
  'workouts[].id',
  'workouts[].d',
  'workouts[].sport',
  'workouts[].min',
  'workouts[].km',
  'workouts[].avgBpm',
  'workouts[].plan',
  'plan.goal',
  'plan.level',
  'plan.week',
  'plan.weeks',
  'plan.done',
  'plan.planned',
  'plan.scalePct',
  'notes[].id',
  'notes[].text',
  'coverage.watchDays',
  'coverage.foodDays',
  'coverage.weighIns',
  'coverage.missing',
] as const;

/** A stable hash of the field list, pinned per consent version in the tests. */
export function fieldsHash(fields: readonly string[] = DIGEST_FIELDS): string {
  let h = 2166136261;
  for (const ch of fields.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Frozen per version: never edit an old entry. 1 had `person.maternal`; 2 (2026-10-22) removed it, so everyone is asked again. */
export const CONSENT_FIELDS_HASH: Record<number, string> = { 1: 'b83cc4df', 2: fieldsHash() };
export const consentMatchesFields = (): boolean => CONSENT_FIELDS_HASH[CONSENT_VERSION] === fieldsHash();

export interface DigestDay {
  d: string;
  sleepMin: number | null;
  sleepScore: number | null;
  restBpm: number | null;
  hrvMs: number | null;
  strain: number | null;
  steps: number | null;
  activeKcal: number | null;
  exerciseMin: number | null;
  weightKg: number | null;
  eatKcal: number | null;
  proteinG: number | null;
}

export interface DigestWorkout {
  id: string;
  d: string;
  sport: string;
  min: number;
  km: number | null;
  avgBpm: number | null;
  plan: string | null;
}

export interface DigestState {
  readiness: { word: string } | { status: 'calibrating'; nightsHave: number; nightsNeed: number } | null;
  load: { status: string; ratio: number } | { status: 'calibrating'; daysHave: number; daysNeed: number } | null;
  hrv: { state: string; recentMs: number; baselineMs: number } | null;
  sleepDebtMin: number | null;
  strainAvg7: number | null;
  vo2max: number | null;
  recoveryHoursLeft: number | null;
}

export interface Digest {
  v: typeof DIGEST_VERSION;
  now: string;
  locale: 'id' | 'en';
  units: { energy: 'kcal' | 'kkal'; weight: 'kg'; distance: 'km' };
  person: { ageYears: number | null; sex: 'm' | 'f' | null; heightCm: number | null; goal: string | null };
  goals: {
    stepsPerDay: number | null;
    stepsIsDefault: boolean;
    sleepNeedMin: number | null;
    eatKcal: number | null;
    weightGoalKg: number | null;
    weightGoalDate: string | null;
  } | null;
  state: DigestState;
  days: DigestDay[];
  workouts: DigestWorkout[];
  plan: { goal: string; level: string; week: number; weeks: number; done: number; planned: number; scalePct: number } | null;
  notes: { id: string; text: string }[];
  coverage: { watchDays: number; foodDays: number; weighIns: number; missing: string[] };
}

/**
 * What the loader gathers. The builder copies named fields out of it and nothing else, so an extra property (a cycle phase
 * added to a data source by mistake) is dropped here instead of reaching the provider.
 */
export interface DigestSource {
  now: string;
  locale: 'id' | 'en';
  person: Person;
  goals: { stepsPerDay: number | null; stepsIsDefault: boolean; sleepNeedMin: number | null };
  state: DigestState;
  days: readonly DigestDay[];
  workouts: readonly DigestWorkout[];
  plan: Digest['plan'];
  notes: readonly { id: string; text: string }[];
  coverage: Digest['coverage'];
}

/** Strips control characters and line breaks so a short string from data or a note cannot add its own "instruction" lines. */
export function flat(text: string, max: number): string {
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const num = (value: number | null | undefined, digits = 0): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const int = (value: number | null | undefined): number => num(value) ?? 0;

function dayRow(d: DigestDay): DigestDay {
  return {
    d: flat(d.d, 10),
    sleepMin: num(d.sleepMin),
    sleepScore: num(d.sleepScore),
    restBpm: num(d.restBpm),
    hrvMs: num(d.hrvMs),
    strain: num(d.strain, 1),
    steps: num(d.steps),
    activeKcal: num(d.activeKcal),
    exerciseMin: num(d.exerciseMin),
    weightKg: num(d.weightKg, 1),
    eatKcal: num(d.eatKcal),
    proteinG: num(d.proteinG),
  };
}

function normalizeState(s: DigestState): DigestState {
  return {
    readiness: s.readiness && 'word' in s.readiness ? { word: flat(s.readiness.word, 20) } : s.readiness ? { status: 'calibrating', nightsHave: int(s.readiness.nightsHave), nightsNeed: int(s.readiness.nightsNeed) } : null,
    load:
      s.load && 'ratio' in s.load
        ? { status: flat(s.load.status, 20), ratio: num(s.load.ratio, 2) ?? 0 }
        : s.load
          ? { status: 'calibrating', daysHave: int(s.load.daysHave), daysNeed: int(s.load.daysNeed) }
          : null,
    hrv: s.hrv ? { state: flat(s.hrv.state, 20), recentMs: num(s.hrv.recentMs) ?? 0, baselineMs: num(s.hrv.baselineMs) ?? 0 } : null,
    sleepDebtMin: num(s.sleepDebtMin),
    strainAvg7: num(s.strainAvg7, 1),
    vo2max: num(s.vo2max, 1),
    recoveryHoursLeft: num(s.recoveryHoursLeft),
  };
}

/** Builds the digest from the gathered source, whitelisting every field and keeping it under {@link DIGEST_MAX_CHARS}. */
export function buildDigest(src: DigestSource): Digest {
  const p = src.person;
  const full: Digest = {
    v: DIGEST_VERSION,
    now: flat(src.now, 30),
    locale: src.locale,
    units: { energy: src.locale === 'id' ? 'kkal' : 'kcal', weight: 'kg', distance: 'km' },
    person: { ageYears: num(p.ageYears), sex: p.sex, heightCm: num(p.heightCm), goal: p.goal },
    goals: {
      stepsPerDay: num(src.goals.stepsPerDay),
      stepsIsDefault: src.goals.stepsIsDefault,
      sleepNeedMin: num(src.goals.sleepNeedMin),
      eatKcal: num(p.eatKcal),
      weightGoalKg: num(p.weightGoalKg, 1),
      weightGoalDate: p.weightGoalDate ? flat(p.weightGoalDate, 10) : null,
    },
    state: normalizeState(src.state),
    days: src.days.slice(-DIGEST_DAYS).map(dayRow),
    workouts: src.workouts.slice(0, DIGEST_WORKOUTS).map((w) => ({
      id: flat(w.id, 24),
      d: flat(w.d, 10),
      sport: flat(w.sport, 30),
      min: int(w.min),
      km: num(w.km, 2),
      avgBpm: num(w.avgBpm),
      plan: w.plan ? flat(w.plan, 40) : null,
    })),
    plan: src.plan
      ? {
          goal: flat(src.plan.goal, 30),
          level: flat(src.plan.level, 30),
          week: int(src.plan.week),
          weeks: int(src.plan.weeks),
          done: int(src.plan.done),
          planned: int(src.plan.planned),
          scalePct: int(src.plan.scalePct),
        }
      : null,
    notes: src.notes.slice(0, MAX_NOTES).map((n) => ({ id: flat(n.id, 12), text: flat(n.text, NOTE_MAX_CHARS) })),
    coverage: {
      watchDays: int(src.coverage.watchDays),
      foodDays: int(src.coverage.foodDays),
      weighIns: int(src.coverage.weighIns),
      missing: src.coverage.missing.slice(0, 6).map((m) => flat(m, 60)),
    },
  };
  return fitToBudget(full);
}

export const digestJson = (digest: Digest): string => JSON.stringify(digest);

/** Trims what matters least until the JSON fits: older workouts, then older days, then goals and plan. Notes, state and coverage always stay. */
function fitToBudget(digest: Digest): Digest {
  const steps: ((d: Digest) => Digest)[] = [
    (d) => ({ ...d, workouts: d.workouts.slice(0, 5) }),
    (d) => ({ ...d, workouts: [] }),
    (d) => ({ ...d, days: d.days.slice(-7) }),
    (d) => ({ ...d, plan: null }),
    (d) => ({ ...d, days: d.days.slice(-3) }),
    (d) => ({ ...d, goals: null }),
  ];
  let current = digest;
  for (const step of steps) {
    if (digestJson(current).length <= DIGEST_MAX_CHARS) break;
    current = step(current);
  }
  return current;
}
