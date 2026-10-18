import { describe, expect, it } from 'bun:test';

import { createLiveClient, type FetchLike, type LivePoint } from './liveClient';
import { BUFFER_CAP, LIVE_STORE_KEY, LiveTracker, type LiveState, type LiveStore } from './tracker';

const T0 = 1_700_000_000_000;
const SESSION = { id: 'sess-1', viewUrl: 'https://api.test/live/tok', token: 'tok', writeKey: 'wkey' };

interface Call {
  path: string;
  authorization: string | null;
  cookie: string | null;
  body: { points?: LivePoint[]; title?: string | null } | null;
}

/** A Worker that answers like the real one unless told otherwise. */
class FakeServer {
  calls: Call[] = [];
  offline = false;
  /** Status answers consumed one per request before the normal answer; `{ status, error, retryAfter }`. */
  script: { status: number; error?: string; retryAfter?: number }[] = [];
  gate: Promise<void> | null = null;
  inflight = 0;
  maxInflight = 0;

  fetch: FetchLike = async (url, init) => {
    const headers = new Headers(init.headers);
    const body: Call['body'] = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const path = url.replace('https://api.test', '');
    this.calls.push({ path, authorization: headers.get('authorization'), cookie: headers.get('cookie'), body });
    this.inflight += 1;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    try {
      if (this.gate) await this.gate;
      if (this.offline) throw new TypeError('Network request failed');
      const next = this.script.shift();
      if (next) {
        return Response.json(next.error ? { error: next.error } : {}, {
          status: next.status,
          headers: next.retryAfter ? { 'retry-after': String(next.retryAfter) } : {},
        });
      }
      if (path === '/v1/live') return Response.json(SESSION, { status: 201 });
      if (path.endsWith('/points')) return Response.json({ stored: body?.points?.length ?? 0 });
      return Response.json({ ended: true });
    } finally {
      this.inflight -= 1;
    }
  };

  posts(): Call[] {
    return this.calls.filter((c) => c.path.endsWith('/points'));
  }
  starts(): Call[] {
    return this.calls.filter((c) => c.path === '/v1/live');
  }
  ends(): Call[] {
    return this.calls.filter((c) => c.path.endsWith('/end'));
  }
}

class MemoryStore implements LiveStore {
  data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async removeItem(key: string) {
    this.data.delete(key);
  }
}

function setup(signedIn = true) {
  const server = new FakeServer();
  const store = new MemoryStore();
  const clock = { t: T0 };
  const client = createLiveClient({ baseUrl: 'https://api.test', fetch: server.fetch, sessionHeaders: async () => (signedIn ? { Cookie: 'session=abc' } : null) });
  const tracker = new LiveTracker({ client, store, now: () => clock.t });
  return { server, store, clock, tracker };
}

const at = (offsetMs: number, extra: Partial<LivePoint> = {}): LivePoint => ({ ts: T0 + offsetMs, lat: -7.95 + offsetMs / 1e8, lon: 112.6, speed: 7, hr: 140, ...extra });

describe('begin', () => {
  it('creates the session with the cookie and the title and exposes the link', async () => {
    const { server, tracker, store } = setup();
    const state = await tracker.begin('Morning ride');
    expect(state).toMatchObject({ status: 'live', viewUrl: SESSION.viewUrl, pending: 0, lastPostAt: null, error: null });
    expect(server.starts()).toHaveLength(1);
    expect(server.starts()[0]?.cookie).toBe('session=abc');
    expect(server.starts()[0]?.body).toEqual({ title: 'Morning ride' });
    expect(JSON.parse(store.data.get(LIVE_STORE_KEY) ?? '{}')).toEqual({ id: 'sess-1', writeKey: 'wkey', viewUrl: SESSION.viewUrl, startedAt: T0 });
  });

  it('does not start a second session while one is active', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    await tracker.begin(null);
    expect(server.starts()).toHaveLength(1);
  });

  it('stops with an error when nobody is signed in, and keeps no points', async () => {
    const { server, tracker } = setup(false);
    expect(await tracker.begin(null)).toMatchObject({ status: 'error', error: 'not-signed-in', viewUrl: null });
    tracker.addPoint(at(0));
    expect(tracker.getState().pending).toBe(0);
    expect(server.calls).toHaveLength(0);
  });

  it('with no signal at the start: offline, keeps points, creates the session when the network returns', async () => {
    const { server, tracker, clock } = setup();
    server.offline = true;
    expect(await tracker.begin('x')).toMatchObject({ status: 'offline', viewUrl: null });
    tracker.addPoint(at(0));
    tracker.addPoint(at(5_000));
    await tracker.flush(T0 + 1_000);
    expect(server.starts()).toHaveLength(1);
    server.offline = false;
    clock.t = T0 + 5_000;
    await tracker.flush(T0 + 5_000);
    expect(server.starts()).toHaveLength(2);
    expect(tracker.getState()).toMatchObject({ status: 'live', viewUrl: SESSION.viewUrl, pending: 2 });
    await tracker.flush(T0 + 6_000);
    expect(server.posts()[0]?.body?.points).toHaveLength(2);
    expect(tracker.getState().pending).toBe(0);
  });
});

