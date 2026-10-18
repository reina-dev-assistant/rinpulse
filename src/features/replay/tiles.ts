/**
 * Where the replay gets its tiles. The default is the app's own online source (`tileSource` of `features/map`: OpenFreeMap
 * through TileJSON, with its caches). `createBytesTileSource` turns any function that returns the raw (gunzipped) vector tile
 * bytes of a z/x/y into the same shape: that is the seam for the offline regional PMTiles reader of the bike computer
 * (`getTile` of `createPmtilesReader` returns exactly those bytes), and `firstOf` tries a list of sources in order, so a
 * replay uses a downloaded region when the route is inside one and the network otherwise.
 */
import { decodeTile } from '@/features/map/mvt';
import { RENDER_LAYERS, renderTile, sourceTileOf, type RenderedTile } from '@/features/map/renderTile';
import type { TileSource } from '@/features/map/tileCache';

export type ReplayTileSource = Pick<TileSource, 'rendered'>;

/** Raw vector tile bytes at a zoom 0..14 tile, `null` when the source has no tile there. */
export type TileBytes = (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Uint8Array | null>;

export function createBytesTileSource(getBytes: TileBytes): ReplayTileSource {
  return {
    async rendered(z, x, y, signal): Promise<RenderedTile> {
      const src = sourceTileOf({ z, x, y });
      const bytes = await getBytes(src.z, src.x, src.y, signal);
      if (!bytes) return { z, layers: [] };
      return renderTile(decodeTile(bytes, { layers: RENDER_LAYERS }), { z, x, y });
    },
  };
}

/** A tile with no layers: the source answered but has nothing there (open sea, outside the region). */
const isEmpty = (tile: RenderedTile) => tile.layers.length === 0;

/**
 * The first source that has a non-empty tile wins; a source that throws or answers empty hands over to the next. When every
 * source is empty the empty tile is returned (it is a legitimate answer); when every source throws the last error is thrown,
 * so the loader counts the tile as failed and can tell that the device is offline.
 */
export function firstOf(...sources: ReplayTileSource[]): ReplayTileSource {
  return {
    async rendered(z, x, y, signal) {
      let empty: RenderedTile | null = null;
      let failure: unknown = null;
      for (const source of sources) {
        try {
          const tile = await source.rendered(z, x, y, signal);
          if (!isEmpty(tile)) return tile;
          empty = tile;
        } catch (e) {
          failure = e;
        }
      }
      if (empty) return empty;
      throw failure ?? new Error('no tile source');
    },
  };
}
