import { t } from '@/i18n';
import { dailyStrain, strainFromTrimp, STRAIN_MAX } from '@/features/today/strain';
import type { StepSample } from '@/wear';

/**
 * Energi Tubuh: a 0 to 100 estimate of how much energy is left, JoyoFit's own model (nothing published backs the
 * constants; they are chosen so a normal day ends low and a good night starts it high). It is a closed form, not a
 * running balance: the level at any moment is worked out from the night before and what happened since waking.
 *
 *   wake level = 30 + 60 x min(1, asleep / need) + 10 x clamp(recovery z, -1, 1)           (5..100; need from `sleepNeedSec`)
 *   level(t)   = wake level
 *                - 0.8 x hours awake                      (just being up)
 *                - 55 x strain(TRIMP since waking) / 21   (effort; the same strain curve as the Strain score)
 *                - stress drain                           (up to 1 per hour at stress 100, none at 40 or below)
 *                + 5 x hours of naps                      (sleep since waking)
 *                + 0.4 per hour resting                   (minutes with no steps and a heart rate within 10 bpm of resting)
 *   clamped to 0..100.
 *
 * No sleep record for last night gives no level: a guess there would be a made-up number.
 */
const WAKE_BASE = 30;
const WAKE_SLEEP = 60;
const WAKE_RECOVERY = 10;
const AWAKE_DRAIN_PER_H = 0.8;
const STRAIN_DRAIN = 55;
const STRESS_FLOOR = 40;
const STRESS_DRAIN_PER_H = 1;
const NAP_CHARGE_PER_H = 5;
const REST_CHARGE_PER_H = 0.4;
const REST_HR_MARGIN = 10;
/** A reading counts as one minute of rest at most. */
const MINUTE_SEC = 60;

export interface EnergyInput {
  nowSec: number;
  /** When last night's sleep ended. */
  wakeSec: number;
  /** Sleep seconds, awake time left out, of last night. */
  asleepSec: number;
  /** The need last night was judged against (`sleepNeedSec` of the strain before it). */
  needSec: number;
  /** HRV recovery z-score (`Recovery.z`), when there is one. */
  recoveryZ: number | null;
  /** The maximum heart rate (training load since waking, in Edwards' fixed %HRmax zones). */
  maxHr: number;
  /** Per-minute samples since waking, oldest first (today's are enough). */
  samples: readonly Pick<StepSample, 'timestamp' | 'steps' | 'heartRate'>[];
  /** Stress readings (`health_metrics` type `emotion`, 0..100). */
  stress: readonly { ts: number; value: number }[];
  /** Sleep periods after waking (naps), unix seconds. */
  naps: readonly { start: number; end: number }[];
  /** The watch's resting heart rate today; when null a rest minute needs a heart rate of at most 70. */
  restingHr: number | null;
}

export interface EnergyPoint {
  ts: number;
  level: number;
}

export interface Energy {
  level: number;
  wakeLevel: number;
  /** Points lost or gained since waking, for the explanation. */
  parts: { awake: number; strain: number; stress: number; naps: number; rest: number };
  /** Hourly from waking to now, ending with now. */
  series: EnergyPoint[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function wakeLevel(asleepSec: number, needSec: number, recoveryZ: number | null): number {
  const share = needSec > 0 ? Math.min(1, Math.max(0, asleepSec / needSec)) : 0;
  return clamp(WAKE_BASE + WAKE_SLEEP * share + WAKE_RECOVERY * clamp(recoveryZ ?? 0, -1, 1), 5, 100);
}

function partsAt(input: EnergyInput, t: number): Energy['parts'] {
  const { wakeSec, maxHr, samples, stress, naps, restingHr } = input;
  const hours = Math.max(0, t - wakeSec) / 3600;
  const since = samples.filter((s) => s.timestamp >= wakeSec && s.timestamp < t);
  const trimp = dailyStrain(since, maxHr).reduce((a, d) => a + d.trimp, 0);
  const strain = (STRAIN_DRAIN * strainFromTrimp(trimp)) / STRAIN_MAX;

  const readings = stress.filter((r) => r.ts >= wakeSec && r.ts < t);
  const meanStress = readings.length > 0 ? readings.reduce((a, r) => a + r.value, 0) / readings.length : 0;
  const stressDrain = hours * STRESS_DRAIN_PER_H * Math.max(0, (meanStress - STRESS_FLOOR) / (100 - STRESS_FLOOR));

  const napSec = naps.reduce((a, n) => a + Math.max(0, Math.min(n.end, t) - Math.max(n.start, wakeSec)), 0);

  const restLimit = (restingHr ?? 60) + REST_HR_MARGIN;
  const restMinutes = since.filter((s) => s.steps === 0 && s.heartRate !== null && s.heartRate > 0 && s.heartRate <= restLimit).length;
  const restSec = restMinutes * MINUTE_SEC;
  // Rest inside a nap is already charged as sleep.
  const awakeRestSec = Math.max(0, restSec - napSec);

  return {
    awake: -AWAKE_DRAIN_PER_H * hours,
    strain: -strain,
    stress: -stressDrain,
    naps: (NAP_CHARGE_PER_H * napSec) / 3600,
    rest: (REST_CHARGE_PER_H * awakeRestSec) / 3600,
  };
}

const MAX_AWAKE_SEC = 36 * 3600;

function levelOf(wake: number, parts: Energy['parts']): number {
  return clamp(wake + parts.awake + parts.strain + parts.stress + parts.naps + parts.rest, 0, 100);
}

export function energyNow(input: EnergyInput): Energy | null {
  const { nowSec, wakeSec } = input;
  // A wake-up more than a day and a half back is not "last night": no level rather than one that has drained for days.
  if (!(nowSec >= wakeSec) || nowSec - wakeSec > MAX_AWAKE_SEC) return null;
  const wake = wakeLevel(input.asleepSec, input.needSec, input.recoveryZ);
  const series: EnergyPoint[] = [{ ts: wakeSec, level: wake }];
  for (let t = (Math.floor(wakeSec / 3600) + 1) * 3600; t < nowSec; t += 3600) {
    series.push({ ts: t, level: levelOf(wake, partsAt(input, t)) });
  }
  const parts = partsAt(input, nowSec);
  const level = levelOf(wake, parts);
  series.push({ ts: nowSec, level });
  return { level, wakeLevel: wake, parts, series };
}

/** Words for a level, JoyoFit's bands. */
export function energyWord(level: number): string {
  if (level >= 75) return t('health:fitness.energyWord.full');
  if (level >= 50) return t('health:fitness.energyWord.enough');
  if (level >= 25) return t('health:fitness.energyWord.low');
  return t('health:fitness.energyWord.empty');
}
