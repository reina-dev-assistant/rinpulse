import { describe, expect, it } from 'bun:test';

import { watchNativeErrors, type NativeErrorSources, type NativeEventPayload } from './nativeErrors';

function harness() {
  const listeners: Record<string, (payload: NativeEventPayload) => void> = {};
  const callListeners = new Set<(error: unknown) => void>();
  const removed: string[] = [];
  const sources: NativeErrorSources = {
    addListener: (event, listener) => {
      listeners[event] = listener;
      return { remove: () => removed.push(event) };
    },
    onCallError: (listener) => {
      callListeners.add(listener);
      return () => callListeners.delete(listener);
    },
  };
  const reported: unknown[] = [];
  const stop = watchNativeErrors(sources, (error) => reported.push(error));
  return { listeners, callListeners, removed, reported, stop };
}

describe('watchNativeErrors', () => {
  it('forwards the errors of failed native calls', () => {
    const h = harness();
    const error = new Error('Database error: database disk image is malformed (code 11 SQLITE_CORRUPT)');
    for (const listener of h.callListeners) listener(error);
    expect(h.reported).toEqual([error]);
  });

  it('forwards the text of error logs, link errors and scan errors, and nothing else', () => {
    const h = harness();
    h.listeners.onLog({ direction: 'error', message: 'Background sync failed [ERR_STORAGE]: Database error: database disk image is malformed' });
    h.listeners.onLog({ direction: 'info', message: 'connected' });
    h.listeners.onStateChange({ error: null });
    h.listeners.onStateChange({ error: 'ERR_STORAGE: database disk image is malformed' });
    h.listeners.onScanStateChange({ error: 'scan failed' });
    expect(h.reported).toEqual([
      'Background sync failed [ERR_STORAGE]: Database error: database disk image is malformed',
      'ERR_STORAGE: database disk image is malformed',
      'scan failed',
    ]);
  });

  it('stops everything it started', () => {
    const h = harness();
    h.stop();
    expect(h.callListeners.size).toBe(0);
    expect(h.removed.sort()).toEqual(['onLog', 'onScanStateChange', 'onStateChange']);
  });

  it('survives a binary that cannot subscribe to an event', () => {
    const reported: unknown[] = [];
    const stop = watchNativeErrors(
      {
        addListener: () => {
          throw new Error('no such event');
        },
        onCallError: () => () => undefined,
      },
      (error) => reported.push(error),
    );
    stop();
    expect(reported).toEqual([]);
  });
});
