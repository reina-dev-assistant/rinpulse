import type { GhostRun } from "./session.ts";
import type { QualityId } from "./theme.ts";

const GHOST_PREFIX = "joyofit-ride-ghost:";
const SEGMENT_PREFIX = "joyofit-ride-segments:";
const SETTINGS_KEY = "joyofit-ride-settings";
const DAILY_PREFIX = "joyofit-ride-daily:";

export type Lang = "id" | "en";

export interface Settings {
  quality?: QualityId;
  lang?: Lang;
  /** Jersey colour, 0xRRGGBB. */
  jersey?: number;
  /** Leaderboard: hide the name. */
  anon?: boolean;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the ride still works, it just forgets the record.
  }
}

export function loadGhost(routeId: string): GhostRun | null {
  const run = read<GhostRun>(GHOST_PREFIX + routeId);
  if (!run || run.routeId !== routeId || !Array.isArray(run.trace) || !(run.timeS > 0)) return null;
  return run;
}

export function saveGhost(run: GhostRun): void {
  write(GHOST_PREFIX + run.routeId, run);
}

export function loadSegmentBests(routeId: string): Record<string, number> {
  return read<Record<string, number>>(SEGMENT_PREFIX + routeId) ?? {};
}

export function saveSegmentBests(routeId: string, bests: Record<string, number>): void {
  write(SEGMENT_PREFIX + routeId, bests);
}

/** Best complete time on the daily challenge of [day] (YYYY-MM-DD, WIB). */
export function loadDailyBest(day: string): number | null {
  const v = read<number>(DAILY_PREFIX + day);
  return typeof v === "number" && v > 0 ? v : null;
}

export function saveDailyBest(day: string, timeS: number): void {
  write(DAILY_PREFIX + day, timeS);
}

export function loadSettings(): Settings {
  return read<Settings>(SETTINGS_KEY) ?? {};
}

export function saveSettings(patch: Settings): void {
  write(SETTINGS_KEY, { ...loadSettings(), ...patch });
}

const TV_UA = /smart-?tv|tizen|web0s|webos|hbbtv|appletv|android ?tv|crkey|silk|aft[a-z]|bravia|viera/i;

/** First-run quality: televisions get the low preset, phones medium, everything else high (the frame loop sheds pixels if it must). */
export function defaultQuality(): QualityId {
  const ua = navigator.userAgent;
  if (TV_UA.test(ua)) return "low";
  if (/mobi|android|iphone|ipad/i.test(ua)) return "medium";
  return "high";
}

export function isTv(): boolean {
  return TV_UA.test(navigator.userAgent);
}