describe('addPoint', () => {
  it('keeps at most one point per 5 s', async () => {
    const { tracker } = setup();
    await tracker.begin(null);
    for (const ms of [0, 1_000, 4_999, 5_000, 5_001, 9_999, 10_000, 12_000]) tracker.addPoint(at(ms));
    expect(tracker.getState().pending).toBe(3);
  });

  it('ignores a point that goes back in time, and points before begin or after end', async () => {
    const { tracker } = setup();
    tracker.addPoint(at(0));
    expect(tracker.getState().pending).toBe(0);
    await tracker.begin(null);
    tracker.addPoint(at(10_000));
    tracker.addPoint(at(0));
    expect(tracker.getState().pending).toBe(1);
    await tracker.end();
    tracker.addPoint(at(60_000));
    expect(tracker.getState().pending).toBe(0);
  });

  it('sends only what the server accepts: bad coordinates are dropped, bad extras become absent', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0, { lat: 91 }));
    tracker.addPoint(at(5_000, { lon: Number.NaN }));
    tracker.addPoint(at(10_000, { speed: 500, hr: 300, alt: 99_999 }));
    tracker.addPoint(at(15_000, { speed: -1, hr: 61.6, alt: 12.5 }));
    await tracker.flush(T0 + 16_000);
    const points = server.posts()[0]?.body?.points ?? [];
    expect(points).toEqual([
      { ts: T0 + 10_000, lat: -7.95 + 10_000 / 1e8, lon: 112.6 },
      { ts: T0 + 15_000, lat: -7.95 + 15_000 / 1e8, lon: 112.6, alt: 12.5, hr: 62 },
    ]);
  });
});

describe('batching', () => {
  it('posts the first point at once, then a batch every 20 s', async () => {
    const { server, tracker, clock } = setup();
    await tracker.begin(null);
    const batchSizes: number[] = [];
    const postTimes: number[] = [];
    for (let s = 0; s <= 65; s++) {
      clock.t = T0 + s * 1000;
      if (s % 5 === 0) tracker.addPoint(at(s * 1000));
      const before = server.posts().length;
      await tracker.flush(T0 + s * 1000);
      if (server.posts().length > before) {
        postTimes.push(s);
        batchSizes.push(server.posts().at(-1)?.body?.points?.length ?? 0);
      }
    }
    expect(postTimes).toEqual([0, 20, 40, 60]);
    expect(batchSizes).toEqual([1, 4, 4, 4]);
    expect(tracker.getState()).toMatchObject({ status: 'live', lastPostAt: T0 + 60_000, pending: 1 });
    expect(server.posts().every((c) => c.authorization === 'Bearer wkey' && c.cookie === null)).toBe(true);
    expect(server.posts()[0]?.path).toBe('/v1/live/sess-1/points');
  });

  it('posts early once 20 points are buffered, at most 30 per request', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    await tracker.flush(T0);
    expect(server.posts()).toHaveLength(1);
    for (let i = 1; i <= 19; i++) tracker.addPoint(at(i * 5_000));
    await tracker.flush(T0 + 1_000);
    expect(server.posts()).toHaveLength(1);
    tracker.addPoint(at(20 * 5_000));
    await tracker.flush(T0 + 2_000);
    expect(server.posts()).toHaveLength(2);
    expect(server.posts()[1]?.body?.points).toHaveLength(20);

    for (let i = 21; i <= 70; i++) tracker.addPoint(at(i * 5_000));
    for (let s = 3; s < 10; s++) await tracker.flush(T0 + s * 1_000);
    const sizes = server.posts().slice(2).map((c) => c.body?.points?.length);
    expect(sizes).toEqual([30, 20]);
  });

  it('never has two requests in flight', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    const { promise, resolve } = Promise.withResolvers<void>();
    server.gate = promise;
    const first = tracker.flush(T0);
    const second = tracker.flush(T0 + 1_000);
    tracker.addPoint(at(5_000));
    const third = tracker.flush(T0 + 30_000);
    await Promise.resolve();
    expect(server.posts()).toHaveLength(1);
    resolve();
    await Promise.all([first, second, third]);
    expect(server.maxInflight).toBe(1);
    expect(server.posts()).toHaveLength(1);
    server.gate = null;
    await tracker.flush(T0 + 31_000);
    expect(server.posts()).toHaveLength(2);
  });

  it('drops the points that came in while a batch was on the wire only after the batch is accepted', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    const { promise, resolve } = Promise.withResolvers<void>();
    server.gate = promise;
    const flushing = tracker.flush(T0);
    tracker.addPoint(at(5_000));
    tracker.addPoint(at(10_000));
    resolve();
    await flushing;
    expect(tracker.getState().pending).toBe(2);
  });
});

