import { Hono } from "hono";
import { z } from "zod";

import { sha256Hex } from "./auth";
import { readJson } from "./body";
import type { AppContext } from "./env";
import { matchAcceptLanguage } from "./i18n";
import {
  LIVE_EXPIRE_MS,
  LIVE_MAX_BODY_BYTES,
  LIVE_MAX_POINTS_PER_POST,
  LIVE_MAX_POINTS_PER_SESSION,
  LIVE_MAX_POSTS_PER_MINUTE,
  LIVE_MAX_STARTS_PER_HOUR,
  LIVE_MAX_TRACK_POINTS,
  LIVE_PURGE_MS,
  LIVE_TS_FUTURE_MS,
  LIVE_TS_PAST_MS,
} from "./limits";
import { renderLivePage } from "./livePage";

/**
 * Live tracking link (docs/bike-computer.md, "Live tracking link"). Three kinds of caller, three kinds of secret:
 *  - the rider's signed-in app starts a session (`POST /v1/live`, JoyoRogo session);
 *  - the phone posts points and ends the session with the session's write key (Bearer), not the cookie, so a
 *    backgrounded phone whose session has expired keeps posting;
 *  - anyone with the link reads it (`GET /v1/live/:token`, `GET /live/:token`); the 128-bit token is the capability.
 * Only SHA-256 hashes of the token and the write key are stored. Times are Unix ms, speed is m/s.
 */

export type LiveState = "live" | "ended" | "expired" | "unknown";

export interface LiveView {
  state: LiveState;
  title: string | null;
  startedAt: number | null;
  lastAt: number | null;
  last: { lat: number; lon: number; speed: number | null; hr: number | null; ts: number } | null;
  /** Absent only when the caller asked for `?track=0`. */
  track?: [number, number][];
}

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 128 random bits as 22 base64url characters. */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const startSchema = z.object({
  title: z
    .string()
    .nullish()
    .transform((value) => {
      // eslint-disable-next-line no-control-regex
      const clean = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
      return clean === "" ? null : clean;
    }),
});

const pointSchema = z.object({
  ts: z.number().int(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number().min(-1_000).max(12_000).nullish(),
  speed: z.number().min(0).max(120).nullish(),
  hr: z.number().int().min(0).max(255).nullish(),
});

/** The batch must be strictly increasing in time and inside the window around `now`. */
function pointsSchema(now: number) {
  return z
    .object({ points: z.array(pointSchema).min(1).max(LIVE_MAX_POINTS_PER_POST) })
    .superRefine(({ points }, ctx) => {
      let previous = -Infinity;
      points.forEach((point, index) => {
        const inWindow = point.ts >= now - LIVE_TS_PAST_MS && point.ts <= now + LIVE_TS_FUTURE_MS;
        if (!inWindow || point.ts <= previous) ctx.addIssue({ code: "custom", path: ["points", index, "ts"], message: "timestamp out of range or not increasing" });
        previous = point.ts;
      });
    });
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

/** At most `max` points, always the first and the last, evenly spread by index in between. */
export function downsampleTrack<T>(points: readonly T[], max: number): T[] {
  // `max` is at least 2 (LIVE_MAX_TRACK_POINTS), so first and last are both kept.
  if (points.length <= max) return [...points];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))] as T);
  return out;
}

const UNKNOWN: LiveView = { state: "unknown", title: null, startedAt: null, lastAt: null, last: null, track: [] };

interface SessionRow {
  id: string;
  title: string | null;
  started_at: number;
  last_at: number;
  ended_at: number | null;
}

interface LastRow {
  ts: number;
  lat: number;
  lon: number;
  speed: number | null;
  hr: number | null;
}

/**
 * What the link shows. An unknown token and a malformed one answer the same; an ended or expired link carries no
 * title, position or track (ending the ride revokes the link), only the state and the times.
 */
