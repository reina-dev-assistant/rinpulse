/**
 * Heart-rate zones: the one place that turns the person's settings into the five zone limits every screen and the watch use.
 *
 * What reads these zones: the zone-time displays (workout zone bars, Detak jantung hari ini, live screens, strap chip, the bike computer's
 * zone field, the burn split by zone), the coach's zone feedback and the watch. What does not: strain, the strain-based training load,
 * readiness, energy, intensity minutes and ride load are Edwards' fixed percent-of-maximum zones (`@/features/today/strain`), which take
 * only `HrZones.maxHr`; changing the method, resting rate, LTHR or limits never changes them (docs/hr-zones.md).
 *
 * The model is Huawei Health's (`HeartRateThresholdConfig`, decompiled from 17.0.8.300; docs/hr-zones.md): zones 1..5 start at 50, 60, 70,
 * 80 and 90 % of the maximum heart rate ("max" method), or the five limits at 59, 74, 84, 88 and 95 % of the heart rate reserve added to the
 * resting rate ("hrr" method), under which sits a warm-up from 50 % of the reserve: six zones, the aerobic base being Z2. A limit is the lowest whole bpm at or above the exact value, so a reading is in zone k exactly when its share reaches the
 * zone's percentage (the rule every figure of this app used before zones were editable, and so unchanged for people who set nothing; Huawei
 * Health rounds to the nearest bpm instead, up to one bpm apart). The last zone runs up to the maximum, below zone 1 is no zone.
 */

export type HrZoneMethod = 'max' | 'hrr' | 'lthr';

export const HR_ZONE_COUNT = 5;
/** Huawei Health's range for the maximum heart rate (100 to 220); the watch protocol (Gadgetbridge `isValid`) takes values below 220. */
export const MAX_HR_MIN = 100;
export const MAX_HR_MAX = 219;
/** Huawei Health's resting heart rate range (30 to 110, and 15 bpm under the maximum). */
export const REST_HR_MIN = 30;
export const REST_HR_MAX = 110;
export const REST_HR_GAP = 15;
/** Huawei Health's own default resting heart rate. */
export const DEFAULT_REST_HR = 60;
/** The lowest bpm zone 1 may start at (Huawei's zone sliders stop at 30 % ...); keeps every limit a plausible heart rate. */
export const ZONE_MIN_BPM = 30;
/** Where the heart-rate limit alert may sit. */
export const WARNING_MIN = 100;

export type ZoneLimits = [number, number, number, number, number];

/** The heart-rate-reserve method has a sixth zone under Huawei's five: the warm-up, from this share of the reserve up to the first limit. */
const WARMUP_RESERVE_PERCENT = 50;

const MAX_PERCENT: readonly number[] = [50, 60, 70, 80, 90];
const RESERVE_PERCENT: readonly number[] = [59, 74, 84, 88, 95];
/**
 * Friel's running zones as shares of the lactate threshold heart rate (LTHR): Z1 recovery up to 85 %, Z2 aerobic 85-89, Z3 tempo 90-94, Z4 sub-threshold
 * 95-99, Z5 super-threshold from 100 (Friel, "The Triathlete's Training Bible"; Z5 splits into 5a-5c above 102 and 106, left as one). The first limit,
 * 67 %, is where Huawei Health's LTHR set starts (`mLthrRecoveryInterval`), so a reading under it is in no zone like under the other methods' Z1.
 */
const LTHR_PERCENT: readonly number[] = [67, 85, 90, 95, 100];
/** Where the LTHR may sit: Huawei Health's own estimate is 85 % of the reserve above rest, so well under the maximum. */
export const LTHR_MIN = 80;

/** What a person chose; every `null` follows the default (age for the maximum, 60 for rest, the method for the limits). */
export interface HrZoneSettings {
  method: HrZoneMethod;
  maxHr: number | null;
  restingHr: number | null;
  /** The lowest bpm of zones 1..5 edited by hand; null follows the method. */
  limits: number[] | null;
  /** The lactate threshold heart rate the `lthr` method works from; null follows Huawei Health's estimate (`estimateLthr`). */
  lthr: number | null;
  /** The watch's heart-rate limit alert during a workout. On by default: Gadgetbridge's defaults, which JoyoFit sent before this setting existed. */
  warningEnabled: boolean;
  /** Null follows the maximum heart rate. */
  warningLimit: number | null;
}

export const DEFAULT_HR_ZONE_SETTINGS: HrZoneSettings = {
  method: 'max',
  maxHr: null,
  restingHr: null,
  limits: null,
  lthr: null,
  warningEnabled: true,
  warningLimit: null,
};

