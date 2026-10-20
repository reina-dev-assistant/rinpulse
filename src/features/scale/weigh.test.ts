import { describe, expect, it } from 'bun:test';

import { FakeScaleNative } from './fakeNative.testkit';
import { ScaleHub } from './hub';
import type { ScaleNative } from './native';
import { okokProtocol } from './protocols/okok';
import { tuyaBeaconProtocol } from './protocols/tuyaBeacon';
import type { GattProtocol, ScaleReading } from './types';
import { WeighSession, type WeighStatus } from './weigh';

const tick = () => new Promise((r) => setTimeout(r, 0));
const ID = 'AA:BB:CC:DD:EE:FF';

function harness(protocol: Parameters<typeof WeighSession.prototype.constructor>[1]['protocol'], now = { t: 1_000 }, secret?: string) {
  const native = new FakeScaleNative();
  const hub = new ScaleHub(() => native as ScaleNative);
  const log = { statuses: [] as WeighStatus[], live: [] as ScaleReading[], final: [] as { r: ScaleReading; upgrade: boolean }[], problems: [] as string[], traces: [] as string[] };
  const session = new WeighSession(
    hub,
    { id: ID, protocol, secret },
    { lowLatency: true, user: () => null, now: () => now.t, cooldownMs: 0, timezoneOffsetMin: () => 420 },
    {
      onStatus: (s) => log.statuses.push(s),
      onLive: (r) => log.live.push(r),
      onFinal: (r, upgrade) => log.final.push({ r, upgrade }),
      onTrace: (l) => log.traces.push(`${l.direction} ${l.message} ${l.hex ?? ''}`.trim()),
      onProblem: (c) => log.problems.push(c),
    },
  );
  return { native, hub, log, session, now };
}

const adv = (manufacturerData: Record<string, string>, id = ID) => ({
  id, name: 'ADV', rssi: -60, ts: 0, serviceUuids: [], serviceData: {}, manufacturerData,
});

// OKOK V20 frames from okok.test.ts (built from openScale's layout; not captures).
const V20_FINAL = '01020304050605001b8f12c561112233445566';
const V20_LIVE = '01020304050604001b8f0000b7112233445566';

describe('WeighSession with a broadcast scale', () => {
  it('scans only for its scale and turns live frames and a repeated final frame into one weigh-in', async () => {
    const { native, session, log } = harness(okokProtocol);
    await session.start();
    expect(native.calls).toEqual(['scan AA:BB:CC:DD:EE:FF fast']);
    expect(log.statuses).toEqual(['starting', 'waiting']);

    native.emit('onScaleAdvertisement', adv({ '20ca': V20_LIVE }));
    expect(log.live.map((r) => r.weightKg)).toEqual([70.55]);
    native.emit('onScaleAdvertisement', adv({ '20ca': V20_FINAL }));
    expect(log.final).toHaveLength(0); // needs a second equal stable frame
    native.emit('onScaleAdvertisement', adv({ '20ca': V20_FINAL }));
    expect(log.final).toHaveLength(1);
    expect(log.final[0].r).toMatchObject({ weightKg: 70.55, impedanceOhm: 480.5, stable: true });
    native.emit('onScaleAdvertisement', adv({ '20ca': V20_FINAL }));
    expect(log.final).toHaveLength(1);
    session.stop();
  });

  it('ignores other devices and stops cleanly', async () => {
    const { native, session, log } = harness(okokProtocol);
    await session.start();
    native.emit('onScaleAdvertisement', adv({ '20ca': V20_FINAL }, '11:22:33:44:55:66'));
    native.emit('onScaleAdvertisement', adv({ '20ca': V20_FINAL }, '11:22:33:44:55:66'));
    expect(log.final).toHaveLength(0);
    session.stop();
    await tick();
    expect(native.calls.at(-1)).toBe('stopScan');
    native.emit('onScaleAdvertisement', adv({ '20ca': V20_FINAL }));
    expect(log.live).toHaveLength(0);
  });

  it('stops and reports when the scan dies', async () => {
    const { native, session, log } = harness(okokProtocol);
    await session.start();
    native.emit('onScaleScanState', { scanning: false, error: 'ERR_BLUETOOTH_OFF' });
    expect(log.problems).toEqual(['ERR_BLUETOOTH_OFF']);
    expect(session.running).toBe(false);
  });

  it('a refused start rejects and leaves the session stopped', async () => {
    const { native, session } = harness(okokProtocol);
    native.failing.add('scan');
    await expect(session.start()).rejects.toBeDefined();
    expect(session.running).toBe(false);
  });
});

// Frames of the owner's HAN RIVER HRTZC01 weigh-in under a fake key (see tuyaBeacon.test.ts): sn 19 = 107.5 kg, sn 20 and 21 = 108.6 kg.
const TUYA_KEY = 'TestKey012345678';
const TUYA = { sn19: '05dc2353dce19500000013634307f6b1f76cf27e071f7e605a1dc1', sn20: '05dc2353dce195000000147ae0e1e1c8536c607b66042e7eac39b1', sn21: '05dc2353dce195000000150211f8168321f2c38c7e6b28085eb05a' };
const tuyaAdv = (hex: string, ts: number) => ({ ...adv({ d007: hex }), ts });

