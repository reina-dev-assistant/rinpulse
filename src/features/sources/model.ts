import { fmtInt, fmtSyncTime, t } from '@/i18n';

/**
 * The Sources & connections screen as data: for each place JoyoFit's data comes from or goes to, what it is, through which channel
 * (`via`), when it last moved and what it carried. The facts come in, ready-worded rows come out, so the wording rules (no zero
 * where nothing is known, a refused upload is "needs a look", a stale watch is "needs a look") are plain tests.
 */
export type SourceId = 'watch' | 'health' | 'strava' | 'joyorogo' | 'scale';

/** `on` is working, `attention` is connected but something is off (stale, failing), `off` is not set up (or not available here). */
export type SourceState = 'on' | 'attention' | 'off';

export interface SourceRow {
  id: SourceId;
  title: string;
  state: SourceState;
  /** The channel, one line: "Bluetooth", "JoyoFit writes to Health Connect". */
  via: string;
  /** When it last moved; null when there is nothing to say (not set up). */
  last: string | null;
  /** What it carried, one line. */
  counts: string | null;
  /** One more line when needed: a failure, a missing permission, the next step. */
  note: string | null;
}

/** A watch that has not synced for this long is shown as needing a look. */
export const WATCH_STALE_SEC = 2 * 86_400;

export interface SourceFacts {
  nowSec: number;
  watch: {
    name: string | null;
    paired: boolean;
    lastSyncSec: number | null;
    /** The last seven days: days that have stored steps, nights of sleep, workouts the watch recorded. */
    stepDays: number;
    sleepNights: number;
    workouts: number;
  };
  health: {
    /** "Health Connect" or "Apple Health". */
    store: string;
    availability: 'available' | 'update-required' | 'unavailable' | null;
    enabled: boolean;
    granted: number;
    total: number;
    lastExportSec: number | null;
    lastError: string | null;
    /** What the last export wrote (`parseExportCounts`); null when none ran. */
    counts: ExportCounts | null;
  };
  strava: { connected: boolean; lastUploadSec: number | null; uploaded: number; failed: number };
  /** `configured` is false when this build has no cloud server: the row is left out. */
  joyorogo: { configured: boolean; signedIn: boolean; email: string | null; lastSentMs: number | null; sent: number; waiting: number; lastError: string | null };
  scale: { name: string | null; lastWeighMs: number | null; weighIns: number; waiting: number };
}

export type ExportCounts = Partial<Record<'steps' | 'hr' | 'sleep' | 'workouts', number>>;

/** The `steps=120 distance=120 ... workouts=1` line a Health Connect / Apple Health export reports; unknown keys are ignored. */
export function parseExportCounts(text: string | null): ExportCounts | null {
  if (!text) return null;
  const out: ExportCounts = {};
  for (const part of text.split(/\s+/)) {
    const [key, raw] = part.split('=');
    const n = Number(raw);
    if ((key === 'steps' || key === 'hr' || key === 'sleep' || key === 'workouts') && Number.isFinite(n)) out[key] = n;
  }
  return out;
}

const join = (parts: readonly string[]) => parts.join(' · ');

function watchRow(f: SourceFacts): SourceRow {
  const { watch } = f;
  const title = watch.name ?? t('settings:sources.watch.title');
  if (!watch.paired) {
    return { id: 'watch', title, state: 'off', via: t('settings:sources.watch.via'), last: null, counts: null, note: t('settings:sources.watch.none') };
  }
  const stale = watch.lastSyncSec === null || f.nowSec - watch.lastSyncSec > WATCH_STALE_SEC;
  const parts = [
    watch.stepDays > 0 ? t('settings:sources.watch.stepDays', { count: watch.stepDays }) : null,
    watch.sleepNights > 0 ? t('settings:sources.watch.sleepNights', { count: watch.sleepNights }) : null,
    watch.workouts > 0 ? t('settings:sources.watch.workouts', { count: watch.workouts }) : null,
  ].filter((p): p is string => p !== null);
  return {
    id: 'watch',
    title,
    state: stale ? 'attention' : 'on',
    via: t('settings:sources.watch.via'),
    last: watch.lastSyncSec === null ? t('settings:sources.watch.neverSynced') : t('settings:sources.lastSync', { time: fmtSyncTime(watch.lastSyncSec) }),
    counts: t('settings:sources.week', { what: parts.length > 0 ? join(parts) : t('settings:sources.nothing') }),
    note: stale ? t('settings:sources.watch.stale') : null,
  };
}