/** The result: everything a consumer needs, computed once. */
export interface HrZones {
  method: HrZoneMethod;
  maxHr: number;
  /** Where `maxHr` comes from: the age formula or the person's entry. */
  maxHrSource: 'age' | 'setting';
  restingHr: number;
  /** The five limits Huawei Health stores and the watch takes, strictly rising: in the max-HR method the lowest bpm of zones 1..5, in the reserve method of zones 2..6. */
  limits: Readonly<ZoneLimits>;
  /** The lowest bpm of every zone, strictly rising: `limits` for the max-HR method (five zones), the warm-up start plus `limits` for the reserve method (six). A reading under `bounds[0]` is in no zone. */
  bounds: readonly number[];
  /** The lactate threshold heart rate behind the `lthr` method's limits (the person's, or Huawei Health's estimate); null for the other methods. */
  lthr: number | null;
  /** True when the limits were edited by hand. */
  custom: boolean;
  warningEnabled: boolean;
  warningLimit: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.round(value) === value;
}

/** Maximum heart rate from age: `220 - age` (Huawei Health's, Gadgetbridge's and this app's formula until now). */
export function maxHrFromAge(age: number): number {
  return clamp(220 - age, MAX_HR_MIN, MAX_HR_MAX);
}

/** Tanaka's `208 - 0.7 x age` (Tanaka 2001), a better fit than `220 - age` for older people. */
export function maxHrTanaka(age: number): number {
  return clamp(Math.round(208 - 0.7 * age), MAX_HR_MIN, MAX_HR_MAX);
}

/** Resting rate that keeps Huawei's 15 bpm gap under the maximum. */
export function clampRest(restingHr: number, maxHr: number): number {
  return clamp(Math.round(restingHr), REST_HR_MIN, Math.min(REST_HR_MAX, maxHr - REST_HR_GAP));
}

/**
 * Makes five limits strictly rising, the first at least `ZONE_MIN_BPM` and the last below `maxHr`, moving each as little as it can.
 * Used on every set of limits, so no consumer ever meets an empty or inverted zone.
 */
export function normalizeLimits(limits: readonly number[], maxHr: number): ZoneLimits {
  const out = limits.map((value) => Math.round(value));
  out[0] = Math.max(ZONE_MIN_BPM, out[0] ?? ZONE_MIN_BPM);
  for (let i = 1; i < HR_ZONE_COUNT; i++) out[i] = Math.max(out[i] ?? 0, (out[i - 1] ?? 0) + 1);
  // Ceilings rise by one, so the minimum of two strictly rising rows is strictly rising.
  for (let i = 0; i < HR_ZONE_COUNT; i++) out[i] = Math.min(out[i] ?? 0, maxHr - 1 - (HR_ZONE_COUNT - 1 - i));
  return out as ZoneLimits;
}

/** Huawei Health's LTHR before any test (`resetLthrHeartRateZoneThreshold`): 85 % of the reserve above the resting rate. */
export function estimateLthr(maxHr: number, restingHr: number): number {
  return Math.round(restingHr + ((maxHr - restingHr) * 85) / 100);
}

/** The limits of `method`: `ceil(max x p / 100)`, `ceil(reserve x p / 100) + rest`, or `ceil(lthr x p / 100)`. */
export function methodLimits(method: HrZoneMethod, maxHr: number, restingHr: number, lthr: number = estimateLthr(maxHr, restingHr)): ZoneLimits {
  let raw: number[];
  if (method === 'max') raw = MAX_PERCENT.map((percent) => Math.ceil((maxHr * percent) / 100));
  else if (method === 'hrr') raw = RESERVE_PERCENT.map((percent) => Math.ceil(((maxHr - restingHr) * percent) / 100) + restingHr);
  else raw = LTHR_PERCENT.map((percent) => Math.ceil((lthr * percent) / 100));
  return normalizeLimits(raw, maxHr);
}

/**
 * The lowest bpm of each zone. The reserve method starts one zone earlier than Huawei's five limits: the warm-up, from 50 % of the reserve
 * (plus rest) to the first limit, so Z1 is the warm-up and Z2 the aerobic base, as the watch and Huawei Health number them. A hand-edited first
 * limit under the warm-up's start pulls the start down with it.
 */
export function zoneBounds(method: HrZoneMethod, limits: Readonly<ZoneLimits>, maxHr: number, restingHr: number): number[] {
  if (method !== 'hrr') return [...limits];
  const warmUp = Math.ceil(((maxHr - restingHr) * WARMUP_RESERVE_PERCENT) / 100) + restingHr;
  return [Math.max(Math.min(warmUp, limits[0] - 1), ZONE_MIN_BPM - 1), ...limits];
}

