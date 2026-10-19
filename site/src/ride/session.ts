import type { GamePhase, SumLap, SumMsg } from "../../../src/features/ride/protocol.ts";
import {
  DEFAULT_GEAR_INDEX,
  climbGear,
  DEFAULT_RIDER_KG,
  clampGear,
  speedFromPower,
  stepSpeed,
} from "../../../src/features/ride/physics.ts";
import { DRAFT_SHOWN_BELOW, Peloton, RIDER_LAT, draftScale, type BotSpec } from "./riders.ts";
import type { RouteDef, SegmentDef } from "./routes.ts";
import type { Track } from "./track.ts";

export const COUNTDOWN_S = 3;
export const MAX_LAPS = 30;
/** How quickly a measured power reading moves the bike's speed, seconds. */
const POWER_SPEED_TAU_S = 2.5;
/** The best ride on a route: distance at the end of each whole second, kept in localStorage. */
export interface GhostRun {
  routeId: string;
  timeS: number;
  /** trace[i] is the distance in metres after i seconds of riding. */
  trace: number[];
}

export interface RideInput {
  cad?: number;
  hr?: number;
  /** Measured watts from a real power meter. */
  pwr?: number;
}

export type SegmentState = "idle" | "active" | "done";

export interface SegmentProgress {
  def: SegmentDef;
  state: SegmentState;
  /** Ride time at the start, while active. */
  startedAtS: number;
  /** Seconds in the segment, live while active and final once done. */
  elapsedS: number;
  /** Best stored before this ride. */
  bestS: number | null;
  /** This ride's time beat the stored best. */
  pb: boolean;
}

export type RideEvent =
  | { type: "segment-start"; segment: SegmentProgress }
  | { type: "segment-end"; segment: SegmentProgress }
  | { type: "lap"; lap: SumLap; index: number }
  | { type: "finish"; complete: boolean };

export interface RideResult {
  routeId: string;
  complete: boolean;
  timeS: number;
  distM: number;
  elevM: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  avgCad: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Mean of the physics-model power estimate, or of the measured readings when a meter was present. */
  avgPower: number | null;
  powerMeasured: boolean;
  laps: SumLap[];
  segments: SegmentProgress[];
  /** The ride's trace for the ghost, whole seconds. */
  trace: number[];
  /** Beat the stored best time on a complete ride. */
  newBest: boolean;
  /** Seconds behind (positive) or ahead of (negative) the previous best at the finish; null with no ghost. */
  deltaToBestS: number | null;
}

export function hrZone(hr: number, maxHr = 190): number {
  const pct = hr / maxHr;
  if (pct < 0.6) return 1;
  if (pct < 0.7) return 2;
  if (pct < 0.8) return 3;
  if (pct < 0.9) return 4;
  return 5;
}

export class RideSession {
  phase: GamePhase = "idle";
  gear = DEFAULT_GEAR_INDEX;
  /** Until the rider shifts (here or on the phone) the game picks the gear for the grade (`climbGear`). */
  private shifted = false;
  countdownS = COUNTDOWN_S;
  distM = 0;
  elevGainM = 0;
  timeS = 0;
  speedMs = 0;
  powerW = 0;
  powerMeasured = false;
  grade = 0;
  hr: number | undefined;
  cad: number | undefined;
  /** In someone's slipstream enough to notice (see `cdaScale`). */
  drafting = false;
  /** Share of the air drag left this step: 1 in clean air, down to DRAFT_CDA_SCALE on a wheel. */
  cdaScale = 1;
  maxSpeedMs = 0;
  /** Times the rider crossed the finish and started the route again (loop rides only). */
  loops = 0;
  /** Loop rides restart the route at the finish instead of ending; the ride ends on stop(). */
  readonly loop: boolean;
  readonly laps: SumLap[] = [];
  readonly segments: SegmentProgress[];
  readonly trace: number[] = [0];
  result: RideResult | null = null;
  /** Pacer bots on the road with the rider; empty when the session was made without any. */
  readonly peloton: Peloton;
  readonly massKg: number;

  private events: RideEvent[] = [];
  private lapStartS = 0;
  private lapStartM = 0;
  private prevElev: number;
  private cadSum = 0;
  private cadN = 0;
  private hrSum = 0;
  private hrN = 0;
  private maxHr = 0;
  private powerSum = 0;
  private powerN = 0;
  private readonly playerRef = { distM: 0, lat: RIDER_LAT, speedMs: 0 };

