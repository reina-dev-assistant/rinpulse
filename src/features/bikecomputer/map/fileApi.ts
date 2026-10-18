import { Directory, File, Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';

import { createDownloadManager, type DownloadHandle, type DownloadManager, type FileApi } from './download';
import { createInstalledStore, type InstalledStore } from './storage';

/**
 * The real `FileApi` over expo-file-system (SDK 57 object API: `File`, `Directory`, `Paths`, `DownloadTask`), the kv-backed
 * registry, and the one shared download manager. No legacy API. Untested on a device (no native run here): the state
 * machine it feeds is tested against a fake in `download.test.ts`.
 */

function downloadHandle(url: string, destPath: string, onProgress: (received: number, total: number) => void): DownloadHandle {
  const task = File.createDownloadTask(url, new File(destPath), {
    onProgress: ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes),
  });
  return {
    run: async () => (await task.downloadAsync()) !== null,
    resume: async () => (await task.resumeAsync()) !== null,
    pause: () => task.pauseAsync(),
    cancel: () => task.cancel(),
  };
}

export const expoFileApi: FileApi = {
  freeBytes: () => Paths.availableDiskSpace,
  exists: (path) => new File(path).exists,
  size: (path) => {
    const file = new File(path);
    return file.exists ? file.size : null;
  },
  ensureDir: (path) => new Directory(path).create({ intermediates: true, idempotent: true }),
  remove: (path) => {
    try {
      const file = new File(path);
      if (file.exists) file.delete();
    } catch {
      // Already gone or not deletable: the registry no longer points at it either way.
    }
  },
  move: (from, to) => new File(from).moveSync(new File(to), { overwrite: true }),
  readBytes: (path, offset, length) => {
    try {
      const handle = new File(path).open();
      try {
        handle.offset = offset;
        return handle.readBytes(length);
      } finally {
        handle.close();
      }
    } catch {
      return null;
    }
  },
  startDownload: downloadHandle,
};

export const installedRegionStore: InstalledStore = createInstalledStore(Storage);

let manager: DownloadManager | null = null;

/** The app-wide download manager: one download at a time, and every screen sees the same state. */
export function getDownloadManager(): DownloadManager {
  manager ??= createDownloadManager({
    files: expoFileApi,
    store: installedRegionStore,
    documentDirectoryUri: Paths.document.uri,
    now: Date.now,
  });
  return manager;
}
