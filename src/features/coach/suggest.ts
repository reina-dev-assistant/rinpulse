import type { TrainingStatus } from '@/features/fitness/trainingLoad';
import type { Feel } from './feel';
import type { PlannedSession, HrZone, SessionType } from './plans/types';

/**
 * The daily suggestion: rule based and transparent, no model. Each signal adds fatigue points; the total picks a band,
 * the band decides whether the planned session stays, is scaled or swapped for something easier, and the biggest
 * contributions become the "why" the person reads. `docs/coach.md` has the same table.
 *
 * | Signal                                  | Points |
 * | --------------------------------------- | ------ |
 * | Readiness: Run down / Strained / Primed | +3 / +2 / -1 |
 * | "How do you feel", only when the watch gives no readiness: wrecked / tired / great | +4 / +2 / -1 |
 * | HRV status low                          | +2 |
 * | Training status overreaching (ACWR > 1.5) | +3 |
 * | Last night under 6 h / under 7 h        | +2 / +1 |
 * | Sleep debt (7 nights) 3 h or more / 90 min or more | +2 / +1 |
 * | Yesterday's strain 15 or more / 12 or more | +2 / +1 |
 * | Two days in a row at strain 12 or more (yesterday and the day before) | +1 |
 * | Watch recovery time left over 24 h / over 12 h | +2 / +1 |
 * | Active on each of the last 5 days       | +3 |
 *
 * Bands: 6 or more exhausted (rest), 4 to 5 tired (easier or active rest), 2 to 3 ok (the plan at 85 %), 0 or 1 fresh
 * (the plan as written). A hard session is never placed the day after a hard day (yesterday's strain 14 or more): it is
 * made an easy one. A signal that is not known adds nothing; with no signal at all the suggestion says so.
 */

export type ReadinessWord = 'Primed' | 'Balanced' | 'Strained' | 'Run down';

export interface SuggestionInput {
  /** The watch's readiness; null with no watch or no night of data yet. */
  readiness: ReadinessWord | null;
  /** What the person said about today, used only while `readiness` is null. */
  feel: Feel | null;
  load: { status: TrainingStatus; ratio: number } | null;
  hrv: 'balanced' | 'unbalanced' | 'low' | null;
  lastNightMin: number | null;
  sleepDebtMin: number | null;
  strainYesterday: number | null;
  strainDayBefore: number | null;
  /** Days in a row, ending yesterday, with strain 8 or more. */
  activeStreak: number;
  recoveryHoursLeft: number | null;
  /** A workout (any sport) already finished today, with its strain when known. */
  trainedToday: { strain: number | null } | null;
  /** The sport people did most in the last 14 days, for a plan-less suggestion. */
  usualSport: 'run' | 'walk' | 'ride' | 'strength' | null;
  /** Today's planned session when it is not done yet; null on a rest day or when it is done. */
  planned: PlannedSession | null;
  /** The planned session of today is already done or skipped. */
  plannedDone: boolean;
  /** A session of this week before today that was neither done nor skipped, if any (the oldest). */
  missed: PlannedSession | null;
  /** The plan ended before today or has not started yet. */
  planState: 'none' | 'active' | 'finished' | 'upcoming';
}

export type ReasonCode =
  | 'readinessRunDown'
  | 'readinessStrained'
  | 'readinessPrimed'
  | 'feelWrecked'
  | 'feelTired'
  | 'feelGreat'
  | 'hrvLow'
  | 'overreaching'
  | 'sleepShort'
  | 'sleepDebt'
  | 'strainYesterday'
  | 'hardStreak'
  | 'recoveryLeft'
  | 'activeStreak'
  | 'afterHardDay'
  | 'planRestDay'
  | 'planDone'
  | 'trainedToday'
  | 'catchUp'
  | 'noSignal';

export interface Reason {
  code: ReasonCode;
  /** Fatigue points it added (negative: it lowered the total); 0 for plan notes. */
  points: number;
  /** Numbers for the sentence. */
  values: Record<string, number>;
}

export type Band = 'fresh' | 'ok' | 'tired' | 'exhausted';

/** What to do today, after the band has had its say. */
export interface Effective {
  type: SessionType | 'walk' | 'mobility';
  minutes: number;
  zone: HrZone | null;
}

