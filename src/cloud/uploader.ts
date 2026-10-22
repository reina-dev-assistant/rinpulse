import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError, CloudLockedError, NotSignedInError, cloudRequest } from '@/cloud/api';
import { cloudLog as log } from '@/cloud/log';
import {
  adoptAccount,
  getUploaded,
  listDevices,
  listSleepAfter,
  listStepSamplesAfter,
  setCloudState,
  setUploaded,
} from '@/db/cloud';
import { errorMessage } from '@/format';

/** Batch sizes stay under the server's per-request limits (server/src/limits.ts). */
const STEP_BATCH = 2_000;
const SLEEP_BATCH = 500;

export interface UploadReport {
  stepSamples: number;
  sleepSegments: number;
  /** Rows the server refused as invalid (400) even alone; their cursor moved on so they do not block the rest. */
  skipped: number;
}

interface MeResponse {
  user: { id: string; email: string };
  /** Whether the server accepts uploads from this account (JoyoRogo Founder). Absent on servers that predate the gate. */
  cloud?: { unlocked: boolean };
}

/**
 * Posts `items` as one batch. When the server refuses the batch as invalid (400) or too big (413), it is split
 * in halves until the offending row stands alone and is skipped, so one bad row never blocks the cursor.
 */
async function send<T>(items: T[], body: (chunk: T[]) => object, report: UploadReport): Promise<void> {
  try {
    await cloudRequest('POST', '/v1/sync', body(items));
  } catch (error) {
    if (!(error instanceof CloudHttpError) || (error.status !== 400 && error.status !== 413)) throw error;
    if (items.length > 1) {
      const middle = Math.ceil(items.length / 2);
      await send(items.slice(0, middle), body, report);
      await send(items.slice(middle), body, report);
      return;
    }
    report.skipped += 1;
    log(`server refused one row (${error.status} ${error.code ?? ''}); skipped`, 'error');
  }
}

/**
 * Uploads everything written locally since the last successful upload, table by table, oldest change first.
 * A table's cursor advances only after the server accepted that batch, so a failure anywhere leaves the rest
 * for the next run; the server upserts, so a batch that is sent twice changes nothing.
 */
export async function runUpload(db: SQLiteDatabase): Promise<UploadReport> {
  const report: UploadReport = { stepSamples: 0, sleepSegments: 0, skipped: 0 };
  try {
    const me = await cloudRequest<MeResponse>('GET', '/v1/me');
    if (me.cloud?.unlocked === false) throw new CloudLockedError();
    if (await adoptAccount(db, me.user.id, me.user.email)) log(`account changed to ${me.user.id}; uploading everything again`);

    const devices = await listDevices(db);
    if (devices.length > 0) await send(devices, (devices) => ({ devices }), report);

    for (;;) {
      const rows = await listStepSamplesAfter(db, await getUploaded(db, 'step_samples'), STEP_BATCH);
      if (rows.length === 0) break;
      await send(
        rows.map((r) => ({
          timestamp: r.timestamp,
          steps: r.steps,
          calories: r.calories,
          distance: r.distance,
          heartRate: r.heartRate,
          spo2: r.spo2,
          restingHeartRate: r.restingHeartRate,
        })),
        (stepSamples) => ({ stepSamples }),
        report,
      );
      await setUploaded(db, 'step_samples', rows[rows.length - 1].rev);
      report.stepSamples += rows.length;
    }

    for (;;) {
      const rows = await listSleepAfter(db, await getUploaded(db, 'sleep_segments'), SLEEP_BATCH);
      if (rows.length === 0) break;
      await send(
        rows.map((r) => ({ start: r.start, end: r.end, type: r.type, stage: r.stage })),
        (sleepSegments) => ({ sleepSegments }),
        report,
      );
      await setUploaded(db, 'sleep_segments', rows[rows.length - 1].rev);
      report.sleepSegments += rows.length;
    }

    await setCloudState(db, { last_sync_at: String(Math.floor(Date.now() / 1000)), last_error: null });
    const total = report.stepSamples + report.sleepSegments;
    if (total > 0 || report.skipped > 0) {
      log(
        `uploaded ${report.stepSamples} step samples, ${report.sleepSegments} sleep segments` +
          (report.skipped > 0 ? `, ${report.skipped} skipped` : ''),
      );
    }
    return report;
  } catch (error) {
    if (error instanceof CloudLockedError) {
      // Not a failure to retry: clear any old error and let the caller show the Founder benefit instead.
      log('cloud backup needs JoyoRogo Founder; not uploading');
      await setCloudState(db, { last_error: null }).catch(() => undefined);
      throw error;
    }
    // No session is a state, not a failure: it must not be kept as an error that shows up again after the next sign-in.
    if (error instanceof NotSignedInError) throw error;
    const message = errorMessage(error);
    log(`upload failed: ${message}`, 'error');
    await setCloudState(db, { last_error: message }).catch(() => undefined);
    throw error;
  }
}
