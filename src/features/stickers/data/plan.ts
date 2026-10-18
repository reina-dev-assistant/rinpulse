import type { PlanGoal } from '@/features/coach/doc';
import type { SessionType, WeekPhase } from '@/features/coach/plans/types';
import type { JsonObject, StickerKind, StickerSubject } from '@/features/stickers/subject';
import { fmtDistance, getT, type Locale } from '@/i18n';

/** The session the plan asks for next. */
export interface PlanNextSession {
  type: SessionType;
  /** `PlannedSession.run.distanceM`: the race distance of a `race` session, else null. */
  distanceM: number | null;
  /** `PlannedSession.strength.focus` of a strength session, else null. */
  focus: 'A' | 'B' | 'C' | null;
}

/**
 * What the share sheet needs of the active coach plan. The host maps the coach objects like this
 * (`plan` = `CoachDoc.plan`, `p` = `planProgress(plan, doc.done, today)`, `weeks` = `p.weeks`):
 *
 * - `planId`   = `plan.id`; `goal` = `plan.goal`.
 * - `week`     = `p.weekIndex + 1` (1-based, clamped to the plan); `weeks` = `plan.weeks`.
 * - `phase`    = `p.weeks[p.weekIndex].phase`.
 * - `total`    = counted sessions of the WHOLE plan: `allSessions(p.weeks).filter((s) => !s.beforeStart).length`.
 * - `done`     = how many of those are done: counted sessions whose `doneEntry` exists and is not `skipped`
 *                (use `liveDone(doc.done)` so cleared marks do not count). `p.doneSoFar` is only "up to today"; use the whole plan.
 * - `weekComplete` = `p.plannedThisWeek > 0 && p.doneThisWeek >= p.plannedThisWeek` (offers the badge sticker).
 * - `next`     = `p.upcoming[0]` (first not-done session from today on) as `{ type, distanceM: run?.distanceM ?? null,
 *                focus: strength?.focus ?? null }`, or null when nothing is left.
 * - `nowMs`    = the moment of sharing.
 */
export interface PlanShareInput {
  planId: string;
  goal: PlanGoal;
  /** 1-based week of today. */
  week: number;
  weeks: number;
  phase: WeekPhase;
  done: number;
  total: number;
  weekComplete: boolean;
  next: PlanNextSession | null;
  nowMs: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** "Lari santai", "Lari 5 km", "Full body A": the coach's own session titles, in the pinned language. */
function nextLabel(next: PlanNextSession, locale: Locale): string {
  const coach = getT(locale, 'coach');
  if (next.type === 'race') return coach('type.race', { distance: fmtDistance(next.distanceM && next.distanceM > 0 ? next.distanceM : 5000, locale) });
  if (next.type === 'strength' && next.focus) return coach('type.strengthFocus', { focus: next.focus });
  return coach(`type.${next.type}`);
}

/**
 * The coach plan as a sticker subject. Returns `null` when the plan has no counted session (`total` is 0 or not a number),
 * since progress would be meaningless. `plan.nextLabel` is absent when `next` is null.
 */
export function buildPlanSubject(input: PlanShareInput, locale: Locale): StickerSubject | null {
  if (!finite(input.total) || input.total < 1 || !finite(input.nowMs)) return null;
  const t = getT(locale, 'stickerdata');
  const coach = getT(locale, 'coach');

  const total = Math.floor(input.total);
  const done = finite(input.done) ? Math.min(total, Math.max(0, Math.floor(input.done))) : 0;
  const weeks = finite(input.weeks) ? Math.max(1, Math.floor(input.weeks)) : 1;
  const week = finite(input.week) ? Math.min(weeks, Math.max(1, Math.floor(input.week))) : 1;
  const progress = Math.round((done / total) * 1000) / 1000;
  const name = coach(`plan.name.${input.goal}`);

  const plan: JsonObject = {
    name,
    goal: t(`plan.goal.${input.goal}`),
    week,
    weeks,
    progress,
    done,
    total,
    phase: t(`plan.phase.${input.phase}`),
  };
  if (input.next) plan.nextLabel = nextLabel(input.next, locale);

  const kinds: StickerKind[] = ['plan'];
  const data: JsonObject = { plan };
  if (input.weekComplete) {
    kinds.push('badge');
    data.milestone = {
      kind: 'plan',
      title: t('plan.weekDone', { week }),
      subtitle: name,
      value: Math.round(progress * 100),
      unit: '%',
    };
  }

  return {
    id: `plan:${input.planId}:${week}`,
    kinds,
    heading: t('plan.heading'),
    caption: getT(locale, 'sharing')('share.caption'),
    date: input.nowMs,
    data,
  };
}
