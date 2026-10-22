import { describe, expect, it } from 'bun:test';

import { aes128EncryptBlock, aesCcmDecrypt, decodeMiBeacon, parseBindkey, parseMiBeaconObjects } from './miBeacon';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const bytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));

/**
 * Frames of ble_monitor's test suite (custom_components/ble_monitor/test/test_xiaomi_parser.py): the service data is what follows
 * `16 95 fe` in the recorded HCI event; key, MAC, packet (frame counter) and the value are the assertions of that suite.
 */
const VECTORS = {
  lywsd03mmc: {
    sd: '58585b0550f4830238c1a495ef58763c26000097e2abb5',
    key: 'e9ea895fac7cca6d30532432a516f3a8',
    mac: 'A4:C1:38:02:83:F4',
    counter: 80,
    productId: 0x055b,
    measure: { rhPct: 46.7 },
  },
  cgg1: {
    sd: '5858480b685f12342d585a0b1841e2aa000e00a4964fb5',
    key: '814aac74c4f17b6c1581e1ab87816b99',
    mac: '5A:58:2D:34:12:5F',
    counter: 104,
    productId: 0x0b48,
    measure: { rhPct: 59.6 },
  },
  cgdk2: {
    sd: '58586f0607892012342d585f176dd54f0200002fa453fa',
    key: 'a3bfe9853dd85a620debe3620caaa351',
    mac: '58:2D:34:12:20:89',
    counter: 7,
    productId: 0x066f,
    measure: { tempC: 22.6 },
  },
} as const;

describe('AES-128', () => {
  it('matches FIPS-197 appendix C.1', () => {
    const key = bytes('000102030405060708090a0b0c0d0e0f');
    const block = bytes('00112233445566778899aabbccddeeff');
    expect(hex(aes128EncryptBlock(key, block))).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
  });

  it('matches FIPS-197 appendix B', () => {
    const key = bytes('2b7e151628aed2a6abf7158809cf4f3c');
    const block = bytes('3243f6a8885a308d313198a2e0370734');
    expect(hex(aes128EncryptBlock(key, block))).toBe('3925841d02dc09fbdc118597196a0b32');
  });
});

