import type { MapRegion } from './regions';
import {
  PMTILES_HEADER_BYTES,
  pmtilesHeaderProblem,
  regionPath,
  toInstalled,
  type InstalledRegion,
  type InstalledStore,
} from './storage';

/**
 * Region download manager (docs/bike-computer.md section 3): free-space check, download into `<file>.part`, size + PMTiles
 * header check, atomic move into place, registry update. The state machine is pure: files, clock and registry are injected, so
 * `download.test.ts` runs it against a fake (`fileApi.ts` is the expo-file-system implementation).
 *
 * Not checked: the catalog's sha256. Hashing a 100+ MB file on the JS thread needs a streaming digest that `expo-crypto` does
 * not offer; the exact byte size plus the header guard against a truncated or wrong file, and the download is https.
 * After the app is killed a `.part` file is discarded on the next start (the native task keeps resume data in memory only).
 */

/** Error kinds the UI turns into copy. `cancelled` is not a failure, it is the rider's own action. */
export type DownloadErrorKind = 'noSpace' | 'network' | 'corrupt' | 'cancelled';
export type DownloadFailureKind = Exclude<DownloadErrorKind, 'cancelled'>;

export class DownloadError extends Error {
  constructor(
    readonly kind: DownloadErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'DownloadError';
  }
}

export type DownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; regionId: string; received: number; total: number }
  | { phase: 'paused'; regionId: string; received: number; total: number }
  | { phase: 'verifying'; regionId: string }
  | { phase: 'installed'; regionId: string; region: InstalledRegion }
  | { phase: 'failed'; regionId: string; kind: DownloadFailureKind; needBytes?: number; freeBytes?: number }
  | { phase: 'cancelled'; regionId: string };

export interface DownloadHandle {
  /** Resolves true when the file is complete, false when paused; rejects when the transfer fails or is cancelled. */
  run(): Promise<boolean>;
  /** Continues a paused transfer; same result as `run`. */
  resume(): Promise<boolean>;
  /** Stops the transfer keeping what was received; resolves once `run`/`resume` has settled as paused. */
  pause(): Promise<void>;
  cancel(): void;
}

/** The slice of the file system the manager needs. */
export interface FileApi {
  /** Free disk space in bytes. */
  freeBytes(): number;
  exists(path: string): boolean;
  /** Size in bytes, or null when the file is missing. */
  size(path: string): number | null;
  ensureDir(path: string): void;
  /** Deletes a file; a missing file is not an error. */
  remove(path: string): void;
  /** Moves a file, replacing the target. */
  move(from: string, to: string): void;
  /** `length` bytes from `offset`, or null when this platform cannot read a file partially. */
  readBytes(path: string, offset: number, length: number): Uint8Array | null;
  startDownload(url: string, destPath: string, onProgress: (received: number, total: number) => void): DownloadHandle;
}

export interface DownloadManagerDeps {
  files: FileApi;
  store: InstalledStore;
  /** `file://` URI of the document directory, with or without a trailing slash. */
  documentDirectoryUri: string;
  now: () => number;
}

export interface DownloadManager {
  getState(): DownloadState;
  subscribe(listener: (state: DownloadState) => void): () => void;
  /** Runs one download to a settled state: installed, failed, cancelled or paused. One at a time; a second call returns the current state. */
  start(region: MapRegion): Promise<DownloadState>;
  pause(): Promise<void>;
  resume(): Promise<DownloadState>;
  cancel(): void;
  /** Deletes an installed region's file and registry entry. */
  remove(id: string): void;
  installed(): InstalledRegion[];
  /** Clears a settled state (installed, failed, cancelled) back to idle. */
  acknowledge(): void;
}

/** The disk the download needs: the file plus 10 % for the `.part` -> final move and filesystem overhead. */
export function requiredFreeBytes(bytes: number): number {
  return Math.ceil(bytes * 1.1);
}

const NO_SPACE = /ENOSPC|no space|not enough (disk )?space|disk full|insufficient storage/i;

export function classifyDownloadError(error: unknown): DownloadErrorKind {
  if (error instanceof DownloadError) return error.kind;
  const message = error instanceof Error ? error.message : String(error);
  return NO_SPACE.test(message) ? 'noSpace' : 'network';
}

/** A failure before the transfer starts is never a cancel: disk problems are `noSpace`, anything else `network`. */
function setupFailure(error: unknown): DownloadFailureKind {
  const kind = classifyDownloadError(error);
  return kind === 'cancelled' ? 'network' : kind;
}

/** Emit progress at most every this many ms or this fraction of the file. */
const PROGRESS_MS = 250;
const PROGRESS_FRACTION = 0.005;

