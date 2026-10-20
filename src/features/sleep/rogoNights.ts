import type { SleepEnvPayload, SleepNightPayload } from '@/cloud/sleepInsightsClient';
import type { HrvReadingRow } from '@/db/queries';
import { nightHasStages, type Night } from '@/features/sleep/nights';
import { startOfLocalDay } from '@/features/today/stats';

/** The server's own limits (JoyoRogo `sleepInsights.upsertNights`); a night outside them would be rejected whole. */
const MIN_IN_BED_SEC = 3600;
const MAX_IN_BED_SEC = 20 * 3600;
const MAX_NAPS = 4;
/** A night HRV reading can land a little after the wake-up (the watch writes it when it finishes the night). */
const HRV_GRACE_SEC = 30 * 60;

const round = (n: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Resting heart rate the server accepts (25..220), else null. */
function validRhr(bpm: number | undefined): number | null {
  if (bpm === undefined || !Number.isFinite(bpm)) return null;
  const v = Math.round(bpm);
  return v >= 25 && v <= 220 ? v : null;
}

/** Night HRV the server accepts (1..500 ms), else null. */
function validHrv(ms: number | undefined): number | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  const v = round(ms, 1);
  return v >= 1 && v <= 500 ? v : null;
}

/** The newest overnight RMSSD whose reading ended during the night; only the Android watch bridge stores these, so iOS gets null. */
function nightHrv(night: Night, hrv: readonly HrvReadingRow[]): number | null {
  let best: HrvReadingRow | null = null;
  for (const r of hrv) {
    if (r.source !== 'night' || r.rmssd <= 0) continue;
    if (r.end < night.start || r.end > night.end + HRV_GRACE_SEC) continue;
    if (!best || r.end > best.end) best = r;
  }
  return validHrv(best?.rmssd);
}

/** The thermometer summary the server accepts (-20..60 C, 0..100 %, at least one reading), else undefined. */
export function validEnv(env: SleepEnvPayload | undefined): SleepEnvPayload | undefined {
  if (!env || env.source !== 'lywsd03mmc') return undefined;
  const temps = [env.tempCMean, env.tempCMin, env.tempCMax];
  const rhs = [env.rhPctMean, env.rhPctMin, env.rhPctMax];
  if (!temps.every((v) => Number.isFinite(v) && v >= -20 && v <= 60)) return undefined;
  if (!rhs.every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) return undefined;
  if (!Number.isInteger(env.samples) || env.samples < 1) return undefined;
  return env;
}

/**
 * Turns the nights JoyoFit shows on its Sleep screen (`buildNights`, newest first) into what Wawasan tidur takes, oldest first.
 *
 * - One main night per wake date: the longest session that is not a nap; every other session of that date is a nap (at most 4,
 *   the longest ones, listed by start). A date with only naps sends nothing.
 * - Stage seconds only for a watch that gives stages; a stage-less watch (Watch Fit 2) sends `hasStages: false` and null stages.
 * - The score is the watch's own; HRV and resting heart rate are the ones JoyoFit already computes (`hrv` rows, `resting` by
 *   local-midnight), left null when missing or outside 25..220 bpm / 1..500 ms.
 * - Nights the server would refuse are dropped: onset not before wake, in bed under 1 h or over 20 h, asleep longer than in bed.
 * - `tzOffsetMin` is the phone's UTC offset at the wake-up, so a night keeps the offset of its own date.
 * - No workout fields, no per-minute data.
 *
 * `env` (by wake date) is passed through when valid and left out otherwise.
 * `maxNights` keeps only the newest wake dates.
 */
export function buildRogoNights(
  nights: readonly Night[],
  hrv: readonly HrvReadingRow[],
  resting: ReadonlyMap<number, number>,
  maxNights = Infinity,
  env: ReadonlyMap<string, SleepEnvPayload> = new Map(),
): SleepNightPayload[] {
  const byDay = new Map<string, Night[]>();
  for (const n of nights) {
    const list = byDay.get(n.day);
    if (list) list.push(n);
    else byDay.set(n.day, [n]);
  }

  const out: SleepNightPayload[] = [];
  for (const [wakeDate, sessions] of byDay) {
    const mains = sessions.filter((s) => !s.nap);
    if (mains.length === 0) continue;
    const main = mains.reduce((a, b) => (b.asleepSeconds > a.asleepSeconds ? b : a));

    const inBed = main.end - main.start;
    if (!(main.start < main.end) || inBed < MIN_IN_BED_SEC || inBed > MAX_IN_BED_SEC) continue;
    const asleepS = Math.round(main.asleepSeconds);
    if (asleepS > inBed) continue;

    const staged = nightHasStages(main);
    const naps = sessions
      .filter((s) => s !== main && s.end > s.start)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, MAX_NAPS)
      .sort((a, b) => a.start - b.start)
      .map((s): [number, number] => [s.start * 1000, s.end * 1000]);

    const wakeMs = main.end * 1000;
    out.push({
      wakeDate,
      onsetMs: main.start * 1000,
      wakeMs,
      tzOffsetMin: -new Date(wakeMs).getTimezoneOffset() || 0,
      asleepS,
      awakeS: Math.round(main.seconds.awake),
      awakenings: main.awakenings,
      hasStages: staged,
      deepS: staged ? Math.round(main.seconds.deep) : null,
      remS: staged ? Math.round(main.seconds.rem) : null,
      lightS: staged ? Math.round(main.seconds.light) : null,
      watchScore: main.score ? Math.min(100, Math.max(0, Math.round(main.score.score))) : null,
      hrvMs: nightHrv(main, hrv),
      rhrBpm: validRhr(resting.get(startOfLocalDay(main.end))),
      naps,
      ...(validEnv(env.get(wakeDate)) ? { env: validEnv(env.get(wakeDate)) } : {}),
    });
  }

  out.sort((a, b) => a.wakeMs - b.wakeMs);
  return Number.isFinite(maxNights) ? out.slice(Math.max(0, out.length - maxNights)) : out;
}
