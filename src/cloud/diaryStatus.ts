import type { SQLiteDatabase } from 'expo-sqlite';

import { getCloudValue } from '@/db/cloud';

import { DIARY_LAST_ERROR_AT_KEY, DIARY_LAST_ERROR_KEY, DIARY_LAST_SENT_KEY } from './diaryNotes';
import { ensurePhoneKcalSchema } from './phoneKcal';
import { ensureKcalSchema } from './strengthKcal';
import { countWatchKcalPending, countWatchKcalSent, ensureWatchKcalSchema } from './watchKcal';

/** Where the push of workout energy to JoyoRogo's diary stands, for Settings, Koneksi, JoyoRogo. */
export interface DiaryStatus {
  /** Epoch ms of the last workout JoyoRogo accepted; null when none ever did from this phone. */
  lastSentAt: number | null;
  /** Workouts JoyoRogo has been told about: watch (for the signed-in account), phone and strength recordings. */
  sentCount: number;
  /** Watch workouts of the last 30 days that the next sync will send. */
  pending: number;
  /** The latest failed push, until a later one went through; null when there is none. */
  lastError: string | null;
  lastErrorAt: number | null;
}

const asMs = (value: string | null): number | null => {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

export async function readDiaryStatus(db: SQLiteDatabase): Promise<DiaryStatus> {
  await Promise.all([ensureWatchKcalSchema(db), ensurePhoneKcalSchema(db), ensureKcalSchema(db)]);
  const [lastSent, lastError, lastErrorAt, watch, pending, other] = await Promise.all([
    getCloudValue(db, DIARY_LAST_SENT_KEY),
    getCloudValue(db, DIARY_LAST_ERROR_KEY),
    getCloudValue(db, DIARY_LAST_ERROR_AT_KEY),
    countWatchKcalSent(db),
    countWatchKcalPending(db),
    db.getFirstAsync<{ n: number }>('SELECT (SELECT COUNT(*) FROM phone_kcal_sent) + (SELECT COUNT(*) FROM strength_kcal_sent) AS n'),
  ]);
  return { lastSentAt: asMs(lastSent), sentCount: watch + (other?.n ?? 0), pending, lastError, lastErrorAt: asMs(lastErrorAt) };
}
