import { describe, expect, test } from 'bun:test';
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';

import { gzipSync } from 'fflate';

import {
  COMPRESSION,
  createPmtilesReader,
  findEntry,
  HEADER_BYTES,
  parseDirectory,
  parseHeader,
  PmtilesError,
  readVarint,
  zxyToTileId,
  type DirEntry,
  type ReadRange,
} from './pmtilesReader';

// ---------------------------------------------------------------------------------------------------------------------
// a minimal PMTiles v3 writer, just enough to exercise the reader

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v >= 128) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

function serializeDirectory(entries: readonly DirEntry[]): Uint8Array {
  const out: number[] = [...varint(entries.length)];
  let last = 0;
  for (const e of entries) {
    out.push(...varint(e.tileId - last));
    last = e.tileId;
  }
  for (const e of entries) out.push(...varint(e.runLength));
  for (const e of entries) out.push(...varint(e.length));
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    // offset 0 means "contiguous with the previous entry"
    out.push(...varint(i > 0 && prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1));
  });
  return Uint8Array.from(out);
}

interface Layout {
  rootDir: Uint8Array;
  leafDirs: Uint8Array;
  tileData: Uint8Array;
  minZoom?: number;
  maxZoom?: number;
  internalCompression?: number;
  tileCompression?: number;
}

function buildArchive(l: Layout): Uint8Array {
  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + l.rootDir.length;
  const meta = new TextEncoder().encode('{}');
  const leafOffset = metaOffset + meta.length;
  const dataOffset = leafOffset + l.leafDirs.length;
  const file = new Uint8Array(dataOffset + l.tileData.length);
  const view = new DataView(file.buffer);
  file.set([...'PMTiles'].map((c) => c.charCodeAt(0)));
  file[7] = 3;
  const put64 = (at: number, n: number) => {
    view.setUint32(at, n % 2 ** 32, true);
    view.setUint32(at + 4, Math.floor(n / 2 ** 32), true);
  };
  put64(8, rootOffset);
  put64(16, l.rootDir.length);
  put64(24, metaOffset);
  put64(32, meta.length);
  put64(40, leafOffset);
  put64(48, l.leafDirs.length);
  put64(56, dataOffset);
  put64(64, l.tileData.length);
  put64(72, 5);
  put64(80, 5);
  put64(88, 4);
  file[96] = 1;
  file[97] = l.internalCompression ?? COMPRESSION.gzip;
  file[98] = l.tileCompression ?? COMPRESSION.gzip;
  file[99] = 1;
  file[100] = l.minZoom ?? 0;
  file[101] = l.maxZoom ?? 14;
  view.setInt32(102, 114.4e7, true);
  view.setInt32(106, -8.92e7, true);
  view.setInt32(110, 115.74e7, true);
  view.setInt32(114, -8.04e7, true);
  file[118] = 8;
  view.setInt32(119, 115.2e7, true);
  view.setInt32(123, -8.65e7, true);
  file.set(l.rootDir, rootOffset);
  file.set(meta, metaOffset);
  file.set(l.leafDirs, leafOffset);
  file.set(l.tileData, dataOffset);
  return file;
}

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

function rangeReader(file: Uint8Array) {
  const calls: [number, number][] = [];
  const read: ReadRange = async (offset, length) => {
    calls.push([offset, length]);
    return file.slice(offset, offset + length);
  };
  return { read, calls };
}

/** Tiles: 0/0/0 "A", 1/0/0 "B", 1/1/1 "C" run-length 2 with 1/1/0 (same bytes), and 2/0/0 under a leaf directory. */
function sampleArchive(opts: { gzipTiles?: boolean; leaf?: boolean } = {}) {
  const gzipTiles = opts.gzipTiles ?? true;
  const wrap = (s: string) => (gzipTiles ? gzipSync(enc(s)) : enc(s));
  const a = wrap('tile-A');
  const b = wrap('tile-B');
  const c = wrap('tile-C');
  const d = wrap('tile-D');
  const tileData = new Uint8Array(a.length + b.length + c.length + d.length);
  tileData.set(a, 0);
  tileData.set(b, a.length);
  tileData.set(c, a.length + b.length);
  tileData.set(d, a.length + b.length + c.length);
  const dOffset = a.length + b.length + c.length;

  const idA = zxyToTileId(0, 0, 0);
  const idB = zxyToTileId(1, 0, 0); // 1
  const idC = zxyToTileId(1, 1, 1); // 3, run of 2 covers 3 and 4
  const idD = zxyToTileId(2, 0, 0); // 5
  const leafEntries: DirEntry[] = [{ tileId: idD, offset: dOffset, length: d.length, runLength: 1 }];
  const leafRaw = gzipSync(serializeDirectory(leafEntries));
  const rootEntries: DirEntry[] = [
    { tileId: idA, offset: 0, length: a.length, runLength: 1 },
    { tileId: idB, offset: a.length, length: b.length, runLength: 1 },
    { tileId: idC, offset: a.length + b.length, length: c.length, runLength: 2 },
  ];
  if (opts.leaf ?? true) rootEntries.push({ tileId: idD, offset: 0, length: leafRaw.length, runLength: 0 });
  return buildArchive({
    rootDir: gzipSync(serializeDirectory(rootEntries)),
    leafDirs: leafRaw,
    tileData,
    tileCompression: gzipTiles ? COMPRESSION.gzip : COMPRESSION.none,
  });
}