/** How many zones a method has: five for the maximum and the LTHR, six for the reserve (warm-up and Huawei's five). */
export function zoneCount(method: HrZoneMethod): number {
  return method === 'hrr' ? HR_ZONE_COUNT + 1 : HR_ZONE_COUNT;
}

/**
 * The share each zone starts at under `method`, in percent of what the method measures from (maximum heart rate, heart rate reserve above
 * rest, or the LTHR), one per entry of `HrZones.bounds`: the reserve method's warm-up first, then the five limits' percentages.
 */
export function methodPercents(method: HrZoneMethod): readonly number[] {
  if (method === 'max') return MAX_PERCENT;
  if (method === 'lthr') return LTHR_PERCENT;
  return [WARMUP_RESERVE_PERCENT, ...RESERVE_PERCENT];
}

/** Names of the zones, in order, as keys under `settings:hrZones.zones.names`: Huawei Health's own words for each method. */
export const ZONE_NAME_KEYS = {
  max: ['warmup', 'fatBurning', 'aerobic', 'anaerobic', 'extreme'],
  hrr: ['warmup', 'aerobicBase', 'aerobicAdvance', 'lacticAcid', 'anaerobicBase', 'anaerobicAdvance'],
  lthr: ['lthrRecovery', 'lthrAerobic', 'lthrTempo', 'lthrSubThreshold', 'lthrSuperThreshold'],
} as const satisfies Record<HrZoneMethod, readonly string[]>;

function validLimits(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === HR_ZONE_COUNT && value.every(isWholeNumber);
}

/** The zones for `settings` at `age` (the profile's, or the default age). Never throws; out-of-range values are brought into range. */
export function resolveHrZones(settings: HrZoneSettings, age: number): HrZones {
  const maxHr = settings.maxHr === null ? maxHrFromAge(age) : clamp(Math.round(settings.maxHr), MAX_HR_MIN, MAX_HR_MAX);
  const restingHr = clampRest(settings.restingHr ?? DEFAULT_REST_HR, maxHr);
  const lthr = settings.method === 'lthr' ? clamp(Math.round(settings.lthr ?? estimateLthr(maxHr, restingHr)), LTHR_MIN, maxHr - 1) : null;
  const derived = methodLimits(settings.method, maxHr, restingHr, lthr ?? undefined);
  const edited = validLimits(settings.limits) ? normalizeLimits(settings.limits, maxHr) : null;
  const custom = edited !== null && edited.some((value, i) => value !== derived[i]);
  const limits = custom && edited ? edited : derived;
  return {
    method: settings.method,
    maxHr,
    maxHrSource: settings.maxHr === null ? 'age' : 'setting',
    restingHr,
    limits,
    bounds: zoneBounds(settings.method, limits, maxHr, restingHr),
    lthr,
    custom,
    warningEnabled: settings.warningEnabled,
    warningLimit: clamp(Math.round(settings.warningLimit ?? maxHr), WARNING_MIN, MAX_HR_MAX),
  };
}

/** The zones of a maximum heart rate alone, default method: for tests and for places that only know the maximum. */
export function hrZonesForMax(maxHr: number): HrZones {
  return resolveHrZones({ ...DEFAULT_HR_ZONE_SETTINGS, maxHr }, 0);
}

/** 0 below zone 1, else 1..5 (1..6 for the reserve method): the number of bounds the reading has reached. */
export function zoneIndex(heartRate: number, zones: Pick<HrZones, 'bounds'>): number {
  let zone = 0;
  for (const limit of zones.bounds) {
    if (heartRate >= limit) zone += 1;
  }
  return zone;
}

/** The bpm range of zone `zone` (1-based): the last zone ends at the maximum, the others one below the next zone's lowest bpm. */
export function zoneRange(zone: number, zones: Pick<HrZones, 'bounds' | 'maxHr'>): { from: number; to: number } {
  const from = zones.bounds[zone - 1] ?? zones.maxHr;
  const to = zone >= zones.bounds.length ? zones.maxHr : (zones.bounds[zone] ?? zones.maxHr) - 1;
  return { from, to };
}

/**
 * Moves limit `index` (0..4) to `value` without crossing a neighbour: at least one above the limit before it (`ZONE_MIN_BPM` for the
 * first) and at most one below the one after it (the maximum for the last).
 */
export function moveLimit(limits: readonly number[], index: number, value: number, maxHr: number): ZoneLimits {
  const low = index === 0 ? ZONE_MIN_BPM : (limits[index - 1] ?? ZONE_MIN_BPM) + 1;
  const high = index === HR_ZONE_COUNT - 1 ? maxHr - 1 : (limits[index + 1] ?? maxHr) - 1;
  const next = [...limits];
  next[index] = clamp(Math.round(value), low, Math.max(low, high));
  return next as ZoneLimits;
}

