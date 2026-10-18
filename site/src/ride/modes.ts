/**
 * Ride modes on top of a route: a free ride, a structured cadence workout, and the daily challenge.
 * Everything here is pure (no DOM, no clock reads) so it can be tested and replayed.
 */
import { ROUTES, type RouteDef } from "./routes.ts";

export type ModeId = "free" | "interval" | "daily";
export const MODE_IDS: readonly ModeId[] = ["free", "interval", "daily"];

// Interval workouts ------------------------------------------------------------------------------------------

export type BlockKind = "warm" | "easy" | "steady" | "hard" | "sprint" | "cool";

export interface IntervalBlock {
  kind: BlockKind;
  durS: number;
  /** Target cadence band, rpm. */
  cadLo: number;
  cadHi: number;
}

export interface Workout {
  id: string;
  blocks: readonly IntervalBlock[];
}

const warm = (durS: number): IntervalBlock => ({ kind: "warm", durS, cadLo: 75, cadHi: 85 });
const cool = (durS: number): IntervalBlock => ({ kind: "cool", durS, cadLo: 70, cadHi: 85 });
const easy = (durS: number): IntervalBlock => ({ kind: "easy", durS, cadLo: 70, cadHi: 85 });

function repeat(n: number, blocks: IntervalBlock[]): IntervalBlock[] {
  const out: IntervalBlock[] = [];
  for (let i = 0; i < n; i++) out.push(...blocks);
  return out;
}

export const WORKOUTS: readonly Workout[] = [
  {
    id: "tempo",
    blocks: [warm(300), ...repeat(3, [{ kind: "steady", durS: 240, cadLo: 85, cadHi: 95 }, easy(60)]), cool(180)],
  },
  {
    id: "4x4",
    blocks: [warm(360), ...repeat(4, [{ kind: "hard", durS: 240, cadLo: 92, cadHi: 105 }, easy(180)]), cool(180)],
  },
  {
    id: "sprint",
    blocks: [warm(300), ...repeat(8, [{ kind: "sprint", durS: 20, cadLo: 105, cadHi: 130 }, easy(100)]), cool(180)],
  },
];

export function workoutById(id: string): Workout {
  return WORKOUTS.find((w) => w.id === id) ?? WORKOUTS[0]!;
}

export function workoutDurationS(w: Workout): number {
  return w.blocks.reduce((sum, b) => sum + b.durS, 0);
}

export type IntervalEvent = { type: "block"; index: number; block: IntervalBlock } | { type: "done" };

export interface IntervalSnapshot {
  index: number;
  count: number;
  block: IntervalBlock;
  next: IntervalBlock | null;
  remainingS: number;
  elapsedS: number;
  totalS: number;
  /** -1 below the band, 0 inside, 1 above; null without cadence. */
  position: -1 | 0 | 1 | null;
  /** Share of the workout so far spent inside the band, 0..1. */
  compliance: number;
  done: boolean;
}

/** Walks a workout's blocks with ride time and scores the time spent inside each target band. */
export class IntervalTracker {
  private index = 0;
  private blockS = 0;
  private elapsed = 0;
  private inBand = 0;
  private lastPosition: -1 | 0 | 1 | null = null;
  private events: IntervalEvent[] = [];
  done = false;
  readonly totalS: number;
  /** Seconds in band per block, for the summary. */
  readonly blockScores: number[];

  constructor(readonly workout: Workout) {
    this.totalS = workoutDurationS(workout);
    this.blockScores = workout.blocks.map(() => 0);
    this.events.push({ type: "block", index: 0, block: workout.blocks[0]! });
  }

  step(dt: number, cad: number | undefined): void {
    if (this.done || dt <= 0) return;
    let left = dt;
    while (left > 0 && !this.done) {
      const block = this.workout.blocks[this.index]!;
      const take = Math.min(left, block.durS - this.blockS);
      this.lastPosition = cad === undefined ? null : cad < block.cadLo ? -1 : cad > block.cadHi ? 1 : 0;
      if (this.lastPosition === 0) {
        this.inBand += take;
        this.blockScores[this.index]! += take;
      }
      this.blockS += take;
      this.elapsed += take;
      left -= take;
      if (this.blockS >= block.durS - 1e-9) {
        if (this.index + 1 >= this.workout.blocks.length) {
          this.done = true;
          this.events.push({ type: "done" });
        } else {
          this.index++;
          this.blockS = 0;
          this.events.push({ type: "block", index: this.index, block: this.workout.blocks[this.index]! });
        }
      }
    }
  }

  drainEvents(): IntervalEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  get compliance(): number {
    return this.elapsed > 0 ? this.inBand / this.elapsed : 0;
  }

  snapshot(): IntervalSnapshot {
    const blocks = this.workout.blocks;
    const block = blocks[this.index]!;
    return {
      index: this.index,
      count: blocks.length,
      block,
      next: blocks[this.index + 1] ?? null,
      remainingS: Math.max(0, block.durS - this.blockS),
      elapsedS: this.elapsed,
      totalS: this.totalS,
      position: this.lastPosition,
      compliance: this.compliance,
      done: this.done,
    };
  }
}

// Daily challenge --------------------------------------------------------------------------------------------

export type Medal = "gold" | "silver" | "bronze";

/** Typical speed of a fit amateur on each route, km/h; the daily target scatters around it. */
const ROUTE_PACE_KMH: Record<string, number> = { pantai: 29, bukit: 20, kebun: 26, bromo: 13 };

export interface DailyChallenge {
  /** YYYY-MM-DD in Western Indonesian Time, the same for every player that day. */
  day: string;
  routeId: string;
  targetS: number;
}

/** The calendar day in WIB (UTC+7). */
export function wibDay(nowMs: number): string {
  return new Date(nowMs + 7 * 3600_000).toISOString().slice(0, 10);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dailyChallenge(nowMs: number, routes: readonly RouteDef[] = ROUTES): DailyChallenge {
  const day = wibDay(nowMs);
  const h = hashString(`joyofit-ride:${day}`);
  const route = routes[h % routes.length]!;
  const pace = (ROUTE_PACE_KMH[route.id] ?? 25) * (0.94 + ((h >>> 8) % 1000) / 1000 * 0.12);
  const targetS = Math.round(route.lengthM / (pace / 3.6) / 5) * 5;
  return { day, routeId: route.id, targetS };
}

/** Gold at or under the target, silver within 5 %, bronze within 15 %. */
export function medalFor(timeS: number, targetS: number): Medal | null {
  if (!(timeS > 0) || !(targetS > 0)) return null;
  if (timeS <= targetS) return "gold";
  if (timeS <= targetS * 1.05) return "silver";
  if (timeS <= targetS * 1.15) return "bronze";
  return null;
}

export const MEDAL_RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };

/** Seconds ahead (negative) or behind (positive) an even pace to the target at this distance. */
export function targetGapS(timeS: number, distM: number, lengthM: number, targetS: number): number {
  return timeS - targetS * Math.min(1, distM / lengthM);
}