// ---------------------------------------------------------------------------------------------------------------------

describe('zxyToTileId', () => {
  test('matches the spec ordering for low zooms', () => {
    expect(zxyToTileId(0, 0, 0)).toBe(0);
    expect(zxyToTileId(1, 0, 0)).toBe(1);
    expect(zxyToTileId(1, 0, 1)).toBe(2);
    expect(zxyToTileId(1, 1, 1)).toBe(3);
    expect(zxyToTileId(1, 1, 0)).toBe(4);
    expect(zxyToTileId(2, 0, 0)).toBe(5);
  });

  test('is a bijection per zoom (z = 3) and offsets by 4^i per lower zoom', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) seen.add(zxyToTileId(3, x, y));
    expect(seen.size).toBe(64);
    expect(Math.min(...seen)).toBe(21); // 1 + 4 + 16
    expect(Math.max(...seen)).toBe(21 + 63);
  });

  test('adjacent tiles at a high zoom stay distinct and below 2^53', () => {
    const a = zxyToTileId(14, 13_000, 8_000);
    const b = zxyToTileId(14, 13_001, 8_000);
    expect(a).not.toBe(b);
    expect(Number.isSafeInteger(zxyToTileId(26, 2 ** 26 - 1, 0))).toBe(true);
  });

  test('rejects bad input', () => {
    expect(() => zxyToTileId(1, 2, 0)).toThrow(PmtilesError);
    expect(() => zxyToTileId(-1, 0, 0)).toThrow(PmtilesError);
    expect(() => zxyToTileId(27, 0, 0)).toThrow(PmtilesError);
    expect(() => zxyToTileId(2, 0.5, 0)).toThrow(PmtilesError);
  });
});

describe('readVarint / parseDirectory / findEntry', () => {
  test('varint round trip, including values over 32 bits', () => {
    for (const n of [0, 1, 127, 128, 300, 2 ** 31, 2 ** 40 + 5]) {
      const bytes = Uint8Array.from(varint(n));
      expect(readVarint(bytes, 0)).toEqual({ value: n, next: bytes.length });
    }
    expect(() => readVarint(Uint8Array.from([0x80]), 0)).toThrow(PmtilesError);
  });

  test('directory round trip with contiguous and explicit offsets', () => {
    const entries: DirEntry[] = [
      { tileId: 0, offset: 0, length: 10, runLength: 1 },
      { tileId: 3, offset: 10, length: 20, runLength: 1 },
      { tileId: 9, offset: 500, length: 5, runLength: 2 },
    ];
    expect(parseDirectory(serializeDirectory(entries))).toEqual(entries);
  });

  test('a corrupt entry count is rejected', () => {
    expect(() => parseDirectory(Uint8Array.from(varint(5000)))).toThrow(PmtilesError);
  });

  test('findEntry handles exact hits, runs, gaps and leaf pointers', () => {
    const entries: DirEntry[] = [
      { tileId: 0, offset: 0, length: 1, runLength: 1 },
      { tileId: 10, offset: 1, length: 1, runLength: 3 },
      { tileId: 20, offset: 0, length: 1, runLength: 0 },
    ];
    expect(findEntry(entries, 0)?.tileId).toBe(0);
    expect(findEntry(entries, 12)?.tileId).toBe(10);
    expect(findEntry(entries, 13)).toBeNull();
    expect(findEntry(entries, 5)).toBeNull();
    expect(findEntry(entries, 500)?.runLength).toBe(0);
    expect(findEntry([], 1)).toBeNull();
    expect(findEntry(entries.slice(1), 1)).toBeNull();
  });
});

