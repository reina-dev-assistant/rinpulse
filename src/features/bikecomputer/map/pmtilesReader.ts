import { gunzipSync } from 'fflate';

/**
 * Pure PMTiles v3 reader for JS consumers that cannot use the native map (offscreen tile rendering through the JS pipeline in
 * `src/features/map`). It reads byte ranges through an injected function, so it runs under `bun test` and on a phone
 * (`pmtilesFile.ts` is the file adapter). Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 *
 * `getTile` returns the tile's RAW bytes (gunzipped when the archive says gzip), ready for `decodeTile`.
 * Only gzip and uncompressed archives are supported (what Planetiler and the `pmtiles` CLI write); brotli and zstd throw.
 */

export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;

export const COMPRESSION = { unknown: 0, none: 1, gzip: 2, brotli: 3, zstd: 4 } as const;
export const TILE_TYPE = { unknown: 0, mvt: 1, png: 2, jpeg: 3, webp: 4, avif: 5 } as const;

export interface PmHeader {
  specVersion: number;
  rootDirOffset: number;
  rootDirLength: number;
  metadataOffset: number;
  metadataLength: number;
  leafDirsOffset: number;
  leafDirsLength: number;
  tileDataOffset: number;
  tileDataLength: number;
  addressedTiles: number;
  tileEntries: number;
  tileContents: number;
  clustered: boolean;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  /** Degrees. */
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  centerZoom: number;
  centerLon: number;
  centerLat: number;
}

export interface DirEntry {
  tileId: number;
  offset: number;
  length: number;
  /** 0 marks a pointer to a leaf directory. */
  runLength: number;
}

export class PmtilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PmtilesError';
  }
}

export const HEADER_BYTES = 127;
/** The spec keeps the header and the root directory inside the first 16 KiB, so one read serves both. */
export const INITIAL_READ_BYTES = 16384;
const MAX_LEAF_DEPTH = 3;
const DEFAULT_DIR_CACHE = 32;

// ---------------------------------------------------------------------------------------------------------------------
// header

function u64(view: DataView, at: number): number {
  const lo = view.getUint32(at, true);
  const hi = view.getUint32(at + 4, true);
  return hi * 2 ** 32 + lo;
}

