/**
 * Xiaomi MiBeacon (service data under UUID 0xFE95), the advertisement the stock firmware of the LYWSD03MMC, MHO-C401, CGG1 and their
 * siblings sends once the unit was bound to the Xiaomi app. Pure TypeScript, no React Native imports, so it is tested with the published
 * vectors of ble_monitor and ships over the air. Ported from the format notes in ble_monitor's `ble_parser/xiaomi.py`
 * (custom-components/ble_monitor, MIT), checked against its test suite (`miBeacon.test.ts`).
 *
 * Service data (after the UUID):
 *   frame control u16 LE | product id u16 LE | frame counter u8 | MAC 6 (little-endian, when bit 4) | capability 1-2 (bit 5) | object (bit 6)
 * Frame control bits: 3 encrypted, 4 MAC included, 5 capability included, 6 object included, 7 mesh, 12..15 version.
 *
 * Encrypted objects (version 4 and 5): `ciphertext | extended counter 3 | MIC 4`, AES-128-CCM with a 4 byte tag, additional data `0x11` and the
 * nonce `MAC (6, as on the air) | product id 2 | frame counter 1 | extended counter 3` (12 bytes), under the 16 byte bind key the Xiaomi cloud
 * holds for the unit. The MIC makes a wrong key or a damaged frame reject itself. Versions 2 and 3 use a 12 byte key and another nonce: not
 * supported. Plaintext (unbound) frames decode without a key.
 *
 * Decrypted objects: `type u16 LE | length u8 | value`. Read here: 0x1004 temperature (int16 LE, 0.1 C), 0x1006 humidity (u16 LE, 0.1 %),
 * 0x100A battery (u8 %), 0x100D temperature and humidity together (4 bytes); the e-ink XMWSDJ04MMC family: 0x4C01 temperature and 0x4C08
 * humidity (float32 LE), 0x4C02 humidity and 0x4C03 battery (u8). The LYWSD03MMC sends one object per advertisement, so a reading
 * takes two frames (see `MiBeaconTracker`).
 */

/** Service data UUID of MiBeacon, as `features/scale/uuid.ts` writes it. */
export const SERVICE_MIBEACON = 'fe95';

/**
 * MiBeacon product ids (ble_monitor's XIAOMI_TYPE_DICT) of the temperature and humidity units: a scan lists a nameless advertisement only
 * when it carries one of these, because every Xiaomi gadget (bands, scales, lamps) advertises under 0xFE95.
 */
const THERMOMETER_PRODUCTS: ReadonlySet<number> = new Set([
  0x01aa, // LYWSDCGQ
  0x0347, // CGG1
  0x0b48, // CGG1 (encrypted)
  0x045b, // LYWSD02
  0x055b, // LYWSD03MMC
  0x066f, // CGDK2
  0x06d3, // MHO-C303
  0x0387, // MHO-C401
  0x16e4, // LYWSD02MMC
  0x2542, // LYWSD02MMC
  0x2832, // MJWSD05MMC
  0x55b5, // MJWSD06MMC
  0x5bea, // MJWSD06MMC
  0x1203, // XMWSDJ04MMC
]);

/** Whether the service data (hex, without the UUID) of a MiBeacon advertisement names a Xiaomi thermometer product. False for anything unreadable. */
export function isMiThermometerAdvert(serviceDataHex: string | undefined): boolean {
  if (!serviceDataHex || serviceDataHex.length < 8) return false;
  const productId = parseInt(serviceDataHex.slice(6, 8) + serviceDataHex.slice(4, 6), 16);
  return THERMOMETER_PRODUCTS.has(productId);
}

