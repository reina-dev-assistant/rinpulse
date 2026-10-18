import type { CoachState } from '../useCoach';
import { liveDone } from '../doc';
import { feelReadiness } from '../feel';
import { headlineText, reasonText, sessionTitle } from '../format';

/**
 * What the phone tells the chat about the person: the same numbers Coach computes (`signals.ts`), the suggestion Today shows,
 * the plan and the last two weeks of workouts. Shape and caps mirror `coachSnapshotSchema` on JoyoRogo
 * (`packages/api/src/lib/coach-chat.ts`); change both together. Nothing here is stored by the server.
 */
export interface CoachSnapshot {
  generatedAt: number;
  today: string;
  readiness: { headline: 'Primed' | 'Balanced' | 'Strained' | 'Run down' | null } | null;
  load: { status: 'productive' | 'maintaining' | 'recovery' | 'overreaching' | 'detraining'; ratio: number } | null;
  hrv: { state: 'balanced' | 'unbalanced' | 'low'; recentMs: number; baselineMs: number } | null;
  sleep: { lastNightMin: number | null; debtMin: number | null; needTonightMin: number | null } | null;
  strain: { yesterday: number | null; today: number | null; avg7: number | null } | null;
  restingHr: number | null;
  vo2max: number | null;
  suggestion: { kind: string; text: string; why: string } | null;
  plan: {
    goal: string;
    level: string;
    daysPerWeek: number;
    week: number;
    weeks: number;
    doneThisWeek: number;
    plannedThisWeek: number;
    scalePct: number;
    next: { date: string; title: string }[];
  } | null;
  workouts: { start: number; sport: string; durationMin: number; distanceKm: number | null; avgHr: number | null; strain: number | null; matchedPlan: boolean }[];
}

const DAY_SEC = 86400;
const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

export function buildSnapshot(coach: CoachState): CoachSnapshot {
  const { signals, progress, suggestion, data, doc } = coach;
  const matched = new Set(
    Object.values(liveDone(doc.done))
      .map((entry) => entry.workoutStart)
      .filter((start): start is number => start !== null),
  );
  const why = suggestion.reasons.filter((r) => r.points > 0).map(reasonText).join(' ');
  return {
    generatedAt: data.nowSec,
    today: coach.today,
    readiness: { headline: signals.readiness ?? (coach.feel ? feelReadiness(coach.feel) : null) },
    load: signals.load ? { status: signals.load.status, ratio: signals.load.ratio } : null,
    hrv: signals.hrv,
    sleep: { lastNightMin: signals.lastNightMin, debtMin: signals.sleepDebtMin, needTonightMin: null },
    strain: { yesterday: signals.strainYesterday, today: signals.strainToday, avg7: signals.strain7 },
    restingHr: signals.restingHr,
    vo2max: signals.vo2max,
    suggestion: { kind: suggestion.kind, text: cut(headlineText(suggestion), 300), why: cut(why, 300) },
    plan: progress
      ? {
          goal: progress.plan.goal,
          level: progress.plan.level,
          daysPerWeek: progress.plan.daysPerWeek,
          week: progress.weekIndex + 1,
          weeks: progress.plan.weeks,
          doneThisWeek: progress.doneThisWeek,
          plannedThisWeek: progress.plannedThisWeek,
          scalePct: progress.weeks[progress.weekIndex]?.scalePct ?? 100,
          next: progress.upcoming.slice(0, 4).map((s) => ({ date: s.day, title: cut(sessionTitle(s), 80) })),
        }
      : null,
    workouts: data.workouts
      .filter(({ workout }) => workout.start >= data.nowSec - 14 * DAY_SEC)
      .slice(0, 10)
      .map(({ workout }) => ({
        start: workout.start,
        sport: cut(workout.sportName, 40),
        durationMin: Math.round(workout.duration / 60),
        distanceKm: workout.distance > 0 ? Math.round(workout.distance / 10) / 100 : null,
        avgHr: workout.avgHr,
        strain: null,
        matchedPlan: matched.has(workout.start),
      })),
  };
}
