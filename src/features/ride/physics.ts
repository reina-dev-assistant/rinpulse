/**
 * Virtual speed and ESTIMATED power for riding the web game with a cadence sensor and no power meter. Pure TypeScript, no imports, no
 * DOM, no React Native: the app (cycling analysis), the browser game and the tests all use it. docs/ride.md explains the model.
 *
 * What is measured and what is not: the only measured inputs are the rider's cadence (and heart rate, which here drives cosmetics
 * only, `effortFromHr`). The rider picks a virtual gear in the game or on the phone. From there:
 *
 * 1. Drivetrain: cadence x gear ratio x wheel circumference is how fast the bike moves when the rider pedals (`driveSpeed`). A chain
 *    ties pedals to the wheel, so on a given gear that speed is what cadence means.
 * 2. Physics: the power needed to move rider plus bike at that speed on the current grade against air and rolling resistance
 *    (`powerAtSpeed`). That is the estimated power. It is a model of the ride, not a measurement: show it as "estimasi" /
 *    "estimated", never next to a real power reading without that label, and never record it as measured power.
 * 3. Limits: the rider's legs cap the power (`maxPowerW`), so a hard gear on a steep climb grinds slower than the cadence suggests
 *    until the rider shifts down, and the bike has inertia (`stepSpeed`), so speed follows cadence smoothly and coasting slows it.
 *
 * Coasting (cadence 0, or pedals slower than the wheel) is 0 W, like a freewheel.
 */

export const GRAVITY = 9.81;
/** kg/m^3 at about 20 C near sea level. */
export const AIR_DENSITY = 1.2;
/** m^2, hoods position of a road rider (0.32 to 0.40 in the wind tunnel data of Martin et al. 1998). */
export const CDA = 0.35;
/** Rolling resistance of a road tyre on smooth tarmac. */
export const CRR = 0.004;
export const BIKE_KG = 9;
/** Share of the pedal power that reaches the wheel (a clean chain). */
export const DRIVETRAIN_EFFICIENCY = 0.976;
/** 700x25c, the app's default wheel (`WHEEL_CIRCUMFERENCE_MM['700x25c']` in sensors/gatt.ts). */
export const WHEEL_CIRCUMFERENCE_M = 2.105;
/** Used when the phone sends no weight. */
export const DEFAULT_RIDER_KG = 70;
/** Fastest the game lets the bike go, m/s (90 km/h); a long steep descent stops here instead of at its terminal speed. */
export const MAX_SPEED_MS = 25;
/** Largest acceleration the rider can make from the pedals, m/s^2. */
export const MAX_ACCEL_MS2 = 2;
/** What the legs can give on top of a climb or a sprint, per kg of the rider. A game limit, not a claim about anyone's fitness. */
export const MAX_POWER_W_PER_KG = 6;

// ---------------------------------------------------------------------------------------------------------------------
// Gears

export interface Gear {
  label: string;
  chainring: number;
  cog: number;
  /** chainring / cog */
  ratio: number;
}

const CHAINRINGS = [34, 50] as const;
const COGS = [11, 12, 13, 14, 15, 17, 19, 21, 24, 28] as const;
/** Gears closer than this to the next easier one are left out (50x24 is 34x17 with other numbers). */
const MIN_RATIO_STEP = 1.045;

function buildGears(): Gear[] {
  const all: Gear[] = [];
  for (const chainring of CHAINRINGS) {
    for (const cog of COGS) all.push({ label: `${chainring}x${cog}`, chainring, cog, ratio: chainring / cog });
  }
  all.sort((a, b) => a.ratio - b.ratio);
  const kept: Gear[] = [];
  for (const gear of all) {
    const last = kept[kept.length - 1];
    if (!last || gear.ratio / last.ratio >= MIN_RATIO_STEP) kept.push(gear);
  }
  return kept;
}

/** A compact 34/50 chainset with an 11-28 cassette, easiest first: the rider shifts up and down this list. */
export const GEARS: readonly Gear[] = buildGears();
export const GEAR_COUNT = GEARS.length;
/** The gear a ride starts in on the flat: about 2.3, relaxed at 80 rpm (23 km/h, under 100 W). */
export const DEFAULT_GEAR_INDEX = GEARS.reduce((best, g, i) => (Math.abs(g.ratio - 2.3) < Math.abs((GEARS[best]?.ratio ?? 0) - 2.3) ? i : best), 0);
/** Steady cadence and effort the auto gear aims at on a climb: about 225 W at 80 rpm on 6 %, in the 200 to 250 W band. */
export const CLIMB_TARGET_CADENCE_RPM = 80;
export const CLIMB_TARGET_POWER_W = 225;