/** The bind key: 16 bytes, written as 32 hex digits. Whitespace, colons and dashes of a paste are ignored; the result is lower case. Null when it is not one. */
export function parseBindkey(text: string): string | null {
  const cleaned = text.replace(/[\s:-]/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(cleaned) ? cleaned : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// AES-128 (encryption only: CCM needs nothing else)

const SBOX = new Uint8Array(256);
(() => {
  let p = 1;
  let q = 1;
  const rotl8 = (x: number, n: number): number => ((x << n) | (x >> (8 - n))) & 0xff;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q = (q ^ (q << 1)) & 0xff;
    q = (q ^ (q << 2)) & 0xff;
    q = (q ^ (q << 4)) & 0xff;
    if (q & 0x80) q ^= 0x09;
    SBOX[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
})();

const xtime = (x: number): number => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;

/** The 11 round keys of a 16 byte key, 176 bytes. */
function expandKey(key: Uint8Array): Uint8Array {
  const w = new Uint8Array(176);
  w.set(key);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4]!;
    let t1 = w[i - 3]!;
    let t2 = w[i - 2]!;
    let t3 = w[i - 1]!;
    if (i % 16 === 0) {
      const first = t0;
      t0 = SBOX[t1]! ^ rcon;
      t1 = SBOX[t2]!;
      t2 = SBOX[t3]!;
      t3 = SBOX[first]!;
      rcon = xtime(rcon);
    }
    w[i] = w[i - 16]! ^ t0;
    w[i + 1] = w[i - 15]! ^ t1;
    w[i + 2] = w[i - 14]! ^ t2;
    w[i + 3] = w[i - 13]! ^ t3;
  }
  return w;
}

/** AES-128 encryption of one block under expanded round keys. */
function encryptBlock(roundKeys: Uint8Array, block: Uint8Array): Uint8Array {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = block[i]! ^ roundKeys[i]!;
  const t = new Uint8Array(16);
  for (let round = 1; round <= 10; round++) {
    // SubBytes and ShiftRows: column c of the result takes row r from column c + r.
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[c * 4 + r] = SBOX[s[((c + r) & 3) * 4 + r]!]!;
    if (round < 10) {
      for (let c = 0; c < 4; c++) {
        const a0 = t[c * 4]!;
        const a1 = t[c * 4 + 1]!;
        const a2 = t[c * 4 + 2]!;
        const a3 = t[c * 4 + 3]!;
        s[c * 4] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
        s[c * 4 + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
        s[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
        s[c * 4 + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
      }
    } else {
      s.set(t);
    }
    for (let i = 0; i < 16; i++) s[i] = s[i]! ^ roundKeys[round * 16 + i]!;
  }
  return s;
}

/** AES-128 encryption of one 16 byte block (exported for the FIPS-197 test). */
export function aes128EncryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  if (key.length !== 16 || block.length !== 16) throw new Error('key and block must be 16 bytes');
  return encryptBlock(expandKey(key), block);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// AES-CCM, 12 byte nonce (L = 3), 4 byte tag, as MiBeacon uses it

const TAG_LEN = 4;
const NONCE_LEN = 12;

function xorInto(target: Uint8Array, offset: number, source: Uint8Array, length: number): void {
  for (let i = 0; i < length; i++) target[offset + i] = target[offset + i]! ^ source[i]!;
}

/**
 * Decrypts and verifies. Returns the plaintext, or null when the tag does not match (wrong key, wrong nonce, damaged data). Never throws on
 * any input of the right key and nonce size.
 */
export function aesCcmDecrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): Uint8Array | null {
  if (key.length !== 16 || nonce.length !== NONCE_LEN || tag.length !== TAG_LEN || aad.length >= 0xff00 || ciphertext.length > 0xffffff) return null;
  const roundKeys = expandKey(key);

  const counterBlock = (i: number): Uint8Array => {
    const a = new Uint8Array(16);
    a[0] = 2; // L - 1
    a.set(nonce, 1);
    a[13] = (i >> 16) & 0xff;
    a[14] = (i >> 8) & 0xff;
    a[15] = i & 0xff;
    return a;
  };

  const plain = new Uint8Array(ciphertext.length);
  for (let i = 0; i * 16 < ciphertext.length; i++) {
    const stream = encryptBlock(roundKeys, counterBlock(i + 1));
    const n = Math.min(16, ciphertext.length - i * 16);
    for (let j = 0; j < n; j++) plain[i * 16 + j] = ciphertext[i * 16 + j]! ^ stream[j]!;
  }

  // CBC-MAC over B0 | encoded additional data | plaintext, each zero padded to whole blocks.
  const b0 = new Uint8Array(16);
  b0[0] = (aad.length > 0 ? 0x40 : 0) | (((TAG_LEN - 2) / 2) << 3) | 2;
  b0.set(nonce, 1);
  b0[13] = (plain.length >> 16) & 0xff;
  b0[14] = (plain.length >> 8) & 0xff;
  b0[15] = plain.length & 0xff;
  let x = encryptBlock(roundKeys, b0);
  const absorb = (data: Uint8Array): void => {
    for (let offset = 0; offset < data.length; offset += 16) {
      const block = new Uint8Array(x);
      xorInto(block, 0, data.subarray(offset), Math.min(16, data.length - offset));
      x = encryptBlock(roundKeys, block);
    }
  };
  if (aad.length > 0) {
    const encoded = new Uint8Array(2 + aad.length);
    encoded[0] = (aad.length >> 8) & 0xff;
    encoded[1] = aad.length & 0xff;
    encoded.set(aad, 2);
    absorb(encoded);
  }
  absorb(plain);

  const s0 = encryptBlock(roundKeys, counterBlock(0));
  let diff = 0;
  for (let i = 0; i < TAG_LEN; i++) diff |= (x[i]! ^ s0[i]!) ^ tag[i]!;
  return diff === 0 ? plain : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// MiBeacon frame

const HEX = /^(?:[0-9a-f]{2})*$/;

function hexToBytes(hex: string): Uint8Array | null {
  const lower = hex.toLowerCase();
  if (!HEX.test(lower)) return null;
  const out = new Uint8Array(lower.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(lower.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** What one frame says about the room; each field only when its object was in the frame. */
export interface MiBeaconMeasure {
  tempC?: number;
  rhPct?: number;
  batteryPct?: number;
}

export type MiBeaconFailure =
  /** Not hex, or too short to be a MiBeacon frame. */
  | 'malformed'
  /** Mesh device, or a version this decoder does not read (below 2; encrypted below 4). */
  | 'unsupported'
  /** The frame carries no object (an idle advertisement of an unbound unit). */
  | 'noObject'
  /** Encrypted and no bind key was given. */
  | 'noKey'
  /** Encrypted and the frame has no MAC and none was given: the nonce cannot be built. */
  | 'noMac'
  /** The tag did not verify: the key is not this unit's (or the frame is damaged). */
  | 'wrongKey';

export type MiBeaconResult =
  | {
      ok: true;
      productId: number;
      /** Rolls with every frame; repeats of one advertisement carry the same value. */
      counter: number;
      /** `A4:C1:38:02:83:F4`, from the payload; null when the frame has none. */
      mac: string | null;
      encrypted: boolean;
      measure: MiBeaconMeasure;
    }
  | { ok: false; reason: MiBeaconFailure };

const fail = (reason: MiBeaconFailure): MiBeaconResult => ({ ok: false, reason });

const round1 = (n: number): number => Math.round(n * 10) / 10;
const u16 = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const s16 = (b: Uint8Array, i: number): number => {
  const v = u16(b, i);
  return v >= 0x8000 ? v - 0x10000 : v;
};

const f32 = (b: Uint8Array): number => new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);

/** The objects of a decrypted (or plaintext) payload. Unknown objects and a cut-off tail are skipped. */
export function parseMiBeaconObjects(payload: Uint8Array): MiBeaconMeasure {
  const out: MiBeaconMeasure = {};
  let i = 0;
  while (i + 3 <= payload.length) {
    const type = u16(payload, i);
    const length = payload[i + 2]!;
    const start = i + 3;
    if (start + length > payload.length) break;
    const value = payload.subarray(start, start + length);
    if (type === 0x1004 && length === 2) out.tempC = round1(s16(value, 0) / 10);
    else if (type === 0x1006 && length === 2) out.rhPct = round1(u16(value, 0) / 10);
    else if (type === 0x100a && length === 1 && value[0]! <= 100) out.batteryPct = value[0]!;
    else if (type === 0x100d && length === 4) {
      out.tempC = round1(s16(value, 0) / 10);
      out.rhPct = round1(u16(value, 2) / 10);
    } else if (type === 0x4c01 && length === 4) out.tempC = round1(f32(value));
    else if (type === 0x4c02 && length === 1) out.rhPct = value[0]!;
    else if (type === 0x4c03 && length === 1 && value[0]! <= 100) out.batteryPct = value[0]!;
    else if (type === 0x4c08 && length === 4) out.rhPct = round1(f32(value));
    i = start + length;
  }
  return out;
}

const macText = (bytes: Uint8Array): string =>
  Array.from(bytes, (v) => v.toString(16).padStart(2, '0'))
    .reverse()
    .join(':')
    .toUpperCase();

/** `A4:C1:38:02:83:F4` (a scan id on Android) as the 6 bytes the nonce wants, little-endian; null for anything else (an iOS peripheral UUID). */
function addressBytes(address: string | null | undefined): Uint8Array | null {
  if (!address || !/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(address)) return null;
  return Uint8Array.from(address.split(':').map((h) => parseInt(h, 16))).reverse();
}

/**
 * Decodes the service data (hex, without the UUID) of one MiBeacon advertisement.
 * - `bindkey`: 32 hex digits, needed only for an encrypted frame.
 * - `scanAddress`: the address the scan reported, used only when the frame carries no MAC of its own.
 * Never throws.
 */
export function decodeMiBeacon(serviceDataHex: string, bindkey?: string | null, scanAddress?: string | null): MiBeaconResult {
  const b = hexToBytes(serviceDataHex);
  if (!b || b.length < 5) return fail('malformed');
  const frameControl = u16(b, 0);
  const version = frameControl >> 12;
  const encrypted = (frameControl & 0x0008) !== 0;
  const hasMac = (frameControl & 0x0010) !== 0;
  const hasCapability = (frameControl & 0x0020) !== 0;
  const hasObject = (frameControl & 0x0040) !== 0;
  const mesh = (frameControl & 0x0080) !== 0;
  if (mesh || version < 2 || (encrypted && version < 4)) return fail('unsupported');
  const productId = u16(b, 2);
  const counter = b[4]!;
  let i = 5;
  let mac: Uint8Array | null = null;
  if (hasMac) {
    if (b.length < i + 6) return fail('malformed');
    mac = b.subarray(i, i + 6);
    i += 6;
  }
  if (hasCapability) {
    if (b.length < i + 1) return fail('malformed');
    const capability = b[i]!;
    i += 1;
    if (capability & 0x20) i += 1;
  }
  if (!hasObject) return fail('noObject');
  const macLabel = mac ? macText(mac) : null;

  if (!encrypted) {
    if (b.length < i + 3) return fail('malformed');
    return { ok: true, productId, counter, mac: macLabel, encrypted, measure: parseMiBeaconObjects(b.subarray(i)) };
  }

  if (bindkey == null) return fail('noKey');
  const keyBytes = hexToBytes(bindkey);
  if (!keyBytes || keyBytes.length !== 16) return fail('noKey');
  const nonceMac = mac ?? addressBytes(scanAddress);
  if (!nonceMac) return fail('noMac');
  // ciphertext (at least one object header), extended counter 3, tag 4
  if (b.length < i + 3 + 7) return fail('malformed');
  const nonce = new Uint8Array(NONCE_LEN);
  nonce.set(nonceMac, 0);
  nonce.set(b.subarray(2, 5), 6);
  nonce.set(b.subarray(b.length - 7, b.length - 4), 9);
  const plain = aesCcmDecrypt(keyBytes, nonce, Uint8Array.of(0x11), b.subarray(i, b.length - 7), b.subarray(b.length - 4));
  if (!plain) return fail('wrongKey');
  return { ok: true, productId, counter, mac: macLabel ?? (scanAddress ? scanAddress.toUpperCase() : null), encrypted, measure: parseMiBeaconObjects(plain) };
}
