import { maplibreStyle, TILEJSON_URL, type MapTheme, type MaplibreStyle } from '@/features/map/palette';

import { ridePalette } from './ridePalette';
import { pmtilesStreamUrl, pmtilesUrl, type InstalledRegion } from './storage';

/**
 * Basemap style for the bike computer and for anything that wants the same offline-capable map (the replay basemap builds on
 * this). Pure and generic: no ride-specific imports. The layers are `maplibreStyle()`'s, unchanged; only the vector source's
 * `url` is swapped:
 *
 * - `offline`: an installed region, `pmtiles://file:///.../<id>-<version>.pmtiles`
 * - `stream`: a catalog file read with range requests, `pmtiles://https://...` (when the rider has not downloaded the region)
 * - `online`: OpenFreeMap's TileJSON, as the route map uses it. `maplibreStyle()` with that source is chosen over the Liberty
 *   style URL (`MAP_STYLE_URL`) so the three sources look the same, share the palette and need no glyphs or sprites.
 */

export type MapSourceKind = 'offline' | 'stream' | 'online';

export interface StyleSource {
  type: 'vector';
  url: string;
  attribution: string;
}

export interface ResolvableStyle extends Omit<MaplibreStyle, 'sources'> {
  sources: Record<string, StyleSource>;
}

export interface ResolvedMapStyle {
  style: ResolvableStyle;
  source: MapSourceKind;
  /** Changes whenever the source, its file version or the look changes: use it as the map's React `key` (MapLibre does not re-read a source URL in place). */
  key: string;
  /** Credit to show on the map; the ODbL and OpenMapTiles licences require it. */
  attribution: string;
}

export interface ResolveMapStyleOptions {
  theme: MapTheme;
  /** High-contrast ride palette instead of the app's map palette. */
  ride?: boolean;
  /** The installed region that covers the rider, if any. */
  region?: InstalledRegion | null;
  /** https URL of a catalog `.pmtiles` file to stream when no region is installed; null or absent means go online. */
  streamUrl?: string | null;
}

// i18n-ok: legal credit lines (ODbL / CC-BY), shown as written
const CREDIT_PMTILES = '© OpenStreetMap contributors © OpenMapTiles';
// i18n-ok: legal credit line, same as the route map's
const CREDIT_ONLINE = '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';

/** The vector source id inside `maplibreStyle()`: its layers refer to it by this name. */
export const MAP_SOURCE_ID = 'openmaptiles';

export function resolveMapStyle(opts: ResolveMapStyleOptions): ResolvedMapStyle {
  const base = opts.ride ? maplibreStyle(opts.theme, ridePalette(opts.theme)) : maplibreStyle(opts.theme);
  const look = `${opts.theme}${opts.ride ? '-ride' : ''}`;

  const withSource = (url: string, attribution: string): ResolvableStyle => ({
    ...base,
    sources: { [MAP_SOURCE_ID]: { type: 'vector', url, attribution } },
  });

  if (opts.region) {
    const url = pmtilesUrl(opts.region.path);
    return {
      style: withSource(url, CREDIT_PMTILES),
      source: 'offline',
      key: `offline:${opts.region.id}:${opts.region.version}:${look}`,
      attribution: CREDIT_PMTILES,
    };
  }

  const stream = opts.streamUrl ? pmtilesStreamUrl(opts.streamUrl) : null;
  if (stream) {
    return {
      style: withSource(stream, CREDIT_PMTILES),
      source: 'stream',
      key: `stream:${opts.streamUrl}:${look}`,
      attribution: CREDIT_PMTILES,
    };
  }

  return {
    style: withSource(TILEJSON_URL, CREDIT_ONLINE),
    source: 'online',
    key: `online:${look}`,
    attribution: CREDIT_ONLINE,
  };
}
