import { describe, expect, it } from 'bun:test';

import { finishedSetup, setupProgress, setupRows, showsSetup, type SetupFacts } from './checklist';

const none: SetupFacts = { paired: false, synced: false, healthStoreOn: false, signedIn: false, profileSaved: false };

describe('setupRows', () => {
  it('lists every step in order while nothing is done', () => {
    expect(setupRows(none).map((r) => r.id)).toEqual(['pair', 'sync', 'health', 'account', 'profile']);
  });

  it('sinks finished rows below the pending ones and keeps the order inside each group', () => {
    const rows = setupRows({ ...none, paired: true, signedIn: true });
    expect(rows.map((r) => `${r.id}:${r.done ? 1 : 0}`)).toEqual(['sync:0', 'health:0', 'profile:0', 'pair:1', 'account:1']);
  });

  it('leaves out the rows that cannot apply on this phone or build', () => {
    const rows = setupRows({ ...none, healthStoreOn: null, signedIn: null });
    expect(rows.map((r) => r.id)).toEqual(['pair', 'sync', 'profile']);
  });

  it('counts progress over the rows that apply', () => {
    expect(setupProgress(setupRows({ ...none, paired: true, synced: true, healthStoreOn: null }))).toEqual({ done: 2, total: 4 });
  });
});

describe('showsSetup', () => {
  it('shows while a row is pending and nothing was remembered', () => {
    expect(showsSetup(setupRows(none), null)).toBe(true);
  });

  it('is hidden after Dismiss, after completion, and when there is nothing left to do', () => {
    expect(showsSetup(setupRows(none), 'dismissed')).toBe(false);
    expect(showsSetup(setupRows(none), 'complete')).toBe(false);
    const all: SetupFacts = { paired: true, synced: true, healthStoreOn: true, signedIn: true, profileSaved: true };
    expect(showsSetup(setupRows(all), null)).toBe(false);
  });

  it('is hidden for good when every row is done', () => {
    const all: SetupFacts = { paired: true, synced: true, healthStoreOn: true, signedIn: true, profileSaved: true };
    expect(finishedSetup(setupRows(all), null)).toBe(true);
    expect(finishedSetup(setupRows(all), 'complete')).toBe(false);
    expect(finishedSetup(setupRows(none), null)).toBe(false);
    expect(finishedSetup([], null)).toBe(false);
  });
});