export async function readView(db: D1Database, token: string, now: number, withTrack: boolean): Promise<LiveView> {
  if (!TOKEN_RE.test(token)) return UNKNOWN;
  const session = await db
    .prepare("SELECT id, title, started_at, last_at, ended_at FROM live_session WHERE token_hash = ?1")
    .bind(await sha256Hex(token))
    .first<SessionRow>();
  if (!session) return UNKNOWN;
  if (session.ended_at !== null) return { state: "ended", title: null, startedAt: session.started_at, lastAt: session.last_at, last: null, track: [] };
  if (now - session.last_at > LIVE_EXPIRE_MS) return { state: "expired", title: null, startedAt: null, lastAt: null, last: null, track: [] };
  const [last, trackRows] = await Promise.all([
    db.prepare("SELECT ts, lat, lon, speed, hr FROM live_point WHERE session_id = ?1 ORDER BY ts DESC LIMIT 1").bind(session.id).first<LastRow>(),
    withTrack ? db.prepare("SELECT lat, lon FROM live_point WHERE session_id = ?1 ORDER BY ts").bind(session.id).all<{ lat: number; lon: number }>() : null,
  ]);
  const view: LiveView = {
    state: "live",
    title: session.title,
    startedAt: session.started_at,
    lastAt: session.last_at,
    last: last ? { lat: round5(last.lat), lon: round5(last.lon), speed: last.speed, hr: last.hr, ts: last.ts } : null,
  };
  if (trackRows) {
    view.track = downsampleTrack(trackRows.results, LIVE_MAX_TRACK_POINTS).map((r): [number, number] => [round5(r.lat), round5(r.lon)]);
  }
  return view;
}

/** Same security headers for every answer that carries a link's data. */
function privateHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

/** Deletes sessions, and their points, whose last batch or end is older than 24 h. Called by the nightly purge. */
export async function purgeLive(db: D1Database, now: number): Promise<void> {
  const cutoff = now - LIVE_PURGE_MS;
  await db.batch([
    db.prepare("DELETE FROM live_point WHERE session_id IN (SELECT id FROM live_session WHERE COALESCE(ended_at, last_at) < ?1)").bind(cutoff),
    db.prepare("DELETE FROM live_session WHERE COALESCE(ended_at, last_at) < ?1").bind(cutoff),
  ]);
}

/** The statements that remove one user's live data (points first); for the account and data deletion paths. */
export function deleteLiveStatements(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM live_point WHERE session_id IN (SELECT id FROM live_session WHERE user_id = ?1)").bind(userId),
    db.prepare("DELETE FROM live_session WHERE user_id = ?1").bind(userId),
  ];
}

/** `POST /v1/live`: mounted under `/v1`, behind the JoyoRogo session. */
export const liveSession = new Hono<AppContext>();

liveSession.post("/", async (c) => {
  const { title } = startSchema.parse(await readJson(c.req.raw, LIVE_MAX_BODY_BYTES));
  const userId = c.get("user").id;
  const now = Date.now();
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM live_session WHERE user_id = ?1 AND started_at > ?2")
    .bind(userId, now - 3_600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= LIVE_MAX_STARTS_PER_HOUR) return c.json({ error: "rate_limited" }, 429, privateHeaders({ "retry-after": "600" }));
  const id = crypto.randomUUID();
  const token = randomSecret();
  const writeKey = randomSecret();
  // One batch (one transaction): the previous active session ends and the new one starts, so the one-active-session
  // index never sees two.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE live_session SET ended_at = ?2 WHERE user_id = ?1 AND ended_at IS NULL").bind(userId, now),
    c.env.DB.prepare(
      "INSERT INTO live_session (id, user_id, token_hash, write_hash, started_at, last_at, title) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
    ).bind(id, userId, await sha256Hex(token), await sha256Hex(writeKey), now, title),
  ]);
  const viewUrl = `${new URL(c.req.url).origin}/live/${token}`;
  return c.json({ id, viewUrl, token, writeKey }, 201, privateHeaders());
});

interface WriterRow {
  ended_at: number | null;
  last_at: number;
  point_count: number;
}

/** The session this Bearer write key belongs to, or null. The key is the only credential. */
async function authorizeWriter(db: D1Database, id: string, authorization: string | undefined): Promise<WriterRow | null> {
  const key = /^Bearer ([A-Za-z0-9_-]{22})$/.exec(authorization ?? "")?.[1];
  if (!key || !ID_RE.test(id)) return null;
  return db
    .prepare("SELECT ended_at, last_at, point_count FROM live_session WHERE id = ?1 AND write_hash = ?2")
    .bind(id, await sha256Hex(key))
    .first<WriterRow>();
}

