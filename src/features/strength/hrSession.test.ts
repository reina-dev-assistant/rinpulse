import { afterEach, describe, expect, it } from 'bun:test';

import type { ValueEvent, WorkoutSessionOptions } from '../../../modules/ble-sensors/src/BleSensors.types';
import { ensureRecordingSchema } from '../record/journal';
import { openDb } from '../record/testDb';
import { bytesToHex } from '../sensors/gatt';
import { HR_FLUSH_SEC, loadHrJournal, saveHrJournal } from './hr';
import { StrengthHrSession } from './hrSession';

const T0 = 1_760_000_000_000;
const profile = { weightKg: 70, age: 35, sex: 'male' as const };
const finished = { exercises: [], durationSec: 600 };
const strap = { id: 'AA:BB', name: 'Polar H10', kinds: ['hr' as const] };
const hex = (bpm: number) => bytesToHex(new Uint8Array([0x00, bpm]));

class Fake {
  listeners: ((e: ValueEvent) => void)[] = [];
  connects: string[] = [];
  disconnects: string[] = [];
  starts: WorkoutSessionOptions[] = [];
  ends = 0;
  failConnect: string | null = null;
  failSession: string | null = null;
  logs: string[] = [];
  now = T0;
  onValue(l: (e: ValueEvent) => void) {
    this.listeners.push(l);
    return () => (this.listeners = this.listeners.filter((x) => x !== l));
  }
  async connect(id: string) {
    if (this.failConnect) throw Object.assign(new Error('bt'), { code: this.failConnect });
    this.connects.push(id);
  }
  async disconnect(id: string) {
    this.disconnects.push(id);
  }
  async start(o: WorkoutSessionOptions) {
    if (this.failSession) throw Object.assign(new Error('fgs'), { code: this.failSession });
    this.starts.push(o);
  }
  async end() {
    this.ends += 1;
  }
  emit(id: string, bpm: number, ts = this.now) {
    for (const l of this.listeners) l({ id, ts, service: '180d', characteristic: '2a37', value: hex(bpm) });
  }
}

const open = async () => {
  const fake = new Fake();
  const { db, all } = openDb();
  await ensureRecordingSchema(db as never);
  const session = new StrengthHrSession({ hub: fake, session: fake, now: () => fake.now, log: (m) => fake.logs.push(m) });
  const begin = (workoutId = 'w1') => session.begin({ db, workoutId, sensor: strap, title: 'Strength', text: 'Recording heart rate' });
  return { fake, db, all, session, begin };
};

/** One second of the session's clock with the strap sending a value each second. */
function seconds(fake: Fake, session: StrengthHrSession, n: number, bpm: (i: number) => number) {
  for (let i = 0; i < n; i++) {
    fake.emit(strap.id, bpm(i));
    session.tick();
    fake.now += 1000;
  }
}

let open_: StrengthHrSession | null = null;
afterEach(async () => {
  await open_?.end();
  open_ = null;
});

