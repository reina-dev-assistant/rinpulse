import { bboxContains, regionContaining } from './regions';
import type { InstalledRegion } from './storage';

/** Degrees (about 2 km) a rider may ride past a region's edge before the map gives up on it. */
export const COVERAGE_HYSTERESIS_DEG = 0.02;

/**
 * The installed region to draw for a position. The region the map is already showing is kept until the rider is clearly
 * outside it (`COVERAGE_HYSTERESIS_DEG` past the edge), so riding along a boundary does not flip the source and remount the map
 * every few seconds. Otherwise the smallest installed region that contains the position; null when none does.
 */
export function pickInstalledRegion(
  installed: readonly InstalledRegion[],
  position: { lat: number; lon: number } | null,
  current: InstalledRegion | null = null,
): InstalledRegion | null {
  const still = current ? installed.find((r) => r.id === current.id && r.version === current.version) : undefined;
  if (!position) return still ?? null;
  if (still) {
    const [w, s, e, n] = still.bbox;
    const pad = COVERAGE_HYSTERESIS_DEG;
    if (bboxContains([w - pad, s - pad, e + pad, n + pad], position.lat, position.lon)) return still;
  }
  return regionContaining({ regions: installed }, position.lat, position.lon);
}
