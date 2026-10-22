import type { SQLiteDatabase } from 'expo-sqlite';

import { loadBalance, MIN_LOAD_DAYS } from '@/features/fitness/trainingLoad';
import { liveDone } from '@/features/coach/doc';
import { sessionTitle } from '@/features/coach/format';
import { addDays, localDay } from '@/features/coach/time';
import type { CoachState } from '@/features/coach/useCoach';
import { MIN_BASELINE_READINGS } from '@/features/today/recovery';
import { startOfLocalDay } from '@/features/today/stats';
import { BASE_SLEEP_NEED_SEC } from '@/features/today/readiness';
import { DIGEST_DAYS, type DigestSource, type DigestState, type DigestWorkout } from '../digest';
import type { CoachNote } from '../memory';
import type { Person } from '../person';
import type { PlanInfo, ToolData } from '../tools';
import { noMark, type Mark } from '../timing';
import { DEFAULT_STEP_GOAL } from '@/features/today/stepGoal';
import { HuaweiWear } from '@/wear';
import { readDailyRows, readSleepNight, readWorkoutDetail, readWorkouts } from './localData';
import { createRogoData } from './rogoData';

/** `2026-10-22T07:41+07:00`: the phone's local time with its offset, so the model reads "today" the way the person does. */
export function localIso(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}${sign}${p(Math.floor(Math.abs(offset) / 60))}:${p(Math.abs(offset) % 60)}`;
}

/** The title of the plan session a workout was matched to, from the coach document. */
function planTitles(coach: CoachState): (start: number) => string | null {
  const byStart = new Map<number, string>();
  if (coach.progress) {
    const done = liveDone(coach.doc.done);
    for (const week of coach.progress.weeks) {
      for (const session of week.sessions) {
        const start = done[session.key]?.workoutStart;
        if (typeof start === 'number') byStart.set(start, sessionTitle(session));
      }
    }
  }
  return (start) => byStart.get(start) ?? null;
}

function planInfo(coach: CoachState): PlanInfo | null {
  const p = coach.progress;
  if (!p) return null;
  return {
    goal: p.plan.goal,
    level: p.plan.level,
    week: p.weekIndex + 1,
    weeks: p.plan.weeks,
    done: p.doneThisWeek,
    planned: p.plannedThisWeek,
    scalePct: p.weeks[p.weekIndex]?.scalePct ?? 100,
    next: p.upcoming.slice(0, 4).map((s) => ({ date: s.day, title: sessionTitle(s) })),
  };
}

/** The tools' view of the phone and of JoyoRogo. Created per conversation so the JoyoRogo answers are cached only that long. */
export function createToolData(db: SQLiteDatabase, coach: CoachState | null): ToolData {
  const rogoData = createRogoData();
  const titles = coach ? planTitles(coach) : () => null;
  return {
    today: () => localDay(Math.floor(Date.now() / 1000)),
    daily: (from, to) => readDailyRows(db, from, to),
    weights: (from, to) => rogoData.weights(from, to),
    food: (from, to) => rogoData.food(from, to),
    sleepNight: (date) => readSleepNight(db, date),
    workouts: (from, to, sport) => readWorkouts(db, from, to, sport, titles),
    workout: (id) => readWorkoutDetail(db, id),
    plan: async () => (coach ? planInfo(coach) : null),
  };
}

function digestState(coach: CoachState): DigestState {
  const { signals, data } = coach;
  const nightDays = new Set(data.hrv.filter((r) => r.source === 'night').map((r) => startOfLocalDay(r.end))).size;
  const load = loadBalance(data.strain, data.dayStart);
  return {
    readiness: signals.readiness ? { word: signals.readiness } : { status: 'calibrating', nightsHave: Math.min(nightDays, MIN_BASELINE_READINGS), nightsNeed: MIN_BASELINE_READINGS },
    load: signals.load
      ? { status: signals.load.status, ratio: signals.load.ratio }
      : { status: 'calibrating', daysHave: load.daysWithData, daysNeed: MIN_LOAD_DAYS },
    hrv: signals.hrv,
    sleepDebtMin: signals.sleepDebtMin,
    strainAvg7: signals.strain7,
    vo2max: signals.vo2max,
    recoveryHoursLeft: signals.recoveryHoursLeft,
  };
}

export interface GatherInput {
  db: SQLiteDatabase;
  coach: CoachState;
  person: Person;
  notes: readonly CoachNote[];
  signedIn: boolean;
  locale: 'id' | 'en';
  tools: ToolData;
  mark?: Mark;
}

/**
 * Gathers the digest source for one question: the last 14 days from the phone, the state Readiness and Coach show, the recent
 * workouts, the plan, the notes, and food and weight from JoyoRogo when signed in. Each JoyoRogo failure leaves that part null and
 * is named in `coverage.missing`, so the model says "I don't see your food" instead of guessing.
 */
export async function gatherDigestSource(input: GatherInput): Promise<DigestSource> {
  const { coach, person, tools } = input;
  const today = coach.today;
  const from = addDays(today, -(DIGEST_DAYS - 1));
  const missing: string[] = [];
  const mark = input.mark ?? noMark;
  // The phone's database and JoyoRogo are read at the same time; the question waits for the slower of the two.
  const rogoPart = input.signedIn
    ? Promise.all([tools.food(from, today).catch(() => null), tools.weights(from, today).catch(() => null)]).then((r) => {
        mark('gather-rogo');
        return r;
      })
    : Promise.resolve(null);
  const [rows, rogo, workoutRows] = await Promise.all([
    tools.daily(from, today).then((r) => {
      mark('gather-days');
      return r;
    }),
    rogoPart,
    tools.workouts(addDays(today, -13), today, null).then((r) => {
      mark('gather-workouts');
      return r;
    }),
  ]);

  let foodDays = 0;
  let weighIns = 0;
  if (!input.signedIn || rogo === null) {
    missing.push('food and weight: not signed in to JoyoRogo');
  } else {
    const [food, weights] = rogo;
    const byDay = new Map(rows.map((r) => [r.d, r]));
    if (food === null) missing.push('food: JoyoRogo did not answer');
    else if (food !== 'not_connected') {
      for (const f of food) {
        const row = byDay.get(f.d);
        if (row && f.logged) {
          row.eatKcal = f.kcal;
          row.proteinG = f.proteinG;
          foodDays += 1;
        }
      }
    }
    if (weights === null) missing.push('weight: JoyoRogo did not answer');
    else if (weights !== 'not_connected') {
      for (const [d, kg] of weights) {
        const row = byDay.get(d);
        if (row) {
          row.weightKg = kg;
          weighIns += 1;
        }
      }
    }
  }

  const profile = HuaweiWear.getUserProfile();
  const workouts: DigestWorkout[] = workoutRows.slice(0, 10);
  const plan = planInfo(coach);
  return {
    now: localIso(new Date()),
    locale: input.locale,
    person,
    goals: { stepsPerDay: profile?.dailyStepGoal ?? DEFAULT_STEP_GOAL, stepsIsDefault: !profile?.dailyStepGoal, sleepNeedMin: BASE_SLEEP_NEED_SEC / 60 },
    state: digestState(coach),
    days: rows,
    workouts,
    plan: plan ? { goal: plan.goal, level: plan.level, week: plan.week, weeks: plan.weeks, done: plan.done, planned: plan.planned, scalePct: plan.scalePct } : null,
    notes: input.notes,
    coverage: { watchDays: rows.filter((r) => r.sleepMin !== null || r.restBpm !== null || r.steps !== null).length, foodDays, weighIns, missing },
  };
}
