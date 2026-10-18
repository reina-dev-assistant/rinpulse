import { describe, expect, test } from 'bun:test';

import {
  classifyDownloadError,
  createDownloadManager,
  DownloadError,
  requiredFreeBytes,
  type DownloadHandle,
  type DownloadState,
  type FileApi,
} from './download';
import type { MapRegion } from './regions';
import { createInstalledStore, regionPath, type KvLike } from './storage';

const DOC = 'file:///data/user/0/app/files/';
const BYTES = 1000;

const region = (over: Partial<MapRegion> = {}): MapRegion => ({
  id: 'bali',
  name: { id: 'Bali', en: 'Bali' },
  bbox: [114.4, -8.92, 115.74, -8.04],
  bytes: BYTES,
  version: '20261018',
  sha256: 'a'.repeat(64),
  url: 'https://maps.example.test/bali-20261018.pmtiles',
  ...over,
});

function goodHeader(): Uint8Array {
  const head = new Uint8Array(127);
  head.set([...'PMTiles'].map((c) => c.charCodeAt(0)));
  head[7] = 3;
  return head;
}

/** Fake file system: files are byte arrays keyed by path. */
class FakeFiles implements FileApi {
  files = new Map<string, Uint8Array>();
  dirs: string[] = [];
  free = 10_000;
  partialReads = true;
  moves: [string, string][] = [];
  /** What the next download writes to the part file, and how it ends. */
  plan: { bytes: Uint8Array; error?: Error; hold?: boolean } = { bytes: new Uint8Array(0) };
  handle!: FakeHandle;

  freeBytes = () => this.free;
  exists = (path: string) => this.files.has(path);
  size = (path: string) => this.files.get(path)?.length ?? null;
  ensureDir = (path: string) => void this.dirs.push(path);
  remove = (path: string) => void this.files.delete(path);
  move = (from: string, to: string) => {
    const data = this.files.get(from);
    if (!data) throw new Error('move: missing source');
    this.files.set(to, data);
    this.files.delete(from);
    this.moves.push([from, to]);
  };
  readBytes = (path: string, offset: number, length: number) => {
    if (!this.partialReads) return null;
    return this.files.get(path)?.slice(offset, offset + length) ?? null;
  };
  startDownload = (_url: string, dest: string, onProgress: (received: number, total: number) => void) => {
    this.handle = new FakeHandle(this, dest, onProgress);
    return this.handle;
  };
}

class FakeHandle implements DownloadHandle {
  private release: ((complete: boolean) => void) | null = null;
  private fail: ((error: Error) => void) | null = null;
  cancelled = false;
  constructor(
    private readonly fs: FakeFiles,
    private readonly dest: string,
    private readonly onProgress: (received: number, total: number) => void,
  ) {}

  private begin(): Promise<boolean> {
    const { bytes, error, hold } = this.fs.plan;
    this.onProgress(bytes.length / 2, bytes.length);
    if (error) return Promise.reject(error);
    if (!hold) {
      this.fs.files.set(this.dest, bytes);
      this.onProgress(bytes.length, bytes.length);
      return Promise.resolve(true);
    }
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    this.release = resolve;
    this.fail = reject;
    return promise;
  }
  run = () => this.begin();
  resume = () => {
    this.fs.plan = { ...this.fs.plan, hold: false };
    return this.begin();
  };
  pause = async () => {
    this.release?.(false);
    this.release = null;
  };
  cancel = () => {
    this.cancelled = true;
    this.fail?.(new Error('aborted'));
  };
}

function setup() {
  const kv = new Map<string, string>();
  const kvLike: KvLike = {
    getItemSync: (key) => kv.get(key) ?? null,
    setItemSync: (key, value) => void kv.set(key, value),
  };
  const files = new FakeFiles();
  const store = createInstalledStore(kvLike);
  let clock = 1_000_000;
  const manager = createDownloadManager({ files, store, documentDirectoryUri: DOC, now: () => (clock += 1000) });
  const seen: DownloadState[] = [];
  manager.subscribe((s) => seen.push(s));
  return { files, store, manager, seen, kv };
}

