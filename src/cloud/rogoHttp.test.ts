import { afterEach, describe, expect, it, vi } from 'bun:test';

import { withDeadline } from './deadline';
import { RogoUnreachableError, retryOnce, withinDeadline } from './rogoHttp';

afterEach(() => vi.useRealTimers());

const never = () => new Promise<never>(() => {});

describe('withDeadline', () => {
  it('passes the result and the failure of work that finishes in time', async () => {
    expect(await withDeadline(Promise.resolve(7), 1_000, () => new Error('late'))).toBe(7);
    await expect(withDeadline(Promise.reject(new Error('boom')), 1_000, () => new Error('late'))).rejects.toThrow('boom');
  });

  it('rejects with onTimeout() when work never settles, and runs onTimeout once', async () => {
    vi.useFakeTimers();
    let called = 0;
    const pending = withDeadline(never(), 20, () => {
      called += 1;
      return new Error('late');
    }).catch((e: unknown) => e);
    vi.advanceTimersByTime(20);
    expect(await pending).toEqual(new Error('late'));
    expect(called).toBe(1);
  });

  it('does not run onTimeout after the work finished', async () => {
    vi.useFakeTimers();
    let called = 0;
    await withDeadline(Promise.resolve(), 20, () => {
      called += 1;
      return new Error('late');
    });
    vi.advanceTimersByTime(100);
    expect(called).toBe(0);
  });
});

describe('withinDeadline', () => {
  it('returns what the request returns', async () => {
    expect(await withinDeadline(1_000, async () => 'ok')).toBe('ok');
  });

  it('turns a request that ignores the abort into a timeout and aborts it', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = withinDeadline(20_000, (s) => {
      signal = s;
      return never();
    }).catch((e: unknown) => e);
    vi.advanceTimersByTime(20_000);
    const error = await pending;
    expect(error).toBeInstanceOf(RogoUnreachableError);
    expect((error as RogoUnreachableError).reason).toBe('timeout');
    expect((error as RogoUnreachableError).message).toBe('JoyoRogo lambat merespons, coba lagi.');
    expect(signal?.aborted).toBe(true);
  });

  it("hides expo's own text when the abort cancels the fetch", async () => {
    vi.useFakeTimers();
    const pending = withinDeadline(
      20_000,
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('fetch failed: Fetch request has been canceled')));
        }),
    ).catch((e: unknown) => e);
    vi.advanceTimersByTime(20_000);
    const error = await pending;
    expect(error).toBeInstanceOf(RogoUnreachableError);
    expect((error as RogoUnreachableError).reason).toBe('timeout');
    expect((error as RogoUnreachableError).message).not.toContain('fetch failed');
  });

  it('calls any other transport failure a network failure and keeps the cause', async () => {
    const cause = new TypeError('Network request failed');
    const error = await withinDeadline(1_000, async () => {
      throw cause;
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RogoUnreachableError);
    expect((error as RogoUnreachableError).reason).toBe('network');
    expect((error as RogoUnreachableError).message).toBe('JoyoRogo tidak terjangkau. Cek koneksi internetmu, lalu coba lagi.');
    expect((error as RogoUnreachableError).cause).toBe(cause);
  });
});

describe('retryOnce', () => {
  const transient = (error: unknown) => error instanceof RogoUnreachableError;

  it('runs a request that works once, without waiting', async () => {
    let runs = 0;
    const waits: number[] = [];
    const result = await retryOnce(async () => (runs += 1), transient, 500, async (ms) => void waits.push(ms));
    expect(result).toBe(1);
    expect(waits).toEqual([]);
  });

  it('waits and runs a transient failure one more time', async () => {
    let runs = 0;
    const waits: number[] = [];
    const result = await retryOnce(
      async () => {
        runs += 1;
        if (runs === 1) throw new RogoUnreachableError('timeout');
        return 'second';
      },
      transient,
      500,
      async (ms) => void waits.push(ms),
    );
    expect(result).toBe('second');
    expect(runs).toBe(2);
    expect(waits).toEqual([500]);
  });

  it('gives up after the second failure with that failure', async () => {
    let runs = 0;
    const error = await retryOnce(
      async () => {
        runs += 1;
        throw new RogoUnreachableError(runs === 1 ? 'timeout' : 'network');
      },
      transient,
      0,
      async () => {},
    ).catch((e: unknown) => e);
    expect(runs).toBe(2);
    expect((error as RogoUnreachableError).reason).toBe('network');
  });

  it('does not repeat a failure that is not transient', async () => {
    let runs = 0;
    const waits: number[] = [];
    await expect(
      retryOnce(
        async () => {
          runs += 1;
          throw new Error('refused');
        },
        transient,
        500,
        async (ms) => void waits.push(ms),
      ),
    ).rejects.toThrow('refused');
    expect(runs).toBe(1);
    expect(waits).toEqual([]);
  });
});
