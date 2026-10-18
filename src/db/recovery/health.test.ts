import { describe, expect, it } from 'bun:test';

import { COOLDOWN_MS, createDbHealth, NOTICE_KEY, SWAP_KEY, type HealthDeps } from './health';
import type { RecoveryResult } from './recover';

function setup(results: RecoveryResult[]) {
  const store = new Map<string, string>();
  const log: string[] = [];
  let clock = 1_000_000;
  let calls = 0;
  const deps: HealthDeps = {
    recover: async () => {
      log.push('recover');
      calls++;
      return results[Math.min(calls - 1, results.length - 1)];
    },
    hold: () => {
      log.push('hold');
      return () => log.push('release');
    },
    storage: {
      get: (key) => store.get(key) ?? null,
      set: (key, value) => (value === null ? store.delete(key) : store.set(key, value)),
    },
    now: () => clock,
  };
  return {
    deps,
    store,
    log,
    advance: (ms: number) => (clock += ms),
    calls: () => calls,
  };
}

const CORRUPT = new Error('database disk image is malformed');
const repaired: RecoveryResult = { kind: 'repaired', method: 'salvage', keptAs: 'joyofit.db.corrupt-1', tables: [], lost: true };

describe('createDbHealth', () => {
  it('ignores errors that are not corruption', async () => {
    const t = setup([repaired]);
    const health = createDbHealth(t.deps);
    health.report(new Error('database is locked'));
    health.report(undefined);
    expect(t.calls()).toBe(0);
    expect(health.getState()).toEqual({ repairing: false, notice: null });
  });

  it('repairs once for many reports, pauses the queries around it and keeps a notice', async () => {
    const t = setup([repaired]);
    const health = createDbHealth(t.deps);
    health.report(CORRUPT);
    health.report(CORRUPT);
    health.report(CORRUPT);
    expect(health.getState().repairing).toBe(true);
    await health.repair();
    expect(t.calls()).toBe(1);
    expect(t.log).toEqual(['hold', 'recover', 'release']);
    const { repairing, notice } = health.getState();
    expect(repairing).toBe(false);
    expect(notice).toMatchObject({ kind: 'repaired', lost: true, keptAs: 'joyofit.db.corrupt-1', pendingSwap: false });
    expect(JSON.parse(t.store.get(NOTICE_KEY) ?? 'null')).toMatchObject({ kind: 'repaired' });
  });

  it('lets queries go and reports a failure when the repair throws', async () => {
    const t = setup([repaired]);
    t.deps.recover = async () => {
      throw new Error('boom');
    };
    const health = createDbHealth(t.deps);
    const result = await health.repair();
    expect(result).toMatchObject({ kind: 'failed', reason: 'boom' });
    expect(t.log).toEqual(['hold', 'release']);
    expect(health.getState().notice?.kind).toBe('failed');
  });

  it('does not start another repair inside the cooldown, and does after it', async () => {
    const t = setup([repaired]);
    const health = createDbHealth(t.deps);
    await health.repair();
    health.report(CORRUPT);
    expect(t.calls()).toBe(1);
    t.advance(COOLDOWN_MS + 1);
    health.report(CORRUPT);
    await health.repair();
    expect(t.calls()).toBe(2);
  });

  it('remembers a prepared swap across starts and forgets it once applied', async () => {
    const failed: RecoveryResult = { kind: 'failed', keptAs: 'joyofit.db.corrupt-2', reason: 'header', swapPending: 'joyofit.db.salvage-2' };
    const t = setup([failed]);
    const health = createDbHealth(t.deps);
    await health.repair();
    expect(health.pendingSwap()).toBe('joyofit.db.salvage-2');
    expect(health.getState().notice).toMatchObject({ kind: 'failed', pendingSwap: true });
    // A new start reads both back.
    const next = createDbHealth(t.deps);
    expect(next.pendingSwap()).toBe('joyofit.db.salvage-2');
    expect(next.getState().notice?.kind).toBe('failed');
    next.clearPendingSwap();
    expect(t.store.has(SWAP_KEY)).toBe(false);
  });

  it('a healthy file ends the spinner and keeps an earlier notice; dismiss clears it', async () => {
    const t = setup([repaired, { kind: 'healthy' }]);
    const health = createDbHealth(t.deps);
    await health.repair();
    await health.repair();
    expect(health.getState()).toMatchObject({ repairing: false, notice: { kind: 'repaired' } });
    let notified = 0;
    health.subscribe(() => notified++);
    health.dismiss();
    expect(notified).toBe(1);
    expect(health.getState().notice).toBeNull();
    expect(t.store.has(NOTICE_KEY)).toBe(false);
  });

  it('a recreated database is a notice with lost data', async () => {
    const t = setup([{ kind: 'recreated', keptAs: 'joyofit.db.corrupt-3' }]);
    const health = createDbHealth(t.deps);
    await health.repair({ canSwap: true });
    expect(health.getState().notice).toMatchObject({ kind: 'recreated', lost: true });
    expect(t.store.has(SWAP_KEY)).toBe(false);
  });
});