  constructor(
    readonly route: RouteDef,
    private readonly track: Track,
    options: {
      massKg?: number;
      ghost: GhostRun | null;
      segmentBests: Record<string, number>;
      loop?: boolean;
      bots?: readonly BotSpec[];
    },
  ) {
    this.loop = options.loop ?? false;
    this.massKg = options.massKg ?? DEFAULT_RIDER_KG;
    this.ghost = this.loop ? null : options.ghost;
    this.peloton = new Peloton(route, track, options.bots ?? [], this.loop);
    this.prevElev = track.elevationAt(0);
    this.grade = track.gradeAt(0);
    this.segments = route.segments.map((def) => ({
      def,
      state: "idle",
      startedAtS: 0,
      elapsedS: 0,
      bestS: options.segmentBests[def.id] ?? null,
      pb: false,
    }));
  }

  readonly ghost: GhostRun | null;

  /** Distance of the ghost after [timeS] seconds of riding; holds at the finish once its ride is over. */
  ghostDistAt(timeS: number): number | null {
    const trace = this.ghost?.trace;
    if (!trace || trace.length === 0) return null;
    const i = Math.floor(timeS);
    if (i >= trace.length - 1) return trace[trace.length - 1]!;
    const a = trace[i]!;
    return a + (trace[i + 1]! - a) * (timeS - i);
  }

  get ghostDistM(): number | null {
    return this.ghostDistAt(this.timeS);
  }

  /** Metres the rider is ahead of the ghost (negative when behind). */
  get ghostGapM(): number | null {
    const g = this.ghostDistM;
    return g === null ? null : this.distM - g;
  }

  get remainingM(): number {
    return Math.max(0, this.route.lengthM - this.distM);
  }

  /** Distance ridden including whole loops. */
  get totalDistM(): number {
    return this.loops * this.route.lengthM + this.distM;
  }

  drainEvents(): RideEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  startCountdown(): void {
    if (this.phase !== "idle") return;
    this.phase = "countdown";
    this.countdownS = COUNTDOWN_S;
  }

  pause(): void {
    if (this.phase === "riding") this.phase = "paused";
  }

  resume(): void {
    if (this.phase === "paused") this.phase = "riding";
  }

  shift(delta: 1 | -1): void {
    this.shifted = true;
    this.gear = clampGear(this.gear + delta);
  }

  lap(): void {
    if (this.phase !== "riding" || this.laps.length >= MAX_LAPS) return;
    const lap = { sec: round1(this.timeS - this.lapStartS), distM: round1(this.totalDistM - this.lapStartM) };
    this.laps.push(lap);
    this.lapStartS = this.timeS;
    this.lapStartM = this.totalDistM;
    this.events.push({ type: "lap", lap, index: this.laps.length });
  }

  /** Ends the ride where it is. A ride that did not reach the finish line is "incomplete" and never becomes the best. */
  stop(): void {
    if (this.phase === "finished" || this.phase === "idle") return;
    this.finish(!this.loop && this.distM >= this.route.lengthM);
  }

