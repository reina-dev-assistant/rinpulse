import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog as log } from '@/cloud/log';
import { setCloudState } from '@/db/cloud';
import { errorMessage } from '@/format';

/**
 * What the app remembers of its pushes to JoyoRogo's diary (strength, phone and watch workouts), for the status in Settings, Koneksi,
 * JoyoRogo: when something last went through, and the error of the latest failed push (cleared by the next success).
 * `cloud_state` keys; nothing here changes what is sent.
 */
export const DIARY_LAST_SENT_KEY = 'diary_last_sent_at';
export const DIARY_LAST_ERROR_KEY = 'diary_last_error';
export const DIARY_LAST_ERROR_AT_KEY = 'diary_last_error_at';

/** A workout's energy was accepted by JoyoRogo. */
export async function noteDiarySent(db: SQLiteDatabase): Promise<void> {
  await setCloudState(db, {
    [DIARY_LAST_SENT_KEY]: String(Date.now()),
    [DIARY_LAST_ERROR_KEY]: null,
    [DIARY_LAST_ERROR_AT_KEY]: null,
  }).catch(() => undefined);
}

/** A push failed for a reason worth showing (not "nobody is signed in"). Logged and remembered; never throws. */
export async function noteDiaryError(db: SQLiteDatabase, what: string, error: unknown): Promise<void> {
  const message = errorMessage(error);
  log(`${what} not sent: ${message}`, 'error');
  await setCloudState(db, { [DIARY_LAST_ERROR_KEY]: message, [DIARY_LAST_ERROR_AT_KEY]: String(Date.now()) }).catch(() => undefined);
}
