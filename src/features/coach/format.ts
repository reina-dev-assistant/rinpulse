import { t, fmtDecimal, fmtDistance, fmtDuration, fmtInt } from '@/i18n';
import { zoneThresholds } from '@/features/today/strain';
import type { PlannedExercise, PlannedSession, SessionType } from './plans/types';
import type { Effective, Reason, Suggestion } from './suggest';

/** "90 dtk" below two minutes that are not whole, else "3 mnt". */
export function spanText(sec: number): string {
  if (sec % 60 === 0) return t('coach:unit.min', { value: fmtInt(sec / 60) });
  return t('coach:unit.sec', { value: fmtInt(sec) });
}

/** The bpm range of heart-rate zone `zone` (1..5) at `maxHr`. */
export function zoneBpm(zone: number, maxHr: number): { from: number; to: number } {
  const lows = zoneThresholds(maxHr);
  const from = lows[zone - 1] ?? maxHr;
  const to = zone >= 5 ? maxHr : (lows[zone] ?? maxHr) - 1;
  return { from, to };
}

/** One line for what to do: "Lari santai 30 menit, zona 2". `session` supplies the structure of tempo, interval and walk/run types. */
export function whatText(effective: Effective, session: PlannedSession | null): string {
  const { minutes, zone } = effective;
  const base = { minutes: fmtInt(minutes), zone: fmtInt(zone ?? 2) };
  const run = session?.run;
  switch (effective.type) {
    case 'tempo':
      return t('coach:what.tempo', { ...base, main: fmtInt(run?.tempo?.mainMin ?? minutes) });
    case 'intervals':
      return t('coach:what.intervals', {
        ...base,
        reps: fmtInt(run?.intervals?.reps ?? 0),
        work: spanText(run?.intervals?.workSec ?? 180),
        rest: spanText(run?.intervals?.restSec ?? 120),
      });
    case 'walkrun':
      return t('coach:what.walkrun', {
        ...base,
        reps: fmtInt(run?.walkRun?.reps ?? 0),
        run: spanText(run?.walkRun?.runSec ?? 60),
        walk: spanText(run?.walkRun?.walkSec ?? 120),
      });
    case 'race':
      return t('coach:what.race', { distance: fmtDistance(run?.distanceM ?? 5000) });
    case 'easy':
    case 'recovery':
    case 'long':
    case 'walk':
    case 'mobility':
    case 'strength':
      return t(`coach:what.${effective.type}`, base);
  }
}

/** The title of a session in a list: "Lari santai", "Interval", "Lari 5 km". */
export function sessionTitle(session: PlannedSession): string {
  const type: SessionType = session.type;
  if (type === 'race') return t('coach:type.race', { distance: fmtDistance(session.run?.distanceM ?? 5000) });
  if (type === 'strength' && session.strength) return t('coach:type.strengthFocus', { focus: session.strength.focus });
  return t(`coach:type.${type}`);
}

/** The sentence for one reason of the suggestion. */
export function reasonText(reason: Reason): string {
  const v = reason.values;
  switch (reason.code) {
    case 'overreaching':
      return t('coach:why.overreaching', { ratio: fmtDecimal(v.ratio ?? 0, 2) });
    case 'sleepShort':
      return t('coach:why.sleepShort', { duration: fmtDuration((v.minutes ?? 0) * 60) });
    case 'sleepDebt':
      return t('coach:why.sleepDebt', { duration: fmtDuration((v.minutes ?? 0) * 60) });
    case 'strainYesterday':
      return t('coach:why.strainYesterday', { strain: fmtDecimal(v.strain ?? 0, 1) });
    case 'recoveryLeft':
      return t('coach:why.recoveryLeft', { hours: fmtInt(Math.round(v.hours ?? 0)) });
    case 'activeStreak':
      return t('coach:why.activeStreak', { days: fmtInt(v.days ?? 0) });
    case 'afterHardDay':
      return t('coach:why.afterHardDay', { strain: fmtDecimal(v.strain ?? 0, 1) });
    case 'readinessRunDown':
    case 'readinessStrained':
    case 'readinessPrimed':
    case 'feelWrecked':
    case 'feelTired':
    case 'feelGreat':
    case 'hrvLow':
    case 'hardStreak':
    case 'planRestDay':
    case 'planDone':
    case 'trainedToday':
    case 'catchUp':
    case 'noSignal':
      return t(`coach:why.${reason.code}`);
  }
}

/** The headline of the suggestion for Today and the Coach screen. */
export function headlineText(suggestion: Suggestion): string {
  const what = suggestion.effective ? whatText(suggestion.effective, suggestion.session) : '';
  return t(`coach:headline.${suggestion.kind}`, { what });
}

/** The one-line explanation under the headline; null when the headline says it all. */
export function bodyText(suggestion: Suggestion): string | null {
  switch (suggestion.kind) {
    case 'sessionScaled':
      return t('coach:body.scaled', { pct: fmtInt(suggestion.scalePct) });
    case 'sessionEasier':
      return t('coach:body.easier');
    case 'rest':
    case 'activeRest':
    case 'trainedToday':
    case 'planDone':
    case 'planRestDay':
    case 'planFinished':
    case 'catchUp':
      return t(`coach:body.${suggestion.kind}`);
    case 'session':
    case 'free':
      return null;
  }
}

/** "3 set x 12 ulangan, istirahat 1,5 mnt" for a planned exercise; `sets` overrides the planned sets (today's scaling). */
export function exerciseLine(exercise: PlannedExercise, sets = exercise.sets): string {
  const rest = spanText(exercise.restSec);
  if (exercise.seconds !== null) return t('coach:session.strength.lineTimed', { sets: fmtInt(sets), seconds: spanText(exercise.seconds), rest });
  return t('coach:session.strength.line', { sets: fmtInt(sets), reps: fmtInt(exercise.reps), rest });
}
