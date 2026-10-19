import { Hono } from "hono";

import type { AppContext } from "./env";
import { SLEEP_MAX_WINDOW_DAYS } from "./limits";
import {
  ACTIVE_STEPS_PER_MIN,
  buildNights,
  cleanUnstagedSleep,
  groupDays,
  toStage,
  workoutSpan,
  wibDayStart,
  type SleepEvidence,
  type SleepSegment,
} from "./sleepDays";

/**
 * `GET /v1/sleep?from=YYYY-MM-DD&to=YYYY-MM-DD` — the web app's sleep view. Sessions are grouped by the WIB day they end on;
 * the rules are the phone's (`sleepDays.ts`). Reads only, the caller's own rows only, no Pro check (like `GET /v1/restore`).
 */
export const sleep = new Hono<AppContext>();

const DAY_SEC = 86_400;
/**
 * Rows are read this far beyond the window on both sides, so a session that straddles its edge, and the stage-less neighbours
 * that the cleaning rules look at (3 h), are whole. No session is anywhere near this long.
 */
const MARGIN_SEC = 36 * 3600;
/** A stored segment spans less than this, so `start` can be bounded from below by `end` (the table is keyed on `start`). */
const SEGMENT_MAX_SPAN_SEC = DAY_SEC;

interface SleepRow {
  start: number;
  end: number;
  stage: string | null;
}

sleep.get("/", async (c) => {
  const fromStart = wibDayStart(c.req.query("from") ?? "");
  const toStart = wibDayStart(c.req.query("to") ?? "");
  if (fromStart === null || toStart === null || toStart < fromStart || (toStart - fromStart) / DAY_SEC + 1 > SLEEP_MAX_WINDOW_DAYS) {
    return c.json({ error: "invalid_range", maxDays: SLEEP_MAX_WINDOW_DAYS }, 400);
  }
  const userId = c.get("user").id;
  const windowEnd = toStart + DAY_SEC;
  const lo = fromStart - MARGIN_SEC;
  const hi = windowEnd + MARGIN_SEC;

  const { results } = await c.env.DB.prepare(
    `SELECT start, "end", stage FROM sleep_segments
     WHERE user_id = ?1 AND start >= ?2 AND start < ?3 AND "end" >= ?4 ORDER BY start, "end"`,
  )
    .bind(userId, lo - SEGMENT_MAX_SPAN_SEC, hi, lo)
    .all<SleepRow>();
  const segments: SleepSegment[] = results.map((r) => ({ start: r.start, end: r.end, stage: toStage(r.stage) }));

  const cleaned = cleanUnstagedSleep(segments, await evidenceFor(c.env.DB, userId, segments));
  const days = groupDays(buildNights(cleaned), fromStart, windowEnd);
  return c.json({ from: c.req.query("from"), to: c.req.query("to"), days });
});

/**
 * What the stored workouts (legacy `workouts` rows) and per-minute steps say about the span of the stage-less segments;
 * nothing is read when every segment has a stage. There are no spot HRV readings on the server.
 */
async function evidenceFor(db: D1Database, userId: string, segments: readonly SleepSegment[]): Promise<SleepEvidence> {
  let from = Infinity;
  let to = -Infinity;
  for (const s of segments) {
    if (s.stage) continue;
    from = Math.min(from, s.start);
    to = Math.max(to, s.end);
  }
  if (from > to) return { workouts: [], spots: [], activeMinutes: [] };
  const [workouts, active] = await Promise.all([
    db
      .prepare(`SELECT start, "end", duration FROM workouts WHERE user_id = ?1 AND "end" >= ?2 AND start <= ?3`)
      .bind(userId, from, to)
      .all<{ start: number; end: number; duration: number }>(),
    db
      .prepare("SELECT timestamp FROM step_samples WHERE user_id = ?1 AND timestamp >= ?2 AND timestamp <= ?3 AND steps >= ?4")
      .bind(userId, from - 60, to, ACTIVE_STEPS_PER_MIN)
      .all<{ timestamp: number }>(),
  ]);
  return {
    workouts: workouts.results.map((w) => workoutSpan(w.start, w.end, w.duration)),
    spots: [],
    activeMinutes: active.results.map((a) => a.timestamp),
  };
}