describe('parseHeader', () => {
  test('reads offsets, compression, zooms and bounds', () => {
    const header = parseHeader(sampleArchive());
    expect(header.specVersion).toBe(3);
    expect(header.rootDirOffset).toBe(127);
    expect(header.internalCompression).toBe(COMPRESSION.gzip);
    expect(header.tileCompression).toBe(COMPRESSION.gzip);
    expect(header.tileType).toBe(1);
    expect(header.minZoom).toBe(0);
    expect(header.maxZoom).toBe(14);
    expect(header.clustered).toBe(true);
    expect(header.minLon).toBeCloseTo(114.4, 6);
    expect(header.minLat).toBeCloseTo(-8.92, 6);
    expect(header.maxLon).toBeCloseTo(115.74, 6);
    expect(header.maxLat).toBeCloseTo(-8.04, 6);
    expect(header.centerZoom).toBe(8);
  });

  test('rejects short, wrong-magic and wrong-version input', () => {
    const file = sampleArchive();
    expect(() => parseHeader(file.slice(0, 100))).toThrow(PmtilesError);
    const bad = file.slice();
    bad[0] = 0;
    expect(() => parseHeader(bad)).toThrow('not a PMTiles');
    const v2 = file.slice();
    v2[7] = 2;
    expect(() => parseHeader(v2)).toThrow('version');
  });

  test('64-bit offsets above 2^32 are read exactly', () => {
    const file = sampleArchive();
    const view = new DataView(file.buffer);
    const big = 5 * 2 ** 32 + 7;
    view.setUint32(56, big % 2 ** 32, true);
    view.setUint32(60, Math.floor(big / 2 ** 32), true);
    expect(parseHeader(file).tileDataOffset).toBe(big);
  });
});

