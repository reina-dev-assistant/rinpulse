import { describe, expect, it } from 'bun:test';

import { createLiveClient, LiveHttpError, LiveUnavailableError, type FetchLike } from './liveClient';

interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ url, method: init.method, headers, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    return answer();
  };
  return { fetch, calls };
}

const SESSION = { id: 'id-1', viewUrl: 'https://api.test/live/tok', token: 'tok', writeKey: 'key' };
const cookie = async () => ({ Cookie: 'session_token=abc' });

describe('createLiveClient', () => {
  it('starts a session with the JoyoRogo cookie and the title', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(SESSION, { status: 201 }));
    const client = createLiveClient({ baseUrl: 'https://api.test', fetch, sessionHeaders: cookie });
    expect(await client.start('Morning ride')).toEqual(SESSION);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.test/v1/live');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.cookie).toBe('session_token=abc');
    expect(calls[0]?.body).toEqual({ title: 'Morning ride' });
  });

  it('refuses to start without a session or without a server, before any request', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(SESSION));
    const signedOut = createLiveClient({ baseUrl: 'https://api.test', fetch, sessionHeaders: async () => null });
    const error = await signedOut.start(null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveUnavailableError);
    expect(error).toMatchObject({ reason: 'not-signed-in' });
    const unconfigured = createLiveClient({ baseUrl: '', fetch, sessionHeaders: cookie });
    expect(await unconfigured.start(null).catch((e: unknown) => e)).toMatchObject({ reason: 'not-configured' });
    expect(calls).toHaveLength(0);
  });

  it('posts points with the write key only, never the cookie', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ stored: 2 }));
    const client = createLiveClient({ baseUrl: 'https://api.test', fetch, sessionHeaders: cookie });
    const points = [
      { ts: 1, lat: 1, lon: 2 },
      { ts: 2, lat: 1, lon: 2, speed: 3 },
    ];
    expect(await client.postPoints('id/1', 'secret', points)).toBe(2);
    expect(calls[0]?.url).toBe('https://api.test/v1/live/id%2F1/points');
    expect(calls[0]?.headers.authorization).toBe('Bearer secret');
    expect(calls[0]?.headers.cookie).toBeUndefined();
    expect(calls[0]?.body).toEqual({ points });
  });

  it('ends with the write key', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ ended: true }));
    const client = createLiveClient({ baseUrl: 'https://api.test', fetch, sessionHeaders: cookie });
    await client.end('id-1', 'secret');
    expect(calls[0]?.url).toBe('https://api.test/v1/live/id-1/end');
    expect(calls[0]?.headers.authorization).toBe('Bearer secret');
  });

  it('turns an error answer into a LiveHttpError with its code and Retry-After', async () => {
    const { fetch } = fakeFetch(() => Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '40' } }));
    const client = createLiveClient({ baseUrl: 'https://api.test', fetch, sessionHeaders: cookie });
    const error = await client.postPoints('id', 'k', [{ ts: 1, lat: 0, lon: 0 }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveHttpError);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfterMs: 40_000 });
  });

  it('copes with an error answer that is not JSON', async () => {
    const { fetch } = fakeFetch(() => new Response('upstream broke', { status: 502 }));
    const client = createLiveClient({ baseUrl: 'https://api.test', fetch, sessionHeaders: cookie });
    expect(await client.end('id', 'k').catch((e: unknown) => e)).toMatchObject({ status: 502, code: null, retryAfterMs: null });
  });

  it('rejects a start answer that is missing the secrets', async () => {
    const { fetch } = fakeFetch(() => Response.json({ id: 'x' }, { status: 201 }));
    const client = createLiveClient({ baseUrl: 'https://api.test', fetch, sessionHeaders: cookie });
    expect(await client.start(null).catch((e: unknown) => e)).toMatchObject({ status: 502, code: 'bad_answer' });
  });

  it('aborts a request that takes longer than the timeout', async () => {
    const fetch: FetchLike = (_url, init) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      return promise;
    };
    const client = createLiveClient({ baseUrl: 'https://api.test', fetch, sessionHeaders: cookie, timeoutMs: 20 });
    expect(await client.end('id', 'k').catch((e: unknown) => e)).toMatchObject({ name: 'AbortError' });
  });
});
