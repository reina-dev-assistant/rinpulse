import type { SQLiteDatabase } from 'expo-sqlite';

import { parseSummary } from './summary';
import type { ProgressRow } from './progress';

interface RawProgressRow {
  start: number;
  end: number;
  sportName: string;
  duration: number;
  distance: number;
  summaryJson: string;
}

/**
 * Every workout that started at or after `sinceSec`, in one query, with the elevation gain read from its summary. No point rows
 * are touched; the sums per week and month are `aggregateProgress`'s.
 */
export async function listProgressRows(db: SQLiteDatabase, sinceSec: number): Promise<ProgressRow[]> {
  const rows = await db.getAllAsync<RawProgressRow>(
    `SELECT start, end, sport_name AS sportName, duration, distance, summary_json AS summaryJson
     FROM workouts WHERE start >= ? ORDER BY start`,
    sinceSec,
  );
  return rows.map(({ summaryJson, ...row }) => {
    const gain = parseSummary(summaryJson).elevationGain;
    return { ...row, gain: typeof gain === 'number' && Number.isFinite(gain) ? gain : null };
  });
}
