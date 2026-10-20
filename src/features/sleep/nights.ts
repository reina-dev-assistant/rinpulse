import type { SleepScoreRow } from '@/db/queries';
import { SESSION_GAP_SEC, startOfLocalDay, withoutBlips, withoutStrayUnstaged, type SleepSpan } from '@/features/today/stats';
import type { SleepStage } from '@/wear';

/** A decoded stage, or `asleep` for a segment the watch stored without one. */
export type NightStage = SleepStage | 'asleep';

export const NIGHT_STAGES: readonly NightStage[] = ['awake', 'rem', 'light', 'deep', 'asleep'];

export interface StagePeriod {
  start: number;
  end: number;
  stage: NightStage;
  /** This period came from the phone's own stage estimate, not the watch's analysis (`SleepSegment.estimated`). */
  estimated?: boolean;
}

/** Whether the watch gave any stage for this night; false when everything is `asleep` (the watch only said when you slept). */
export function nightHasStages(night: Pick<Night, 'seconds' | 'asleepSeconds'>): boolean {
  return night.asleepSeconds + night.seconds.awake > night.seconds.asleep;
}

export interface Night {
  start: number;
  end: number;
  /** Local `YYYY-MM-DD` of the wake-up; nights are listed and picked by it. */
  day: string;
  /** Non-overlapping, oldest first; neighbours with the same stage are merged. */
  periods: StagePeriod[];
  seconds: Record<NightStage, number>;
  /** Everything recorded except awake. */
  asleepSeconds: number;
  /** Shorter than {@link MIN_NIGHT_SEC} of sleep: shown as a nap. */
  nap: boolean;
  /** Awake periods with sleep before and after them. */
  awakenings: number;
  /** The watch's own score for this night, null when it gave none. */
  score: SleepScoreRow | null;
  /**
   * Every sleeping segment of the night came from the phone's own stage estimate (`EstimatedSleepStages`): the watch
   * sent no stages, so the shape here was worked out from its raw night and is an estimate, not the watch's analysis.
   */
  estimated: boolean;
}

/** The watch score whose span overlaps `start`..`end` the most; the watch scores the main sleep, not naps. */
export function scoreFor(start: number, end: number, scores: readonly SleepScoreRow[]): SleepScoreRow | null {
  let best: SleepScoreRow | null = null;
  let bestOverlap = 0;
  for (const s of scores) {
    const overlap = Math.min(end, s.end) - Math.max(start, s.start);
    if (overlap > bestOverlap) {
      best = s;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** Below this much sleep a session is a nap (`MIN_NIGHT_SEC` in SleepReport.kt). */
export const MIN_NIGHT_SEC = 3 * 3600;

function localDay(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Turns stored segments into sleep sessions, newest first. Overlaps are cut so every second belongs to
 * one stage (an earlier-starting segment keeps its time); sessions split where the gap exceeds
 * {@link SESSION_GAP_SEC}, the same rule the Today card and the watch's morning report use, and where a segment
 * is marked `breakBefore` (a workout or a long awake stretch in between, see `cleanUnstagedSleep`).
 */
export function buildNights(segments: readonly SleepSpan[], scores: readonly SleepScoreRow[]): Night[] {
  const sorted = withoutBlips(withoutStrayUnstaged(segments));
  const periods: (StagePeriod & { breakBefore?: boolean })[] = [];
  let cursor = -Infinity;
  for (const seg of sorted) {
    const start = Math.max(seg.start, cursor);
    if (start >= seg.end) continue;
    const stage: NightStage = seg.stage ?? 'asleep';
    const last = periods[periods.length - 1];
    const period = seg.breakBefore
      ? { start, end: seg.end, stage, breakBefore: true, estimated: seg.estimated }
      : { start, end: seg.end, stage, estimated: seg.estimated };
    if (last && last.stage === stage && last.end >= start && !seg.breakBefore) last.end = seg.end;
    else periods.push(period);
    cursor = seg.end;
  }

  const sessions: StagePeriod[][] = [];
  for (const period of periods) {
    const current = sessions[sessions.length - 1];
    if (current && !period.breakBefore && period.start - current[current.length - 1].end <= SESSION_GAP_SEC) {
      current.push(period);
    } else {
      sessions.push([period]);
    }
  }

  return sessions
    .map((session): Night => {
      const seconds = Object.fromEntries(NIGHT_STAGES.map((stage) => [stage, 0])) as Record<NightStage, number>;
      for (const p of session) seconds[p.stage] += p.end - p.start;
      const asleepSeconds = NIGHT_STAGES.reduce((sum, stage) => (stage === 'awake' ? sum : sum + seconds[stage]), 0);
      const end = session[session.length - 1].end;
      return {
        start: session[0].start,
        end,
        day: localDay(end),
        periods: session,
        seconds,
        asleepSeconds,
        nap: asleepSeconds < MIN_NIGHT_SEC,
        awakenings: session.filter((p, i) => p.stage === 'awake' && i > 0 && i < session.length - 1).length,
        score: scoreFor(session[0].start, end, scores),
        // The stage estimate's rows are the whole story of this night's shape: nothing the watch staged is in it.
        estimated:
          session.some((p) => p.stage !== 'asleep') && session.every((p) => p.stage === 'asleep' || p.estimated === true),
      };
    })
    .reverse();
}

export interface DaySleep {
  /** Asleep seconds of every session that ended on the day, night and naps together. */
  asleepSeconds: number;
  /** The part of {@link asleepSeconds} that came from naps. */
  napSeconds: number;
  /** The day has a main sleep (a session of {@link MIN_NIGHT_SEC} or more); a day with only naps has no night on record. */
  hasNight: boolean;
}

/**
 * Sleep per wake day, keyed by local midnight (unix seconds) of the day a session ends on: a nap belongs to the day it
 * ends, like the main sleep. {@link buildNights} already cuts overlaps, so nothing is counted twice.
 */
export function sleepByDay(nights: readonly Night[]): Map<number, DaySleep> {
  const days = new Map<number, DaySleep>();
  for (const n of nights) {
    const key = startOfLocalDay(n.end);
    const day = days.get(key) ?? { asleepSeconds: 0, napSeconds: 0, hasNight: false };
    day.asleepSeconds += n.asleepSeconds;
    if (n.nap) day.napSeconds += n.asleepSeconds;
    else day.hasNight = true;
    days.set(key, day);
  }
  return days;
}

export interface HourStages {
  /** Unix seconds of the hour's start (local clock hour). */
  hour: number;
  seconds: Record<NightStage, number>;
}

/** Seconds of each stage inside every local clock hour the night touches, earliest hour first. */
export function hourlyStages(night: Night): HourStages[] {
  const first = new Date(night.start * 1000);
  first.setMinutes(0, 0, 0);
  const hours: HourStages[] = [];
  // Step by wall-clock hour so a DST change still gives one bar per clock hour.
  for (const d = first; d.getTime() / 1000 < night.end; d.setHours(d.getHours() + 1)) {
    const from = d.getTime() / 1000;
    const to = from + 3600;
    const seconds = Object.fromEntries(NIGHT_STAGES.map((stage) => [stage, 0])) as Record<NightStage, number>;
    for (const p of night.periods) {
      const overlap = Math.min(p.end, to) - Math.max(p.start, from);
      if (overlap > 0) seconds[p.stage] += overlap;
    }
    hours.push({ hour: from, seconds });
  }
  return hours;
}
