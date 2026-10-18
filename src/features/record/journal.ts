/**
 * The crash journal of a recording: samples are appended every few seconds and the recorder's plain-JSON state is overwritten, so a
 * recording survives the app being killed (the person resumes it from the Workouts tab). Used by the phone recorder (`session = 'phone'`)
 * and by the strength logger's heart rate (`session = 'strength'`). Cleared when the workout is saved or discarded.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { RecordedSample } from './recorder';

export type JournalSession = 'phone' | 'strength';

/** What the journal needs of the database handle. */
export type JournalDb = Pick<SQLiteDatabase, 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;

const CHUNK = 90;

export async function ensureRecordingSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS recording_state (
      session TEXT PRIMARY KEY,
      meta TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recording_journal (
      session TEXT NOT NULL,
      ts INTEGER NOT NULL,
      lat REAL, lon REAL, alt REAL, hr INTEGER, speed REAL, cadence INTEGER, stride REAL, power INTEGER,
      PRIMARY KEY (session, ts)
    );
  `);
}

export async function appendJournal(db: JournalDb, session: JournalSession, samples: readonly RecordedSample[]): Promise<void> {
  for (let i = 0; i < samples.length; i += CHUNK) {
    const chunk = samples.slice(i, i + CHUNK);
    await db.runAsync(
      `INSERT OR REPLACE INTO recording_journal (session, ts, lat, lon, alt, hr, speed, cadence, stride, power)
       VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      chunk.flatMap((s) => [session, s.ts, s.lat, s.lon, s.alt, s.hr, s.speed, s.cadence, s.stride, s.power]),
    );
  }
}

export async function saveJournalState(db: JournalDb, session: JournalSession, meta: unknown, now: number): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO recording_state (session, meta, updated_at) VALUES (?, ?, ?)',
    session,
    JSON.stringify(meta),
    now,
  );
}

export interface LoadedJournal<M> {
  meta: M;
  samples: RecordedSample[];
  updatedAt: number;
}

export async function loadJournal<M>(db: JournalDb, session: JournalSession): Promise<LoadedJournal<M> | null> {
  const state = await db.getFirstAsync<{ meta: string; updated_at: number }>(
    'SELECT meta, updated_at FROM recording_state WHERE session = ?',
    session,
  );
  if (!state) return null;
  let meta: M;
  try {
    meta = JSON.parse(state.meta) as M;
  } catch {
    return null;
  }
  const samples = await db.getAllAsync<RecordedSample>(
    'SELECT ts, lat, lon, alt, hr, speed, cadence, stride, power FROM recording_journal WHERE session = ? ORDER BY ts',
    session,
  );
  return { meta, samples, updatedAt: state.updated_at };
}

export async function clearJournal(db: JournalDb, session: JournalSession): Promise<void> {
  await db.runAsync('DELETE FROM recording_journal WHERE session = ?', session);
  await db.runAsync('DELETE FROM recording_state WHERE session = ?', session);
}