const phases = (seen: DownloadState[]) => seen.map((s) => s.phase);
const complete = () => {
  const bytes = new Uint8Array(BYTES);
  bytes.set(goodHeader());
  return bytes;
};

describe('requiredFreeBytes', () => {
  test('is size times 1.1 rounded up', () => {
    expect(requiredFreeBytes(1000)).toBe(1100);
    expect(requiredFreeBytes(101)).toBe(112);
  });
});

describe('classifyDownloadError', () => {
  test('maps errors to kinds', () => {
    expect(classifyDownloadError(new DownloadError('corrupt'))).toBe('corrupt');
    expect(classifyDownloadError(new Error('write failed: ENOSPC'))).toBe('noSpace');
    expect(classifyDownloadError(new Error('No space left on device'))).toBe('noSpace');
    expect(classifyDownloadError(new Error('Network request failed'))).toBe('network');
    expect(classifyDownloadError('boom')).toBe('network');
  });
});

describe('createDownloadManager', () => {
  test('happy path: downloading, verifying, installed, registry written, part file moved', async () => {
    const { files, manager, seen, store } = setup();
    files.plan = { bytes: complete() };
    const result = await manager.start(region());
    const finalPath = regionPath('bali', '20261018', DOC);

    expect(result.phase).toBe('installed');
    expect(phases(seen)).toEqual(['downloading', 'downloading', 'downloading', 'verifying', 'installed']);
    expect(files.moves).toEqual([[`${finalPath}.part`, finalPath]]);
    expect(files.exists(`${finalPath}.part`)).toBe(false);
    expect(files.exists(finalPath)).toBe(true);
    expect(files.dirs).toEqual([`${DOC}maps/`]);
    const [entry] = store.read();
    expect(entry).toMatchObject({ id: 'bali', version: '20261018', bytes: BYTES, path: finalPath });
    expect(entry?.bbox).toEqual([114.4, -8.92, 115.74, -8.04]);
  });

  test('refuses to start without 1.1x free space and touches nothing', async () => {
    const { files, manager, store } = setup();
    files.free = 1099;
    const result = await manager.start(region());
    expect(result).toEqual({ phase: 'failed', regionId: 'bali', kind: 'noSpace', needBytes: 1100, freeBytes: 1099 });
    expect(files.dirs).toEqual([]);
    expect(store.read()).toEqual([]);
  });

  test('starts with exactly 1.1x free', async () => {
    const { files, manager } = setup();
    files.free = 1100;
    files.plan = { bytes: complete() };
    expect((await manager.start(region())).phase).toBe('installed');
  });

  test('a wrong size is corrupt and the part file is deleted', async () => {
    const { files, manager, store } = setup();
    files.plan = { bytes: complete().slice(0, 900) };
    const result = await manager.start(region());
    expect(result).toMatchObject({ phase: 'failed', kind: 'corrupt' });
    expect(files.files.size).toBe(0);
    expect(store.read()).toEqual([]);
  });

  test('a bad magic or version byte is corrupt', async () => {
    for (const mutate of [(b: Uint8Array) => (b[0] = 0x50 ^ 1), (b: Uint8Array) => (b[7] = 2)]) {
      const { files, manager } = setup();
      const bytes = complete();
      mutate(bytes);
      files.plan = { bytes };
      expect(await manager.start(region())).toMatchObject({ phase: 'failed', kind: 'corrupt' });
    }
  });

  test('when the platform cannot read partially, the size alone decides', async () => {
    const { files, manager } = setup();
    files.partialReads = false;
    files.plan = { bytes: new Uint8Array(BYTES) };
    expect((await manager.start(region())).phase).toBe('installed');
  });

  test('a network error fails with kind network and leaves no part file', async () => {
    const { files, manager } = setup();
    files.plan = { bytes: new Uint8Array(0), error: new Error('Network request failed') };
    expect(await manager.start(region())).toMatchObject({ phase: 'failed', kind: 'network' });
    expect(files.files.size).toBe(0);
  });

  test('a disk-full error mid-download is noSpace', async () => {
    const { files, manager } = setup();
    files.plan = { bytes: new Uint8Array(0), error: new Error('java.io.IOException: ENOSPC') };
    expect(await manager.start(region())).toMatchObject({ phase: 'failed', kind: 'noSpace' });
  });

  test('cancel while downloading ends cancelled and deletes the part file', async () => {
    const { files, manager } = setup();
    files.plan = { bytes: complete(), hold: true };
    const running = manager.start(region());
    manager.cancel();
    expect(await running).toEqual({ phase: 'cancelled', regionId: 'bali' });
    expect(files.handle.cancelled).toBe(true);
    expect(files.files.size).toBe(0);
  });

  test('pause then resume completes the install', async () => {
    const { files, manager, seen } = setup();
    files.plan = { bytes: complete(), hold: true };
    const running = manager.start(region());
    await manager.pause();
    expect((await running).phase).toBe('paused');
    expect(manager.getState().phase).toBe('paused');
    files.files.set(`${regionPath('bali', '20261018', DOC)}.part`, complete());
    const resumed = await manager.resume();
    expect(resumed.phase).toBe('installed');
    expect(phases(seen)).toContain('paused');
  });

  test('cancel while paused ends cancelled', async () => {
    const { files, manager } = setup();
    files.plan = { bytes: complete(), hold: true };
    const running = manager.start(region());
    await manager.pause();
    await running;
    manager.cancel();
    expect(manager.getState()).toEqual({ phase: 'cancelled', regionId: 'bali' });
    expect(files.files.size).toBe(0);
  });

  test('a second start while one runs returns the current state', async () => {
    const { files, manager } = setup();
    files.plan = { bytes: complete(), hold: true };
    const first = manager.start(region());
    const second = await manager.start(region({ id: 'diy' }));
    expect(second.phase).toBe('downloading');
    manager.cancel();
    await first;
  });

  test('progress is throttled but the final value always arrives', async () => {
    const { files, manager, seen } = setup();
    files.plan = { bytes: complete() };
    await manager.start(region());
    const progress = seen.filter((s) => s.phase === 'downloading');
    expect(progress.at(-1)).toMatchObject({ received: BYTES, total: BYTES });
  });

  test('an update installs the new version, then deletes the old file', async () => {
    const { files, manager, store } = setup();
    files.plan = { bytes: complete() };
    await manager.start(region({ version: '20261018' }));
    const oldPath = regionPath('bali', '20261018', DOC);
    expect(files.exists(oldPath)).toBe(true);

    await manager.start(region({ version: '20261201' }));
    const newPath = regionPath('bali', '20261201', DOC);
    expect(files.exists(newPath)).toBe(true);
    expect(files.exists(oldPath)).toBe(false);
    expect(store.read()).toHaveLength(1);
    expect(store.read()[0]?.version).toBe('20261201');
  });

  test('remove deletes the file and the registry entry', async () => {
    const { files, manager, store } = setup();
    files.plan = { bytes: complete() };
    await manager.start(region());
    manager.remove('bali');
    expect(store.read()).toEqual([]);
    expect(files.files.size).toBe(0);
    expect(manager.installed()).toEqual([]);
  });

  test('acknowledge returns a settled state to idle; remove ignores an unknown id', async () => {
    const { files, manager } = setup();
    files.free = 0;
    await manager.start(region());
    manager.acknowledge();
    expect(manager.getState()).toEqual({ phase: 'idle' });
    expect(() => manager.remove('nowhere')).not.toThrow();
  });
});
