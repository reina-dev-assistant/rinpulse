import { rogoDay } from '@/cloud/rogoZone';

import type { ScaleReading } from './types';

/** `weight.checkIn` of JoyoRogo (packages/api/src/routers/weight.ts) accepts 25 to 400 kg. */
export const ROGO_MIN_KG = 25;
export const ROGO_MAX_KG = 400;

/** Body fields `weight.checkIn` accepts, with the inclusive range each must sit in (a value outside is left out, the server rejects it). */
const BODY_RANGES = {
  bodyFatPct: [2, 75, 1],
  musclePct: [5, 80, 1],
  waterPct: [20, 85, 1],
  boneKg: [0.5, 8, 2],
  visceralFat: [1, 60, 0],
  bmrKcal: [500, 5000, 0],
  proteinPct: [2, 40, 1],
} as const;

type BodyKey = keyof typeof BODY_RANGES;

export interface RogoCheckIn extends Partial<Record<BodyKey, number>> {
  weightKg: number;
  date: string;
  source: 'scale';
}

type BodyValues = Partial<Record<BodyKey, number>>;

export interface RogoWeighIn {
  weightKg: number;
  reported?: BodyValues | null;
  estimate?: BodyValues | null;
}

/**
 * What `weight.checkIn` gets for a weigh-in: the weight to 0.1 kg (what a person types), the Jakarta day of the moment it was taken,
 * `source: 'scale'` and the body values: the scale's own (`reported`) per field, else the formula `estimate`. Values are rounded
 * (fat/muscle/water/protein 0.1, bone 0.01, visceral and BMR whole) and any value outside the range JoyoRogo accepts is left out.
 * JoyoRogo keeps one row per day (the last weigh-in of the day wins). Null when the weight is outside what JoyoRogo accepts.
 */
export function toRogoCheckIn(weighIn: RogoWeighIn, takenAt: number): RogoCheckIn | null {
  const weightKg = Math.round(weighIn.weightKg * 10) / 10;
  if (!Number.isFinite(weightKg) || weightKg < ROGO_MIN_KG || weightKg > ROGO_MAX_KG) return null;
  const out: RogoCheckIn = { weightKg, date: rogoDay(takenAt), source: 'scale' };
  for (const key of Object.keys(BODY_RANGES) as BodyKey[]) {
    const [min, max, digits] = BODY_RANGES[key];
    const raw = weighIn.reported?.[key] ?? weighIn.estimate?.[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const f = 10 ** digits;
    const v = Math.round(raw * f) / f;
    if (v >= min && v <= max) out[key] = v;
  }
  return out;
}
