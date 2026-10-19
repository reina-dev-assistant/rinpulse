/**
 * Pacer bots that share the road with the player, and the slipstream every rider leaves behind. Pure: no DOM, no clock reads.
 *
 * Indonesia keeps left, so riders use the left lane (negative lateral offsets) and oncoming traffic the right one.
 */
import { BIKE_KG, DRIVETRAIN_EFFICIENCY, MAX_SPEED_MS, resistanceN, speedFromPower } from "../../../src/features/ride/physics.ts";
import type { RouteDef } from "./routes.ts";
import type { Track } from "./track.ts";

/** Lateral offsets in metres from the road centre; negative is left of the centre line. */
export const RIDER_LAT = -1.6;
export const GHOST_LAT = -2.7;
const LANE_MIN = -3.3;
const LANE_MAX = -0.55;

/** Centre-to-centre distance behind a rider where the slipstream works: full shelter up to DRAFT_FULL_M, none past DRAFT_MAX_M. */
export const DRAFT_MIN_M = 1;
export const DRAFT_FULL_M = 4;
export const DRAFT_MAX_M = 12;
/** Fraction of the air drag left in the best spot of the slipstream. */
export const DRAFT_CDA_SCALE = 0.7;
/** Below this drag share the HUD says the rider is drafting. */
export const DRAFT_SHOWN_BELOW = 0.97;

/** Drag share left [gapM] metres (centre to centre) behind a rider; 1 = no shelter. */
export function draftScale(gapM: number): number {
  if (!(gapM >= DRAFT_MIN_M) || gapM > DRAFT_MAX_M) return 1;
  const along = gapM <= DRAFT_FULL_M ? 1 : 1 - (gapM - DRAFT_FULL_M) / (DRAFT_MAX_M - DRAFT_FULL_M);
  return 1 - (1 - DRAFT_CDA_SCALE) * along;
}

export interface BotSpec {
  name: string;
  kg: number;
  /** Sustainable watts per kilogram; the bot rides a share of it that depends on the grade. */
  wkg: number;
  jersey: number;
  /** Where the bot rides when it is not following a wheel. */
  homeLat: number;
  startM: number;
}

export interface Bot {
  readonly spec: BotSpec;
  /** Route distance, metres; wraps at the route length. */
  distM: number;
  speedMs: number;
  lat: number;
  powerW: number;
  cad: number;
  /** Drag share this step (below 1 in someone's slipstream). */
  cda: number;
}

/** Any rider a bot can follow or must not ride through. */
export interface RoadUser {
  /** Metres ahead of the bot (negative = behind). */
  gapM: number;
  lat: number;
  speedMs: number;
}

const NAMES = [
  "Budi S.",
  "Sari W.",
  "Agus P.",
  "Dewi K.",
  "Rizky A.",
  "Putu W.",
  "Made A.",
  "Lestari N.",
  "Yoga H.",
  "Intan R.",
  "Bayu T.",
  "Fitri M.",
] as const;

const KIT = [0xd94a3d, 0x0a6580, 0xf2c230, 0x2f8f4e, 0x1d1d22, 0xe86aa6, 0xf08a24, 0x6b4fc8, 0xe8e4d8, 0x3a9fd6, 0xb8322a, 0x7fae4c];

/** Deterministic PRNG so a route always gets the same bots. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function routeSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const BOT_COUNT = 10;

/**
 * The bots for a route: a small group that rolls out with the player, the rest spread along the road. Stronger riders start
 * behind and come past; easier ones start ahead and get caught.
 */
export function makeBots(route: RouteDef, count = BOT_COUNT): BotSpec[] {
  const rand = mulberry32(routeSeed(route.id));
  const out: BotSpec[] = [];
  for (let i = 0; i < count; i++) {
    const wkg = 1.9 + rand() * 2.3;
    const group = i < 3;
    // Easier riders further ahead so the player has wheels to chase; strong ones start up to 200 m behind and come past.
    const ease = (4.2 - wkg) / 2.3;
    const startM = group ? 5 + i * 4.5 + rand() * 1.5 : -200 + ease * route.lengthM * 0.55 * (0.3 + rand() * 0.7);
    out.push({
      name: NAMES[i % NAMES.length]!,
      kg: Math.round(52 + rand() * 30),
      wkg: Math.round(wkg * 10) / 10,
      jersey: KIT[(i + routeSeed(route.id)) % KIT.length]!,
      homeLat: LANE_MIN + 0.4 + rand() * (LANE_MAX - LANE_MIN - 0.8),
      startM: Math.round(startM),
    });
  }
  return out;
}

/** Share of a bot's sustainable power it rides at on [grade] percent: soft-pedals down, pushes up. */
export function effortOnGrade(grade: number): number {
  if (grade <= -4) return 0.12;
  if (grade < 0) return 0.72 + (grade / 4) * 0.6;
  return Math.min(1.02, 0.72 + grade * 0.04);
}

const MAX_ACCEL = 1.6;
const MAX_BRAKE = 3;
const STEER_MS = 0.7;
const FOLLOW_M = 8;
const MIN_GAP_M = 1.7;
/** Lateral spacing of two riders side by side, metres. */
const SIDE_BY_SIDE_M = 0.9;

