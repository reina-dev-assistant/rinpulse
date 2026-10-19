/**
 * Sleep sessions, nights and wake days from stored `sleep_segments` rows. Pure TypeScript, no Worker or React Native
 * imports: a port of the phone's rules, constant for constant, so the web app shows the numbers the app shows.
 *
 * | Here | Phone |
 * |---|---|
 * | {@link withoutStrayUnstaged}, {@link withoutBlips}, {@link SESSION_GAP_SEC}, {@link BLIP_GAP_SEC}, {@link MIN_SLEEP_SEC} | `src/features/today/stats.ts` |
 * | {@link cleanUnstagedSleep} and its constants | `src/features/sleep/cleanSleep.ts` |
 * | {@link buildNights}, {@link MIN_NIGHT_SEC}, {@link nightHasStages} | `src/features/sleep/nights.ts` |
 * | {@link groupDays} | `sleepByDay` (nights.ts) and `lastSleepSession` (stats.ts), see its doc |
 *
 * Intentional differences:
 * - **Time zone.** The phone cuts days at its own local midnight; the server has no device time zone and uses WIB
 *   (UTC+7, no DST), like JoyoRogo. A night that ends between 00:00 and 07:00 WIB on a phone set to another zone can sit
 *   on another calendar day here.
 * - **Evidence for {@link cleanUnstagedSleep}.** The phone subtracts stored workouts, spot HRV measurements and minutes
 *   with 15 or more steps from stage-less ranges. The server has no HRV readings, so `spots` is always empty here; workouts
 *   come only from the legacy `workouts` table (builds before the cloud-workouts release; newer ones keep workouts in
 *   JoyoRogo) and steps from `step_samples`. A stage-less night can therefore differ from the phone's by a spot HRV minute.
 *   Staged segments are never touched, so a watch that reports stages gives identical results.
 * - **Stages.** The phone's `stage` is `light | deep | rem | awake | null`. The server stores any short text; anything
 *   else than those four is read as `null` (stage-less).
 * - **Several sessions of one day.** The day's main sleep is its longest session when that holds at least
 *   {@link MIN_NIGHT_SEC} (the Today summary's pick, `lastSleepSession`); every other session of the day is a nap, however long.
 *   `sleepByDay` would call a second session of 3 h or more a night, not a nap; the total of the day is the same.
 */

/** Unix seconds; every time in this module is. */
export type Sec = number;

export type SleepStage = "awake" | "rem" | "light" | "deep";
/** A decoded stage, or `asleep` for a segment stored without one. */
export type NightStage = SleepStage | "asleep";
export const NIGHT_STAGES: readonly NightStage[] = ["awake", "rem", "light", "deep", "asleep"];

/** A stored row: `end` is exclusive, `stage` null when the watch gave none. The raw watch `type` byte does not matter for grouping. */
export interface SleepSegment {
  start: Sec;
  end: Sec;
  stage: SleepStage | null;
}

/** A segment plus what only {@link cleanUnstagedSleep} knows: a workout or a long stretch of nothing precedes it, so it starts a new session. */
export type SleepSpan = SleepSegment & { breakBefore?: boolean };

/** Reads the `stage` text of a row; anything but the four decoded stages is stage-less. */
export function toStage(text: string | null): SleepStage | null {
  return text === "awake" || text === "rem" || text === "light" || text === "deep" ? text : null;
}

/** Segments closer together than this belong to the same sleep session. */
export const SESSION_GAP_SEC = 3 * 3600;
/** Sleep within this of other sleep belongs to the same stretch when telling a blip from a nap. */
export const BLIP_GAP_SEC = 3600;
/** A stretch with less sleep than this (awake excluded) is not sleep. */
export const MIN_SLEEP_SEC = 5 * 60;
/** Below this much sleep a session is a nap (`MIN_NIGHT_SEC` in SleepReport.kt). */
export const MIN_NIGHT_SEC = 3 * 3600;

/** A stage-less run needs this much sleep to be sleep. */
export const MIN_RUN_SEC = 20 * 60;
/** Stage-less pieces this close belong to one run. */
export const RUN_BRIDGE_SEC = 2 * 60;
/** A minute with this many steps is awake. */
export const ACTIVE_STEPS_PER_MIN = 15;
/** Room left around a spot HRV measurement. */
export const SPOT_MARGIN_SEC = 60;
/** Two stage-less segments further apart than this are two sessions. */
export const UNSTAGED_BREAK_SEC = 60 * 60;