describe('createPmtilesReader', () => {
  test('header() reads once and caches', async () => {
    const { read, calls } = rangeReader(sampleArchive());
    const reader = createPmtilesReader(read);
    const [a, b] = await Promise.all([reader.header(), reader.header()]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([0, 16384]);
  });

  test('getTile returns raw bytes of gzip tiles (root hits)', async () => {
    const reader = createPmtilesReader(rangeReader(sampleArchive()).read);
    expect(dec(await reader.getTile(0, 0, 0))).toBe('tile-A');
    expect(dec(await reader.getTile(1, 0, 0))).toBe('tile-B');
    expect(dec(await reader.getTile(1, 1, 1))).toBe('tile-C');
  });

  test('a run length serves several tile ids with the same bytes', async () => {
    const reader = createPmtilesReader(rangeReader(sampleArchive()).read);
    expect(dec(await reader.getTile(1, 1, 0))).toBe('tile-C');
  });

  test('follows a leaf directory', async () => {
    const reader = createPmtilesReader(rangeReader(sampleArchive()).read);
    expect(dec(await reader.getTile(2, 0, 0))).toBe('tile-D');
  });

  test('uncompressed tile archives return the stored bytes', async () => {
    const reader = createPmtilesReader(rangeReader(sampleArchive({ gzipTiles: false })).read);
    expect(dec(await reader.getTile(1, 0, 0))).toBe('tile-B');
    expect(dec(await reader.getTile(2, 0, 0))).toBe('tile-D');
  });

  test('missing tiles and out-of-range zooms are null, not errors', async () => {
    const archive = buildArchive({
      rootDir: gzipSync(serializeDirectory([{ tileId: 0, offset: 0, length: 1, runLength: 1 }])),
      leafDirs: new Uint8Array(0),
      tileData: gzipSync(enc('x')).slice(0, 1),
      maxZoom: 3,
    });
    const reader = createPmtilesReader(rangeReader(archive).read);
    expect(await reader.getTile(2, 3, 3)).toBeNull();
    expect(await reader.getTile(4, 0, 0)).toBeNull();
  });

  test('leaf directories are cached and the least recently used one is evicted', async () => {
    const tiles = [gzipSync(enc('t1')), gzipSync(enc('t2')), gzipSync(enc('t3'))];
    const tileData = new Uint8Array(tiles.reduce((n, t) => n + t.length, 0));
    const offsets: number[] = [];
    let at = 0;
    for (const t of tiles) {
      offsets.push(at);
      tileData.set(t, at);
      at += t.length;
    }
    const ids = [zxyToTileId(2, 0, 0), zxyToTileId(2, 1, 1), zxyToTileId(2, 0, 3)];
    const leaves = ids.map((id, i) =>
      gzipSync(serializeDirectory([{ tileId: id, offset: offsets[i] ?? 0, length: tiles[i]?.length ?? 0, runLength: 1 }])),
    );
    const leafDirs = new Uint8Array(leaves.reduce((n, l) => n + l.length, 0));
    const rootEntries: DirEntry[] = [];
    let leafAt = 0;
    leaves.forEach((leaf, i) => {
      leafDirs.set(leaf, leafAt);
      rootEntries.push({ tileId: ids[i] ?? 0, offset: leafAt, length: leaf.length, runLength: 0 });
      leafAt += leaf.length;
    });
    const archive = buildArchive({ rootDir: gzipSync(serializeDirectory(rootEntries)), leafDirs, tileData });
    const { read, calls } = rangeReader(archive);
    const reader = createPmtilesReader(read, { maxCachedDirectories: 2 });
    const header = await reader.header();
    const leafReads = () => calls.filter(([o]) => o >= header.leafDirsOffset && o < header.tileDataOffset).length;

    expect(dec(await reader.getTile(2, 0, 0))).toBe('t1');
    expect(dec(await reader.getTile(2, 0, 0))).toBe('t1');
    expect(leafReads()).toBe(1);
    await reader.getTile(2, 1, 1);
    await reader.getTile(2, 0, 3);
    expect(leafReads()).toBe(3);
    // leaf 1 was evicted when leaf 3 arrived (capacity 2): reading it again costs a read
    await reader.getTile(2, 0, 0);
    expect(leafReads()).toBe(4);
    // leaf 3 is still cached
    await reader.getTile(2, 0, 3);
    expect(leafReads()).toBe(4);
  });

  test('a root directory beyond the first 16 KiB is read separately', async () => {
    const file = sampleArchive();
    const header = parseHeader(file);
    const padded = new Uint8Array(20000 + file.length);
    padded.set(file.subarray(0, HEADER_BYTES));
    const view = new DataView(padded.buffer);
    const shift = 20000;
    for (const at of [8, 24, 40, 56]) {
      const v = Number(new DataView(file.buffer).getUint32(at, true)) + shift;
      view.setUint32(at, v, true);
    }
    padded.set(file.subarray(HEADER_BYTES), HEADER_BYTES + shift);
    const { read, calls } = rangeReader(padded);
    const reader = createPmtilesReader(read);
    expect(dec(await reader.getTile(0, 0, 0))).toBe('tile-A');
    expect(calls.some(([o, l]) => o === header.rootDirOffset + shift && l === header.rootDirLength)).toBe(true);
  });

  test('errors: not a PMTiles file, unsupported compression, truncated reads, and a retry after a failed boot', async () => {
    await expect(createPmtilesReader(async () => enc('hello world'.repeat(20))).header()).rejects.toThrow(PmtilesError);

    const brotli = buildArchive({
      rootDir: gzipSync(serializeDirectory([{ tileId: 0, offset: 0, length: 1, runLength: 1 }])),
      leafDirs: new Uint8Array(0),
      tileData: new Uint8Array(1),
      tileCompression: COMPRESSION.brotli,
    });
    await expect(createPmtilesReader(rangeReader(brotli).read).getTile(0, 0, 0)).rejects.toThrow('unsupported compression');

    const truncated = sampleArchive().slice(0, -3);
    await expect(createPmtilesReader(rangeReader(truncated).read).getTile(2, 0, 0)).rejects.toThrow(PmtilesError);

    let fail = true;
    const file = sampleArchive();
    const flaky: ReadRange = async (offset, length) => {
      if (fail) {
        fail = false;
        throw new Error('io');
      }
      return file.slice(offset, offset + length);
    };
    const reader = createPmtilesReader(flaky);
    await expect(reader.header()).rejects.toThrow('io');
    expect((await reader.header()).maxZoom).toBe(14);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// optional spot check against the real Bali build (JOYO_PMTILES=/path/to/bali.pmtiles bun test ...)

const REAL = process.env.JOYO_PMTILES;
describe.skipIf(!REAL || !existsSync(REAL))('real PMTiles file (env-gated)', () => {
  test('header, a low-zoom tile and a Bali tile decode as MVT-sized gzip payloads', async () => {
    const path = REAL as string;
    const fd = openSync(path, 'r');
    const size = statSync(path).size;
    try {
      const read: ReadRange = async (offset, length) => {
        const n = Math.max(0, Math.min(length, size - offset));
        const buffer = new Uint8Array(n);
        readSync(fd, buffer, 0, n, offset);
        return buffer;
      };
      const reader = createPmtilesReader(read);
      const header = await reader.header();
      expect(header.tileType).toBe(1);
      expect(header.maxZoom).toBeGreaterThanOrEqual(12);
      // Denpasar at z12 and z14
      const tile = (z: number, lon: number, lat: number) => {
        const n = 2 ** z;
        const x = Math.floor(((lon + 180) / 360) * n);
        const rad = (lat * Math.PI) / 180;
        const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
        return [x, y] as const;
      };
      for (const z of [10, 12, 14]) {
        const [x, y] = tile(z, 115.2167, -8.65);
        const bytes = await reader.getTile(z, x, y);
        expect(bytes).not.toBeNull();
        expect((bytes?.length ?? 0) > 20).toBe(true);
        // an uncompressed MVT never starts with the gzip magic
        expect(bytes?.[0] === 0x1f && bytes?.[1] === 0x8b).toBe(false);
      }
    } finally {
      closeSync(fd);
    }
  });
});