export function createDownloadManager(deps: DownloadManagerDeps): DownloadManager {
  const { files, store, documentDirectoryUri, now } = deps;
  let state: DownloadState = { phase: 'idle' };
  const listeners = new Set<(state: DownloadState) => void>();
  let active: { region: MapRegion; handle: DownloadHandle; partPath: string; finalPath: string } | null = null;
  let cancelRequested = false;

  const emit = (next: DownloadState) => {
    state = next;
    for (const listener of [...listeners]) listener(next);
  };

  const makeProgress = (regionId: string, total: number) => {
    let lastAt = Number.NEGATIVE_INFINITY;
    let lastReceived = 0;
    return (received: number, reported: number) => {
      if (state.phase !== 'downloading') return;
      const size = reported > 0 ? reported : total;
      const at = now();
      const settled = received >= size;
      if (!settled && at - lastAt < PROGRESS_MS && received - lastReceived < size * PROGRESS_FRACTION) return;
      lastAt = at;
      lastReceived = received;
      emit({ phase: 'downloading', regionId, received, total: size });
    };
  };

  const fail = (regionId: string, kind: DownloadFailureKind, extra: { needBytes?: number; freeBytes?: number } = {}) => {
    emit({ phase: 'failed', regionId, kind, ...extra });
  };

  const finish = async (current: NonNullable<typeof active>, outcome: Promise<boolean>): Promise<DownloadState> => {
    const { region, partPath, finalPath } = current;
    try {
      const complete = await outcome;
      if (!complete && !cancelRequested) {
        // Paused: keep the part file and the handle for `resume`.
        const received = state.phase === 'downloading' ? state.received : (files.size(partPath) ?? 0);
        emit({ phase: 'paused', regionId: region.id, received, total: region.bytes });
        return state;
      }
      if (cancelRequested) throw new DownloadError('cancelled');
      emit({ phase: 'verifying', regionId: region.id });
      const size = files.size(partPath);
      if (size !== region.bytes) throw new DownloadError('corrupt', `size ${size} != ${region.bytes}`);
      const head = files.readBytes(partPath, 0, PMTILES_HEADER_BYTES);
      // null: this platform cannot read a file partially, so the exact size above is all that can be checked.
      if (head !== null) {
        const problem = pmtilesHeaderProblem(head);
        if (problem) throw new DownloadError('corrupt', `header: ${problem}`);
      }
      const previous = store.read().find((r) => r.id === region.id);
      files.move(partPath, finalPath);
      const installed = toInstalled(region, finalPath, now());
      store.upsert(installed);
      if (previous && previous.path !== finalPath) files.remove(previous.path);
      active = null;
      emit({ phase: 'installed', regionId: region.id, region: installed });
    } catch (error) {
      files.remove(partPath);
      active = null;
      const kind = cancelRequested ? 'cancelled' : classifyDownloadError(error);
      if (kind === 'cancelled') emit({ phase: 'cancelled', regionId: region.id });
      else fail(region.id, kind);
    }
    return state;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async start(region) {
      if (active) return state;
      cancelRequested = false;
      const need = requiredFreeBytes(region.bytes);
      const free = files.freeBytes();
      if (free < need) {
        fail(region.id, 'noSpace', { needBytes: need, freeBytes: free });
        return state;
      }
      const finalPath = regionPath(region.id, region.version, documentDirectoryUri);
      const partPath = `${finalPath}.part`;
      try {
        files.ensureDir(finalPath.slice(0, finalPath.lastIndexOf('/') + 1));
        files.remove(partPath);
      } catch (error) {
        fail(region.id, setupFailure(error));
        return state;
      }
      emit({ phase: 'downloading', regionId: region.id, received: 0, total: region.bytes });
      const onProgress = makeProgress(region.id, region.bytes);
      let handle: DownloadHandle;
      try {
        handle = files.startDownload(region.url, partPath, onProgress);
      } catch (error) {
        files.remove(partPath);
        fail(region.id, setupFailure(error));
        return state;
      }
      active = { region, handle, partPath, finalPath };
      return finish(active, handle.run());
    },

    async pause() {
      if (!active || state.phase !== 'downloading') return;
      await active.handle.pause();
    },

    async resume() {
      if (!active || state.phase !== 'paused') return state;
      emit({ phase: 'downloading', regionId: active.region.id, received: state.received, total: state.total });
      return finish(active, active.handle.resume());
    },

    cancel() {
      if (!active) return;
      if (state.phase === 'verifying') return;
      cancelRequested = true;
      active.handle.cancel();
      // A paused download has no pending promise to settle: finish it here.
      if (state.phase === 'paused') {
        files.remove(active.partPath);
        const regionId = active.region.id;
        active = null;
        emit({ phase: 'cancelled', regionId });
      }
    },

    remove(id) {
      if (active?.region.id === id) return;
      const entry = store.read().find((r) => r.id === id);
      if (!entry) return;
      files.remove(entry.path);
      store.remove(id);
      if (state.phase !== 'idle' && state.regionId === id) emit({ phase: 'idle' });
    },

    installed: () => store.read(),

    acknowledge() {
      if (state.phase === 'installed' || state.phase === 'failed' || state.phase === 'cancelled') emit({ phase: 'idle' });
    },
  };
}
