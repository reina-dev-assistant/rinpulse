import type { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openMemoryDb } from '@/cloud/syncTestKit';
import { listPendingWorkouts, upsertCloudWorkout } from '@/db/cloud';
import { ANALYSIS_ENGINE_REV } from '@/features/workouts/analysis/engineRev';

import {
  countPendingDeletes,
  deletedStarts,
  ensureDeletedSchema,
  flushDeleteTombstones,
  isWorkoutDeleted,
  purgeDeletedWatchRows,
  recordRemoteDeletion,
  removeWorkoutRows,
  type DeleteIo,
} from './deleteCore';

const START = 1_792_000_000;

interface Phone {
  raw: Database;
  db: SQLiteDatabase;
}

function phone(): Phone {
  const { raw, db } = openMemoryDb();
  raw.exec(`CREATE TABLE IF NOT EXISTS watch_kcal_sent (
    workout_start INTEGER PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, external_id TEXT NOT NULL, date TEXT NOT NULL, kcal INTEGER NOT NULL, sent_at INTEGER NOT NULL)`);
  raw.exec('CREATE TABLE IF NOT EXISTS workout_gear (workout_start INTEGER PRIMARY KEY NOT NULL, gear_id TEXT, source TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  return { raw, db };
}

/** What the native sync writes: the workout row and its points (a watch row is `imported = 0`). */
function nativeSync(p: Phone, start: number, imported = 0): number {
  const inserted = p.raw
    .query(
      `INSERT OR REPLACE INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, imported)
       VALUES (1, ?, ?, 1, 'Running', 600, 1000, 50, 100, '{}', ?)`,
    )
    .run(start, start + 600, imported);
  const id = Number(inserted.lastInsertRowid);
  p.raw.query('INSERT INTO workout_points (workout_id, ts, hr) VALUES (?, ?, 120)').run(id, start + 10);
  return id;
}

const count = (p: Phone, sql: string) => p.raw.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${sql}`).get()?.n ?? 0;

const ops = { accountId: 'acc-1', cloud: true, diary: ['watch:' + START], posts: [] as string[] };

describe('removeWorkoutRows', () => {
  it('deletes the row, its points and bookkeeping, and writes the tombstone with what the account must still be told', async () => {
    const p = phone();
    const id = nativeSync(p, START);
    nativeSync(p, START + 5_000);
    p.raw.query("INSERT INTO watch_kcal_sent VALUES (?, 'acc-1', ?, '2026-10-01', 50, 1)").run(START, `watch:${START}`);
    p.raw.query("INSERT INTO workout_gear VALUES (?, 'g1', 'auto', 1)").run(START);
    p.raw.query("INSERT INTO strava_upload (workout_start, status, updated_at) VALUES (?, 'done', 1)").run(START);
    await upsertCloudWorkout(p.db, { start: START, rev: 1, engineRev: ANALYSIS_ENGINE_REV, version: 1, hash: 'h', bytes: 1, uploadedAt: 1 });

    expect(await removeWorkoutRows(p.db, START, ops)).toBe(true);

    expect(count(p, `workouts WHERE start = ${START}`)).toBe(0);
    expect(count(p, `workout_points WHERE workout_id = ${id}`)).toBe(0);
    expect(count(p, 'cloud_workout')).toBe(0);
    expect(count(p, 'watch_kcal_sent')).toBe(0);
    expect(count(p, 'workout_gear')).toBe(0);
    // Another workout is untouched, and Strava's bookkeeping stays so the workout is never uploaded twice.
    expect(count(p, `workouts WHERE start = ${START + 5_000}`)).toBe(1);
    expect(count(p, 'strava_upload')).toBe(1);
    expect(await isWorkoutDeleted(p.db, START)).toBe(true);
    expect(await countPendingDeletes(p.db)).toBe(1);
  });

  it('writes the tombstone even when the phone has no such row (the watch may still bring it)', async () => {
    const p = phone();
    expect(await removeWorkoutRows(p.db, START, ops)).toBe(false);
    expect([...(await deletedStarts(p.db))]).toEqual([START]);
  });

  it('drops the heart-rate minutes a phone recording wrote, and only those', async () => {
    const p = phone();
    nativeSync(p, START, 1);
    const minute = START + 10 - ((START + 10) % 60);
    p.raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, imported) VALUES (?, 0, 0, 0, 120, 1)').run(minute);
    p.raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, imported) VALUES (?, 30, 2, 20, 118, 0)').run(minute + 60);
    await removeWorkoutRows(p.db, START, { ...ops, diary: [] });
    expect(count(p, 'step_samples')).toBe(1);
  });
});

describe('the watch sync after a delete', () => {
  it('writes the workout again and the purge removes it before anything reads or uploads it', async () => {
    const p = phone();
    nativeSync(p, START);
    await removeWorkoutRows(p.db, START, ops);

    // The watch re-sends everything after the newest workout it knows of: the deleted one is stored again, points included.
    const id = nativeSync(p, START);
    expect(count(p, `workouts WHERE start = ${START}`)).toBe(1);
    expect((await listPendingWorkouts(p.db, ANALYSIS_ENGINE_REV)).map((w) => w.start)).toContain(START);

    expect(await purgeDeletedWatchRows(p.db)).toBe(1);

    expect(count(p, `workouts WHERE start = ${START}`)).toBe(0);
    expect(count(p, `workout_points WHERE workout_id = ${id}`)).toBe(0);
    expect(await listPendingWorkouts(p.db, ANALYSIS_ENGINE_REV)).toEqual([]);
    // Nothing left to purge the next time.
    expect(await purgeDeletedWatchRows(p.db)).toBe(0);
  });

  it('a workout the person imports or records again is theirs: only the watch copy (imported = 0) is purged', async () => {
    const p = phone();
    await removeWorkoutRows(p.db, START, ops);
    nativeSync(p, START, 1);
    expect(await purgeDeletedWatchRows(p.db)).toBe(0);
    expect(count(p, `workouts WHERE start = ${START}`)).toBe(1);
  });

  it('a workout the cloud deleted is remembered the same way', async () => {
    const p = phone();
    await recordRemoteDeletion(p.db, START);
    nativeSync(p, START);
    expect(await purgeDeletedWatchRows(p.db)).toBe(1);
    expect(await countPendingDeletes(p.db)).toBe(0);
  });
});

interface Calls {
  cloud: number[];
  diary: string[];
  posts: string[];
}

function io(over: Partial<DeleteIo> = {}): { io: DeleteIo; calls: Calls } {
  const calls: Calls = { cloud: [], diary: [], posts: [] };
  return {
    calls,
    io: {
      boundAccount: async () => 'acc-1',
      paused: () => false,
      removeCloudWorkout: async (start) => void calls.cloud.push(start),
      removeDiaryRow: async (id) => void calls.diary.push(id),
      deletePost: async (id) => void calls.posts.push(id),
      classify: (error) => (error as { kind?: 'quiet' | 'refused' | 'stop' }).kind ?? 'stop',
      ...over,
    },
  };
}

describe('flushDeleteTombstones', () => {
  it('sends the cloud tombstone, removes the JoyoRogo diary rows and the posts, then has nothing pending', async () => {
    const p = phone();
    nativeSync(p, START);
    await removeWorkoutRows(p.db, START, { accountId: 'acc-1', cloud: true, diary: [`watch:${START}`, 'strength:s1'], posts: ['post-1'] });
    const harness = io();

    const result = await flushDeleteTombstones(p.db, harness.io);

    expect(harness.calls).toEqual({ cloud: [START], diary: [`watch:${START}`, 'strength:s1'], posts: ['post-1'] });
    expect(result).toEqual({ sent: 4, pending: 0 });
    // Asking again sends nothing; the tombstone stays for the watch's sake.
    await flushDeleteTombstones(p.db, harness.io);
    expect(harness.calls.cloud).toEqual([START]);
    expect(await isWorkoutDeleted(p.db, START)).toBe(true);
  });

  it('keeps what could not be sent (offline) and sends it at the next pass; steps already done are not repeated', async () => {
    const p = phone();
    await removeWorkoutRows(p.db, START, { accountId: 'acc-1', cloud: true, diary: [`watch:${START}`], posts: [] });
    let offline = true;
    const harness = io({
      removeDiaryRow: async (id) => {
        if (offline) throw { kind: 'stop' };
        harness.calls.diary.push(id);
      },
    });

    expect((await flushDeleteTombstones(p.db, harness.io)).pending).toBe(1);
    expect(harness.calls.cloud).toEqual([START]);
    expect(harness.calls.diary).toEqual([]);

    offline = false;
    expect((await flushDeleteTombstones(p.db, harness.io)).pending).toBe(0);
    expect(harness.calls.cloud).toEqual([START]);
    expect(harness.calls.diary).toEqual([`watch:${START}`]);
  });

  it('waits while nobody is signed in or sync is paused, and for the account the workout belonged to', async () => {
    const p = phone();
    await removeWorkoutRows(p.db, START, ops);
    for (const harness of [io({ boundAccount: async () => null }), io({ paused: () => true }), io({ boundAccount: async () => 'acc-2' })]) {
      expect((await flushDeleteTombstones(p.db, harness.io)).pending).toBe(1);
      expect(harness.calls).toEqual({ cloud: [], diary: [], posts: [] });
    }
  });

  it('crosses off an answer of "no" from the server, so it is not asked forever', async () => {
    const p = phone();
    await removeWorkoutRows(p.db, START, ops);
    const harness = io({
      removeDiaryRow: async () => {
        throw { kind: 'refused' };
      },
    });
    expect((await flushDeleteTombstones(p.db, harness.io)).pending).toBe(0);
    expect(harness.calls.cloud).toEqual([START]);
  });

  it('a phone that was signed out when the workout was deleted has nothing to tell', async () => {
    const p = phone();
    await removeWorkoutRows(p.db, START, { accountId: null, cloud: false, diary: [], posts: [] });
    const harness = io();
    expect(await flushDeleteTombstones(p.db, harness.io)).toEqual({ sent: 0, pending: 0 });
    expect(harness.calls).toEqual({ cloud: [], diary: [], posts: [] });
  });

  it('creates its table on demand', async () => {
    const p = phone();
    await ensureDeletedSchema(p.db);
    expect(count(p, 'workout_deleted')).toBe(0);
  });
});
