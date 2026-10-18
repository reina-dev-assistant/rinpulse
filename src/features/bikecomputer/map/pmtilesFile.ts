import { File, type FileHandle } from 'expo-file-system';

import type { ReadRange } from './pmtilesReader';

export interface FileRangeReader extends ReadRange {
  /** Releases the file handle; the reader reopens it on the next read. */
  close(): void;
}

/**
 * Range reader over a local `.pmtiles` file for `createPmtilesReader`, using one expo-file-system handle (SDK 57 `File.open`,
 * `FileHandle.offset` + `readBytes`). Reads past the end of the file return what is left. Not pure; the reader itself is.
 * `path` is a `file://` URI or absolute path (an installed region's `path`).
 */
export function fileRangeReader(path: string): FileRangeReader {
  let handle: FileHandle | null = null;

  const read: ReadRange = async (offset, length) => {
    handle ??= new File(path).open();
    const size = handle.size ?? Number.POSITIVE_INFINITY;
    const wanted = Math.max(0, Math.min(length, size - offset));
    if (wanted === 0) return new Uint8Array(0);
    handle.offset = offset;
    return handle.readBytes(wanted);
  };

  return Object.assign(read, {
    close() {
      handle?.close();
      handle = null;
    },
  });
}
