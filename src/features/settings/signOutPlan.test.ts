import { describe, expect, it } from 'bun:test';

import { keepReason, pendingTotal, signOutPlan, type PendingLocal } from './signOutPlan';

const none: PendingLocal = { rows: 0, workouts: 0, strength: 0, records: 0 };

describe('signOutPlan', () => {
  it('offers to delete only for a Pro account whose last sync finished and with nothing waiting', () => {
    expect(signOutPlan({ pro: true, synced: true, pending: none })).toBe('offer-delete');
  });

  it('warns for a free account, whatever else is true', () => {
    expect(signOutPlan({ pro: false, synced: true, pending: none })).toBe('warn-keep');
    expect(signOutPlan({ pro: false, synced: false, pending: { ...none, workouts: 3 } })).toBe('warn-keep');
  });

  it('warns while Pro is not known yet', () => {
    expect(signOutPlan({ pro: null, synced: true, pending: none })).toBe('warn-keep');
  });

  it('warns when the last sync did not finish or never ran', () => {
    expect(signOutPlan({ pro: true, synced: false, pending: none })).toBe('warn-keep');
  });

  it('warns for every kind of data that is still waiting to upload', () => {
    for (const key of ['rows', 'workouts', 'strength', 'records'] as const) {
      expect(signOutPlan({ pro: true, synced: true, pending: { ...none, [key]: 1 } })).toBe('warn-keep');
    }
  });
});

describe('keepReason and pendingTotal', () => {
  it('names why the data may exist only here', () => {
    expect(keepReason({ pro: false, synced: true, pending: none })).toBe('free');
    expect(keepReason({ pro: true, synced: true, pending: { ...none, rows: 5 } })).toBe('pending');
    expect(keepReason({ pro: true, synced: false, pending: none })).toBe('unsynced');
    expect(keepReason({ pro: null, synced: false, pending: none })).toBe('unsynced');
  });

  it('adds up what waits', () => {
    expect(pendingTotal({ rows: 1, workouts: 2, strength: 3, records: 4 })).toBe(10);
  });
});
