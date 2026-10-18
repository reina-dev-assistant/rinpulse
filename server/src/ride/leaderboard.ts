/**
 * The ride game's leaderboard (docs/ride-web.md). A result is only accepted from a room whose phone streamed cadence for the
 * whole ride, so a demo or a hand-written request cannot place: the relay itself counts the phone's samples between the game's
 * `ctl start` and the submission, and the claimed numbers must agree with what it saw.
 */

/** What the relay saw of the current ride, kept in the room's state. */
export interface RideEvidence {
  /** Relay clock (ms) when the game said `start`. */
  startedAt: number;
  /** Phone samples that carried a cadence. */
  cadSamples: number;
  cadSum: number;
  /** A result for this ride was accepted already. */
  submitted: boolean;
}

export interface ResultInput {
  routeId: string;
  timeS: number;
  distM: number;
  avgCad: number;
  anon: boolean;
}

/** Route lengths (m) the server accepts, and the fastest average it believes for each (km/h). */
export const ROUTE_LIMITS: Record<string, { lengthM: number; maxKmh: number }> = {
  pantai: { lengthM: 12000, maxKmh: 55 },
  bukit: { lengthM: 9000, maxKmh: 45 },
  kebun: { lengthM: 3000, maxKmh: 50 },
  bromo: { lengthM: 8000, maxKmh: 32 },
};

/** Phone samples arrive at about 4 Hz; a quarter of that survives a bad connection. */
export const MIN_SAMPLES_PER_S = 1;
/** Disagreement allowed between the game's average cadence and the relay's, rpm. */
export const CAD_TOLERANCE = 12;

export type Rejection = "no_ride" | "already_submitted" | "unknown_route" | "incomplete" | "too_fast" | "too_long" | "no_sensor" | "cadence_mismatch";

export function emptyEvidence(now: number): RideEvidence {
  return { startedAt: now, cadSamples: 0, cadSum: 0, submitted: false };
}

export function checkResult(evidence: RideEvidence | null, input: ResultInput, now: number): Rejection | null {
  if (!evidence) return "no_ride";
  if (evidence.submitted) return "already_submitted";
  const limits = ROUTE_LIMITS[input.routeId];
  if (!limits) return "unknown_route";
  if (input.distM < limits.lengthM - 5) return "incomplete";
  if ((limits.lengthM / input.timeS) * 3.6 > limits.maxKmh) return "too_fast";
  // The ride cannot have lasted longer than the relay has known about it (pauses only make the wall time longer).
  if (input.timeS > (now - evidence.startedAt) / 1000 + 5) return "too_long";
  if (evidence.cadSamples < input.timeS * MIN_SAMPLES_PER_S) return "no_sensor";
  const relayCad = evidence.cadSum / evidence.cadSamples;
  if (Math.abs(relayCad - input.avgCad) > CAD_TOLERANCE) return "cadence_mismatch";
  return null;
}

/** "Dzulfikar Ahmad Rizki" -> "Dzulfikar R." : enough to recognise a friend, not a full name in public. */
export function publicName(name: string | null): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]!.slice(0, 20);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : first;
}

/** The calendar day in WIB (UTC+7), the same day the game's daily challenge uses. */
export function wibDay(nowMs: number): string {
  return new Date(nowMs + 7 * 3600_000).toISOString().slice(0, 10);
}

export interface BoardRow {
  rank: number;
  name: string | null;
  timeS: number;
  you: boolean;
}

export const BOARD_SIZE = 20;

/** Each rider's best time on a route (all time or one day), fastest first. */
export async function readBoard(db: D1Database, routeId: string, day: string | null, userId: string | null): Promise<BoardRow[]> {
  const where = day === null ? "route_id = ?1" : "route_id = ?1 AND day = ?2";
  const binds: unknown[] = day === null ? [routeId] : [routeId, day];
  const { results } = await db
    .prepare(
      `SELECT user_id, MIN(time_s) AS time_s,
              (SELECT CASE WHEN r2.anon = 1 THEN NULL ELSE r2.display_name END FROM ride_result r2
                WHERE r2.user_id = r.user_id ORDER BY r2.created_at DESC LIMIT 1) AS name
         FROM ride_result r WHERE ${where}
        GROUP BY user_id ORDER BY time_s ASC LIMIT ${BOARD_SIZE}`,
    )
    .bind(...binds)
    .all<{ user_id: string; time_s: number; name: string | null }>();
  return results.map((r, i) => ({ rank: i + 1, name: r.name, timeS: r.time_s, you: userId !== null && r.user_id === userId }));
}

/** 1-based place of [timeS] among riders' bests on the route (all time). */
export async function rankOf(db: D1Database, routeId: string, userId: string, timeS: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (SELECT user_id, MIN(time_s) AS best FROM ride_result WHERE route_id = ?1 AND user_id != ?2 GROUP BY user_id) WHERE best < ?3`,
    )
    .bind(routeId, userId, timeS)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

export async function insertResult(
  db: D1Database,
  row: { userId: string; name: string | null; input: ResultInput; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ride_result (id, user_id, display_name, anon, route_id, day, time_s, dist_m, avg_cad, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      crypto.randomUUID(),
      row.userId,
      row.name,
      row.input.anon ? 1 : 0,
      row.input.routeId,
      wibDay(row.now),
      Math.round(row.input.timeS * 10) / 10,
      Math.round(row.input.distM),
      Math.round(row.input.avgCad * 10) / 10,
      row.now,
    )
    .run();
}
