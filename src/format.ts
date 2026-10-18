import { isCorruptionError } from '@/db/recovery/corruption';
import { fmtAgo, fmtClock, fmtDateTime, fmtDistance, fmtDuration, fmtInt, fmtSyncTime, t } from '@/i18n';

// Locale-aware wrappers kept under their old names so screens keep one import. The work is in src/i18n/format.ts.

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Local time of day from unix seconds, in the language's clock style. */
export const formatClock = (sec: number) => fmtClock(sec);

/** `HH:MM:SS.mmm` in local time from unix milliseconds. Debug logs only, never translated. */
export function formatClockMs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** `7 j 05 mnt` / `7 h 05 min`, `42 mnt`. Seconds in. */
export const formatDuration = (totalSec: number) => fmtDuration(totalSec);

export const formatCount = (n: number) => fmtInt(n);

/** The contract gives no distance unit; metres is assumed (unverified). */
export const formatDistance = (meters: number) => fmtDistance(meters);

export const formatDateTime = (sec: number) => fmtDateTime(sec);

/** The text of an error for the screen. A damaged database file is never shown as SQLite's words: it has its own notice and repair (`src/db/recovery`). */
export function errorMessage(e: unknown): string {
  if (isCorruptionError(e)) return t('common:dbRecovery.inline');
  return e instanceof Error ? e.message : String(e);
}

/** The clock for today, a short date and clock for any other day. Unix seconds, local time. */
export const formatSyncTime = (sec: number) => fmtSyncTime(sec);

/** `baru saja`, `5 mnt lalu`; a day or older falls back to {@link formatSyncTime}. Unix seconds. */
export const formatAgo = (sec: number, nowSec: number) => fmtAgo(sec, nowSec);
