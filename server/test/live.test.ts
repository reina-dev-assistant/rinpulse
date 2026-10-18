import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../src/auth";
import { runScheduled } from "../src/family/cron";
import { downsampleTrack } from "../src/live";
import { call, env, grantApi, postJson, signUp, upstream } from "./helpers";

interface Started {
  id: string;
  viewUrl: string;
  token: string;
  writeKey: string;
}

const HOUR = 3_600_000;

afterEach(() => {
  vi.restoreAllMocks();
});

async function start(cookie: string, title: string | null = "Morning ride"): Promise<Started> {
  const response = await postJson("/v1/live", { title }, cookie);
  expect(response.status).toBe(201);
  const started: Started = await response.json();
  return started;
}

function point(offsetS: number, extra: Record<string, unknown> = {}) {
  return { ts: Date.now() - 60_000 + offsetS * 1000, lat: -7.95 + offsetS * 1e-4, lon: 112.61 + offsetS * 1e-4, speed: 7.5, hr: 142, ...extra };
}

function post(id: string, writeKey: string | null, body: unknown, path = "points"): Promise<Response> {
  return call(`/v1/live/${id}/${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...(writeKey ? { authorization: `Bearer ${writeKey}` } : {}) },
  });
}

const view = (token: string, query = "") => call(`/v1/live/${token}${query}`);

interface ViewBody {
  state: string;
  title: string | null;
  startedAt: number | null;
  lastAt: number | null;
  last: { lat: number; lon: number; speed: number | null; hr: number | null; ts: number } | null;
  track?: [number, number][];
}

/** The public JSON of a link, typed: the Worker's own answer in a test, so the shape is asserted right after. */
async function viewBody(token: string, query = ""): Promise<ViewBody> {
  const parsed: ViewBody = await (await view(token, query)).json();
  return parsed;
}

/** The JSON data block of the page: what the script reads. */
function pageConfig(block: string): { view: ViewBody } {
  const parsed: { view: ViewBody } = JSON.parse(block);
  return parsed;
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;
}

describe("POST /v1/live", () => {
  it("needs a session", async () => {
    expect((await postJson("/v1/live", { title: "x" })).status).toBe(401);
  });

  it("returns the id, link, token and write key once, and stores only hashes", async () => {
    const { cookie, user } = signUp("rina");
    const response = await postJson("/v1/live", { title: "  Morning ride  " }, cookie);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const started: Started = await response.json();
    expect(started.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(started.writeKey).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(started.token).not.toBe(started.writeKey);
    expect(started.viewUrl).toBe(`https://api.test/live/${started.token}`);

    const row = await env.DB.prepare("SELECT * FROM live_session WHERE id = ?1").bind(started.id).first<Record<string, unknown>>();
    expect(row?.user_id).toBe(user.id);
    expect(row?.title).toBe("Morning ride");
    expect(row?.token_hash).toBe(await sha256Hex(started.token));
    expect(row?.write_hash).toBe(await sha256Hex(started.writeKey));
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(started.token);
    expect(stored).not.toContain(started.writeKey);
  });

  it("ends the user's previous active session when a new one starts", async () => {
    const { cookie } = signUp("sari");
    const first = await start(cookie);
    const second = await start(cookie);
    expect((await viewBody(first.token)).state).toBe("ended");
    expect((await viewBody(second.token)).state).toBe("live");
    expect((await post(first.id, first.writeKey, { points: [point(0)] })).status).toBe(409);
    expect((await post(second.id, second.writeKey, { points: [point(0)] })).status).toBe(200);
  });

  it("limits how many sessions a user starts in an hour", async () => {
    const { cookie } = signUp("tono");
    for (let i = 0; i < 10; i++) await start(cookie);
    const response = await postJson("/v1/live", { title: "again" }, cookie);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
  });

  it("cleans the title: control characters, length, blank", async () => {
    const { cookie } = signUp("uli");
    const long = await start(cookie, `a\nb${"x".repeat(200)}`);
    const title = (await env.DB.prepare("SELECT title FROM live_session WHERE id = ?1").bind(long.id).first<{ title: string }>())?.title ?? "";
    expect(title.length).toBe(80);
    expect(title.startsWith("a b")).toBe(true);
    const blank = await start(cookie, "   ");
    expect((await env.DB.prepare("SELECT title FROM live_session WHERE id = ?1").bind(blank.id).first<{ title: string | null }>())?.title).toBeNull();
  });
});

