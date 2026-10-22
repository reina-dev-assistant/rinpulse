/**
 * The guide of the time trial: wall-clock times only, so the phase is right after the app was in the background or restarted. The guide does not record
 * the run (the watch or JoyoFit's recorder does); it tells when to start the effort, and its times are where the analysis looks first.
 */
import { COOLDOWN_SEC, EFFORT_SEC, SETTLE_SEC, WARMUP_SEC } from './trial';

export interface Guide {
  /** Epoch milliseconds the warm-up began. */
  startedAt: number;
}

export type GuidePhase = 'warmup' | 'effort' | 'cooldown' | 'done';

export interface GuideState {
  phase: GuidePhase;
  /** Seconds left in the phase; 0 when done. */
  leftSec: number;
  /** Seconds the phase lasts. */
  lengthSec: number;
  /** Within the effort: false while the first 10 minutes (not measured) run. */
  measuring: boolean;
  /** Unix seconds the effort starts and ends. */
  effortStart: number;
  effortEnd: number;
}

export function guideState(guide: Guide, nowMs: number): GuideState {
  const elapsed = Math.max(0, Math.floor((nowMs - guide.startedAt) / 1000));
  const effortStart = Math.floor(guide.startedAt / 1000) + WARMUP_SEC;
  const base = { effortStart, effortEnd: effortStart + EFFORT_SEC };
  if (elapsed < WARMUP_SEC) return { ...base, phase: 'warmup', leftSec: WARMUP_SEC - elapsed, lengthSec: WARMUP_SEC, measuring: false };
  const inEffort = elapsed - WARMUP_SEC;
  if (inEffort < EFFORT_SEC) return { ...base, phase: 'effort', leftSec: EFFORT_SEC - inEffort, lengthSec: EFFORT_SEC, measuring: inEffort >= SETTLE_SEC };
  const inCool = inEffort - EFFORT_SEC;
  if (inCool < COOLDOWN_SEC) return { ...base, phase: 'cooldown', leftSec: COOLDOWN_SEC - inCool, lengthSec: COOLDOWN_SEC, measuring: false };
  return { ...base, phase: 'done', leftSec: 0, lengthSec: 0, measuring: false };
}

/** The moments the phone says something: seconds after the guide began. */
export const GUIDE_CUES = [
  { key: 'effort', afterSec: WARMUP_SEC },
  { key: 'measure', afterSec: WARMUP_SEC + SETTLE_SEC },
  { key: 'cooldown', afterSec: WARMUP_SEC + EFFORT_SEC },
] as const;

export type GuideCue = (typeof GUIDE_CUES)[number]['key'];

export function parseGuide(raw: string | null, nowMs: number): Guide | null {
  if (raw === null) return null;
  try {
    const doc = JSON.parse(raw) as { startedAt?: unknown };
    const startedAt = Number(doc.startedAt);
    // A guide older than a day is a forgotten one.
    if (!Number.isFinite(startedAt) || nowMs - startedAt > 24 * 3600 * 1000 || startedAt > nowMs + 60_000) return null;
    return { startedAt };
  } catch {
    return null;
  }
}
