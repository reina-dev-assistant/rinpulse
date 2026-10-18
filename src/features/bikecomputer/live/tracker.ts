/**
 * The phone side of the live tracking link: keeps the positions of a recorded ride and posts them to the Worker in small batches.
 * Pure: the client, the key-value store and the clock are injected, and the app calls `flush(nowMs)` once a second while a ride
 * records. Rules (docs/bike-computer.md "Live tracking link"):
 *  - at most one point per 5 s is kept; points wait in a buffer of at most 600 (the oldest are dropped first);
 *  - a batch goes out when 20 s passed since the last attempt or 20 points are buffered, at most 30 points per request, never two
 *    requests at once; the first point of a ride goes out at once so the link shows a position quickly;
 *  - a failed request (no network, 5xx, 408, 425, 429) keeps the buffer and retries after 5 s, 15 s, 45 s, then every 60 s;
 *  - a start that fails for the same reasons (no signal at the trailhead) is retried the same way while points are buffered;
 *  - `end()` posts what is left and then ends the session, so the link stops answering;
 *  - the session is persisted, so an app restart that the recorder restores resumes posting to the same link (`resume`).
 */
import { LiveHttpError, LiveUnavailableError, type LiveClient, type LivePoint } from './liveClient';

export type LiveStatus = 'idle' | 'live' | 'offline' | 'ended' | 'error';

/** Why the tracker stopped on its own (`status: 'error'`). */
export type LiveErrorCode = 'not-signed-in' | 'not-configured' | 'unauthorized' | 'expired' | 'session-full' | 'rejected';

export interface LiveState {
  status: LiveStatus;
  /** When the last batch was accepted (the instant passed to `flush`), or null. */
  lastPostAt: number | null;
  /** Points waiting to be posted. */
  pending: number;
  /** The link to share; null until the session exists. */
  viewUrl: string | null;
  error: LiveErrorCode | null;
}

/** The little storage the session survives an app restart in (`expo-sqlite/kv-store` has this shape). */
export interface LiveStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface LiveTrackerOptions {
  client: LiveClient;
  store: LiveStore;
  now: () => number;
}

export const LIVE_STORE_KEY = 'joyofit.bike.live';
export const MIN_POINT_GAP_MS = 5_000;
export const POST_INTERVAL_MS = 20_000;
export const BATCH_TRIGGER = 20;
/** The server takes at most 30 points per request. */
export const MAX_BATCH = 30;
export const BUFFER_CAP = 600;
export const BACKOFF_MS = [5_000, 15_000, 45_000] as const;
export const BACKOFF_CAP_MS = 60_000;
/** A stored session older than this is not resumed (the link expires 12 h after its last batch). */
export const RESUME_WINDOW_MS = 12 * 3_600_000;
/** The server refuses points older than 6 h; a batch is not sent with any, because one stale point would sink the whole batch. */
const STALE_POINT_MS = 5.5 * 3_600_000;

interface StoredSession {
  id: string;
  writeKey: string;
  viewUrl: string;
  startedAt: number;
  /** Set when the ride ended but the server could not be told yet; the next launch tries again instead of resuming. */
  endPending?: boolean;
}

interface Queued {
  seq: number;
  point: LivePoint;
}

const IDLE: LiveState = { status: 'idle', lastPostAt: null, pending: 0, viewUrl: null, error: null };

function parseStored(text: string | null): StoredSession | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    if (!('id' in value) || typeof value.id !== 'string') return null;
    if (!('writeKey' in value) || typeof value.writeKey !== 'string') return null;
    if (!('viewUrl' in value) || typeof value.viewUrl !== 'string') return null;
    if (!('startedAt' in value) || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) return null;
    return { id: value.id, writeKey: value.writeKey, viewUrl: value.viewUrl, startedAt: value.startedAt, ...('endPending' in value && value.endPending === true ? { endPending: true } : {}) };
  } catch {
    return null;
  }
}

const isTransient = (error: unknown): boolean =>
  !(error instanceof LiveUnavailableError) && (!(error instanceof LiveHttpError) || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500);

