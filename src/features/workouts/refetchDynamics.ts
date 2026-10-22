import type { WorkoutRefetchOutcome, WorkoutRefetchReport } from '@/wear';

import { sportKind } from './analysis/sport';
import type { WorkoutSummary } from './summary';

/**
 * "Ambil ulang dari jam": runs and walks that were synced before the app kept the running dynamics can ask the watch for their
 * samples again (`HuaweiWear.refetchWorkoutData`, native; `WorkoutSync.refetchDynamics` / `WorkoutSync.swift`). The watch only
 * has what it has not rolled off, so the answer is counted per workout: updated, already complete, still on the watch without
 * dynamics, no longer on the watch, failed. This file is the part with no native or screen in it.
 */

/** The means a watch run gets from the dynamics sync, other than the contact-time mean the older sync already kept (and polluted with zeros). */
const FORM_MEANS = ['avgVerticalOscillation', 'avgVerticalRatio', 'avgGroundContactBalance', 'avgHangTimeMs'] as const;

/** True when the summary has no running form beyond the old contact-time mean: no per-minute series and none of the four newer means. */
export function lacksDynamics(summary: WorkoutSummary): boolean {
  if (summary.dynamics && typeof summary.dynamics === 'object') return false;
  const samples = summary.samples;
  return !samples || FORM_MEANS.every((key) => typeof samples[key] !== 'number');
}

/** The part of a stored workout the choice needs. */
export interface RefetchRow {
  start: number;
  sportName: string;
  summary: WorkoutSummary;
}

/**
 * A run or walk the watch recorded that has no running form yet and has not been tried: the watch may still hold it. A phone recording,
 * a workout of another kind and one a refetch already found without dynamics or gone from the watch are not offered again.
 */
export function canRefetch(row: RefetchRow, tried: ReadonlySet<number>): boolean {
  if (row.summary.source === 'phone' || tried.has(row.start)) return false;
  const kind = sportKind(row.sportName, row.summary.kind);
  return (kind === 'run' || kind === 'walk') && lacksDynamics(row.summary);
}

/** What the controls need to know about the native side and the link. */
export interface RefetchAvailability {
  /** The installed binary has `refetchWorkoutData` (older builds do not). */
  native: boolean;
  /** The link is up and idle (not syncing, not connecting). */
  connected: boolean;
  /** The watch the link is up to (`DeviceInfo.address`), null when none. */
  address: string | null;
  /** The watch that recorded the workout (`workouts.device`), null for a phone recording, an import or a row from before the attribution. */
  workoutDevice: string | null;
}

/** Whether to show the action for a workout: the function exists, the connected watch is the one that recorded it, and it is a candidate. */
export function showsRefetch(availability: RefetchAvailability, row: RefetchRow, tried: ReadonlySet<number>): boolean {
  const { native, connected, address, workoutDevice } = availability;
  return native && connected && address !== null && workoutDevice === address && canRefetch(row, tried);
}

export interface RefetchTotals {
  requested: number;
  updated: number;
  unchanged: number;
  noDynamics: number;
  gone: number;
  failed: number;
}

export const EMPTY_TOTALS: RefetchTotals = { requested: 0, updated: 0, unchanged: 0, noDynamics: 0, gone: 0, failed: 0 };

export interface RefetchProgress {
  done: number;
  total: number;
}

export interface RefetchRun {
  totals: RefetchTotals;
  /** Per start, for the ones the watch answered about. */
  outcomes: Map<number, WorkoutRefetchOutcome>;
  /** The error that ended the run early (the link dropped, a timeout), null when every workout was asked about. */
  error: unknown;
}

export interface RefetchApi {
  refetchWorkoutData(starts: number[]): Promise<WorkoutRefetchReport>;
}

const COUNT_KEY: Record<WorkoutRefetchOutcome, keyof Omit<RefetchTotals, 'requested'>> = {
  updated: 'updated',
  unchanged: 'unchanged',
  no_dynamics: 'noDynamics',
  gone: 'gone',
  failed: 'failed',
};

/**
 * Asks the watch about `starts` one workout at a time, so the person sees "3 of 12" and a dropped link keeps what was done. A call that
 * throws ends the run: the totals so far and the error come back. `shouldStop` is read between workouts.
 */
export async function refetchRuns(
  starts: readonly number[],
  api: RefetchApi,
  onProgress?: (progress: RefetchProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<RefetchRun> {
  const totals: RefetchTotals = { ...EMPTY_TOTALS };
  const outcomes = new Map<number, WorkoutRefetchOutcome>();
  let error: unknown = null;
  onProgress?.({ done: 0, total: starts.length });
  for (const [index, start] of starts.entries()) {
    if (shouldStop()) break;
    try {
      const report = await api.refetchWorkoutData([start]);
      for (const result of report.results) {
        const key = COUNT_KEY[result.outcome];
        if (key === undefined) continue;
        totals[key] += 1;
        totals.requested += 1;
        outcomes.set(result.start, result.outcome);
      }
    } catch (e) {
      error = e;
      break;
    }
    onProgress?.({ done: index + 1, total: starts.length });
  }
  return { totals, outcomes, error };
}

/** The starts to remember as tried: the ones the watch holds without dynamics and the ones it no longer holds. A failed one may work next time. */
export function settledStarts(run: RefetchRun): number[] {
  return [...run.outcomes].filter(([, outcome]) => outcome === 'no_dynamics' || outcome === 'gone').map(([start]) => start);
}

/** The stored list of tried starts; a damaged value is an empty list, never an error. */
export function parseTried(raw: string | null): Set<number> {
  try {
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []);
  } catch {
    return new Set();
  }
}

/** The pieces of the result sentence, in the order they are read, each with its count; zero counts left out. */
export function resultParts(totals: RefetchTotals): { key: 'updated' | 'unchanged' | 'noDynamics' | 'gone' | 'failed'; count: number }[] {
  return (['updated', 'unchanged', 'noDynamics', 'gone', 'failed'] as const)
    .map((key) => ({ key, count: totals[key] }))
    .filter((part) => part.count > 0);
}
