import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getStravaUpload, type StravaUploadRow } from './strava';

function dbWith(row: StravaUploadRow | null): SQLiteDatabase {
  return { getFirstAsync: async () => row } as unknown as SQLiteDatabase;
}

const base: StravaUploadRow = { workoutStart: 1, status: 'rejected', uploadId: 5, activityId: null, error: null, attempts: 1, updatedAt: 2 };

describe('getStravaUpload', () => {
  it('reads a stored link-form duplicate as the activity Strava already has', async () => {
    const error = "joyofit-1785798055.fit duplicate of <a href='/activities/19589870698' target='_blank'>Outdoor run</a>";
    const row = await getStravaUpload(dbWith({ ...base, error }), 1);
    expect(row).toMatchObject({ status: 'done', activityId: 19589870698, error: null });
  });

  it('shows any other refusal without HTML', async () => {
    const row = await getStravaUpload(dbWith({ ...base, error: 'The <b>file</b> is empty' }), 1);
    expect(row).toMatchObject({ status: 'rejected', activityId: null, error: 'The file is empty' });
  });

  it('leaves done rows, rows without an error and a missing row alone', async () => {
    const done = { ...base, status: 'done' as const, activityId: 7 };
    expect(await getStravaUpload(dbWith(done), 1)).toBe(done);
    expect(await getStravaUpload(dbWith(base), 1)).toBe(base);
    expect(await getStravaUpload(dbWith(null), 1)).toBeNull();
  });
});