/** Keeps a sample the server will accept: out-of-range extras become null instead of costing the whole batch. */
function clean(p: LivePoint): LivePoint | null {
  if (![p.ts, p.lat, p.lon].every(Number.isFinite) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  const out: LivePoint = { ts: Math.round(p.ts), lat: p.lat, lon: p.lon };
  if (typeof p.alt === 'number' && p.alt >= -1_000 && p.alt <= 12_000) out.alt = p.alt;
  if (typeof p.speed === 'number' && p.speed >= 0 && p.speed <= 120) out.speed = p.speed;
  if (typeof p.hr === 'number' && p.hr >= 0 && p.hr <= 255) out.hr = Math.round(p.hr);
  return out;
}

export class LiveTracker {
  private readonly client: LiveClient;
  private readonly store: LiveStore;
  private readonly now: () => number;

  private state: LiveState = IDLE;
  private readonly listeners = new Set<(state: LiveState) => void>();
  /** Between `begin`/`resume` and the end of the ride. */
  private active = false;
  private title: string | null = null;
  private session: StoredSession | null = null;
  /** A finished ride whose `/end` has not got through yet. */
  private pendingEnd: StoredSession | null = null;
  private buffer: Queued[] = [];
  private seq = 0;
  private lastTs = Number.NEGATIVE_INFINITY;
  private lastAttemptAt: number | null = null;
  private retryAt = 0;
  private failures = 0;
  private inflight: Promise<void> | null = null;

  constructor({ client, store, now }: LiveTrackerOptions) {
    this.client = client;
    this.store = store;
    this.now = now;
  }

  getState(): LiveState {
    return this.state;
  }

  subscribe(listener: (state: LiveState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Starts sharing: creates the session on the server. Never throws: with no signal the state is `offline` and the start is retried
   * by `flush`; with no sign-in or no cloud server it is `error`.
   */
  async begin(title: string | null): Promise<LiveState> {
    if (this.active) return this.state;
    this.reset();
    this.active = true;
    this.title = title;
    this.setState({ status: 'offline' });
    await this.flush(this.now());
    return this.state;
  }

  /** Picks up the session of a ride the recorder restored after a restart. True when posting continues on the same link. */
  async resume(): Promise<boolean> {
    if (this.active) return true;
    const stored = parseStored(await this.store.getItem(LIVE_STORE_KEY).catch(() => null));
    const now = this.now();
    if (!stored || now - stored.startedAt >= RESUME_WINDOW_MS) {
      await this.forget();
      return false;
    }
    if (stored.endPending) {
      this.pendingEnd = stored;
      await this.flush(now);
      return false;
    }
    this.reset();
    this.session = stored;
    this.active = true;
    this.setState({ status: 'live', viewUrl: stored.viewUrl });
    return true;
  }

  /** Offers one position (about once a second from the recorder); at most one per 5 s is kept. */
  addPoint(point: LivePoint): void {
    if (!this.active) return;
    const kept = clean(point);
    if (!kept || kept.ts - this.lastTs < MIN_POINT_GAP_MS) return;
    this.lastTs = kept.ts;
    this.buffer.push({ seq: ++this.seq, point: kept });
    if (this.buffer.length > BUFFER_CAP) this.buffer.splice(0, this.buffer.length - BUFFER_CAP);
    this.setState({ pending: this.buffer.length });
  }

  /** Called every second by the app: sends what is due. Never throws, never runs two requests at once. */
  async flush(nowMs: number): Promise<void> {
    if (this.inflight) return;
    const job = this.nextJob(nowMs);
    if (job) await this.runJob(job);
  }

  /**
   * Ends sharing: posts the rest, then tells the server so the link stops answering. If the server cannot be reached the end is
   * remembered and retried (by `flush`, and at the next launch by `resume`).
   */
  async end(): Promise<void> {
    if (this.inflight) await this.inflight;
    this.active = false;
    const session = this.session;
    if (!session) {
      if (this.state.status === 'live' || this.state.status === 'offline') this.setState({ ...IDLE });
      return;
    }
    for (let before = Number.POSITIVE_INFINITY; this.session && this.buffer.length > 0 && this.buffer.length < before; ) {
      before = this.buffer.length;
      await this.runJob(() => this.postBatch(this.now()));
    }
    if (!this.session) return;
    this.session = null;
    this.buffer = [];
    this.pendingEnd = session;
    this.failures = 0;
    this.retryAt = 0;
    this.setState({ status: 'ended', pending: 0 });
    await this.runJob(() => this.sendEnd(this.now()));
  }

  private nextJob(nowMs: number): (() => Promise<void>) | null {
    if (this.pendingEnd) return nowMs >= this.retryAt ? () => this.sendEnd(nowMs) : null;
    if (!this.active || nowMs < this.retryAt) return null;
    if (!this.session) return () => this.startSession(nowMs);
    if (this.buffer.length === 0) return null;
    const due = this.failures > 0 || this.lastAttemptAt === null || nowMs - this.lastAttemptAt >= POST_INTERVAL_MS || this.buffer.length >= BATCH_TRIGGER;
    return due ? () => this.postBatch(nowMs) : null;
  }

  private async runJob(job: () => Promise<void>): Promise<void> {
    const running = job().finally(() => {
      this.inflight = null;
    });
    this.inflight = running;
    await running;
  }

  private async startSession(nowMs: number): Promise<void> {
    try {
      const created = await this.client.start(this.title);
      this.session = { id: created.id, writeKey: created.writeKey, viewUrl: created.viewUrl, startedAt: this.now() };
      await this.persist(this.session);
      this.failures = 0;
      this.retryAt = 0;
      this.setState({ status: 'live', viewUrl: created.viewUrl, error: null });
    } catch (error) {
      await this.fail(error, nowMs);
    }
  }

  private async postBatch(nowMs: number): Promise<void> {
    const session = this.session;
    if (!session) return;
    const fresh = this.buffer.filter((q) => nowMs - q.point.ts < STALE_POINT_MS);
    if (fresh.length !== this.buffer.length) this.buffer = fresh;
    const batch = this.buffer.slice(0, MAX_BATCH);
    const last = batch[batch.length - 1];
    if (!last) {
      this.setState({ pending: 0 });
      return;
    }
    this.lastAttemptAt = nowMs;
    try {
      await this.client.postPoints(session.id, session.writeKey, batch.map((q) => q.point));
      this.buffer = this.buffer.filter((q) => q.seq > last.seq);
      this.failures = 0;
      this.retryAt = 0;
      this.setState({ status: 'live', lastPostAt: nowMs, pending: this.buffer.length, error: null });
    } catch (error) {
      if (error instanceof LiveHttpError && error.status === 400) {
        // The server will never take this batch; keeping it would block every later one.
        this.buffer = this.buffer.filter((q) => q.seq > last.seq);
        this.setState({ pending: this.buffer.length });
        return;
      }
      await this.fail(error, nowMs);
    }
  }

  private async sendEnd(nowMs: number): Promise<void> {
    const session = this.pendingEnd;
    if (!session) return;
    try {
      await this.client.end(session.id, session.writeKey);
    } catch (error) {
      if (isTransient(error)) {
        this.backoff(error, nowMs);
        await this.persist({ ...session, endPending: true });
        return;
      }
    }
    this.pendingEnd = null;
    this.failures = 0;
    this.retryAt = 0;
    await this.forget();
  }

  /** Decides what a failed request means: wait and retry, or stop for good. */
  private async fail(error: unknown, nowMs: number): Promise<void> {
    if (isTransient(error)) {
      this.backoff(error, nowMs);
      this.setState({ status: 'offline', pending: this.buffer.length });
      return;
    }
    let status: LiveStatus = 'error';
    let code: LiveErrorCode | null = 'rejected';
    if (error instanceof LiveUnavailableError) code = error.reason;
    else if (error instanceof LiveHttpError) {
      if (error.status === 401) code = 'unauthorized';
      else if (error.status === 409 && error.code === 'ended') [status, code] = ['ended', null];
      else if (error.status === 409 && error.code === 'expired') code = 'expired';
      else if (error.status === 409 && error.code === 'session_full') code = 'session-full';
    }
    this.active = false;
    this.session = null;
    this.buffer = [];
    await this.forget();
    this.setState({ status, error: code, pending: 0 });
  }

  private backoff(error: unknown, nowMs: number): void {
    this.failures += 1;
    const step = BACKOFF_MS[this.failures - 1] ?? BACKOFF_CAP_MS;
    const hinted = error instanceof LiveHttpError && error.retryAfterMs !== null ? Math.min(error.retryAfterMs, BACKOFF_CAP_MS) : 0;
    this.retryAt = nowMs + Math.max(step, hinted);
  }

  private reset(): void {
    this.active = false;
    this.title = null;
    this.session = null;
    this.pendingEnd = null;
    this.buffer = [];
    this.lastTs = Number.NEGATIVE_INFINITY;
    this.lastAttemptAt = null;
    this.retryAt = 0;
    this.failures = 0;
    this.state = IDLE;
    this.emit();
  }

  private async persist(session: StoredSession): Promise<void> {
    try {
      await this.store.setItem(LIVE_STORE_KEY, JSON.stringify(session));
    } catch {
      // The link still works for this run; only a restart could not resume it.
    }
  }

  private async forget(): Promise<void> {
    try {
      await this.store.removeItem(LIVE_STORE_KEY);
    } catch {
      // Nothing to do: a stale record is ignored once it is 12 h old.
    }
  }

  private setState(patch: Partial<LiveState>): void {
    const next = { ...this.state, ...patch };
    if (next.status === this.state.status && next.lastPostAt === this.state.lastPostAt && next.pending === this.state.pending && next.viewUrl === this.state.viewUrl && next.error === this.state.error) return;
    this.state = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
