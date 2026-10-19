import { verifyWatchface } from "../../packages/hwt/src/builder";
import { HwtError, utf8Decode } from "../../packages/hwt/src/bytes";
import { parseDescription } from "../../packages/hwt/src/description";
import { HONOR_WATCHFACE_ENTRY, HUAWEI_WATCHFACE_ENTRY, NESTED_BINARY_ENTRY } from "../../packages/hwt/src/hwt";
import { parseWatchface } from "../../packages/hwt/src/watchface";
import { isZip, readZip, type ZipArchive } from "../../packages/hwt/src/zip";
import { MAX_WATCHFACE_UNZIPPED_BYTES, WATCHFACE_NAME_MAX } from "./limits";

export type HwtCheck = { ok: true; name: string | null } | { ok: false; reason: string };

/**
 * The sum of the uncompressed sizes a zip's central directory declares, read without inflating anything; 0 when the
 * directory cannot be read (the real reader then reports the problem). Lets us refuse a zip bomb before `readZip`
 * allocates a buffer of the declared size for every entry.
 */
function declaredUnzippedBytes(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue;
    let total = 0;
    let p = dv.getUint32(i + 16, true);
    for (let n = dv.getUint16(i + 10, true); n > 0; n--) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) return 0;
      total += dv.getUint32(p + 24, true);
      p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return total;
  }
  return 0;
}

function openZip(bytes: Uint8Array, what: string): ZipArchive {
  if (declaredUnzippedBytes(bytes) > MAX_WATCHFACE_UNZIPPED_BYTES) {
    throw new HwtError(`${what} unzips to more than ${MAX_WATCHFACE_UNZIPPED_BYTES / (1024 * 1024)} MiB`);
  }
  return readZip(bytes);
}

function entry(archive: ZipArchive, name: string): Uint8Array | undefined {
  return archive.entries.find((e) => e.name === name)?.data;
}

/** The face's own display name: the `<title>` of `description.xml`, control characters dropped, whitespace collapsed, cut to {@link WATCHFACE_NAME_MAX}. */
function cleanTitle(title: string): string | null {
  const name = title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return name === "" ? null : [...name].slice(0, WATCHFACE_NAME_MAX).join("");
}

/**
 * Decides whether `bytes` is a real Huawei/Honor watch face package (`.hwt`), with the codec in `packages/hwt` (pure
 * `Uint8Array` code plus fflate, runs in a Worker). What is checked, in order:
 *
 * 1. the zip magic, and a central directory whose declared unzipped size stays under {@link MAX_WATCHFACE_UNZIPPED_BYTES}
 *    (checked before inflating, for the nested zip too, so a small upload cannot expand into a memory bomb);
 * 2. every zip entry inflates to the size it declares;
 * 3. `description.xml` exists, has a `HwTheme` / `HnTheme` root and a `<screen>` code;
 * 4. the watchface entry (`com.huawei.watchface`, `com.honor.watchface` for Honor) exists; when it is itself a zip (nested
 *    package) it holds `watchface.bin`;
 * 5. the watchface binary parses and passes `verifyWatchface`: header lengths add up to the file size, the image table
 *    tiles the bin area exactly, every image blob carries the ARGB8888 magic, and the protobuf layout decodes.
 *
 * Not checked: the screen code against any watch model (faces for other Huawei models are valid faces), Huawei's size
 * limits for the Fit 4 (`checkFit4Limits` is a warning in the codec), and whether the watch will accept the face.
 * Never throws: every problem becomes `reason`.
 */
export function checkHwt(bytes: Uint8Array): HwtCheck {
  try {
    if (!isZip(bytes)) return { ok: false, reason: "not a zip file (a .hwt package is a zip)" };
    const outer = openZip(bytes, "package");
    const description = entry(outer, "description.xml");
    if (!description) return { ok: false, reason: "not a watch face package: no description.xml" };
    const parsed = parseDescription(utf8Decode(description));

    const watchfaceEntry = parsed.root === "HnTheme" ? HONOR_WATCHFACE_ENTRY : HUAWEI_WATCHFACE_ENTRY;
    let binary = entry(outer, watchfaceEntry);
    if (!binary) return { ok: false, reason: `not a watch face package: no ${watchfaceEntry}` };
    if (isZip(binary)) {
      binary = entry(openZip(binary, watchfaceEntry), NESTED_BINARY_ENTRY);
      if (!binary) return { ok: false, reason: `${watchfaceEntry} is a zip without ${NESTED_BINARY_ENTRY}` };
    }

    parseWatchface(binary);
    const report = verifyWatchface(binary);
    if (!report.ok) return { ok: false, reason: `watch face binary is inconsistent: ${report.problems.slice(0, 3).join("; ")}` };
    return { ok: true, name: cleanTitle(parsed.title) };
  } catch (error) {
    if (error instanceof HwtError) return { ok: false, reason: error.message };
    return { ok: false, reason: "the file could not be read as a watch face package" };
  }
}