describe('failures and backoff', () => {
  it('retries after 5 s, 15 s, 45 s and then every 60 s, keeping the buffer, and recovers', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    for (let i = 0; i < 4; i++) tracker.addPoint(at(i * 5_000));
    server.offline = true;
    const attempts: number[] = [];
    let seen = 0;
    for (let s = 0; s <= 200; s++) {
      await tracker.flush(T0 + s * 1000);
      if (server.posts().length > seen) {
        attempts.push(s);
        seen = server.posts().length;
      }
    }
    // attempt at 0, then +5 s, +15 s, +45 s, +60 s, +60 s, +60 s
    expect(attempts).toEqual([0, 5, 20, 65, 125, 185]);
    expect(tracker.getState()).toMatchObject({ status: 'offline', pending: 4, lastPostAt: null });

    server.offline = false;
    await tracker.flush(T0 + 245_000);
    expect(tracker.getState()).toMatchObject({ status: 'live', pending: 0, lastPostAt: T0 + 245_000 });
    expect(server.posts().at(-1)?.body?.points).toHaveLength(4);
  });

  it('starts the backoff over after a success', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    server.offline = true;
    await tracker.flush(T0);
    server.offline = false;
    await tracker.flush(T0 + 5_000);
    expect(tracker.getState().status).toBe('live');
    tracker.addPoint(at(10_000));
    server.offline = true;
    await tracker.flush(T0 + 25_000);
    tracker.addPoint(at(30_000));
    server.offline = false;
    await tracker.flush(T0 + 29_999);
    expect(server.posts()).toHaveLength(3);
    await tracker.flush(T0 + 30_000);
    expect(server.posts()).toHaveLength(4);
  });

  it('honours Retry-After when it is longer than the backoff step', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    server.script = [{ status: 429, error: 'rate_limited', retryAfter: 40 }];
    await tracker.flush(T0);
    expect(tracker.getState().status).toBe('offline');
    await tracker.flush(T0 + 39_999);
    expect(server.posts()).toHaveLength(1);
    await tracker.flush(T0 + 40_000);
    expect(server.posts()).toHaveLength(2);
    expect(tracker.getState()).toMatchObject({ status: 'live', pending: 0 });
  });

  it('treats a 5xx like a lost connection', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    server.script = [{ status: 503 }];
    await tracker.flush(T0);
    expect(tracker.getState()).toMatchObject({ status: 'offline', pending: 1 });
  });

  it('caps the buffer at 600 points and drops the oldest', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    server.offline = true;
    const total = BUFFER_CAP + 100;
    for (let i = 0; i < total; i++) tracker.addPoint(at(i * 5_000));
    expect(tracker.getState().pending).toBe(BUFFER_CAP);
    server.offline = false;
    const now = T0 + total * 5_000;
    await tracker.flush(now);
    expect(server.posts()[0]?.body?.points?.[0]?.ts).toBe(T0 + 100 * 5_000);
    expect(server.posts()[0]?.body?.points).toHaveLength(30);
    for (let s = 1; s <= 25; s++) await tracker.flush(now + s * 1_000);
    expect(tracker.getState().pending).toBe(0);
    expect(server.posts().reduce((n, c) => n + (c.body?.points?.length ?? 0), 0)).toBe(BUFFER_CAP);
  });

  it('does not send points older than the server accepts, and keeps the fresh ones', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    tracker.addPoint(at(7 * 3_600_000));
    await tracker.flush(T0 + 7 * 3_600_000 + 1_000);
    expect(server.posts()[0]?.body?.points).toEqual([expect.objectContaining({ ts: T0 + 7 * 3_600_000 })]);
  });

  it('drops a batch the server will never take (400) and goes on with the next', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    server.script = [{ status: 400, error: 'invalid_body' }];
    await tracker.flush(T0);
    expect(tracker.getState()).toMatchObject({ status: 'live', pending: 0 });
    tracker.addPoint(at(5_000));
    await tracker.flush(T0 + 20_000);
    expect(server.posts()).toHaveLength(2);
    expect(tracker.getState()).toMatchObject({ status: 'live', pending: 0, lastPostAt: T0 + 20_000 });
  });

  it('stops for good on 401, forgets the session and ignores later points', async () => {
    const { server, tracker, store } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    server.script = [{ status: 401, error: 'unauthorized' }];
    await tracker.flush(T0);
    expect(tracker.getState()).toMatchObject({ status: 'error', error: 'unauthorized', pending: 0 });
    expect(store.data.has(LIVE_STORE_KEY)).toBe(false);
    tracker.addPoint(at(5_000));
    await tracker.flush(T0 + 60_000);
    expect(tracker.getState().pending).toBe(0);
    expect(server.posts()).toHaveLength(1);
  });

  it('409 ended means the link was ended elsewhere: status ended; 409 expired and session_full are errors', async () => {
    for (const [code, expected] of [
      ['ended', { status: 'ended', error: null }],
      ['expired', { status: 'error', error: 'expired' }],
      ['session_full', { status: 'error', error: 'session-full' }],
    ] as const) {
      const { server, tracker, store } = setup();
      await tracker.begin(null);
      tracker.addPoint(at(0));
      server.script = [{ status: 409, error: code }];
      await tracker.flush(T0);
      expect(tracker.getState()).toMatchObject(expected);
      expect(store.data.has(LIVE_STORE_KEY)).toBe(false);
    }
  });
});

