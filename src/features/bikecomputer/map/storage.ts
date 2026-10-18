import { z } from 'zod';

import { isNewerVersion, type MapRegion, type RegionIndex } from './regions';

/**
 * Installed offline regions (docs/bike-computer.md section 3): a small registry in the key-value store plus the path and URL
 * helpers MapLibre needs. Everything here is pure; the kv-store and the file system are injected (see `installedStore.ts` and
 * `fileApi.ts` for the real ones).
 */

export const INSTALLED_KEY = 'joyofit.bike.maps';

export interface InstalledRegion {
  id: string;
  name: { id: string; en: string };
  bbox: [number, number, number, number];
  version: string;
  bytes: number;
  /** `file://` URI of the `.pmtiles` file. */
  path: string;
  /** Epoch ms. */
  installedAt: number;
}

const installedSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,48}$/),
  name: z.object({ id: z.string(), en: z.string() }),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  version: z.string().min(1),
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  installedAt: z.number().finite(),
});

/** The registry from its stored JSON; a damaged value or entry is dropped, never thrown. */
export function parseInstalled(raw: string | null | undefined): InstalledRegion[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: InstalledRegion[] = [];
  for (const item of value) {
    const parsed = installedSchema.safeParse(item);
    if (parsed.success && !out.some((r) => r.id === parsed.data.id)) out.push(parsed.data);
  }
  return out;
}

export function upsertInstalled(list: readonly InstalledRegion[], region: InstalledRegion): InstalledRegion[] {
  return [...list.filter((r) => r.id !== region.id), region];
}

export function removeInstalled(list: readonly InstalledRegion[], id: string): InstalledRegion[] {
  return list.filter((r) => r.id !== id);
}

export function totalInstalledBytes(list: readonly InstalledRegion[]): number {
  return list.reduce((sum, r) => sum + r.bytes, 0);
}

/** Installed regions with a newer build in the catalog, paired with that build. */
export function updatesAvailable(
  installed: readonly InstalledRegion[],
  index: Pick<RegionIndex, 'regions'>,
): { installed: InstalledRegion; latest: MapRegion }[] {
  const out: { installed: InstalledRegion; latest: MapRegion }[] = [];
  for (const have of installed) {
    const latest = index.regions.find((r) => r.id === have.id);
    if (latest && isNewerVersion(latest.version, have.version)) out.push({ installed: have, latest });
  }
  return out;
}

/** Fields of `InstalledRegion` that the catalog entry provides. */
export function toInstalled(region: MapRegion, path: string, installedAt: number): InstalledRegion {
  return {
    id: region.id,
    name: region.name,
    bbox: region.bbox,
    version: region.version,
    bytes: region.bytes,
    path,
    installedAt,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// paths and URLs

/** The directory the maps live in, under the app's document directory (not the cache: the OS must not evict it). */
export function mapsDirUri(documentDirectoryUri: string): string {
  return `${documentDirectoryUri.replace(/\/+$/, '')}/maps/`;
}

/** `file://` URI of a region file: `<documentDirectory>maps/<id>-<version>.pmtiles`. */
export function regionPath(id: string, version: string, documentDirectoryUri: string): string {
  return `${mapsDirUri(documentDirectoryUri)}${id}-${version}.pmtiles`;
}

/**
 * `pmtiles://` + one `file://` URI, for a MapLibre vector source `url`. A doubled scheme (`pmtiles://file://file:///...`) fails
 * in MapLibre with a misleading "path not found", so any mix of `pmtiles://`, `file://` and a bare absolute path gives the same
 * single-scheme result: `pmtiles://file:///data/user/0/app/files/maps/bali-20261018.pmtiles`.
 */
export function pmtilesUrl(path: string): string {
  let rest = path.trim();
  for (;;) {
    if (rest.startsWith('pmtiles://')) rest = rest.slice('pmtiles://'.length);
    else if (rest.startsWith('file://')) rest = rest.slice('file://'.length);
    else break;
  }
  if (!rest.startsWith('/')) rest = `/${rest}`;
  return `pmtiles://file://${rest}`;
}

/** `pmtiles://https://...` to stream a catalog file with range requests; null when the URL is not https. */
export function pmtilesStreamUrl(httpsUrl: string): string | null {
  const bare = httpsUrl.startsWith('pmtiles://') ? httpsUrl.slice('pmtiles://'.length) : httpsUrl;
  return bare.startsWith('https://') ? `pmtiles://${bare}` : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// PMTiles header

export const PMTILES_HEADER_BYTES = 127;
const MAGIC = 'PMTiles';

export type HeaderProblem = 'short' | 'magic' | 'version';

/** Magic `PMTiles` and spec version byte 3 within the first 127 bytes; null when the header is fine. */
export function pmtilesHeaderProblem(head: Uint8Array): HeaderProblem | null {
  if (head.length < PMTILES_HEADER_BYTES) return 'short';
  for (let i = 0; i < MAGIC.length; i++) {
    if (head[i] !== MAGIC.charCodeAt(i)) return 'magic';
  }
  return head[MAGIC.length] === 3 ? null : 'version';
}

// ---------------------------------------------------------------------------------------------------------------------
// registry I/O behind an injected key-value store

export interface KvLike {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
}

export interface InstalledStore {
  read(): InstalledRegion[];
  upsert(region: InstalledRegion): InstalledRegion[];
  remove(id: string): InstalledRegion[];
}

export function createInstalledStore(kv: KvLike, key: string = INSTALLED_KEY): InstalledStore {
  const read = () => parseInstalled(kv.getItemSync(key));
  const write = (list: InstalledRegion[]) => {
    kv.setItemSync(key, JSON.stringify(list));
    return list;
  };
  return {
    read,
    upsert: (region) => write(upsertInstalled(read(), region)),
    remove: (id) => write(removeInstalled(read(), id)),
  };
}