describe('MiBeacon v5 encrypted, published vectors', () => {
  for (const [name, v] of Object.entries(VECTORS)) {
    it(`decrypts ${name}`, () => {
      const result = decodeMiBeacon(v.sd, v.key);
      expect(result).toEqual({ ok: true, productId: v.productId, counter: v.counter, mac: v.mac, encrypted: true, measure: v.measure });
    });
  }

  it('decrypts a frame without a MAC with the address of the scan (XMWSDJ04MMC, 0x4C08 humidity float 45.0)', () => {
    const sd = '4859' + '0312' + 'a4' + '1b776e7c96add7' + '000000' + 'f2bf545b';
    const key = 'b2cf9a553d53571b5657defd582d676e';
    expect(decodeMiBeacon(sd, key)).toEqual({ ok: false, reason: 'noMac' });
    expect(decodeMiBeacon(sd, key, '6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toEqual({ ok: false, reason: 'noMac' });
    const result = decodeMiBeacon(sd, key, '2C:11:65:25:70:04');
    expect(result).toMatchObject({ ok: true, productId: 0x1203, counter: 164, encrypted: true, measure: { rhPct: 45 } });
  });

  it('authenticates the LYWSD02MMC frame (an object this decoder does not read)', () => {
    const sd = '5858e4162c84535638c1a42b6ef2e91200006c884d9e';
    const result = decodeMiBeacon(sd, 'a115210eed7a88e50ad52662e732a9fb');
    expect(result).toMatchObject({ ok: true, counter: 44, mac: 'A4:C1:38:56:53:84', measure: {} });
  });

  it('rejects a wrong key, a damaged frame and a missing key', () => {
    const v = VECTORS.lywsd03mmc;
    expect(decodeMiBeacon(v.sd, '00112233445566778899aabbccddeeff')).toEqual({ ok: false, reason: 'wrongKey' });
    const damaged = v.sd.slice(0, 24) + '96' + v.sd.slice(26);
    expect(decodeMiBeacon(damaged, v.key)).toEqual({ ok: false, reason: 'wrongKey' });
    const badTag = v.sd.slice(0, -2) + 'b4';
    expect(decodeMiBeacon(badTag, v.key)).toEqual({ ok: false, reason: 'wrongKey' });
    expect(decodeMiBeacon(v.sd)).toEqual({ ok: false, reason: 'noKey' });
    expect(decodeMiBeacon(v.sd, 'not a key')).toEqual({ ok: false, reason: 'noKey' });
  });
});

describe('MiBeacon plaintext', () => {
  it('reads the unbound LYWSD03MMC frame of ble_monitor (0x100D, 27.2 C / 49.0 %)', () => {
    const sd = '50305b05034c94b438c1a40d10041001ea01';
    expect(decodeMiBeacon(sd)).toEqual({
      ok: true,
      productId: 0x055b,
      counter: 3,
      mac: 'A4:C1:38:B4:94:4C',
      encrypted: false,
      measure: { tempC: 27.2, rhPct: 49 },
    });
  });

  it('reads the LYWSDCGQ frame of ble_monitor (MiBeacon v2, 25.4 C / 58.4 %)', () => {
    const sd = '5020aa01da219335342d580d1004fe004802';
    expect(decodeMiBeacon(sd)).toMatchObject({ ok: true, counter: 218, mac: '58:2D:34:35:93:21', measure: { tempC: 25.4, rhPct: 58.4 } });
  });

  it('rejects what is no MiBeacon reading', () => {
    expect(decodeMiBeacon('')).toEqual({ ok: false, reason: 'malformed' });
    expect(decodeMiBeacon('zz')).toEqual({ ok: false, reason: 'malformed' });
    expect(decodeMiBeacon('5030')).toEqual({ ok: false, reason: 'malformed' });
    // no object bit: an idle advertisement
    expect(decodeMiBeacon('1030' + '5b05' + '03' + '4c94b438c1a4')).toEqual({ ok: false, reason: 'noObject' });
    // mesh bit, version 1 and an encrypted legacy (v3) frame
    expect(decodeMiBeacon('d030' + '5b05' + '03' + '4c94b438c1a4' + '0d1004' + '1001ea01')).toEqual({ ok: false, reason: 'unsupported' });
    expect(decodeMiBeacon('5010' + '5b05' + '03' + '4c94b438c1a4' + '0d1004' + '1001ea01')).toEqual({ ok: false, reason: 'unsupported' });
    expect(decodeMiBeacon('5830' + '5b05' + '03' + '4c94b438c1a4' + '0d1004' + '1001ea01', 'e9ea895fac7cca6d30532432a516f3a8')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });
});

describe('objects', () => {
  it('reads 0x1004, 0x1006, 0x100A and 0x100D, and skips what it does not know', () => {
    expect(parseMiBeaconObjects(bytes('0410' + '02' + 'fe00'))).toEqual({ tempC: 25.4 });
    expect(parseMiBeaconObjects(bytes('0610' + '02' + '4802'))).toEqual({ rhPct: 58.4 });
    expect(parseMiBeaconObjects(bytes('0a10' + '01' + '5a'))).toEqual({ batteryPct: 90 });
    expect(parseMiBeaconObjects(bytes('0d10' + '04' + '1001ea01'))).toEqual({ tempC: 27.2, rhPct: 49 });
    expect(parseMiBeaconObjects(bytes('ffff' + '01' + '00' + '0a10' + '01' + '32'))).toEqual({ batteryPct: 50 });
  });

  it('reads a negative temperature as signed', () => {
    expect(parseMiBeaconObjects(bytes('0410' + '02' + '9cff'))).toEqual({ tempC: -10 });
  });

  it('ignores objects of the wrong length and a cut-off tail', () => {
    expect(parseMiBeaconObjects(bytes('0410' + '01' + 'fe'))).toEqual({});
    expect(parseMiBeaconObjects(bytes('0d10' + '04' + '1001'))).toEqual({});
    expect(parseMiBeaconObjects(bytes('0a10' + '01' + '65'))).toEqual({});
  });

  it('reads the e-ink family: 0x4C01 temperature and 0x4C08 humidity as float32', () => {
    const f32 = (v: number): string => {
      const b = Buffer.alloc(4);
      b.writeFloatLE(v);
      return b.toString('hex');
    };
    expect(parseMiBeaconObjects(bytes('014c' + '04' + f32(21.5) + '084c' + '04' + f32(45)))).toEqual({ tempC: 21.5, rhPct: 45 });
  });
});

describe('bind key', () => {
  it('accepts 32 hex digits, ignores separators and case', () => {
    expect(parseBindkey('E9EA895FAC7CCA6D30532432A516F3A8')).toBe('e9ea895fac7cca6d30532432a516f3a8');
    expect(parseBindkey(' e9ea895f ac7cca6d\n30532432a516f3a8 ')).toBe('e9ea895fac7cca6d30532432a516f3a8');
    expect(parseBindkey('e9:ea:89:5f:ac:7c:ca:6d:30:53:24:32:a5:16:f3:a8')).toBe('e9ea895fac7cca6d30532432a516f3a8');
  });

  it('rejects anything else', () => {
    expect(parseBindkey('')).toBeNull();
    expect(parseBindkey('e9ea895fac7cca6d30532432a516f3a')).toBeNull();
    expect(parseBindkey('e9ea895fac7cca6d30532432a516f3a8a')).toBeNull();
    expect(parseBindkey('g9ea895fac7cca6d30532432a516f3a8')).toBeNull();
    // a 24 digit legacy key (MiBeacon v2/v3) is not accepted
    expect(parseBindkey('b853075158487ca39a5b5ea9')).toBeNull();
  });
});

/** Built with Node's own `aes-128-ccm` (an independent implementation; Bun has none, so the bytes are fixed here). */
describe('AES-CCM against Node crypto', () => {
  it('decrypts a 37 byte message (three blocks, additional data 0x11) and refuses a flipped tag or byte', () => {
    const key = bytes('000102030405060708090a0b0c0d0e0f');
    const nonce = bytes('101112131415161718191a1b');
    const cipher = bytes('20bfa8b85dd2008631ee3690233abeea08cd533fbad1978f5d5a1e9014ebb858bef95d921c');
    const tag = bytes('37151a52');
    const out = aesCcmDecrypt(key, nonce, Uint8Array.of(0x11), cipher, tag);
    expect(out && hex(out)).toBe('030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8ff');
    expect(aesCcmDecrypt(key, nonce, Uint8Array.of(0x11), cipher, bytes('37151a53'))).toBeNull();
    expect(aesCcmDecrypt(key, nonce, Uint8Array.of(0x12), cipher, tag)).toBeNull();
    const damaged = Uint8Array.from(cipher);
    damaged[36] = damaged[36]! ^ 0x80;
    expect(aesCcmDecrypt(key, nonce, Uint8Array.of(0x11), damaged, tag)).toBeNull();
  });

  it('decodes synthetic frames of 0x100D, 0x1004, 0x100A and 0x1006 under the key 00112233...eeff', () => {
    const key = '00112233445566778899aabbccddeeff';
    expect(decodeMiBeacon('58585b0509f4830238c1a446f5b48dae6c8b0102033f3edee9', key)).toMatchObject({ ok: true, counter: 9, measure: { tempC: 27.2, rhPct: 49 } });
    expect(decodeMiBeacon('58585b050af4830238c1a41126c09dcb010204cc9db9a4', key)).toMatchObject({ ok: true, counter: 10, measure: { tempC: 25.4 } });
    expect(decodeMiBeacon('58585b050bf4830238c1a4867216e301020580628699', key)).toMatchObject({ ok: true, counter: 11, measure: { batteryPct: 90 } });
    expect(decodeMiBeacon('58585b050cf4830238c1a445871853e8010206e5a78aa5', key)).toMatchObject({ ok: true, counter: 12, measure: { rhPct: 46.7 } });
  });
});