describe('end', () => {
  it('posts the rest in batches, then ends the session, then forgets it', async () => {
    const { server, tracker, store } = setup();
    await tracker.begin(null);
    for (let i = 0; i < 65; i++) tracker.addPoint(at(i * 5_000));
    await tracker.end();
    expect(server.posts().map((c) => c.body?.points?.length)).toEqual([30, 30, 5]);
    expect(server.ends()).toHaveLength(1);
    expect(server.ends()[0]?.path).toBe('/v1/live/sess-1/end');
    expect(server.ends()[0]?.authorization).toBe('Bearer wkey');
    expect(server.calls.at(-1)?.path.endsWith('/end')).toBe(true);
    expect(tracker.getState()).toMatchObject({ status: 'ended', pending: 0, viewUrl: SESSION.viewUrl });
    expect(store.data.has(LIVE_STORE_KEY)).toBe(false);
  });

  it('waits for a request in flight before posting the rest', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    const { promise, resolve } = Promise.withResolvers<void>();
    server.gate = promise;
    const flushing = tracker.flush(T0);
    tracker.addPoint(at(5_000));
    const ending = tracker.end();
    await Promise.resolve();
    expect(server.calls.filter((c) => c.path !== '/v1/live')).toHaveLength(1);
    server.gate = null;
    resolve();
    await Promise.all([flushing, ending]);
    expect(server.maxInflight).toBe(1);
    expect(server.posts().map((c) => c.body?.points?.length)).toEqual([1, 1]);
    expect(server.ends()).toHaveLength(1);
  });

  it('still ends the session when the last points cannot be posted', async () => {
    const { server, tracker } = setup();
    await tracker.begin(null);
    tracker.addPoint(at(0));
    server.script = [{ status: 503 }];
    await tracker.end();
    expect(server.ends()).toHaveLength(1);
    expect(tracker.getState().status).toBe('ended');
  });

  it('remembers an end the server did not get, retries it from flush, and then forgets it', async () => {
    const { server, tracker, store } = setup();
    await tracker.begin(null);
    server.offline = true;
    await tracker.end();
    expect(tracker.getState().status).toBe('ended');
    expect(JSON.parse(store.data.get(LIVE_STORE_KEY) ?? '{}')).toMatchObject({ id: 'sess-1', endPending: true });
    await tracker.flush(T0 + 1_000);
    expect(server.ends()).toHaveLength(1);
    server.offline = false;
    await tracker.flush(T0 + 5_000);
    expect(server.ends()).toHaveLength(2);
    expect(store.data.has(LIVE_STORE_KEY)).toBe(false);
    await tracker.flush(T0 + 100_000);
    expect(server.ends()).toHaveLength(2);
  });

  it('with no session ever created goes back to idle and sends nothing', async () => {
    const { server, tracker } = setup();
    server.offline = true;
    await tracker.begin(null);
    tracker.addPoint(at(0));
    await tracker.end();
    expect(tracker.getState()).toMatchObject({ status: 'idle', pending: 0 });
    expect(server.ends()).toHaveLength(0);
  });
});