describe("the live flow", () => {
  it("create, post points, read, end", async () => {
    const { cookie } = signUp("vina");
    const { id, token, writeKey } = await start(cookie);

    const waiting = await viewBody(token);
    expect(waiting).toMatchObject({ state: "live", title: "Morning ride", last: null, track: [] });

    const stored = await post(id, writeKey, { points: [point(0), point(5, { alt: 450.5 }), point(10, { speed: 9, hr: null })] });
    expect(stored.status).toBe(200);
    expect(await stored.json()).toEqual({ stored: 3 });

    const response = await view(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const live: ViewBody = await response.json();
    expect(live.state).toBe("live");
    expect(live.track).toHaveLength(3);
    expect(live.track?.[0]).toEqual([-7.95, 112.61]);
    expect(live.last).toMatchObject({ lat: -7.949, lon: 112.611, speed: 9, hr: null });
    expect(live.lastAt).toBeGreaterThanOrEqual(live.startedAt ?? Infinity);

    const light = await viewBody(token, "?track=0");
    expect(light).not.toHaveProperty("track");
    expect(light.last).toMatchObject({ speed: 9 });

    const ended = await post(id, writeKey, {}, "end");
    expect(ended.status).toBe(200);
    expect(await ended.json()).toEqual({ ended: true });
    // Repeating the end (a lost answer, a retry) is fine.
    expect((await post(id, writeKey, {}, "end")).status).toBe(200);

    const after = await viewBody(token);
    expect(after).toMatchObject({ state: "ended", title: null, last: null, track: [] });
    expect(JSON.stringify(after)).not.toContain("-7.95");
    expect((await post(id, writeKey, { points: [point(20)] })).status).toBe(409);
  });

  it("ignores a point it already has (a retried batch) and counts only the new ones", async () => {
    const { cookie } = signUp("wawan");
    const { id, writeKey } = await start(cookie);
    const batch = { points: [point(0), point(5)] };
    expect(await (await post(id, writeKey, batch)).json()).toEqual({ stored: 2 });
    expect(await (await post(id, writeKey, { points: [batch.points[1], point(10)] })).json()).toEqual({ stored: 1 });
    expect(await count("SELECT COUNT(*) AS n FROM live_point WHERE session_id = ?1", id)).toBe(3);
    expect(await count("SELECT point_count AS n FROM live_session WHERE id = ?1", id)).toBe(3);
  });

  it("answers 409 session_full once the cap would be passed", async () => {
    const { cookie } = signUp("xena");
    const { id, writeKey } = await start(cookie);
    await env.DB.prepare("UPDATE live_session SET point_count = 19990 WHERE id = ?1").bind(id).run();
    const response = await post(id, writeKey, { points: Array.from({ length: 11 }, (_, i) => point(i)) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "session_full" });
  });
});

describe("POST /v1/live/:id/points authorization", () => {
  it("answers 401 for a wrong, missing or foreign write key and for the session cookie alone", async () => {
    const rider = signUp("yoga");
    const other = signUp("zaki");
    const one = await start(rider.cookie);
    const two = await start(other.cookie);
    const body = { points: [point(0)] };
    expect((await post(one.id, "A".repeat(22), body)).status).toBe(401);
    expect((await post(one.id, null, body)).status).toBe(401);
    expect((await post(one.id, two.writeKey, body)).status).toBe(401);
    expect((await post(one.id, one.token, body)).status).toBe(401);
    expect((await post("not-an-id", one.writeKey, body)).status).toBe(401);
    expect((await call(`/v1/live/${one.id}/points`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, cookie: rider.cookie })).status).toBe(401);
    expect((await post(one.id, "A".repeat(22), {}, "end")).status).toBe(401);
    expect(await count("SELECT COUNT(*) AS n FROM live_point WHERE session_id IN (?1, ?2)", one.id, two.id)).toBe(0);
  });

  it("still works when the JoyoRogo session is gone", async () => {
    const { cookie } = signUp("abel");
    const { id, writeKey } = await start(cookie);
    expect((await post(id, writeKey, { points: [point(0)] })).status).toBe(200);
    expect(grantApi.calls).toHaveLength(0);
  });
});

