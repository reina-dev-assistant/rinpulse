/**
 * The host side of the engine's logical fonts: `display` and `body` are Plus Jakarta Sans (the app font, already loaded by
 * the root layout), `mono` is IBM Plex Mono (receipt stickers only, loaded on first use by `ensureStickerFonts`).
 * Metrics come from `metrics.ts` (generated from these font files), so layout is identical in Node tests and on a phone.
 */
import { createMonoMetrics, createTableMetrics, nearestWeight, type FontMap, type FontMetrics, type FontPaint } from './core/text';
import type { FontRole } from './core/scene';
import { MONO, SANS } from './metrics';

/** Family names as registered with expo-font. Android has no weight axis: each weight is its own family. */
export const SANS_FAMILIES: Record<number, string> = {
  500: 'PlusJakartaSans_500Medium',
  600: 'PlusJakartaSans_600SemiBold',
  700: 'PlusJakartaSans_700Bold',
  800: 'PlusJakartaSans_800ExtraBold',
};
export const MONO_FAMILIES: Record<number, string> = {
  400: 'IBMPlexMono_400Regular',
  500: 'IBMPlexMono_500Medium',
  700: 'IBMPlexMono_700Bold',
};

function metricsOf(tables: Record<number, (typeof SANS)[number]>, mono: boolean): Record<number, FontMetrics> {
  const out: Record<number, FontMetrics> = {};
  for (const [weight, table] of Object.entries(tables)) {
    out[Number(weight)] = mono
      ? createMonoMetrics(table.avg / 1000, { asc: table.asc, desc: table.desc, cap: table.cap, xh: table.xh })
      : createTableMetrics(table);
  }
  return out;
}

const SANS_METRICS = metricsOf(SANS, false);
const MONO_METRICS = metricsOf(MONO, true);

export const FIT_FONTS: FontMap = {
  metrics(role: FontRole, weight: number): FontMetrics {
    return nearestWeight(role === 'mono' ? MONO_METRICS : SANS_METRICS, weight);
  },
  paint(role: FontRole, weight: number): FontPaint {
    const families = role === 'mono' ? MONO_FAMILIES : SANS_FAMILIES;
    const keys = Object.keys(families).map(Number);
    const nearest = keys.reduce((best, key) => (Math.abs(key - weight) < Math.abs(best - weight) ? key : best), keys[0]!);
    return { family: families[nearest]! };
  },
};
