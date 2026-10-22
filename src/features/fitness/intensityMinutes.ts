import { intensityZones, type HrZoneMethod } from '@/features/hrzones/zones';
import type { DayStrain } from '@/features/today/strain';
import { addDays } from '@/features/trends/series';

/**
 * Intensity minutes of a week (Monday to Sunday, local time), from the per-minute heart rate the watch stored:
 * minutes at 60 to 80 % of maximum heart rate (Edwards zones 2 and 3) are moderate and count once; minutes at 80 % and
 * above (zones 4 and 5) are vigorous and count twice. With the heart-rate-reserve method the zones are Huawei's six (`intensityZones`):
 * warm-up and aerobic base (50 to 74 % of the reserve) are moderate, every zone from the aerobic advance up is vigorous. The target is 150 a week, the moderate-activity minimum of the WHO
 * 2020 guidelines and the ACSM 2018 advice (75 vigorous minutes equal 150 moderate ones, hence the doubling).
 */
export const WEEKLY_TARGET_MIN = 150;

/** A day counts as an active day (a check on the week's pills) from this many intensity minutes, so a stray minute above 60 % of maximum heart rate is not an exercise day. */
export const ACTIVE_DAY_MIN = 10;

export interface IntensityDay {
  day: number;
  moderate: number;
  vigorous: number;
  /** moderate + 2 x vigorous. */
  total: number;
}

export interface IntensityWeek {
  /** Local Monday midnight. */
  weekStart: number;
  moderate: number;
  vigorous: number;
  total: number;
  target: number;
  /** Seven days, Monday first; days without heart rate are zero. */
  days: IntensityDay[];
}

/** Local midnight of the Monday on or before `daySec` (any time of that day). */
export function mondayOf(daySec: number): number {
  const d = new Date(daySec * 1000);
  const back = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return Math.floor(d.getTime() / 1000);
}

export function intensityMinutes(days: readonly Pick<DayStrain, 'day' | 'zoneMinutes'>[], weekStart: number, method: HrZoneMethod): IntensityWeek {
  const bands = intensityZones(method);
  const sum = (z: readonly number[], indexes: readonly number[]) => indexes.reduce((a, i) => a + (z[i] ?? 0), 0);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const out: IntensityDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const z = byDay.get(day)?.zoneMinutes;
    const moderate = z ? sum(z, bands.moderate) : 0;
    const vigorous = z ? sum(z, bands.vigorous) : 0;
    out.push({ day, moderate, vigorous, total: moderate + 2 * vigorous });
  }
  const moderate = out.reduce((a, d) => a + d.moderate, 0);
  const vigorous = out.reduce((a, d) => a + d.vigorous, 0);
  return { weekStart, moderate, vigorous, total: moderate + 2 * vigorous, target: WEEKLY_TARGET_MIN, days: out };
}