describe("point validation", () => {
  const bad: [string, unknown][] = [
    ["no points", { points: [] }],
    ["more than 30 points", { points: Array.from({ length: 31 }, (_, i) => point(i)) }],
    ["no points key", {}],
    ["latitude over 90", { points: [point(0, { lat: 90.5 })] }],
    ["longitude under -180", { points: [point(0, { lon: -181 })] }],
    ["latitude not a number", { points: [point(0, { lat: "x" })] }],
    ["negative speed", { points: [point(0, { speed: -1 })] }],
    ["absurd speed", { points: [point(0, { speed: 500 })] }],
    ["heart rate over 255", { points: [point(0, { hr: 300 })] }],
    ["fractional heart rate", { points: [point(0, { hr: 120.5 })] }],
    ["altitude out of range", { points: [point(0, { alt: 99_999 })] }],
    ["timestamp more than 6 h old", { points: [point(0, { ts: Date.now() - 7 * HOUR })] }],
    ["timestamp in the future", { points: [point(0, { ts: Date.now() + HOUR })] }],
    ["timestamp not an integer", { points: [point(0, { ts: 1.5 })] }],
    ["decreasing timestamps", { points: [point(10), point(0)] }],
    ["repeated timestamp in a batch", { points: [point(5), point(5)] }],
  ];

  it.each(bad)("answers 400 for %s", async (_name, body) => {
    const { cookie } = signUp("bima");
    const { id, writeKey } = await start(cookie);
    const response = await post(id, writeKey, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_body" });
    expect(await count("SELECT COUNT(*) AS n FROM live_point WHERE session_id = ?1", id)).toBe(0);
  });

  it("answers 400 for a body that is not JSON and 413 for a huge one", async () => {
    const { cookie } = signUp("cici");
    const { id, writeKey } = await start(cookie);
    expect((await post(id, writeKey, "{nope")).status).toBe(400);
    expect((await post(id, writeKey, { points: [point(0)], pad: "x".repeat(10_000) })).status).toBe(413);
  });

  it("accepts a point at the edge of the window and coordinates at the limits", async () => {
    const { cookie } = signUp("dodi");
    const { id, writeKey } = await start(cookie);
    const response = await post(id, writeKey, {
      points: [
        { ts: Date.now() - 5 * HOUR, lat: -90, lon: -180 },
        { ts: Date.now() - 1000, lat: 90, lon: 180, alt: -50, speed: 0, hr: 0 },
      ],
    });
    expect(response.status).toBe(200);
  });
});

describe("rate limit", () => {
  it("allows 12 posts a minute per session, then 429 with Retry-After, and starts over the next minute", async () => {
    const { cookie } = signUp("eko");
    const { id, writeKey } = await start(cookie);
    const now = Math.floor(Date.now() / 60_000) * 60_000 + 20_000;
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    const at = (s: number) => ({ points: [{ ts: now - 30_000 + s * 1000, lat: -7.9, lon: 112.6 }] });
    for (let i = 0; i < 12; i++) expect((await post(id, writeKey, at(i))).status).toBe(200);
    const limited = await post(id, writeKey, at(13));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBe(40);
    spy.mockReturnValue(now + 60_000);
    expect((await post(id, writeKey, { points: [{ ts: now + 30_000, lat: -7.9, lon: 112.6 }] })).status).toBe(200);
  });
});

describe("GET /v1/live/:token", () => {
  it("is public: no session, no cookie, and no cache", async () => {
    const { cookie } = signUp("fani");
    const { id, token, writeKey } = await start(cookie);
    await post(id, writeKey, { points: [point(0)] });
    upstream.calls = [];
    const response = await view(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    // Nothing asked JoyoRogo: no session is involved.
    expect(upstream.calls).toHaveLength(0);
  });

  it("answers an unknown and a malformed token the same and reveals nothing", async () => {
    const unknown = await view("A".repeat(22));
    const malformed = await view("short");
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    const expected = { state: "unknown", title: null, startedAt: null, lastAt: null, last: null, track: [] };
    expect(await unknown.json()).toEqual(expected);
    expect(await malformed.json()).toEqual(expected);
  });

  it("does not leak the user, the hashes, the id or the write key", async () => {
    const { cookie, user } = signUp("gita");
    const started = await start(cookie);
    await post(started.id, started.writeKey, { points: [point(0)] });
    const text = await (await view(started.token)).text();
    for (const secret of [user.id, user.email, started.id, started.writeKey, await sha256Hex(started.token), await sha256Hex(started.writeKey)]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["last", "lastAt", "startedAt", "state", "title", "track"]);
    // The write key is not a read capability and the token is not a write key.
    expect((await view(started.writeKey)).status).toBe(404);
    expect((await post(started.id, started.token, { points: [point(1)] })).status).toBe(401);
  });

  it("expires 12 h after the last point and then shows nothing", async () => {
    const { cookie } = signUp("hadi");
    const { id, token, writeKey } = await start(cookie);
    await post(id, writeKey, { points: [point(0)] });
    await env.DB.prepare("UPDATE live_session SET last_at = ?2 WHERE id = ?1").bind(id, Date.now() - 11 * HOUR).run();
    expect((await viewBody(token)).state).toBe("live");
    await env.DB.prepare("UPDATE live_session SET last_at = ?2 WHERE id = ?1").bind(id, Date.now() - 12 * HOUR - 1000).run();
    const expired = await viewBody(token);
    expect(expired).toEqual({ state: "expired", title: null, startedAt: null, lastAt: null, last: null, track: [] });
    const refused = await post(id, writeKey, { points: [point(30)] });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "expired" });
  });

  it("returns at most 300 track points and keeps the first and the last", async () => {
    const { cookie } = signUp("indra");
    const { id, token } = await start(cookie);
    const base = Date.now() - HOUR;
    const rows = Array.from({ length: 1000 }, (_, i) => ({ ts: base + i * 1000, lat: -7 - i * 1e-4, lon: 112 + i * 1e-4 }));
    await env.DB.prepare("INSERT INTO live_point (session_id, ts, lat, lon) SELECT ?1, json_extract(value, '$.ts'), json_extract(value, '$.lat'), json_extract(value, '$.lon') FROM json_each(?2)")
      .bind(id, JSON.stringify(rows))
      .run();
    const body = await viewBody(token);
    const track = body.track ?? [];
    expect(track).toHaveLength(300);
    expect(track[0]).toEqual([-7, 112]);
    expect(track[299]).toEqual([-7.0999, 112.0999]);
    expect(body.last).toMatchObject({ lat: -7.0999, lon: 112.0999 });
    const lats = track.map((p) => p[0]);
    expect([...lats].sort((a, b) => b - a)).toEqual(lats);
  });
});

