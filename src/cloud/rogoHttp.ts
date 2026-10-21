import { withDeadline } from '@/cloud/deadline';
import { t } from '@/i18n';

/**
 * JoyoRogo gave no answer: `timeout` when the deadline passed first, `network` when the request failed on the way (offline, DNS,
 * TLS, connection reset). `message` is the sentence to show; the transport's own text (expo's `fetch failed: Fetch request has been
 * canceled`) stays in `cause` for the log.
 */
export class RogoUnreachableError extends Error {
  constructor(
    readonly reason: 'timeout' | 'network',
    cause?: unknown,
  ) {
    super(t(reason === 'timeout' ? 'common:errors.rogoSlow' : 'common:errors.rogoUnreachable'), { cause });
  }
}

/**
 * Runs one request attempt with an abort signal that fires after `timeoutMs`. `request` does the transport only (fetch and
 * reading the body); a refusal JoyoRogo answers with is the caller's to judge afterwards. Whatever goes wrong inside becomes a
 * {@link RogoUnreachableError}, and the attempt ends at the deadline even when the platform's fetch ignores the abort.
 */
export async function withinDeadline<T>(timeoutMs: number, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  try {
    return await withDeadline(request(controller.signal), timeoutMs, () => {
      timedOut = true;
      controller.abort();
      return new RogoUnreachableError('timeout');
    });
  } catch (error) {
    throw error instanceof RogoUnreachableError ? error : new RogoUnreachableError(timedOut ? 'timeout' : 'network', error);
  }
}

function pause(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Runs `request`; when it fails with an error `isTransient` accepts, waits `delayMs` and runs it one more time. */
export async function retryOnce<T>(
  request: () => Promise<T>,
  isTransient: (error: unknown) => boolean,
  delayMs = 1_000,
  wait: (ms: number) => Promise<void> = pause,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!isTransient(error)) throw error;
    await wait(delayMs);
    return request();
  }
}