describe('WeighSession with a Tuya beacon scale (local key)', () => {
  it('saves the settled 108.6 kg once: live while it settles, final when the next sn repeats it', async () => {
    const { native, session, log } = harness(tuyaBeaconProtocol, { t: 1_000 }, TUYA_KEY);
    await session.start();
    native.emit('onScaleAdvertisement', tuyaAdv(TUYA.sn19, 0));
    native.emit('onScaleAdvertisement', tuyaAdv(TUYA.sn20, 20_000));
    native.emit('onScaleAdvertisement', tuyaAdv(TUYA.sn20, 20_300));
    expect(log.final).toHaveLength(0);
    expect(log.live.map((r) => r.weightKg)).toEqual([107.5, 108.6, 108.6]);
    native.emit('onScaleAdvertisement', tuyaAdv(TUYA.sn21, 37_000));
    expect(log.final.map((f) => f.r)).toEqual([{ weightKg: 108.6, stable: true }]);
    native.emit('onScaleAdvertisement', tuyaAdv(TUYA.sn21, 37_300));
    expect(log.final).toHaveLength(1);
    session.stop();
  });

  it('reads nothing with a wrong key and without one', async () => {
    for (const secret of ['TestKey012345679', undefined]) {
      const { native, session, log } = harness(tuyaBeaconProtocol, { t: 1_000 }, secret);
      await session.start();
      for (const [i, hex] of [TUYA.sn20, TUYA.sn21].entries()) native.emit('onScaleAdvertisement', tuyaAdv(hex, i * 1000));
      expect(log.live).toHaveLength(0);
      expect(log.final).toHaveLength(0);
      session.stop();
    }
  });

  it('ignores another scale\'s beacons', async () => {
    const { native, session, log } = harness(tuyaBeaconProtocol, { t: 1_000 }, TUYA_KEY);
    await session.start();
    native.emit('onScaleAdvertisement', { ...tuyaAdv(TUYA.sn20, 0), id: '11:22:33:44:55:66' });
    expect(log.live).toHaveLength(0);
    session.stop();
  });
});

const fakeGatt: GattProtocol = {
  kind: 'gatt',
  id: 'fake-gatt',
  label: 'Fake',
  brands: [],
  source: [],
  matches: () => true,
  createSession: () => ({
    start: () => ({
      actions: [
        { op: 'subscribe', service: 'ffe0', characteristic: 'ffe1' },
        { op: 'write', service: 'ffe5', characteristic: 'ffe9', hex: '1309', withResponse: false },
      ],
      readings: [],
    }),
    onValue: (_s, _c, hex) =>
      hex === 'aa'
        ? { actions: [], readings: [{ weightKg: 70.1, stable: false }] }
        : { actions: [], readings: [{ weightKg: 70.1, stable: true, impedanceOhm: 500 }], done: true },
  }),
};

describe('WeighSession with a connected scale', () => {
  it('waits for the advertisement, connects, runs the handshake, saves the weigh-in and goes back to waiting', async () => {
    const { native, session, log } = harness(fakeGatt);
    await session.start();
    expect(native.calls).toEqual(['scan AA:BB:CC:DD:EE:FF fast']);

    native.emit('onScaleAdvertisement', adv({}));
    await tick();
    expect(native.calls.at(-1)).toBe(`connect ${ID}`);
    expect(log.statuses.at(-1)).toBe('connecting');

    native.emit('onScaleLink', { id: ID, state: 'connected', error: null, services: [{ uuid: 'ffe0', characteristics: [{ uuid: 'ffe1', properties: ['notify'] }] }] });
    await tick();
    expect(native.calls.slice(-2)).toEqual(['subscribe ffe0/ffe1', 'write ffe5/ffe9 1309']);
    expect(native.writes[0]).toEqual({ service: 'ffe5', characteristic: 'ffe9', hex: '1309', withResponse: false });

    native.emit('onScaleValue', { id: ID, ts: 5, service: 'ffe0', characteristic: 'ffe1', value: 'aa' });
    await tick();
    expect(log.live.map((r) => r.weightKg)).toEqual([70.1]);
    native.emit('onScaleValue', { id: ID, ts: 6, service: 'ffe0', characteristic: 'ffe1', value: 'bb' });
    await tick();
    expect(log.final.map((f) => f.r.weightKg)).toEqual([70.1]);
    // `done` drops the link and the session waits for the next step-on.
    expect(native.calls.at(-1)).toBe(`disconnect ${ID}`);
    expect(log.statuses.at(-1)).toBe('waiting');
    expect(log.traces).toContain('tx ffe5/ffe9 1309');
    expect(log.traces).toContain('rx ffe0/ffe1 bb');
    session.stop();
  });

  it('a failing optional operation is traced and skipped, the handshake continues', async () => {
    const { native, session, log } = harness(fakeGatt);
    await session.start();
    native.emit('onScaleAdvertisement', adv({}));
    await tick();
    native.failing.add('subscribe');
    native.emit('onScaleLink', { id: ID, state: 'connected', error: null, services: [] });
    await tick();
    expect(native.writes).toHaveLength(1);
    expect(log.traces.some((t) => t.startsWith('error subscribe ffe0/ffe1 failed'))).toBe(true);
    session.stop();
  });

  it('a link that drops without a reading returns to waiting and tries again on the next advertisement', async () => {
    const { native, session, log } = harness(fakeGatt);
    await session.start();
    native.emit('onScaleAdvertisement', adv({}));
    await tick();
    native.emit('onScaleLink', { id: ID, state: 'disconnected', error: 'Link ended', services: [] });
    await tick();
    expect(log.statuses.at(-1)).toBe('waiting');
    native.emit('onScaleAdvertisement', adv({}));
    await tick();
    expect(native.calls.filter((c) => c.startsWith('connect')).length).toBe(2);
    session.stop();
  });

  it('does not connect twice while a link is up', async () => {
    const { native, session } = harness(fakeGatt);
    await session.start();
    native.emit('onScaleAdvertisement', adv({}));
    native.emit('onScaleAdvertisement', adv({}));
    await tick();
    expect(native.calls.filter((c) => c.startsWith('connect')).length).toBe(1);
    session.stop();
  });
});