describe('StrengthHrSession', () => {
  it('connects the strap, starts the native session without GPS and reports the live heart rate', async () => {
    const { fake, session, begin } = await open();
    open_ = session;
    await begin();
    expect(fake.connects).toEqual([strap.id]);
    expect(fake.starts).toEqual([{ title: 'Strength', text: 'Recording heart rate', gps: false }]);
    expect(session.getSnapshot()).toEqual({ workoutId: 'w1', sensorId: strap.id, hr: null, error: null });
    fake.emit(strap.id, 111);
    session.tick();
    expect(session.getSnapshot().hr).toBe(111);
  });

  it('samples every 5 seconds and hands the finished workout its heart rate', async () => {
    const { fake, session, begin } = await open();
    open_ = session;
    await begin();
    seconds(fake, session, 31, (i) => 100 + i);
    const result = session.result(finished, profile);
    expect(result?.samples.map((s) => s.ts - T0 / 1000)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(result).toMatchObject({ minHr: 100, maxHr: 130, avgHr: 115, sensors: [strap], kcal: null });
  });

  it('ignores other sensors and has no result when the strap never sent a heart rate', async () => {
    const { fake, session, begin } = await open();
    open_ = session;
    await begin();
    fake.emit('OTHER', 150);
    session.tick();
    expect(session.getSnapshot().hr).toBeNull();
    expect(session.result(finished, profile)).toBeNull();
  });

  it('takes no samples while the stopwatch is paused', async () => {
    const { fake, session, begin } = await open();
    open_ = session;
    await begin();
    seconds(fake, session, 6, () => 100);
    session.setPaused(true);
    seconds(fake, session, 30, () => 100);
    session.setPaused(false);
    seconds(fake, session, 6, () => 100);
    // before the pause: 0 s and 5 s; after: the first tick after resuming is >= 5 s since the last sample
    expect(session.result(finished, profile)?.samples).toHaveLength(4);
  });

  it('journals the samples every 15 seconds and restores them for the same workout', async () => {
    const { fake, db, session, begin } = await open();
    open_ = session;
    await begin();
    seconds(fake, session, HR_FLUSH_SEC, () => 120);
    await session.settled();
    const journaled = await loadHrJournal(db, 'w1');
    expect(journaled?.map((s) => s.ts - T0 / 1000)).toEqual([0, 5, 10]);

    // the app was killed and reopened: a new session object for the same workout continues with those samples
    const again = new StrengthHrSession({ hub: fake, session: fake, now: () => fake.now });
    await again.begin({ db, workoutId: 'w1', sensor: strap, title: 'Strength', text: 'x' });
    expect(again.result(finished, profile)?.samples).toEqual(journaled ?? []);
    await again.end();
  });

  it('does not restore the journal of another workout', async () => {
    const { fake, db, session, begin } = await open();
    open_ = session;
    await saveHrJournal(db, [{ ts: T0 / 1000, hr: 99 }], { workoutId: 'wold', sensorId: strap.id }, T0);
    await begin('wnew');
    fake.emit(strap.id, 120);
    session.tick();
    expect(session.result(finished, profile)?.samples).toEqual([{ ts: T0 / 1000, hr: 120 }]);
  });

  it('is started once per workout, and a session of another workout ends first', async () => {
    const { fake, session, begin } = await open();
    open_ = session;
    await begin('w1');
    await begin('w1');
    expect(fake.connects).toEqual([strap.id]);
    await begin('w2');
    expect(fake.disconnects).toEqual([strap.id]);
    expect(fake.ends).toBe(1);
    expect(fake.connects).toEqual([strap.id, strap.id]);
    expect(session.getSnapshot().workoutId).toBe('w2');
  });

  it('ends with the native session, the strap link and the journal', async () => {
    const { fake, db, all, session, begin } = await open();
    await begin();
    seconds(fake, session, HR_FLUSH_SEC, () => 120);
    await session.end();
    expect(fake.disconnects).toEqual([strap.id]);
    expect(fake.ends).toBe(1);
    expect(fake.listeners).toEqual([]);
    expect(session.getSnapshot().workoutId).toBeNull();
    expect(session.result(finished, profile)).toBeNull();
    expect(await loadHrJournal(db, 'w1')).toBeNull();
    expect(all('SELECT * FROM recording_state')).toEqual([]);
    // ending again is harmless
    await session.end();
    expect(fake.ends).toBe(1);
  });

  it('carries on without the foreground service when Android refuses it, without a log line', async () => {
    const { fake, session, begin } = await open();
    open_ = session;
    fake.failSession = 'ERR_SERVICE_NOT_ALLOWED';
    await begin();
    expect(fake.connects).toEqual([strap.id]);
    expect(fake.logs).toEqual([]);
  });

  it('keeps the workout going and reports the code when the strap cannot connect', async () => {
    const { fake, session, begin } = await open();
    open_ = session;
    fake.failConnect = 'ERR_BLUETOOTH_OFF';
    await begin();
    expect(session.getSnapshot()).toMatchObject({ workoutId: 'w1', error: 'ERR_BLUETOOTH_OFF' });
  });
});
