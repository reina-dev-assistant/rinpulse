import type { SQLiteDatabase } from 'expo-sqlite';

import type { ManualRow } from './manual';

/** Two workouts cannot start on the same second (`start` is unique); a clash moves the new one a second later. */
async function freeStart(db: SQLiteDatabase, wanted: number): Promise<number> {
  let start = wanted;
  for (let i = 0; i < 60; i += 1) {
    const taken = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE start = ?', start);
    if (!taken || taken.n === 0) return start;
    start += 1;
  }
  return start;
}

/** Stores a hand-typed workout (`imported = 1`, no heart rate, no route) and returns its row id. */
export async function saveManualWorkout(db: SQLiteDatabase, row: ManualRow): Promise<number> {
  const start = await freeStart(db, row.start);
  const end = start + row.duration;
  const result = await db.runAsync(
    `INSERT INTO workouts (workout_number, start, "end", sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
     VALUES (0, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, 1, 1)`,
    start,
    end,
    row.type,
    row.name,
    row.duration,
    row.distance,
    row.calories,
    row.summary,
  );
  return result.lastInsertRowId;
}