export type SuggestionKind =
  | 'session'
  | 'sessionScaled'
  | 'sessionEasier'
  | 'catchUp'
  | 'free'
  | 'activeRest'
  | 'rest'
  | 'trainedToday'
  | 'planDone'
  | 'planRestDay'
  | 'planFinished';

export interface Suggestion {
  kind: SuggestionKind;
  /** The planned session this refers to, as written in the plan. */
  session: PlannedSession | null;
  effective: Effective | null;
  /** Percent of the planned volume (minutes, sets) kept today. */
  scalePct: number;
  fatigue: number;
  band: Band;
  /** What added up to the band, biggest first, then plan notes. */
  reasons: Reason[];
}

const EXHAUSTED = 6;
const TIRED = 4;
const OK = 2;
const HARD_STRAIN = 14;

export function fatigueReasons(input: SuggestionInput): Reason[] {
  const reasons: Reason[] = [];
  const add = (code: ReasonCode, points: number, values: Record<string, number> = {}) => reasons.push({ code, points, values });

  if (input.readiness === 'Run down') add('readinessRunDown', 3);
  else if (input.readiness === 'Strained') add('readinessStrained', 2);
  else if (input.readiness === 'Primed') add('readinessPrimed', -1);
  else if (input.readiness === null) {
    if (input.feel === 'wrecked') add('feelWrecked', 4);
    else if (input.feel === 'tired') add('feelTired', 2);
    else if (input.feel === 'great') add('feelGreat', -1);
  }

  if (input.hrv === 'low') add('hrvLow', 2);
  if (input.load?.status === 'overreaching') add('overreaching', 3, { ratio: input.load.ratio });

  if (input.lastNightMin !== null) {
    if (input.lastNightMin < 360) add('sleepShort', 2, { minutes: input.lastNightMin });
    else if (input.lastNightMin < 420) add('sleepShort', 1, { minutes: input.lastNightMin });
  }
  if (input.sleepDebtMin !== null) {
    if (input.sleepDebtMin >= 180) add('sleepDebt', 2, { minutes: input.sleepDebtMin });
    else if (input.sleepDebtMin >= 90) add('sleepDebt', 1, { minutes: input.sleepDebtMin });
  }

  const y = input.strainYesterday;
  if (y !== null) {
    if (y >= 15) add('strainYesterday', 2, { strain: y });
    else if (y >= 12) add('strainYesterday', 1, { strain: y });
    if (y >= 12 && (input.strainDayBefore ?? 0) >= 12) add('hardStreak', 1, { strain: y });
  }

  if (input.recoveryHoursLeft !== null) {
    if (input.recoveryHoursLeft > 24) add('recoveryLeft', 2, { hours: input.recoveryHoursLeft });
    else if (input.recoveryHoursLeft > 12) add('recoveryLeft', 1, { hours: input.recoveryHoursLeft });
  }
  if (input.activeStreak >= 5) add('activeStreak', 3, { days: input.activeStreak });
  return reasons;
}

export function bandOf(fatigue: number): Band {
  if (fatigue >= EXHAUSTED) return 'exhausted';
  if (fatigue >= TIRED) return 'tired';
  if (fatigue >= OK) return 'ok';
  return 'fresh';
}

const roundTo5 = (minutes: number): number => Math.max(10, Math.round(minutes / 5) * 5);

/** A hard session turned easy: the same time cut to 70 % (at most 40 minutes), zone 2. */
function easierRun(session: PlannedSession): Effective {
  return { type: 'easy', minutes: Math.min(40, roundTo5(session.minutes * 0.7)), zone: 2 };
}

/** The reasons a person reads: signals that raised the fatigue, biggest first, then the rest. */
function sorted(reasons: Reason[]): Reason[] {
  return [...reasons].sort((a, b) => b.points - a.points);
}

