/**
 * Calendar days as local `YYYY-MM-DD` strings. Plans live on calendar days, not on instants, so the arithmetic here is
 * done on UTC midnights of those strings: no daylight-saving drift and the same answer on every phone.
 */

const DAY_MS = 86_400_000;

const pad = (n: number): string => String(n).padStart(2, '0');

function parse(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function format(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The local calendar day of an instant (unix seconds). */
export function localDay(sec: number): string {
  const date = new Date(sec * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day: string, days: number): string {
  return format(parse(day) + days * DAY_MS);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}

/** 0 = Monday .. 6 = Sunday. */
export function weekdayOf(day: string): number {
  return (new Date(parse(day)).getUTCDay() + 6) % 7;
}

/** The Monday on or before `day`. */
export function mondayOf(day: string): string {
  return addDays(day, -weekdayOf(day));
}

/** Local midnight (unix seconds) at the start of `day`. */
export function dayStartSec(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(new Date(y!, m! - 1, d!).getTime() / 1000);
}
