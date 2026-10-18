import { z } from 'zod';

/**
 * The offline map catalog (docs/bike-computer.md section 3): `index.json` on the maps bucket lists the regions that were
 * actually built. Pure: parsing and geometry only, no I/O. Sizes are shown by the UI with the `@/i18n` format helpers.
 */

/** west, south, east, north in degrees. */
export type BBox = readonly [w: number, s: number, e: number, n: number];

export interface MapRegion {
  id: string;
  name: { id: string; en: string };
  bbox: [number, number, number, number];
  bytes: number;
  /** Build date, `YYYYMMDD`; a newer version of the same id means "Perbarui". */
  version: string;
  sha256: string;
  /** https URL of the `.pmtiles` file. */
  url: string;
}

export interface RegionIndex {
  version: 1;
  attribution: string;
  licenseUrl: string;
  regions: MapRegion[];
}

/** Public base of the maps bucket `joyofit-maps` (custom domain); keep in step with scripts/maps. */
export const MAPS_BASE_URL = 'https://maps.fit.joyorogo.com';
export const INDEX_URL = `${MAPS_BASE_URL}/index.json`;

const httpsUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'https only');

const bboxSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .refine(([w, s, e, n]) => w < e && s < n, 'bbox must have west < east and south < north');

const regionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,48}$/),
  name: z.object({ id: z.string().min(1).max(80), en: z.string().min(1).max(80) }),
  bbox: bboxSchema,
  bytes: z.number().int().positive().max(2 ** 40),
  version: z.string().regex(/^[0-9A-Za-z._-]{1,32}$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  url: httpsUrl,
});

const indexSchema = z.object({
  version: z.literal(1),
  attribution: z.string().min(1).max(500),
  licenseUrl: httpsUrl,
  regions: z.array(z.unknown()),
});

/**
 * The index from untrusted JSON, or null when its envelope is wrong (not an object, another `version`, no attribution or
 * licence link: the app must not offer a download it cannot credit). One bad region (bbox, bytes or a non-https url) is
 * dropped; the others stay usable. Duplicate ids keep the first.
 */
export function parseRegionIndex(json: unknown): RegionIndex | null {
  const head = indexSchema.safeParse(json);
  if (!head.success) return null;
  const regions: MapRegion[] = [];
  const seen = new Set<string>();
  for (const raw of head.data.regions) {
    const parsed = regionSchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    regions.push(parsed.data);
  }
  return { version: 1, attribution: head.data.attribution, licenseUrl: head.data.licenseUrl, regions };
}

export function bboxContains(bbox: BBox, lat: number, lon: number): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function bboxArea(bbox: BBox): number {
  return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
}

/** The region whose box holds the point; where boxes overlap, the smallest (the most specific) wins. */
export function regionContaining<T extends { bbox: BBox }>(
  index: { regions: readonly T[] },
  lat: number,
  lon: number,
): T | null {
  let best: T | null = null;
  for (const region of index.regions) {
    if (!bboxContains(region.bbox, lat, lon)) continue;
    if (!best || bboxArea(region.bbox) < bboxArea(best.bbox)) best = region;
  }
  return best;
}

const EARTH_RADIUS_M = 6_371_008.8;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Metres from the point to the box (0 inside). */
export function distanceToBBoxM(bbox: BBox, lat: number, lon: number): number {
  const clampedLon = Math.min(Math.max(lon, bbox[0]), bbox[2]);
  const clampedLat = Math.min(Math.max(lat, bbox[1]), bbox[3]);
  return haversineM(lat, lon, clampedLat, clampedLon);
}

export interface NearRegion<T> {
  region: T;
  distanceM: number;
}

/** Regions closest to the point first (a containing region is at 0 m); ties go to the smaller box. */
export function nearestRegions<T extends { bbox: BBox }>(
  index: { regions: readonly T[] },
  lat: number,
  lon: number,
  limit = 3,
): NearRegion<T>[] {
  return index.regions
    .map((region) => ({ region, distanceM: distanceToBBoxM(region.bbox, lat, lon) }))
    .sort((a, b) => a.distanceM - b.distanceM || bboxArea(a.region.bbox) - bboxArea(b.region.bbox))
    .slice(0, Math.max(0, limit));
}

/** Newer build of a region than the installed one (versions are `YYYYMMDD`, so string order is date order). */
export function isNewerVersion(candidate: string, installed: string): boolean {
  return candidate > installed;
}
