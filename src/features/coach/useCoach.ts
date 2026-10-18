import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo } from 'react';

import { useFitnessData, type FitnessData } from '@/features/fitness/useFitnessData';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { reconcileCoach } from './actions';
import type { Feel } from './feel';
import { strengthLinks } from './links';
import type { CoachDoc } from './doc';
import { planProgress, type PlanProgress } from './progress';
import { computeSignals, type CoachSignals } from './signals';
import { loadCoachDoc, useCoachDoc } from './store';
import { suggest, type Suggestion, type SuggestionInput } from './suggest';
import { localDay } from './time';
import { useFeel } from './useFeel';

export interface CoachState {
  /** Everything below is null until the stored document and the body data are both read. */
  doc: CoachDoc;
  data: FitnessData;
  signals: CoachSignals;
  progress: PlanProgress | null;
  suggestion: Suggestion;
  today: string;
  /** The watch gave no readiness today, so the suggestion leans on how the person says they feel (`feel`, null until they answer). */
  needsFeel: boolean;
  feel: Feel | null;
  setFeel: (feel: Feel | null) => void;
}

/** What `suggest` reads, from the body signals and the plan. */
export function suggestionInput(signals: CoachSignals, progress: PlanProgress | null, feel: Feel | null): SuggestionInput {
  const planned = progress?.today && !progress.todayDone && progress.state === 'active' ? progress.today : null;
  return {
    readiness: signals.readiness,
    feel,
    load: signals.load ? { status: signals.load.status, ratio: signals.load.ratio } : null,
    hrv: signals.hrv?.state ?? null,
    lastNightMin: signals.lastNightMin,
    sleepDebtMin: signals.sleepDebtMin,
    strainYesterday: signals.strainYesterday,
    strainDayBefore: signals.strainDayBefore,
    activeStreak: signals.activeStreak,
    recoveryHoursLeft: signals.recoveryHoursLeft,
    trainedToday: signals.trainedToday,
    usualSport: signals.usualSport,
    planned,
    plannedDone: progress?.todayDone != null && !progress.todayDone.skipped,
    missed: progress?.missed ?? null,
    planState: progress ? progress.state : 'none',
  };
}

/**
 * The coach for the screen on show: reads the stored document and the body data, matches new workouts to plan sessions
 * and decides the weeks that have started (once per data version), and answers with the suggestion for today.
 * Null until both reads are in.
 */
export function useCoach(dataVersion: number, availability: NightHrvAvailability | null): CoachState | null {
  const db = useSQLiteContext();
  const doc = useCoachDoc();
  const { data } = useFitnessData(dataVersion, 'full');
  const { feel, setFeel } = useFeel();

  useEffect(() => {
    void loadCoachDoc(db).catch(() => {});
  }, [db]);

  const signals = useMemo(() => (data ? computeSignals(data, availability) : null), [data, availability]);
  const planId = doc?.plan?.id ?? null;

  useEffect(() => {
    if (!data || !signals || planId === null) return;
    const workouts = data.workouts.map(({ workout, summary }) => ({
      start: workout.start,
      duration: workout.duration,
      distance: workout.distance,
      sportName: workout.sportName,
      summaryKind: summary.kind,
    }));
    const signalsNow = { load: signals.load, hrv: signals.hrv?.state ?? null, readiness: signals.readiness, sleepDebtMin: signals.sleepDebtMin };
    const plan = doc?.plan;
    void (plan ? strengthLinks(db, plan).catch(() => ({})) : Promise.resolve({}))
      .then((links) => reconcileCoach(db, workouts, signalsNow, links))
      .catch(() => {});
  }, [db, data, signals, planId, doc?.plan]);

  return useMemo(() => {
    if (!doc || !data || !signals) return null;
    const today = localDay(data.nowSec);
    const progress = doc.plan ? planProgress(doc.plan, doc.done, today) : null;
    const suggestion = suggest(suggestionInput(signals, progress, feel));
    return { doc, data, signals, progress, suggestion, today, needsFeel: signals.readiness === null, feel, setFeel };
  }, [doc, data, signals, feel, setFeel]);
}
