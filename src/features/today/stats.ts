import type { FitnessTotals, SleepSegment, StepSample } from '@/wear';

/** Unix seconds of local midnight for the day containing `nowSec`. */
export function startOfLocalDay(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Totals in the watch's FitnessTotals units: calories in kcal (samples carry small calories). */
export function sumTotals(samples: readonly StepSample[]): FitnessTotals {
  const totals: FitnessTotals = { steps: 0, calories: 0, distance: 0 };
  for (const s of samples) {
    totals.steps += s.steps;
    totals.calories += s.calories;
    totals.distance += s.distance;
  }
  totals.calories = Math.round(totals.calories / 1000);
  return totals;
}

export interface HeartRateStats {
  latest: { bpm: number; timestamp: number };
  min: number;
  max: number;
}

/** Heart-rate summary over samples that carry a reading (non-null, positive); null when none do. */
export function heartRateStats(samples: readonly StepSample[]): HeartRateStats | null {
  let stats: HeartRateStats | null = null;
  for (const s of samples) {
    const bpm = s.heartRate;
    if (bpm === null || bpm <= 0) continue;
    if (!stats) {
      stats = { latest: { bpm, timestamp: s.timestamp }, min: bpm, max: bpm };
      continue;
    }
    if (s.timestamp >= stats.latest.timestamp) stats.latest = { bpm, timestamp: s.timestamp };
    stats.min = Math.min(stats.min, bpm);
    stats.max = Math.max(stats.max, bpm);
  }
  return stats;
}

/** A live reading older than this no longer counts as live (the watch pushes about one a second). */
export const LIVE_FRESH_MS = 20_000;

export interface HeartReading {
  bpm: number;
  /** Unix seconds the reading was taken (stored sample) or received (live). */
  timestamp: number;
  /** Pushed by the watch within {@link LIVE_FRESH_MS}. */
  live: boolean;
}

/**
 * What the hero shows: the live reading while it is fresh, else the newest of the last live reading
 * and the newest stored one; null when there is neither. `live.ts` is unix milliseconds.
 */
export function pickHeartReading(
  live: { bpm: number; ts: number } | null,
  stored: { bpm: number; timestamp: number } | null,
  nowMs: number,
): HeartReading | null {
  const received = live ? { bpm: live.bpm, timestamp: Math.floor(live.ts / 1000) } : null;
  if (live && received && nowMs - live.ts < LIVE_FRESH_MS) return { ...received, live: true };
  const newest = received && (!stored || received.timestamp >= stored.timestamp) ? received : stored;
  return newest ? { bpm: newest.bpm, timestamp: newest.timestamp, live: false } : null;
}

/** Steps summed per local clock hour (index 0..23). */
export function hourlySteps(samples: readonly StepSample[]): number[] {
  const bins = new Array<number>(24).fill(0);
  for (const s of samples) bins[new Date(s.timestamp * 1000).getHours()] += s.steps;
  return bins;
}

/** Segments closer together than this belong to the same sleep session. */
export const SESSION_GAP_SEC = 3 * 3600;

/**
 * A stored segment, plus the one thing only the cleaning step knows (`cleanUnstagedSleep`): a workout or a long awake
 * stretch lies between this segment and the one before it, so it starts a new session however close the two are.
 */
export type SleepSpan = SleepSegment & { breakBefore?: boolean };

/**
 * Drops unstaged segments within {@link SESSION_GAP_SEC} of a staged one: the watch stores short unstaged spans
 * around a staged night, and next to real stages they only stretch it. An unstaged nap far from staged sleep
 * stays. Same rule as `withoutStrayUnstaged` in SleepReport.kt.
 */
export function withoutStrayUnstaged<T extends SleepSegment>(segments: readonly T[]): T[] {
  const staged = segments.filter((s) => s.stage);
  return segments.filter(
    (s) => s.stage || !staged.some((t) => t.start - s.end <= SESSION_GAP_SEC && s.start - t.end <= SESSION_GAP_SEC),
  );
}

/** Sleep within this of other sleep belongs to the same stretch when telling a blip from a nap. */
export const BLIP_GAP_SEC = 3600;

/** A stretch with less sleep than this (awake excluded) is not sleep: a 1-2 minute HRV or stress check, not a short nap. */
export const MIN_SLEEP_SEC = 5 * 60;

/**
 * Drops stretches of sleep (segments chained with gaps up to {@link BLIP_GAP_SEC}) holding less than
 * {@link MIN_SLEEP_SEC} asleep. A watch records a few minutes of sitting still, such as a 1-minute HRV or stress
 * check, as sleep; on its own that became the latest "night" or a nap, and within {@link SESSION_GAP_SEC} of waking it
 * stretched the night. Same rule as `withoutBlips` in SleepReport.kt. Returns the kept segments sorted by start.
 */
export function withoutBlips<T extends SleepSegment>(segments: readonly T[]): T[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: T[] = [];
  let stretch: T[] = [];
  let reach = -Infinity;
  const close = () => {
    const asleep = stretch.reduce((sum, s) => sum + (s.stage === 'awake' ? 0 : Math.max(0, s.end - s.start)), 0);
    if (asleep >= MIN_SLEEP_SEC) kept.push(...stretch);
    stretch = [];
  };
  for (const s of sorted) {
    if (stretch.length > 0 && s.start - reach > BLIP_GAP_SEC) close();
    stretch.push(s);
    reach = stretch.length === 1 ? s.end : Math.max(reach, s.end);
  }
  close();
  return kept;
}

export interface SleepTypeSummary {
  /** Raw watch sleep-state byte; its meaning is not decoded here. */
  type: number;
  count: number;
  seconds: number;
}

export interface SleepStageSummary {
  stage: 'light' | 'deep' | 'rem' | 'awake';
  count: number;
  seconds: number;
}

const SLEEP_STAGES: readonly SleepStageSummary['stage'][] = ['light', 'deep', 'rem', 'awake'];

/** A sleep session of the same wake day as the main sleep (a nap, however long). */
export interface SleepNap {
  start: number;
  end: number;
  /** Seconds asleep in it, awake excluded. */
  seconds: number;
}

export interface SleepSummary {
  start: number;
  end: number;
  /** Sum of segment durations of the main sleep (gaps between segments excluded). */
  totalSeconds: number;
  byType: SleepTypeSummary[];
  /** Segments with a decoded stage, in light, deep, rem, awake order; empty when none carry one. */
  byStage: SleepStageSummary[];
  /** Everything asleep on the main sleep's wake day, main sleep plus {@link naps}, awake excluded and overlaps counted once. */
  dayAsleepSeconds: number;
  /** The day's other sleep sessions, oldest first. */
  naps: SleepNap[];
}

/** Seconds asleep (awake excluded) in `segments`; time covered by more than one segment counts once, the earlier-starting segment keeping it. */
export function asleepUnionSeconds(segments: readonly SleepSegment[]): number {
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = -Infinity;
  let total = 0;
  for (const seg of sorted) {
    const start = Math.max(seg.start, cursor);
    if (start >= seg.end) continue;
    if (seg.stage !== 'awake') total += seg.end - start;
    cursor = seg.end;
  }
  return total;
}

/** Splits cleaned segments (sorted by start) into sessions: a gap over {@link SESSION_GAP_SEC} or a `breakBefore` starts a new one. */
function splitSessions(sorted: readonly SleepSpan[]): SleepSpan[][] {
  const sessions: SleepSpan[][] = [];
  let reach = -Infinity;
  for (const seg of sorted) {
    const current = sessions[sessions.length - 1];
    if (current && !seg.breakBefore && seg.start - reach <= SESSION_GAP_SEC) {
      current.push(seg);
      reach = Math.max(reach, seg.end);
    } else {
      sessions.push([seg]);
      reach = seg.end;
    }
  }
  return sessions;
}

/**
 * Summarises the sleep of the most recent wake day: every session that ends on the same local day as the latest one
 * (the day a main sleep is filed under, see `buildNights`). The longest of them is the main sleep that the stages,
 * range and types describe; the others are naps. `dayAsleepSeconds` is the day's total, main sleep and naps together.
 * Expects `segments` oldest-first.
 */
export function lastSleepSession(segments: readonly SleepSpan[]): SleepSummary | null {
  const sessions = splitSessions(withoutBlips(withoutStrayUnstaged(segments)));
  if (sessions.length === 0) return null;
  const endOf = (session: readonly SleepSpan[]) => Math.max(...session.map((s) => s.end));
  const day = startOfLocalDay(endOf(sessions[sessions.length - 1]));
  const ofDay = sessions.filter((session) => startOfLocalDay(endOf(session)) === day);
  const asleep = ofDay.map(asleepUnionSeconds);
  let mainIndex = 0;
  asleep.forEach((seconds, i) => {
    if (seconds >= asleep[mainIndex]) mainIndex = i;
  });
  const session = ofDay[mainIndex];

  const byType = new Map<number, SleepTypeSummary>();
  const byStage = Object.fromEntries(
    SLEEP_STAGES.map((stage) => [stage, { stage, count: 0, seconds: 0 }]),
  ) as Record<SleepStageSummary['stage'], SleepStageSummary>;
  let totalSeconds = 0;
  let start = Infinity;
  let end = 0;
  for (const seg of session) {
    const seconds = Math.max(0, seg.end - seg.start);
    totalSeconds += seconds;
    start = Math.min(start, seg.start);
    end = Math.max(end, seg.end);
    const entry = byType.get(seg.type) ?? { type: seg.type, count: 0, seconds: 0 };
    entry.count += 1;
    entry.seconds += seconds;
    byType.set(seg.type, entry);
    if (seg.stage) {
      byStage[seg.stage].count += 1;
      byStage[seg.stage].seconds += seconds;
    }
  }
  return {
    start,
    end,
    totalSeconds,
    byType: [...byType.values()].sort((a, b) => a.type - b.type),
    byStage: SLEEP_STAGES.map((stage) => byStage[stage]).filter((entry) => entry.count > 0),
    dayAsleepSeconds: asleepUnionSeconds(ofDay.flat()),
    naps: ofDay
      .map((other, i) => ({ other, i }))
      .filter(({ i }) => i !== mainIndex)
      .map(({ other, i }) => ({ start: Math.min(...other.map((s) => s.start)), end: endOf(other), seconds: asleep[i] })),
  };
}