export function parseHeader(bytes: Uint8Array): PmHeader {
  if (bytes.length < HEADER_BYTES) throw new PmtilesError('header is shorter than 127 bytes');
  const magic = String.fromCharCode(...bytes.subarray(0, 7));
  if (magic !== 'PMTiles') throw new PmtilesError('not a PMTiles archive');
  if (bytes[7] !== 3) throw new PmtilesError(`unsupported PMTiles version ${bytes[7]}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const e7 = (at: number) => view.getInt32(at, true) / 1e7;
  return {
    specVersion: 3,
    rootDirOffset: u64(view, 8),
    rootDirLength: u64(view, 16),
    metadataOffset: u64(view, 24),
    metadataLength: u64(view, 32),
    leafDirsOffset: u64(view, 40),
    leafDirsLength: u64(view, 48),
    tileDataOffset: u64(view, 56),
    tileDataLength: u64(view, 64),
    addressedTiles: u64(view, 72),
    tileEntries: u64(view, 80),
    tileContents: u64(view, 88),
    clustered: view.getUint8(96) === 1,
    internalCompression: view.getUint8(97),
    tileCompression: view.getUint8(98),
    tileType: view.getUint8(99),
    minZoom: view.getUint8(100),
    maxZoom: view.getUint8(101),
    minLon: e7(102),
    minLat: e7(106),
    maxLon: e7(110),
    maxLat: e7(114),
    centerZoom: view.getUint8(118),
    centerLon: e7(119),
    centerLat: e7(123),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// tile ids

function rotate(n: number, xy: [number, number], rx: number, ry: number): void {
  if (ry === 0) {
    if (rx === 1) {
      xy[0] = n - 1 - xy[0];
      xy[1] = n - 1 - xy[1];
    }
    const t = xy[0];
    xy[0] = xy[1];
    xy[1] = t;
  }
}

/** Hilbert-curve tile id: all tiles of lower zooms first, then the curve position within the zoom. */
export function zxyToTileId(z: number, x: number, y: number): number {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new PmtilesError('zoom must be an integer from 0 to 26');
  const n = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    throw new PmtilesError('tile coordinates out of range for the zoom');
  }
  let acc = 0;
  for (let i = 0; i < z; i++) acc += 4 ** i;
  const xy: [number, number] = [x, y];
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0;
    const ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    rotate(s, xy, rx, ry);
  }
  return acc + d;
}

// ---------------------------------------------------------------------------------------------------------------------
// directories

/** LEB128 varint at `pos`; values up to 2^53. Returns the value and the next position. */
export function readVarint(bytes: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  let at = pos;
  for (let i = 0; i < 9; i++) {
    const byte = bytes[at++];
    if (byte === undefined) throw new PmtilesError('varint runs past the end of the directory');
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return { value, next: at };
    scale *= 128;
  }
  throw new PmtilesError('varint longer than 9 bytes');
}

/** A decompressed directory: entry count, then column-wise tile id deltas, run lengths, lengths and offsets. */
export function parseDirectory(bytes: Uint8Array): DirEntry[] {
  let cursor = readVarint(bytes, 0);
  const count = cursor.value;
  if (count > bytes.length) throw new PmtilesError('directory entry count exceeds its size');
  const entries: DirEntry[] = Array.from({ length: count }, () => ({ tileId: 0, offset: 0, length: 0, runLength: 0 }));
  let pos = cursor.next;
  let lastId = 0;
  for (const entry of entries) {
    cursor = readVarint(bytes, pos);
    lastId += cursor.value;
    entry.tileId = lastId;
    pos = cursor.next;
  }
  for (const entry of entries) {
    cursor = readVarint(bytes, pos);
    entry.runLength = cursor.value;
    pos = cursor.next;
  }
  for (const entry of entries) {
    cursor = readVarint(bytes, pos);
    entry.length = cursor.value;
    pos = cursor.next;
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    cursor = readVarint(bytes, pos);
    pos = cursor.next;
    if (cursor.value === 0 && i > 0) {
      const prev = entries[i - 1];
      entry.offset = prev ? prev.offset + prev.length : 0;
    } else {
      entry.offset = cursor.value - 1;
    }
  }
  return entries;
}

/** The entry that holds `tileId`, or the leaf pointer that may; null when nothing covers it. */
export function findEntry(entries: readonly DirEntry[], tileId: number): DirEntry | null {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = entries[mid];
    if (!entry) return null;
    if (tileId > entry.tileId) lo = mid + 1;
    else if (tileId < entry.tileId) hi = mid - 1;
    else return entry;
  }
  const before = entries[hi];
  if (!before) return null;
  if (before.runLength === 0) return before;
  return tileId - before.tileId < before.runLength ? before : null;
}

function decompress(bytes: Uint8Array, compression: number, what: string): Uint8Array {
  if (compression === COMPRESSION.none) return bytes;
  if (compression === COMPRESSION.gzip) {
    try {
      return gunzipSync(bytes);
    } catch {
      throw new PmtilesError(`${what} is not valid gzip`);
    }
  }
  throw new PmtilesError(`${what} uses an unsupported compression (${compression})`);
}

// ---------------------------------------------------------------------------------------------------------------------
// reader

export interface PmtilesReader {
  header(): Promise<PmHeader>;
  /** Raw (decompressed) tile bytes, or null when the archive has no tile there or the zoom is outside its range. */
  getTile(z: number, x: number, y: number): Promise<Uint8Array | null>;
}

export interface PmtilesReaderOptions {
  /** Leaf directories kept in memory (least recently used out). Default 32. */
  maxCachedDirectories?: number;
}

export function createPmtilesReader(readRange: ReadRange, options: PmtilesReaderOptions = {}): PmtilesReader {
  const maxCached = Math.max(1, options.maxCachedDirectories ?? DEFAULT_DIR_CACHE);
  const leafCache = new Map<number, Promise<DirEntry[]>>();
  let boot: Promise<{ header: PmHeader; root: DirEntry[] }> | null = null;

  const readExact = async (offset: number, length: number, what: string): Promise<Uint8Array> => {
    const bytes = await readRange(offset, length);
    if (bytes.length < length) throw new PmtilesError(`${what}: expected ${length} bytes at ${offset}, got ${bytes.length}`);
    return bytes.length === length ? bytes : bytes.subarray(0, length);
  };

  const load = (): Promise<{ header: PmHeader; root: DirEntry[] }> => {
    boot ??= (async () => {
      const first = await readRange(0, INITIAL_READ_BYTES);
      const header = parseHeader(first);
      const rootEnd = header.rootDirOffset + header.rootDirLength;
      const rootRaw =
        rootEnd <= first.length
          ? first.subarray(header.rootDirOffset, rootEnd)
          : await readExact(header.rootDirOffset, header.rootDirLength, 'root directory');
      return { header, root: parseDirectory(decompress(rootRaw, header.internalCompression, 'root directory')) };
    })();
    // A failed first read must not be remembered: the next call retries.
    boot.catch(() => {
      boot = null;
    });
    return boot;
  };

  const leaf = (header: PmHeader, entry: DirEntry): Promise<DirEntry[]> => {
    const key = entry.offset;
    const hit = leafCache.get(key);
    if (hit) {
      leafCache.delete(key);
      leafCache.set(key, hit);
      return hit;
    }
    const pending = (async () => {
      const raw = await readExact(header.leafDirsOffset + entry.offset, entry.length, 'leaf directory');
      return parseDirectory(decompress(raw, header.internalCompression, 'leaf directory'));
    })();
    leafCache.set(key, pending);
    pending.catch(() => leafCache.delete(key));
    while (leafCache.size > maxCached) {
      const oldest = leafCache.keys().next();
      if (oldest.done) break;
      leafCache.delete(oldest.value);
    }
    return pending;
  };

  return {
    async header() {
      return (await load()).header;
    },

    async getTile(z, x, y) {
      const { header, root } = await load();
      if (z < header.minZoom || z > header.maxZoom) return null;
      const tileId = zxyToTileId(z, x, y);
      let entries = root;
      for (let depth = 0; depth <= MAX_LEAF_DEPTH; depth++) {
        const entry = findEntry(entries, tileId);
        if (!entry) return null;
        if (entry.runLength > 0) {
          const raw = await readExact(header.tileDataOffset + entry.offset, entry.length, 'tile');
          return decompress(raw, header.tileCompression, 'tile');
        }
        entries = await leaf(header, entry);
      }
      throw new PmtilesError('directory nesting is deeper than the spec allows');
    },
  };
}
