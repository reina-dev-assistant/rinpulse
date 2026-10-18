import { describe, expect, it, mock } from 'bun:test';

import { openMemoryDb } from '@/cloud/syncTestKit';
import { removeWorkoutRows } from '@/features/workouts/deleteCore';

const START = 1_792_000_000;
const calls: { path: string; input: unknown }[] = [];
let page: unknown = { items: [], cursor: null, hasMore: false };
let blobRequests = 0;

// `workoutSync.ts` reaches the network, the auth client and the native crypto module: stand-ins for those, the sync code itself is real.
// Module mocks outlive the file that made them, so each stands in only for modules no other test file loads for real.
mock.module('@/cloud/rogo', () => ({
  rogoCall: async (path: string, input: unknown) => {
    calls.push({ path, input });
    return path === 'watchWorkout/changes' ? page : {};
  },
}));
mock.module('@/cloud/workoutHttp', () => ({
  getWorkoutBlob: async () => {
    blobRequests += 1;
    return null;
  },
  putWorkout: async () => ({ version: 1, bytes: 1 }),
}));
mock.module('@/cloud/api', () => ({
  CloudHttpError: class CloudHttpError extends Error {},
  CloudLockedError: class CloudLockedError extends Error {},
  NotSignedInError: class NotSignedInError extends Error {},
  cloudRequest: async () => ({}),
}));
mock.module('@/cloud/build', () => ({ APP_BUILD: 'test' }));
mock.module('@/cloud/workoutAnalysis', () => ({ loadStoredWorkout: async () => null }));
mock.module('@/cloud/strengthSync', () => ({ wipeStrengthCloud: async () => {} }));
mock.module('expo-crypto', () => ({ digest: async () => new ArrayBuffer(0), CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));

describe('pulling the cloud after a delete on this phone', () => {
  it('does not restore a workout the cloud still lists while its tombstone has not been sent', async () => {
    const { pullWorkouts } = await import('@/cloud/workoutSync');
    const { db, raw } = openMemoryDb();
    await removeWorkoutRows(db, START, { accountId: 'acc-1', cloud: true, diary: [], posts: [] });
    page = { items: [{ start: START, version: 3, deletedAt: null }], cursor: { updatedAt: 5, start: START }, hasMore: false };

    const report = await pullWorkouts(db);

    expect(report).toEqual({ restored: 0, deleted: 0, skipped: 0 });
    expect(blobRequests).toBe(0);
    expect(raw.query('SELECT COUNT(*) AS n FROM workouts').get()).toEqual({ n: 0 });
  });

  it('remembers a delete made elsewhere, so the watch does not bring the workout back here', async () => {
    const { pullWorkouts } = await import('@/cloud/workoutSync');
    const { isWorkoutDeleted } = await import('@/features/workouts/deleteCore');
    const { db } = openMemoryDb();
    page = { items: [{ start: START, version: 3, deletedAt: 1_792_000_500_000 }], cursor: { updatedAt: 6, start: START }, hasMore: false };

    await pullWorkouts(db);

    expect(await isWorkoutDeleted(db, START)).toBe(true);
    expect(calls.some((c) => c.path === 'watchWorkout/remove')).toBe(false);
  });
});