/** The nearest valid gear index. */
export function clampGear(index: number): number {
  return Math.min(GEAR_COUNT - 1, Math.max(0, Math.round(Number.isFinite(index) ? index : DEFAULT_GEAR_INDEX)));
}

export function gearRatio(index: number): number {
  return GEARS[clampGear(index)]?.ratio ?? 1;
}

/** Metres per second the bike moves when the rider pedals at `cadRpm` in gear `gearIdx` (the wheel turns `ratio` times per crank turn). */
export function driveSpeed(cadRpm: number, gearIdx: number): number {
  if (!(cadRpm > 0)) return 0;
  return (cadRpm * gearRatio(gearIdx) * WHEEL_CIRCUMFERENCE_M) / 60;
}

// ---------------------------------------------------------------------------------------------------------------------
// Resistance and power

/** Force (N) pushing against the bike at `vMs` on `gradePct` (positive uphill): gravity along the road, rolling and air. Negative on a steep descent. */
export function resistanceN(vMs: number, gradePct: number, massKg: number, cdaScale = 1): number {
  const theta = Math.atan(gradePct / 100);
  const m = massKg + BIKE_KG;
  return m * GRAVITY * (Math.sin(theta) + CRR * Math.cos(theta)) + 0.5 * AIR_DENSITY * CDA * cdaScale * vMs * Math.abs(vMs);
}

/** Watts the pedals must give to hold `vMs` on `gradePct`; 0 when gravity alone keeps the bike going. */
export function powerAtSpeed(vMs: number, gradePct: number, massKg: number, cdaScale = 1): number {
  return Math.max(0, (resistanceN(vMs, gradePct, massKg, cdaScale) * vMs) / DRIVETRAIN_EFFICIENCY);
}

/**
 * The steady speed (m/s) `powerW` holds on `gradePct`: the inverse of `powerAtSpeed`. 0 W on the flat is 0; 0 W on a descent is the
 * speed gravity settles at. Capped at `MAX_SPEED_MS`.
 */
export function speedFromPower(powerW: number, gradePct: number, massKg: number, cdaScale = 1): number {
  const wheel = Math.max(0, powerW) * DRIVETRAIN_EFFICIENCY;
  const theta = Math.atan(gradePct / 100);
  const a = (massKg + BIKE_KG) * GRAVITY * (Math.sin(theta) + CRR * Math.cos(theta));
  const b = 0.5 * AIR_DENSITY * CDA * cdaScale;
  // wheel = a v + b v^3. For a < 0 (descent) the right side first dips below zero, so search from its lowest point, where it rises.
  let lo = a < 0 ? Math.sqrt(-a / (3 * b)) : 0;
  let hi = MAX_SPEED_MS * 2;
  if (a * lo + b * lo ** 3 >= wheel) return Math.min(MAX_SPEED_MS, Math.max(0, lo));
  for (let k = 0; k < 50; k++) {
    const v = (lo + hi) / 2;
    if (a * v + b * v ** 3 < wheel) lo = v;
    else hi = v;
  }
  return Math.min(MAX_SPEED_MS, (lo + hi) / 2);
}

export interface PowerInput {
  cadRpm: number;
  gearIdx: number;
  /** Road grade in percent, positive uphill. */
  gradePct: number;
  massKg: number;
  /** The bike's current speed, m/s. */
  vMs: number;
  /** Multiplies the drag area: below 1 while drafting behind another rider (default 1). */
  cdaScale?: number;
}

/** Slack (m/s) under which pedals counted as turning the wheel rather than freewheeling. */
const FREEWHEEL_SLACK_MS = 0.2;

/**
 * ESTIMATED power (W) at this moment: the power the physics model needs to hold `vMs` on this grade while the rider pedals. 0 while
 * coasting (no cadence, or the pedals are slower than the wheel). Label it "estimasi".
 */
export function estimatePower(input: PowerInput): number {
  if (!(input.cadRpm > 0)) return 0;
  if (driveSpeed(input.cadRpm, input.gearIdx) < input.vMs - FREEWHEEL_SLACK_MS) return 0;
  return powerAtSpeed(input.vMs, input.gradePct, input.massKg, input.cdaScale);
}

