import { HUAWEI_WATCHFACE_ENTRY, NESTED_BINARY_ENTRY, createHwt, writeHwt } from "../../packages/hwt/src/hwt";
import { writeWatchface } from "../../packages/hwt/src/watchface";
import { writeZip } from "../../packages/hwt/src/zip";

const utf8 = (text: string) => new TextEncoder().encode(text);

/** A small but real face package (flat container, like the Fit 4 Pro samples): the codec's own empty face with a 2 x 2 thumbnail. */
export function flatFace(title: string, { author = "tester", seed = title }: { author?: string; seed?: string } = {}): Uint8Array {
  const pkg = createHwt({
    title,
    author,
    cover: Uint8Array.from([0xff, 0xd8, 0xff, ...utf8(seed)]),
    thumbnail: { width: 2, height: 2, data: new Uint8Array(16).fill(0x7f) },
  });
  return writeHwt(pkg);
}

/** The same face as a nested package: `com.huawei.watchface` is a zip holding `watchface.bin` next to project files (the GT3 samples). */
export function nestedFace(title: string): Uint8Array {
  const pkg = createHwt({ title, cover: Uint8Array.from([0xff, 0xd8, 0xff]), thumbnail: { width: 2, height: 2, data: new Uint8Array(16).fill(1) } });
  const binary = writeWatchface(pkg.watchface!);
  const inner = writeZip({
    entries: [
      { name: NESTED_BINARY_ENTRY, data: binary },
      { name: "watchface/watch_face_info.xml", data: utf8("<info/>") },
    ],
    comment: new Uint8Array(0),
    prefix: new Uint8Array(0),
  });
  pkg.archive.entries.find((e) => e.name === HUAWEI_WATCHFACE_ENTRY)!.data = inner;
  pkg.watchface = undefined;
  return writeHwt(pkg);
}

/** A package whose watchface binary carries an image blob that is not ARGB8888 (the codec's own consistency check fails). */
export function faceWithBrokenImage(): Uint8Array {
  const pkg = createHwt({ title: "Broken", cover: Uint8Array.from([0xff, 0xd8, 0xff]), thumbnail: { width: 2, height: 2, data: new Uint8Array(16) } });
  pkg.watchface!.images.push(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  return writeHwt(pkg);
}

/** A plain zip with the given entries. */
export function zipOf(entries: Record<string, Uint8Array>): Uint8Array {
  return writeZip({
    entries: Object.entries(entries).map(([name, data]) => ({ name, data })),
    comment: new Uint8Array(0),
    prefix: new Uint8Array(0),
  });
}

/** `bytes` (a zip) with the declared uncompressed size of its first central directory entry set to `size`. */
export function withDeclaredSize(bytes: Uint8Array, size: number): Uint8Array {
  const out = bytes.slice();
  const dv = new DataView(out.buffer);
  let eocd = out.length - 22;
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  dv.setUint32(dv.getUint32(eocd + 16, true) + 24, size, true);
  return out;
}

export { utf8 };