function healthRow(f: SourceFacts): SourceRow {
  const { health } = f;
  const via = t('settings:sources.health.via', { store: health.store });
  if (health.availability === 'unavailable' || health.availability === null) {
    return { id: 'health', title: health.store, state: 'off', via, last: null, counts: null, note: health.availability === null ? null : t('settings:sources.health.unavailable', { store: health.store }) };
  }
  if (!health.enabled) {
    return { id: 'health', title: health.store, state: 'off', via, last: null, counts: null, note: t('settings:sources.health.off', { store: health.store }) };
  }
  const c = health.counts;
  const parts = c
    ? [
        c.steps ? t('settings:sources.health.steps', { value: fmtInt(c.steps) }) : null,
        c.hr ? t('settings:sources.health.hr', { value: fmtInt(c.hr) }) : null,
        c.sleep ? t('settings:sources.health.sleep', { value: fmtInt(c.sleep) }) : null,
        c.workouts ? t('settings:sources.health.workouts', { count: c.workouts }) : null,
      ].filter((p): p is string => p !== null)
    : [];
  const missingPermission = health.granted < health.total;
  return {
    id: 'health',
    title: health.store,
    state: health.lastError || health.availability === 'update-required' ? 'attention' : 'on',
    via,
    last: health.lastExportSec === null ? t('settings:sources.health.neverWritten') : t('settings:sources.health.lastWrite', { time: fmtSyncTime(health.lastExportSec) }),
    counts: health.lastExportSec === null ? null : t('settings:sources.health.lastCounts', { what: parts.length > 0 ? join(parts) : t('settings:sources.nothingNew') }),
    note: health.lastError
      ? t('settings:sources.health.failed', { error: health.lastError })
      : health.availability === 'update-required'
        ? t('settings:healthConnect.updateRequired', { store: health.store })
        : missingPermission
          ? t('settings:sources.health.permissions', { granted: health.granted, total: health.total })
          : null,
  };
}

function stravaRow(f: SourceFacts): SourceRow {
  const { strava } = f;
  const via = t('settings:sources.strava.via');
  if (!strava.connected) {
    return { id: 'strava', title: 'Strava', state: 'off', via, last: null, counts: null, note: t('settings:sources.strava.off') }; // i18n-ok: product name
  }
  const parts = [t('settings:sources.strava.uploaded', { count: strava.uploaded }), strava.failed > 0 ? t('settings:sources.strava.failed', { count: strava.failed }) : null].filter(
    (p): p is string => p !== null,
  );
  return {
    id: 'strava',
    title: 'Strava', // i18n-ok: product name
    state: strava.failed > 0 ? 'attention' : 'on',
    via,
    last: strava.lastUploadSec === null ? t('settings:sources.strava.never') : t('settings:sources.strava.lastUpload', { time: fmtSyncTime(strava.lastUploadSec) }),
    counts: t('settings:sources.week', { what: join(parts) }),
    note: strava.failed > 0 ? t('settings:sources.strava.retry') : null,
  };
}

function joyorogoRow(f: SourceFacts): SourceRow | null {
  const { joyorogo } = f;
  if (!joyorogo.configured) return null;
  const title = t('settings:screens.joyorogo');
  if (!joyorogo.signedIn) {
    return { id: 'joyorogo', title, state: 'off', via: t('settings:sources.joyorogo.via'), last: null, counts: null, note: t('settings:sources.joyorogo.off') };
  }
  return {
    id: 'joyorogo',
    title,
    state: joyorogo.lastError ? 'attention' : 'on',
    via: joyorogo.email ? t('settings:sources.joyorogo.viaAccount', { email: joyorogo.email }) : t('settings:sources.joyorogo.via'),
    last: joyorogo.lastSentMs === null ? t('settings:sources.joyorogo.never') : t('settings:sources.joyorogo.lastSent', { time: fmtSyncTime(joyorogo.lastSentMs / 1000) }),
    counts: t('settings:sources.joyorogo.counts', { sent: fmtInt(joyorogo.sent), waiting: fmtInt(joyorogo.waiting) }),
    note: joyorogo.lastError ? t('settings:sources.joyorogo.failed', { error: joyorogo.lastError }) : null,
  };
}

function scaleRow(f: SourceFacts): SourceRow {
  const { scale } = f;
  const title = t('settings:screens.scale');
  if (scale.name === null) {
    return { id: 'scale', title, state: 'off', via: t('settings:sources.scale.via'), last: null, counts: null, note: t('settings:sources.scale.off') };
  }
  return {
    id: 'scale',
    title,
    state: 'on',
    via: t('settings:sources.scale.viaName', { name: scale.name }),
    last: scale.lastWeighMs === null ? t('settings:sources.scale.never') : t('settings:sources.scale.lastWeigh', { time: fmtSyncTime(scale.lastWeighMs / 1000) }),
    counts: t('settings:sources.week', {
      what: [t('settings:sources.scale.weighIns', { count: scale.weighIns }), scale.waiting > 0 ? t('settings:sources.scale.waiting', { count: scale.waiting }) : null]
        .filter((p): p is string => p !== null)
        .join(' · '),
    }),
    note: null,
  };
}

/** The rows in a fixed order; a source this build cannot have (no cloud server) is left out. */
export function sourceRows(facts: SourceFacts): SourceRow[] {
  return [watchRow(facts), healthRow(facts), stravaRow(facts), joyorogoRow(facts), scaleRow(facts)].filter((r): r is SourceRow => r !== null);
}

/** Connected sources (working or needing a look) first, those not set up after; order kept inside each group. */
export function splitSources(rows: readonly SourceRow[]): { connected: SourceRow[]; available: SourceRow[] } {
  return { connected: rows.filter((r) => r.state !== 'off'), available: rows.filter((r) => r.state === 'off') };
}
