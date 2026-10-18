import type { UserProfile } from '@/wear';

/** The range the profile form accepts, so the guide and Settings never disagree about what a weight is. */
export const MIN_WEIGHT_KG = 20;
export const MAX_WEIGHT_KG = 300;

/** The weight a text field holds ("72,5" and "72.5" both work), rounded to 0.1 kg; null when it is not a weight. */
export function parseWeightKg(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < MIN_WEIGHT_KG || value > MAX_WEIGHT_KG) return null;
  return Math.round(value * 10) / 10;
}

/** The stored profile with a new weight; the rest stays as it was, or comes from `fallback` (the Profile screen's starting values) when nothing was stored. */
export function withWeight(stored: UserProfile | null, weightKg: number, fallback: UserProfile): UserProfile {
  return { ...(stored ?? fallback), weightKg };
}