describe("downsampleTrack", () => {
  it("returns short tracks unchanged", () => {
    expect(downsampleTrack([1, 2, 3], 300)).toEqual([1, 2, 3]);
    expect(downsampleTrack([], 300)).toEqual([]);
  });

  it("keeps the first and the last, in order, with no repeats", () => {
    const input = Array.from({ length: 12_345 }, (_, i) => i);
    const out = downsampleTrack(input, 300);
    expect(out).toHaveLength(300);
    expect(out[0]).toBe(0);
    expect(out[299]).toBe(12_344);
    expect(new Set(out).size).toBe(300);
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });

  it("keeps both ends when the limit is 2", () => {
    expect(downsampleTrack([1, 2, 3, 4, 5], 2)).toEqual([1, 5]);
  });
});

describe("GET /live/:token (the page)", () => {
  it("serves an HTML page with a strict CSP, noindex and no store", async () => {
    const { cookie } = signUp("jaka");
    const { id, token, writeKey } = await start(cookie);
    await post(id, writeKey, { points: [point(0), point(5)] });
    const response = await call(`/live/${token}`, { headers: { "accept-language": "en-US,en;q=0.9" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9_-]{22}'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toContain('<html lang="en">');
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain(`<style nonce="${nonce}">`);
    // No external scripts, styles, images or tiles; the only absolute URLs are the OpenStreetMap links.
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)=/);
    const hosts = new Set([...html.matchAll(/https?:\/\/([^/"'\s\\]+)/g)].map((m) => m[1]));
    expect([...hosts]).toEqual(["www.openstreetmap.org"]);
    expect(html).toContain("Open in OpenStreetMap");
    expect(html).toContain("OpenStreetMap contributors");
    expect(html).toContain("/v1/live/");
  });

  it("follows Accept-Language: Indonesian by default and for id", async () => {
    const { cookie } = signUp("kiki");
    const { token } = await start(cookie);
    for (const header of [undefined, "id-ID,id;q=0.9", "fr"]) {
      const html = await (await call(`/live/${token}`, header ? { headers: { "accept-language": header } } : {})).text();
      expect(html).toContain('<html lang="id">');
      expect(html).toContain("Buka di OpenStreetMap");
      expect(html).toContain("Diperbarui {ago}");
    }
  });

  it("never lets the title out of its data block or into markup (XSS)", async () => {
    const { cookie } = signUp("lola");
    const evil = `</script><script>alert(1)</script><img src=x onerror=alert(1)>"'&\u2028`;
    const { id, token, writeKey } = await start(cookie, evil);
    await post(id, writeKey, { points: [point(0)] });
    const html = await (await call(`/live/${token}`)).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("</script><script>");
    expect(html).not.toContain("\u2028");
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html).toContain("\\u003c/script\\u003e");
    // The data block parses back to the exact title.
    const block = /<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(pageConfig(block).view.title).toBe(evil.replace(/\u2028/g, " ").trim().slice(0, 80));
    // The script writes it with textContent only.
    expect(html).toContain('setText("title"');
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("document.write");
  });

  it("answers an unknown link with a 404 page that says nothing about it", async () => {
    const response = await call(`/live/${"B".repeat(22)}`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await response.text();
    const block = /<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(pageConfig(block).view).toMatchObject({ state: "unknown", title: null });
    expect((await call("/live/short")).status).toBe(404);
  });
});

describe("purge and deletion", () => {
  async function seedSession(userId: string, id: string, lastAt: number, endedAt: number | null) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO live_session (id, user_id, token_hash, write_hash, started_at, last_at, ended_at) VALUES (?1, ?2, ?3, 'w', ?4, ?4, ?5)").bind(id, userId, `t-${id}`, lastAt, endedAt),
      env.DB.prepare("INSERT INTO live_point (session_id, ts, lat, lon) VALUES (?1, ?2, 1, 1), (?1, ?3, 2, 2)").bind(id, lastAt, lastAt + 1),
    ]);
  }

  it("the nightly purge removes sessions and points 24 h after the last point or the end, and keeps the rest", async () => {
    const now = Date.now();
    // One unfinished session per user is an index rule, so each unfinished one has its own user.
    const user = signUp("mira").user.id;
    await seedSession(signUp("mira2").user.id, "old-live", now - 25 * HOUR, null);
    await seedSession(user, "old-ended", now - 30 * HOUR, now - 25 * HOUR);
    await seedSession(signUp("mira3").user.id, "fresh-live", now - 23 * HOUR, null);
    await seedSession(user, "recently-ended", now - 30 * HOUR, now - 23 * HOUR);
    await runScheduled(env, "0 20 * * *", now);
    const left = await env.DB.prepare("SELECT id FROM live_session ORDER BY id").all<{ id: string }>();
    expect(left.results.map((r) => r.id).filter((id) => ["old-live", "old-ended", "fresh-live", "recently-ended"].includes(id))).toEqual(["fresh-live", "recently-ended"]);
    for (const gone of ["old-live", "old-ended"]) expect(await count("SELECT COUNT(*) AS n FROM live_point WHERE session_id = ?1", gone)).toBe(0);
    for (const kept of ["fresh-live", "recently-ended"]) expect(await count("SELECT COUNT(*) AS n FROM live_point WHERE session_id = ?1", kept)).toBe(2);
  });

  it("the other crons leave live data alone", async () => {
    const now = Date.now();
    const user = signUp("nina").user.id;
    await seedSession(user, "keep-me", now - 40 * HOUR, null);
    await runScheduled(env, "0 12 * * *", now);
    expect(await count("SELECT COUNT(*) AS n FROM live_session WHERE id = 'keep-me'")).toBe(1);
  });

  it("DELETE /v1/account and DELETE /v1/data remove the caller's live data and nobody else's", async () => {
    const now = Date.now();
    const alice = signUp("alice");
    const bob = signUp("bob");
    await seedSession(alice.user.id, "alice-1", now, null);
    await seedSession(alice.user.id, "alice-2", now - HOUR, now - HOUR);
    await seedSession(bob.user.id, "bob-1", now, null);

    expect((await call("/v1/data", { method: "DELETE", cookie: alice.cookie })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM live_session WHERE user_id = ?1", alice.user.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM live_point WHERE session_id LIKE 'alice-%'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM live_session WHERE user_id = ?1", bob.user.id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM live_point WHERE session_id = 'bob-1'")).toBe(2);

    await seedSession(alice.user.id, "alice-3", now, null);
    grantApi.handler = () => Response.json({ revoked: true });
    expect((await call("/v1/account", { method: "DELETE", cookie: alice.cookie })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM live_session WHERE user_id = ?1", alice.user.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM live_point WHERE session_id = 'alice-3'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM live_session WHERE user_id = ?1", bob.user.id)).toBe(1);
  });
});
