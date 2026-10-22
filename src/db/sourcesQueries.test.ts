import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';

import { countWatchWorkoutsSince } from './queries';
import { stravaUploadSummary } from './strava';

function open() {
  const raw = new Database(':memory:');
  for (const statements of migrationsJson) raw.exec(statements.join(';\n'));
  const db = {
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).get(...(params as never[])),
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).all(...(params as never[])),
  } as unknown as SQLiteDatabase;
  return { raw, db };
}

describe('countWatchWorkoutsSince', () => {
  it('counts finished watch workouts since the time and leaves imports and older ones out', async () => {
    const { raw, db } = open();
    const add = (start: number, imported: number, complete = 1) =>
      raw
        .query(
          `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
           VALUES (?, ?, ?, 1, 'run', 600, 1000, 50, 900, '{}', ?, ?)`,
        )
        .run(start, start, start + 600, complete, imported);
    add(1000, 0);
    add(2000, 0);
    add(3000, 1);
    add(4000, 0, 0);
    add(100, 0);
    expect(await countWatchWorkoutsSince(db, 500)).toBe(2);
  });
});

describe('stravaUploadSummary', () => {
  it('reports the newest finished upload, and the recent finished and failed ones', async () => {
    const { raw, db } = open();
    const add = (start: number, status: string, updatedAt: number) =>
      raw.query('INSERT INTO strava_upload (workout_start, status, attempts, updated_at) VALUES (?, ?, 1, ?)').run(start, status, updatedAt);
    add(1, 'done', 100);
    add(2, 'done', 900);
    add(3, 'failed', 950);
    add(4, 'rejected', 20);
    add(5, 'processing', 960);
    expect(await stravaUploadSummary(db, 500)).toEqual({ lastDoneAt: 900, done: 1, failed: 1 });
  });

  it('is empty before any upload', async () => {
    const { db } = open();
    expect(await stravaUploadSummary(db, 0)).toEqual({ lastDoneAt: null, done: 0, failed: 0 });
  });
});