/** True when `settings` are all defaults, so nothing needs to be stored or synced. */
export function isDefaultSettings(settings: HrZoneSettings): boolean {
  return sameSettings(settings, DEFAULT_HR_ZONE_SETTINGS);
}

/** True when two settings say the same thing. */
export function sameSettings(a: HrZoneSettings, b: HrZoneSettings): boolean {
  const limitsA = a.limits ?? [];
  const limitsB = b.limits ?? [];
  return (
    a.method === b.method &&
    a.maxHr === b.maxHr &&
    a.restingHr === b.restingHr &&
    a.lthr === b.lthr &&
    a.warningEnabled === b.warningEnabled &&
    a.warningLimit === b.warningLimit &&
    limitsA.length === limitsB.length &&
    limitsA.every((value, i) => value === limitsB[i])
  );
}

/** Reads settings from untrusted JSON (kv store, a pulled account document); null when it is not a settings object. Bad fields fall back to the default. */
export function parseHrZoneSettings(value: unknown): HrZoneSettings | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  const whole = (v: unknown, min: number, max: number): number | null => (isWholeNumber(v) && v >= min && v <= max ? v : null);
  return {
    method: doc.method === 'hrr' ? 'hrr' : doc.method === 'lthr' ? 'lthr' : 'max',
    maxHr: whole(doc.maxHr, MAX_HR_MIN, MAX_HR_MAX),
    restingHr: whole(doc.restingHr, REST_HR_MIN, REST_HR_MAX),
    lthr: whole(doc.lthr, LTHR_MIN, MAX_HR_MAX),
    limits: validLimits(doc.limits) ? doc.limits : null,
    warningEnabled: typeof doc.warningEnabled === 'boolean' ? doc.warningEnabled : DEFAULT_HR_ZONE_SETTINGS.warningEnabled,
    warningLimit: whole(doc.warningLimit, WARNING_MIN, MAX_HR_MAX),
  };
}

/** What the watch gets (`HeartRateZonesConfig` in the native module): the zones as computed here, nothing left for the watch to recompute. */
export function watchConfig(zones: HrZones): {
  method: 'max' | 'hrr';
  maxHr: number;
  restingHr: number;
  zones: number[];
  warningEnabled: boolean;
  warningLimit: number;
} {
  return {
    // The watch takes the zones as the lowest bpm of five zones under a maximum-heart-rate or a reserve set; the LTHR zones travel as the maximum's set.
    method: zones.method === 'hrr' ? 'hrr' : 'max',
    maxHr: zones.maxHr,
    restingHr: zones.restingHr,
    zones: [...zones.limits],
    warningEnabled: zones.warningEnabled,
    warningLimit: zones.warningLimit,
  };
}

/** A highest heart rate that is the next one's neighbour within this many bpm is believed; further above, it is taken for a sensor spike. */
const SPIKE_BPM = 10;

/**
 * The highest heart rate the workouts show, for a maximum-heart-rate suggestion: the largest of the per-workout maxima in the plausible
 * range, unless it towers `SPIKE_BPM` over the next largest (an optical sensor spike), then that next one. Null without a plausible value.
 */
export function peakHeartRate(workoutMaxima: readonly number[]): number | null {
  const sorted = workoutMaxima.filter((v) => isWholeNumber(v) && v >= MAX_HR_MIN && v <= MAX_HR_MAX).sort((a, b) => b - a);
  const top = sorted[0];
  if (top === undefined) return null;
  const next = sorted[1];
  if (next !== undefined && top - next > SPIKE_BPM) return next;
  return top;
}

/** The median of the watch's recent resting rates, whole bpm; null without any plausible value. */
export function typicalResting(values: readonly number[]): number | null {
  const sorted = values.filter((v) => v >= REST_HR_MIN && v <= REST_HR_MAX).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return Math.round(sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

export interface HrZoneSuggestion {
  /** A maximum worth offering: the highest rate seen, only when it is above what the age formula says. Null otherwise. */
  maxHr: number | null;
  /** The highest heart rate seen in workouts (whether or not it is offered). */
  peak: number | null;
  /** The watch's typical resting heart rate. */
  restingHr: number | null;
}

/**
 * A suggestion from the person's data, never applied on its own. A highest rate below the age formula proves nothing (the person may never
 * have gone all out), so it is shown but not offered as the maximum; one above it means the formula is too low for this person.
 */
export function suggestZones(peak: number | null, resting: number | null, age: number): HrZoneSuggestion {
  const formula = maxHrFromAge(age);
  return { maxHr: peak !== null && peak > formula ? peak : null, peak, restingHr: resting };
}