describe('resume', () => {
  async function stored(startedAgoMs: number, extra: Record<string, unknown> = {}) {
    const first = setup();
    first.store.data.set(LIVE_STORE_KEY, JSON.stringify({ id: 'old-1', writeKey: 'old-key', viewUrl: 'https://api.test/live/old', startedAt: T0 - startedAgoMs, ...extra }));
    return first;
  }

  it('continues posting to the same session after a restart, without creating a new one', async () => {
    const { server, tracker } = await stored(3_600_000);
    expect(await tracker.resume()).toBe(true);
    expect(tracker.getState()).toMatchObject({ status: 'live', viewUrl: 'https://api.test/live/old' });
    tracker.addPoint(at(0));
    await tracker.flush(T0);
    expect(server.starts()).toHaveLength(0);
    expect(server.posts()[0]?.path).toBe('/v1/live/old-1/points');
    expect(server.posts()[0]?.authorization).toBe('Bearer old-key');
    await tracker.end();
    expect(server.ends()[0]?.path).toBe('/v1/live/old-1/end');
  });

  it('does not resume a session started 12 h ago or more, and clears it', async () => {
    const { server, tracker, store } = await stored(12 * 3_600_000);
    expect(await tracker.resume()).toBe(false);
    expect(tracker.getState().status).toBe('idle');
    expect(store.data.has(LIVE_STORE_KEY)).toBe(false);
    expect(server.calls).toHaveLength(0);
  });

  it('resumes one that is just under 12 h old', async () => {
    const { tracker } = await stored(12 * 3_600_000 - 1);
    expect(await tracker.resume()).toBe(true);
  });

  it('is false with nothing stored or with garbage', async () => {
    const { tracker, store } = setup();
    expect(await tracker.resume()).toBe(false);
    store.data.set(LIVE_STORE_KEY, '{"id":1}');
    expect(await tracker.resume()).toBe(false);
    store.data.set(LIVE_STORE_KEY, 'not json');
    expect(await tracker.resume()).toBe(false);
    expect(tracker.getState().status).toBe('idle');
  });

  it('finishes an end that was pending instead of resuming', async () => {
    const { server, tracker, store } = await stored(3_600_000, { endPending: true });
    expect(await tracker.resume()).toBe(false);
    expect(server.ends()).toHaveLength(1);
    expect(server.ends()[0]?.path).toBe('/v1/live/old-1/end');
    expect(store.data.has(LIVE_STORE_KEY)).toBe(false);
    expect(tracker.getState().status).toBe('idle');
  });
});

describe('subscribe', () => {
  it('tells listeners about each change and stops after unsubscribe', async () => {
    const { tracker } = setup();
    const seen: LiveState[] = [];
    const unsubscribe = tracker.subscribe((s) => seen.push(s));
    await tracker.begin(null);
    tracker.addPoint(at(0));
    expect(seen.map((s) => [s.status, s.pending])).toEqual([
      ['idle', 0],
      ['offline', 0],
      ['live', 0],
      ['live', 1],
    ]);
    unsubscribe();
    tracker.addPoint(at(5_000));
    expect(seen).toHaveLength(4);
    expect(tracker.getState().pending).toBe(2);
  });
});