  step(dt: number, input: RideInput): void {
    if (this.phase === "countdown") {
      this.countdownS -= dt;
      if (this.countdownS <= 0) this.phase = "riding";
      this.hr = input.hr;
      this.cad = input.cad;
      return;
    }
    this.hr = input.hr;
    this.cad = input.cad;
    if (this.phase !== "riding") return;

    this.grade = this.track.gradeAt(this.distM);
    const ghostGap = this.ghostGapM;
    const ghostLive = this.ghost !== null && this.timeS < this.ghost.timeS;
    let cdaScale = ghostLive && ghostGap !== null ? draftScale(-ghostGap) : 1;
    for (const bot of this.peloton.bots) cdaScale = Math.min(cdaScale, draftScale(this.peloton.gap(this.distM, bot.distM)));
    this.cdaScale = cdaScale;
    this.drafting = cdaScale < DRAFT_SHOWN_BELOW && this.speedMs > 2;
    if (!this.shifted) this.gear = climbGear(this.grade, this.massKg);

    if (input.pwr !== undefined) {
      const target = speedFromPower(input.pwr, this.grade, this.massKg, cdaScale);
      this.speedMs += (target - this.speedMs) * Math.min(1, dt / POWER_SPEED_TAU_S);
      this.powerW = input.pwr;
      this.powerMeasured = true;
    } else {
      const r = stepSpeed(
        this.speedMs,
        { cadRpm: input.cad ?? 0, gearIdx: this.gear, gradePct: this.grade, massKg: this.massKg, cdaScale },
        dt,
      );
      this.speedMs = r.vMs;
      this.powerW = r.pwrW;
      this.powerMeasured = false;
    }

    this.distM += this.speedMs * dt;
    this.timeS += dt;
    this.playerRef.distM = this.distM;
    this.playerRef.speedMs = this.speedMs;
    this.peloton.step(dt, this.playerRef);
    this.maxSpeedMs = Math.max(this.maxSpeedMs, this.speedMs);

    const elev = this.track.elevationAt(Math.min(this.distM, this.route.lengthM));
    if (elev > this.prevElev) this.elevGainM += elev - this.prevElev;
    this.prevElev = elev;

    if (input.cad !== undefined) {
      this.cadSum += input.cad * dt;
      this.cadN += dt;
    }
    if (input.hr !== undefined) {
      this.hrSum += input.hr * dt;
      this.hrN += dt;
      this.maxHr = Math.max(this.maxHr, input.hr);
    }
    this.powerSum += this.powerW * dt;
    this.powerN += dt;

    while (this.trace.length <= Math.floor(this.timeS)) this.trace.push(round1(this.distM));

    this.updateSegments();

    if (this.distM >= this.route.lengthM) {
      if (this.loop) {
        this.distM -= this.route.lengthM;
        this.loops++;
        this.prevElev = this.track.elevationAt(this.distM);
        for (const seg of this.segments) if (seg.state !== "active") seg.state = "idle";
      } else {
        this.distM = this.route.lengthM;
        this.finish(true);
      }
    }
  }

  private updateSegments(): void {
    for (const seg of this.segments) {
      if (seg.state === "idle" && this.distM >= seg.def.startM && this.distM < seg.def.endM) {
        seg.state = "active";
        seg.startedAtS = this.timeS;
        seg.elapsedS = 0;
        this.events.push({ type: "segment-start", segment: seg });
      } else if (seg.state === "active") {
        seg.elapsedS = this.timeS - seg.startedAtS;
        if (this.distM >= seg.def.endM) {
          seg.state = "done";
          seg.pb = seg.bestS === null || seg.elapsedS < seg.bestS;
          this.events.push({ type: "segment-end", segment: seg });
        }
      }
    }
  }

  private finish(complete: boolean): void {
    this.phase = "finished";
    const totalM = this.totalDistM;
    if (totalM - this.lapStartM > 1 && this.laps.length < MAX_LAPS) {
      this.laps.push({ sec: round1(this.timeS - this.lapStartS), distM: round1(totalM - this.lapStartM) });
    }
    for (const seg of this.segments) if (seg.state === "active") seg.state = "idle";
    const ghostTime = this.ghost?.timeS ?? null;
    this.result = {
      routeId: this.route.id,
      complete,
      timeS: this.timeS,
      distM: totalM,
      elevM: this.elevGainM,
      avgSpeedKmh: this.timeS > 0 ? (totalM / this.timeS) * 3.6 : 0,
      maxSpeedKmh: this.maxSpeedMs * 3.6,
      avgCad: this.cadN > 0 ? this.cadSum / this.cadN : null,
      avgHr: this.hrN > 0 ? this.hrSum / this.hrN : null,
      maxHr: this.maxHr > 0 ? this.maxHr : null,
      avgPower: this.powerN > 0 ? this.powerSum / this.powerN : null,
      powerMeasured: this.powerMeasured,
      laps: this.laps.slice(),
      segments: this.segments,
      trace: this.trace.slice(),
      newBest: complete && (ghostTime === null || this.timeS < ghostTime),
      deltaToBestS: complete && ghostTime !== null ? this.timeS - ghostTime : null,
    };
    this.events.push({ type: "finish", complete });
  }

  state(): StateFields {
    return {
      gear: this.gear,
      phase: this.phase,
      distM: this.distM,
      elevM: this.elevGainM,
      grade: this.grade,
      vKmh: this.speedMs * 3.6,
      pwrEst: this.powerMeasured ? 0 : this.powerW,
    };
  }

  summaryMessage(): SumMsg | null {
    if (!this.result) return null;
    return {
      t: "sum",
      v: 1,
      distM: round1(this.result.distM),
      elevM: round1(this.result.elevM),
      route: this.route.name,
      laps: this.result.laps.slice(0, MAX_LAPS),
    };
  }
}

interface StateFields {
  gear: number;
  phase: GamePhase;
  distM: number;
  elevM: number;
  grade: number;
  vKmh: number;
  pwrEst: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