// ---------------------------------------------------------------------------------------------------------------------
// WIB calendar days

/** JoyoRogo's day boundary: Asia/Jakarta, UTC+7 all year. */
export const WIB_OFFSET_SEC = 7 * 3600;
const DAY_SEC = 86_400;

/** Unix seconds of 00:00 WIB of the day containing `sec`. */
export function startOfWibDay(sec: Sec): Sec {
  return Math.floor((sec + WIB_OFFSET_SEC) / DAY_SEC) * DAY_SEC - WIB_OFFSET_SEC;
}

/** `YYYY-MM-DD` (WIB) of the day containing `sec`. */
export function wibDay(sec: Sec): string {
  return new Date((sec + WIB_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
}

/** Unix seconds of 00:00 WIB of a `YYYY-MM-DD`; null for anything that is not a real calendar date. */
export function wibDayStart(day: string): Sec | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return null;
  return ms / 1000 - WIB_OFFSET_SEC;
}

// ---------------------------------------------------------------------------------------------------------------------
// stats.ts

/** Drops stage-less segments within {@link SESSION_GAP_SEC} of a staged one (the watch stores short unstaged spans around a staged night). */
export function withoutStrayUnstaged<T extends SleepSegment>(segments: readonly T[]): T[] {
  const staged = segments.filter((s) => s.stage);
  return segments.filter(
    (s) => s.stage || !staged.some((t) => t.start - s.end <= SESSION_GAP_SEC && s.start - t.end <= SESSION_GAP_SEC),
  );
}

/**
 * Drops stretches of sleep (segments chained with gaps up to {@link BLIP_GAP_SEC}) holding less than {@link MIN_SLEEP_SEC}
 * asleep: a 1 to 2 minute HRV or stress check the watch records as sleep. Returns the kept segments sorted by start.
 */
export function withoutBlips<T extends SleepSegment>(segments: readonly T[]): T[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: T[] = [];
  let stretch: T[] = [];
  let reach = -Infinity;
  const close = () => {
    const asleep = stretch.reduce((sum, s) => sum + (s.stage === "awake" ? 0 : Math.max(0, s.end - s.start)), 0);
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

// ---------------------------------------------------------------------------------------------------------------------
// cleanSleep.ts

export interface Span {
  start: Sec;
  end: Sec;
}

/** What says the wearer was awake while the watch recorded a stage-less range. */
export interface SleepEvidence {
  /** Stored workouts. */
  workouts: readonly Span[];
  /** Spot HRV measurements. Always empty on the server (it holds none), see the module doc. */
  spots: readonly Span[];
  /** Start of every minute with at least {@link ACTIVE_STEPS_PER_MIN} steps, in any order. */
  activeMinutes: readonly Sec[];
}

export const NO_EVIDENCE: SleepEvidence = { workouts: [], spots: [], activeMinutes: [] };

/** A workout's span; a row without a usable end falls back to its active duration. */
export function workoutSpan(start: Sec, end: Sec, duration: number): Span {
  return { start, end: end > start ? end : start + Math.max(0, duration) };
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** `piece` minus the sorted, disjoint `awake` spans; `from` is the first span that can still overlap. */
function subtract(piece: Span, awake: readonly Span[], from: number): Span[] {
  const out: Span[] = [];
  let at = piece.start;
  for (let i = from; i < awake.length; i++) {
    const span = awake[i]!;
    if (span.start >= piece.end) break;
    if (span.end <= at) continue;
    if (span.start > at) out.push({ start: at, end: span.start });
    at = Math.max(at, span.end);
    if (at >= piece.end) break;
  }
  if (at < piece.end) out.push({ start: at, end: piece.end });
  return out;
}

/** Index of the first of the sorted, disjoint `spans` that ends after `time`. */
function firstEndingAfter(spans: readonly Span[], time: Sec): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid]!.end > time) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The phone's rule for watches that give no stages (`cleanUnstagedSleep`): awake evidence is subtracted from stage-less
 * ranges, what is left is chained into runs of pieces at most {@link RUN_BRIDGE_SEC} apart, runs under
 * {@link MIN_RUN_SEC} are dropped, and a stage-less segment that follows a workout, or follows another stage-less one after
 * more than {@link UNSTAGED_BREAK_SEC}, is marked `breakBefore`. Staged segments are never touched. Sorted by start.
 */
export function cleanUnstagedSleep<T extends SleepSegment>(
  segments: readonly T[],
  evidence: SleepEvidence,
): (T & { breakBefore?: boolean })[] {
  const staged: T[] = [];
  const unstaged: T[] = [];
  for (const s of segments) {
    if (s.stage) staged.push(s);
    else if (s.end > s.start) unstaged.push(s);
  }
  if (unstaged.length === 0) return [...segments].sort((a, b) => a.start - b.start || a.end - b.end);

  const awake = mergeSpans([
    ...evidence.workouts,
    ...evidence.spots.map((s) => ({ start: s.start - SPOT_MARGIN_SEC, end: s.end + SPOT_MARGIN_SEC })),
    ...evidence.activeMinutes.map((t) => ({ start: t, end: t + 60 })),
  ]);

  // Stage-less ranges overlap each other (two raw types for one night, or two watches); an earlier-starting one keeps the time.
  unstaged.sort((a, b) => a.start - b.start || a.end - b.end);
  const pieces: (T & { breakBefore?: boolean })[] = [];
  let cursor = -Infinity;
  for (const seg of unstaged) {
    const start = Math.max(seg.start, cursor);
    if (start >= seg.end) continue;
    cursor = seg.end;
    for (const span of subtract({ start, end: seg.end }, awake, firstEndingAfter(awake, start))) {
      pieces.push({ ...seg, start: span.start, end: span.end });
    }
  }

  const kept: (T & { breakBefore?: boolean })[] = [...staged];
  let run: (T & { breakBefore?: boolean })[] = [];
  let runSec = 0;
  let reach = -Infinity;
  const closeRun = () => {
    if (runSec >= MIN_RUN_SEC) kept.push(...run);
    run = [];
    runSec = 0;
  };
  for (const piece of pieces) {
    if (run.length > 0 && piece.start - reach > RUN_BRIDGE_SEC) closeRun();
    run.push(piece);
    runSec += piece.end - piece.start;
    reach = piece.end;
  }
  closeRun();
  kept.sort((a, b) => a.start - b.start || a.end - b.end);

  const workouts = mergeSpans([...evidence.workouts]);
  for (let i = 1; i < kept.length; i++) {
    const seg = kept[i]!;
    if (seg.stage) continue;
    const prev = kept[i - 1]!;
    if (seg.start < prev.end) continue;
    const next = workouts[firstEndingAfter(workouts, prev.end)];
    const workoutBetween = next !== undefined && next.start < seg.start;
    if (workoutBetween || (!prev.stage && seg.start - prev.end > UNSTAGED_BREAK_SEC)) seg.breakBefore = true;
  }
  return kept;
}

// ---------------------------------------------------------------------------------------------------------------------
// nights.ts

export interface StagePeriod {
  start: Sec;
  end: Sec;
  stage: NightStage;
}

/** One sleep session. */
export interface Night {
  start: Sec;
  end: Sec;
  /** Non-overlapping, oldest first; neighbours with the same stage are merged. */
  periods: StagePeriod[];
  seconds: Record<NightStage, number>;
  /** Everything recorded except awake. */
  asleepSeconds: number;
  /** Awake periods with sleep before and after them. */
  awakenings: number;
}

/** Whether the watch gave any stage for this night; false when everything is `asleep` (it only said when you slept). */
export function nightHasStages(night: Pick<Night, "seconds" | "asleepSeconds">): boolean {
  return night.asleepSeconds + night.seconds.awake > night.seconds.asleep;
}

/** A session is a nap when it holds less than {@link MIN_NIGHT_SEC} of sleep. */
export function isNap(night: Pick<Night, "asleepSeconds">): boolean {
  return night.asleepSeconds < MIN_NIGHT_SEC;
}

/**
 * Turns segments (as returned by {@link cleanUnstagedSleep}) into sleep sessions, oldest first. Overlaps are cut so every
 * second belongs to one stage (an earlier-starting segment keeps its time, which is also what keeps two watches from
 * counting the same night twice); sessions split where the gap exceeds {@link SESSION_GAP_SEC} and where a segment is
 * marked `breakBefore`. The phone returns newest first; this is the other way round.
 */
export function buildNights(segments: readonly SleepSpan[]): Night[] {
  const sorted = withoutBlips(withoutStrayUnstaged(segments));
  const periods: (StagePeriod & { breakBefore?: boolean })[] = [];
  let cursor = -Infinity;
  for (const seg of sorted) {
    const start = Math.max(seg.start, cursor);
    if (start >= seg.end) continue;
    const stage: NightStage = seg.stage ?? "asleep";
    const last = periods[periods.length - 1];
    if (last && last.stage === stage && last.end >= start && !seg.breakBefore) last.end = seg.end;
    else periods.push(seg.breakBefore ? { start, end: seg.end, stage, breakBefore: true } : { start, end: seg.end, stage });
    cursor = seg.end;
  }

  const sessions: StagePeriod[][] = [];
  for (const period of periods) {
    const current = sessions[sessions.length - 1];
    if (current && !period.breakBefore && period.start - current[current.length - 1]!.end <= SESSION_GAP_SEC) {
      current.push({ start: period.start, end: period.end, stage: period.stage });
    } else {
      sessions.push([{ start: period.start, end: period.end, stage: period.stage }]);
    }
  }

  return sessions.map((session): Night => {
    const seconds: Record<NightStage, number> = { awake: 0, rem: 0, light: 0, deep: 0, asleep: 0 };
    for (const p of session) seconds[p.stage] += p.end - p.start;
    const asleepSeconds = seconds.rem + seconds.light + seconds.deep + seconds.asleep;
    return {
      start: session[0]!.start,
      end: session[session.length - 1]!.end,
      periods: session,
      seconds,
      asleepSeconds,
      awakenings: session.filter((p, i) => p.stage === "awake" && i > 0 && i < session.length - 1).length,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The API's day shape

export interface ApiNight {
  start: Sec;
  end: Sec;
  asleepSec: number;
  awakeSec: number;
  stages: Record<NightStage, number>;
  hasStages: boolean;
  awakenings: number;
  periods: StagePeriod[];
}

export interface ApiNap {
  start: Sec;
  end: Sec;
  asleepSec: number;
}

export interface ApiDay {
  /** WIB `YYYY-MM-DD` the session(s) ended on. */
  day: string;
  /** Night and naps of the day, overlaps counted once. */
  asleepSec: number;
  napSec: number;
  night: ApiNight | null;
  naps: ApiNap[];
}

/**
 * Groups sessions by the WIB day they end on (a nap belongs to the day it ends, like the main sleep), oldest day first.
 * The main sleep of a day is its longest session when that has at least {@link MIN_NIGHT_SEC} of sleep (ties go to the later
 * one, as in `lastSleepSession`); every other session is a nap, oldest first. `asleepSec` is night plus naps. Only days
 * that have a session appear. `from` / `to` (unix seconds, `to` exclusive) keep the days whose sessions end inside.
 */
export function groupDays(nights: readonly Night[], from: Sec, to: Sec): ApiDay[] {
  const byDay = new Map<string, Night[]>();
  for (const n of nights) {
    if (n.end < from || n.end >= to) continue;
    const key = wibDay(n.end);
    const list = byDay.get(key);
    if (list) list.push(n);
    else byDay.set(key, [n]);
  }

  const days: ApiDay[] = [];
  for (const [day, sessions] of byDay) {
    sessions.sort((a, b) => a.start - b.start);
    let mainIndex = 0;
    sessions.forEach((s, i) => {
      if (s.asleepSeconds >= sessions[mainIndex]!.asleepSeconds) mainIndex = i;
    });
    const main = sessions[mainIndex]!;
    const night = isNap(main) ? null : main;
    const naps = sessions.filter((s) => s !== night).map((s): ApiNap => ({ start: s.start, end: s.end, asleepSec: s.asleepSeconds }));
    days.push({
      day,
      asleepSec: sessions.reduce((sum, s) => sum + s.asleepSeconds, 0),
      napSec: naps.reduce((sum, n) => sum + n.asleepSec, 0),
      night: night && {
        start: night.start,
        end: night.end,
        asleepSec: night.asleepSeconds,
        awakeSec: night.seconds.awake,
        stages: night.seconds,
        hasStages: nightHasStages(night),
        awakenings: night.awakenings,
        periods: night.periods,
      },
      naps,
    });
  }
  return days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