export interface StepInput {
  cadRpm: number;
  gearIdx: number;
  gradePct: number;
  massKg: number;
  /** The most the rider can give, W. Defaults to `MAX_POWER_W_PER_KG` x `massKg`. */
  maxPowerW?: number;
  /** Multiplies the drag area: below 1 while drafting behind another rider (default 1). */
  cdaScale?: number;
}

export interface StepResult {
  /** The bike's speed after the step, m/s. */
  vMs: number;
  /** ESTIMATED power over the step, W (0 while coasting). */
  pwrW: number;
}

/** Below this speed (m/s) the pedal force, not the power, limits how hard a start can be: keeps `power / v` finite. */
const MIN_PUSH_SPEED_MS = 1;

/**
 * Moves the bike `dtS` seconds ahead.
 *
 * - The rider pedals faster than the wheel (`driveSpeed` above `vMs`): the bike accelerates towards `driveSpeed`, as hard as the
 *   power limit and `MAX_ACCEL_MS2` allow, and never past it. When the limit keeps `driveSpeed` out of reach (a hard gear on a climb)
 *   the speed settles where `maxPowerW` holds it, and power reads `maxPowerW`.
 * - Otherwise the rider coasts: resistance and gravity change the speed, power is 0. When coasting slows the bike down to the pedals,
 *   they take over again.
 */
export function stepSpeed(vMs: number, input: StepInput, dtS: number): StepResult {
  const mass = input.massKg + BIKE_KG;
  const v = Math.max(0, vMs);
  const maxPowerW = input.maxPowerW ?? MAX_POWER_W_PER_KG * input.massKg;
  const drive = driveSpeed(input.cadRpm, input.gearIdx);
  const resistance = resistanceN(v, input.gradePct, input.massKg, input.cdaScale);

  let next: number;
  let engaged: boolean;
  if (drive > v) {
    // Pedals ahead of the wheel: push, up to the power limit.
    const reachable = Math.min(drive, speedFromPower(maxPowerW, input.gradePct, input.massKg, input.cdaScale));
    const accel = Math.min(MAX_ACCEL_MS2, (maxPowerW * DRIVETRAIN_EFFICIENCY) / Math.max(v, MIN_PUSH_SPEED_MS) / mass - resistance / mass);
    next = accel >= 0 ? Math.min(reachable, v + accel * dtS) : Math.max(reachable, v + accel * dtS);
    engaged = true;
  } else {
    next = v - (resistance / mass) * dtS;
    // Slowing down to the pedals: they pick the wheel up again.
    engaged = drive > 0 && next <= drive;
    if (engaged) next = drive;
  }
  next = Math.min(MAX_SPEED_MS, Math.max(0, next));
  if (!engaged || dtS <= 0) return { vMs: next, pwrW: 0 };

  const mean = (v + next) / 2;
  const wheelW = resistanceN(mean, input.gradePct, input.massKg, input.cdaScale) * mean + mass * mean * ((next - v) / dtS);
  return { vMs: next, pwrW: Math.min(maxPowerW, Math.max(0, wheelW / DRIVETRAIN_EFFICIENCY)) };
}

/**
 * The gear a rider who has not shifted yet rides in on `gradePct`: the one whose steady power at `CLIMB_TARGET_CADENCE_RPM` is closest to
 * `CLIMB_TARGET_POWER_W`, never harder than `DEFAULT_GEAR_INDEX`. The flat and gentle slopes stay in the default gear; 6 % lands in
 * 34x24 (about 240 W at 80 rpm), Bukit's 10.8 % in the easiest gear (34x28).
 */
export function climbGear(gradePct: number, massKg: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i <= DEFAULT_GEAR_INDEX; i++) {
    const err = Math.abs(powerAtSpeed(driveSpeed(CLIMB_TARGET_CADENCE_RPM, i), gradePct, massKg) - CLIMB_TARGET_POWER_W);
    if (err < bestErr) {
      best = i;
      bestErr = err;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------
// Heart rate (cosmetics)

/**
 * How hard the heart is working, 0 to 1, from the share of the reserve between `restHr` and `maxHr` (Karvonen). The game uses it for
 * cosmetics only (the rider's breathing, sweat, a flush on the screen); it never feeds the physics.
 */
export function effortFromHr(hr: number, maxHr = 190, restHr = 60): number {
  if (!(hr > 0) || maxHr <= restHr) return 0;
  return Math.min(1, Math.max(0, (hr - restHr) / (maxHr - restHr)));
}