/** Public routes of the link, mounted at `/v1/live` before the session-checked `/v1`. */
export const livePublic = new Hono<AppContext>();

livePublic.post("/:id/points", async (c) => {
  const id = c.req.param("id");
  const now = Date.now();
  const writer = await authorizeWriter(c.env.DB, id, c.req.header("authorization"));
  if (!writer) return c.json({ error: "unauthorized" }, 401, privateHeaders());
  if (writer.ended_at !== null) return c.json({ error: "ended" }, 409, privateHeaders());
  if (now - writer.last_at > LIVE_EXPIRE_MS) return c.json({ error: "expired" }, 409, privateHeaders());

  // Counted before the body is read, so a flood of junk is limited too.
  const minute = Math.floor(now / 60_000);
  const counted = await c.env.DB.prepare(
    "UPDATE live_session SET post_hits = CASE WHEN post_minute = ?2 THEN post_hits + 1 ELSE 1 END, post_minute = ?2 WHERE id = ?1 RETURNING post_hits",
  )
    .bind(id, minute)
    .first<{ post_hits: number }>();
  if ((counted?.post_hits ?? 1) > LIVE_MAX_POSTS_PER_MINUTE) {
    return c.json({ error: "rate_limited" }, 429, privateHeaders({ "retry-after": String(Math.max(1, Math.ceil(((minute + 1) * 60_000 - now) / 1000))) }));
  }

  const { points } = pointsSchema(now).parse(await readJson(c.req.raw, LIVE_MAX_BODY_BYTES));
  if (writer.point_count + points.length > LIVE_MAX_POINTS_PER_SESSION) return c.json({ error: "session_full" }, 409, privateHeaders());

  const rows = points.map((p) => ({ ts: p.ts, lat: p.lat, lon: p.lon, alt: p.alt ?? null, speed: p.speed ?? null, hr: p.hr ?? null }));
  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO live_point (session_id, ts, lat, lon, alt, speed, hr)
     SELECT ?1, json_extract(value, '$.ts'), json_extract(value, '$.lat'), json_extract(value, '$.lon'),
            json_extract(value, '$.alt'), json_extract(value, '$.speed'), json_extract(value, '$.hr')
       FROM json_each(?2)`,
  )
    .bind(id, JSON.stringify(rows))
    .run();
  await c.env.DB.prepare("UPDATE live_session SET last_at = ?2, point_count = point_count + ?3 WHERE id = ?1 AND ended_at IS NULL")
    .bind(id, now, inserted.meta.changes)
    .run();
  return c.json({ stored: inserted.meta.changes }, 200, privateHeaders());
});

livePublic.post("/:id/end", async (c) => {
  const id = c.req.param("id");
  const writer = await authorizeWriter(c.env.DB, id, c.req.header("authorization"));
  if (!writer) return c.json({ error: "unauthorized" }, 401, privateHeaders());
  // Repeatable: a retried /end after a lost answer must not fail.
  if (writer.ended_at === null) await c.env.DB.prepare("UPDATE live_session SET ended_at = ?2 WHERE id = ?1 AND ended_at IS NULL").bind(id, Date.now()).run();
  return c.json({ ended: true }, 200, privateHeaders());
});

/** `GET /v1/live/:token?track=0`: public JSON. `track=0` skips the track (one row read instead of the whole ride). */
livePublic.get("/:token", async (c) => {
  const view = await readView(c.env.DB, c.req.param("token"), Date.now(), c.req.query("track") !== "0");
  return c.json(view, view.state === "unknown" ? 404 : 200, privateHeaders());
});

/** `GET /live/:token`: the page people open. */
export const livePage = new Hono<AppContext>();

livePage.get("/:token", async (c) => {
  const token = c.req.param("token");
  const view = await readView(c.env.DB, token, Date.now(), true);
  const nonce = randomSecret();
  const html = renderLivePage({ token: TOKEN_RE.test(token) ? token : "", view, locale: matchAcceptLanguage(c.req.header("accept-language")), nonce });
  return new Response(html, {
    status: view.state === "unknown" ? 404 : 200,
    headers: privateHeaders({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    }),
  });
});
