/**
 * Client of the live tracking routes of the Worker (`server/src/live.ts`, docs/bike-computer.md "Live tracking link").
 * Pure: `fetch` and the session headers are injected, so it runs under `bun test`. Starting a session uses the JoyoRogo session
 * (a `Cookie` header from `sessionHeaders`); posting points and ending use the session's write key as a Bearer token only, so a
 * backgrounded phone whose sign-in has expired keeps posting.
 */

/** One position of the ride. `ts` is Unix milliseconds, `speed` is metres per second. */
export interface LivePoint {
  ts: number;
  lat: number;
  lon: number;
  alt?: number | null;
  speed?: number | null;
  hr?: number | null;
}

/** What `POST /v1/live` answers, once. The write key never leaves the phone; the link is what the rider shares. */
export interface LiveSession {
  id: string;
  viewUrl: string;
  token: string;
  writeKey: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LiveClientOptions {
  /** The Worker origin, without a trailing slash. Empty means the cloud is not configured. */
  baseUrl: string;
  fetch: FetchLike;
  /** The headers that carry the JoyoRogo session (`Cookie`), or null when nobody is signed in. */
  sessionHeaders: () => Promise<Record<string, string> | null>;
  /** Per-request timeout; a phone on one bar of signal must not hang a request for minutes. */
  timeoutMs?: number;
}

/** The server answered with a non-2xx status. `code` is its `{ error }`. */
export class LiveHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly retryAfterMs: number | null,
  ) {
    super(code ? `live ${status} ${code}` : `live ${status}`);
    this.name = 'LiveHttpError';
  }
}

/** Starting needs a JoyoRogo session and there is none, or the cloud server is not configured. Not retryable. */
export class LiveUnavailableError extends Error {
  constructor(readonly reason: 'not-signed-in' | 'not-configured') {
    super(`live unavailable: ${reason}`);
    this.name = 'LiveUnavailableError';
  }
}

export interface LiveClient {
  start(title: string | null): Promise<LiveSession>;
  /** Resolves with how many points the server stored (a retried batch stores fewer). */
  postPoints(id: string, writeKey: string, points: readonly LivePoint[]): Promise<number>;
  end(id: string, writeKey: string): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function isSession(value: unknown): value is LiveSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'viewUrl' in value &&
    typeof value.viewUrl === 'string' &&
    'token' in value &&
    typeof value.token === 'string' &&
    'writeKey' in value &&
    typeof value.writeKey === 'string'
  );
}

export function createLiveClient({ baseUrl, fetch: doFetch, sessionHeaders, timeoutMs = DEFAULT_TIMEOUT_MS }: LiveClientOptions): LiveClient {
  async function request(path: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!response.ok) {
        const json: unknown = await response.json().catch(() => null);
        const code = typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string' ? json.error : null;
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new LiveHttpError(response.status, code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async start(title) {
      if (baseUrl === '') throw new LiveUnavailableError('not-configured');
      const headers = await sessionHeaders();
      if (!headers) throw new LiveUnavailableError('not-signed-in');
      const session = await request('/v1/live', headers, { title });
      if (!isSession(session)) throw new LiveHttpError(502, 'bad_answer', null);
      return session;
    },
    async postPoints(id, writeKey, points) {
      const answer = await request(`/v1/live/${encodeURIComponent(id)}/points`, { Authorization: `Bearer ${writeKey}` }, { points });
      return typeof answer === 'object' && answer !== null && 'stored' in answer && typeof answer.stored === 'number' ? answer.stored : points.length;
    },
    async end(id, writeKey) {
      await request(`/v1/live/${encodeURIComponent(id)}/end`, { Authorization: `Bearer ${writeKey}` }, {});
    },
  };
}