export function suggest(input: SuggestionInput): Suggestion {
  const base = fatigueReasons(input);
  const fatigue = base.reduce((sum, r) => sum + r.points, 0);
  const band = bandOf(fatigue);
  const known = base.length > 0 || input.readiness !== null || input.lastNightMin !== null || input.feel !== null;
  const reasons = sorted(base);
  const withNote = (...notes: Reason[]): Reason[] => [...sorted(base), ...notes];
  const none: Suggestion = { kind: 'free', session: null, effective: null, scalePct: 100, fatigue, band, reasons };

  if (input.planState === 'finished') {
    return { ...none, kind: 'planFinished', reasons: withNote({ code: 'planDone', points: 0, values: {} }) };
  }

  if (input.trainedToday) {
    return { ...none, kind: 'trainedToday', reasons: withNote({ code: 'trainedToday', points: 0, values: { strain: input.trainedToday.strain ?? 0 } }) };
  }

  if (band === 'exhausted') {
    return { ...none, kind: 'rest', effective: null, session: input.planned, scalePct: 0 };
  }

  const yesterdayHard = (input.strainYesterday ?? 0) >= HARD_STRAIN;

  if (input.planned) {
    const session = input.planned;
    if (band === 'tired') {
      if (session.kind === 'run') {
        return { ...none, kind: 'sessionEasier', session, effective: easierRun(session), scalePct: 70, reasons: sorted(base) };
      }
      return { ...none, kind: 'activeRest', session, effective: { type: 'mobility', minutes: 20, zone: null }, scalePct: 0, reasons: sorted(base) };
    }
    if (session.hard && yesterdayHard && session.kind === 'run') {
      return {
        ...none,
        kind: 'sessionEasier',
        session,
        effective: easierRun(session),
        scalePct: 70,
        reasons: withNote({ code: 'afterHardDay', points: 0, values: { strain: input.strainYesterday ?? 0 } }),
      };
    }
    if (band === 'ok') {
      const scalePct = 85;
      const effective: Effective | null =
        { type: session.type, minutes: roundTo5((session.minutes * scalePct) / 100), zone: session.run?.zone ?? null };
      return { ...none, kind: 'sessionScaled', session, effective, scalePct, reasons: sorted(base) };
    }
    const effective: Effective | null = { type: session.type, minutes: session.minutes, zone: session.run?.zone ?? null };
    return { ...none, kind: 'session', session, effective, scalePct: 100, reasons: sorted(base) };
  }

  if (input.plannedDone) {
    return { ...none, kind: 'planDone', reasons: withNote({ code: 'planDone', points: 0, values: {} }) };
  }

  if (input.planState === 'active') {
    // A rest day of the plan. A missed session may be caught up on a day when you are fresh and yesterday was not hard.
    if (input.missed && band === 'fresh' && !yesterdayHard) {
      const session = input.missed;
      const effective: Effective | null = { type: session.type, minutes: session.minutes, zone: session.run?.zone ?? null };
      return { ...none, kind: 'catchUp', session, effective, scalePct: 100, reasons: withNote({ code: 'catchUp', points: 0, values: {} }) };
    }
    return { ...none, kind: 'planRestDay', reasons: withNote({ code: 'planRestDay', points: 0, values: {} }) };
  }

  // No plan (or one that has not started): a suggestion from the state of the body alone.
  if (band === 'tired') {
    return { ...none, kind: 'activeRest', effective: { type: 'walk', minutes: 30, zone: 1 }, scalePct: 0 };
  }
  if (!known) {
    // No body data at all (no watch, nothing said today): someone who lifts is not handed a run.
    const effective: Effective =
      input.usualSport === 'strength' ? { type: 'strength', minutes: 40, zone: null } : { type: 'easy', minutes: 30, zone: 2 };
    return { ...none, kind: 'free', effective, scalePct: 100, reasons: [{ code: 'noSignal', points: 0, values: {} }] };
  }
  const foot = input.usualSport === 'run' || input.usualSport === null;
  if (input.usualSport === 'strength') {
    return { ...none, kind: 'free', effective: { type: 'strength', minutes: band === 'ok' ? 30 : 40, zone: null }, scalePct: 100 };
  }
  const minutes = band === 'ok' ? 30 : 40;
  return {
    ...none,
    kind: 'free',
    effective: foot ? { type: 'easy', minutes, zone: 2 } : { type: 'walk', minutes, zone: 2 },
    scalePct: 100,
  };
}