export class Peloton {
  readonly bots: Bot[];
  private clock = 0;
  private readonly others: RoadUser[] = [];

  constructor(
    readonly route: RouteDef,
    private readonly track: Track,
    specs: readonly BotSpec[],
    /** Loop rides: bots go round the route like the player does. */
    private readonly loop: boolean,
  ) {
    this.bots = specs.map((spec) => ({ spec, distM: spec.startM, speedMs: 0, lat: spec.homeLat, powerW: 0, cad: 0, cda: 1 }));
  }

  /** Metres from [fromM] to [toM] along the road; in a loop ride the shorter way round. */
  gap(fromM: number, toM: number): number {
    const d = toM - fromM;
    if (!this.loop) return d;
    const L = this.route.lengthM;
    return ((((d + L / 2) % L) + L) % L) - L / 2;
  }

  /** Moves every bot [dt] seconds; [player] is the human rider (distance, lateral offset, speed), whom bots follow and avoid. */
  step(dt: number, player: { distM: number; lat: number; speedMs: number } | null): void {
    if (dt <= 0) return;
    this.clock += dt;
    const L = this.route.lengthM;
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i]!;
      const others = this.others;
      others.length = 0;
      for (let j = 0; j < this.bots.length; j++) {
        if (j === i) continue;
        const o = this.bots[j]!;
        others.push({ gapM: this.gap(bot.distM, o.distM), lat: o.lat, speedMs: o.speedMs });
      }
      if (player) others.push({ gapM: this.gap(bot.distM, player.distM), lat: player.lat, speedMs: player.speedMs });
      this.stepBot(bot, dt, others, i);
      if (bot.distM >= L) bot.distM -= L;
    }
  }

  private stepBot(bot: Bot, dt: number, others: readonly RoadUser[], index: number): void {
    const { spec } = bot;
    const grade = this.track.gradeAt(Math.min(Math.max(bot.distM, 0), this.route.lengthM));

    // The wheel to follow: the nearest rider ahead.
    let ahead: RoadUser | null = null;
    let cda = 1;
    for (const o of others) {
      if (o.gapM <= 0) continue;
      cda = Math.min(cda, draftScale(o.gapM));
      if (o.gapM < FOLLOW_M && (!ahead || o.gapM < ahead.gapM)) ahead = o;
    }
    bot.cda = cda;

    // A slow surge and fade so the bunch is never perfectly steady; a bot in the slipstream eases off a little.
    const wave = 1 + 0.05 * Math.sin(this.clock * 0.11 + index * 1.7) + 0.03 * Math.sin(this.clock * 0.37 + index);
    const effort = spec.wkg * spec.kg * effortOnGrade(grade) * wave;
    const target = effort * (cda < DRAFT_SHOWN_BELOW ? 0.94 : 1);
    bot.powerW += (target - bot.powerW) * Math.min(1, dt * 1.5);

    const mass = spec.kg + BIKE_KG;
    const v = bot.speedMs;
    const push = (bot.powerW * DRIVETRAIN_EFFICIENCY) / Math.max(v, 1.5);
    let accel = (push - resistanceN(v, grade, spec.kg, cda)) / mass;
    accel = Math.min(MAX_ACCEL, accel);
    let next = Math.max(0, v + accel * dt);

    // Lanes: sit on a wheel unless the bot could ride faster in clean air, then pull out and pass; never ride through a rider in
    // the same line.
    let targetLat = spec.homeLat;
    if (ahead) {
      const sameLine = Math.abs(ahead.lat - bot.lat) < 0.75;
      if (speedFromPower(effort, grade, spec.kg) > ahead.speedMs + 0.3) {
        targetLat = ahead.lat + (ahead.lat < (LANE_MIN + LANE_MAX) / 2 ? 1.05 : -1.05);
      } else {
        targetLat = ahead.lat;
      }
      if (sameLine && ahead.gapM < MIN_GAP_M + 0.6 && next > ahead.speedMs) {
        next = Math.max(ahead.speedMs, v - MAX_BRAKE * dt);
      }
    }
    // Someone alongside (overlapping wheels): hold a shoulder's width away from them, whatever else the bot wanted.
    for (const o of others) {
      if (Math.abs(o.gapM) >= MIN_GAP_M || Math.abs(o.lat - bot.lat) >= SIDE_BY_SIDE_M) continue;
      const away = bot.lat >= o.lat ? 1 : -1;
      const wanted = o.lat + away * SIDE_BY_SIDE_M;
      targetLat = wanted > LANE_MAX || wanted < LANE_MIN ? o.lat - away * SIDE_BY_SIDE_M : wanted;
    }
    targetLat = Math.min(LANE_MAX, Math.max(LANE_MIN, targetLat));
    const dl = targetLat - bot.lat;
    bot.lat += Math.sign(dl) * Math.min(Math.abs(dl), STEER_MS * dt);

    bot.speedMs = Math.min(MAX_SPEED_MS, next);
    bot.distM += bot.speedMs * dt;
    // Pedalling at a cadence that rises with effort; freewheeling on a descent.
    bot.cad = bot.powerW > 25 ? 78 + Math.min(18, (bot.powerW / spec.kg) * 4) : 0;
  }
}
