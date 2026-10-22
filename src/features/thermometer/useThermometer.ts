import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { removeSensor, saveSensor, updateSensorInfo, type SavedSensor } from '@/features/sensors/store';

import { parseBindkey } from '@/features/sensors/miBeacon';

import { checkBindkey, readingFromFrames, type BindkeyCheck, type FoundThermometer } from './discovery';
import { envVersion, pairingVersion, useEnvVersion, usePairingVersion } from './events';
import type { GattFailure, GattResult } from './gattRead';
import { readGattNow } from './gattRuntime';
import type { RoomLink } from './link';
import { roomLink } from './linkStore';
import { roomCaptureNative } from './native';
import { readProblem, setReadProblem } from './readStatus';
import { deleteEnvSamples, insertEnvSample, latestEnvSample, listThermometers, type EnvSample } from './store';

/** What happened to a typed-in bind key: kept, not a key, or why the unit's frames did not open with it. */
export type BindkeyPairResult = 'saved' | 'invalid' | Exclude<BindkeyCheck, 'ok'>;

export interface ThermometerState {
  /** The paired thermometer; null when none. */
  sensor: SavedSensor | null;
  /** Its newest stored reading. */
  last: EnvSample | null;
  loaded: boolean;
  /** How it is read (`advert` for every pairing made before stock firmware was supported). */
  link: RoomLink;
  /** Why the newest connected read failed (link `gatt`), null when it worked or none ran. */
  problem: GattFailure | null;
  /** Makes this device the room thermometer (replacing an earlier one, whose readings stay: same room). */
  pair: (found: FoundThermometer) => Promise<void>;
  /** Pairs a stock-firmware unit read over a connection: reads one sample first and pairs only when it worked. */
  pairGatt: (found: FoundThermometer) => Promise<GattResult>;
  /** Pairs a stock-firmware unit read from its encrypted broadcasts: the key must open a frame the unit broadcast, then it is kept in the secure store. */
  pairBindkey: (found: FoundThermometer, text: string) => Promise<BindkeyPairResult>;
  /** Reads the connected-read thermometer now; null when it has none or the app has no reader yet. */
  readNow: () => Promise<GattResult | null>;
  /** Forgets the thermometer, deletes its readings from this phone and stops the overnight scan. */
  forget: () => Promise<void>;
}

/** A thermometer that advertises no name still needs a label; the id's tail tells two apart. */
const unnamed = (id: string): string => id.slice(-5);

/** The paired bedroom thermometer and its last reading, kept current while screens read it. */
export function useThermometer(): ThermometerState {
  const db = useSQLiteContext();
  const pairing = usePairingVersion();
  const env = useEnvVersion();
  const [state, setState] = useState<{ sensor: SavedSensor | null; last: EnvSample | null; loaded: boolean; link: RoomLink; problem: GattFailure | null }>({
    sensor: null,
    last: null,
    loaded: false,
    link: 'advert',
    problem: null,
  });

  useEffect(() => {
    let live = true;
    void (async () => {
      const [sensor] = await listThermometers(db);
      const last = sensor ? await latestEnvSample(db, sensor.id) : null;
      if (live) setState({ sensor: sensor ?? null, last, loaded: true, link: sensor ? roomLink.get(sensor.id) : 'advert', problem: sensor ? readProblem(sensor.id) : null });
    })();
    return () => {
      live = false;
    };
  }, [db, pairing, env]);

  /** Saves `found` as the room thermometer in the given way, replacing an earlier one (whose readings stay: same room). */
  const replaceWith = useCallback(
    async (found: FoundThermometer, link: RoomLink, now: number) => {
      for (const old of await listThermometers(db)) {
        if (old.id === found.id) continue;
        await removeSensor(db, old.id);
        await roomLink.forget(old.id);
      }
      await saveSensor(db, { id: found.id, name: found.name ?? unnamed(found.id), kinds: ['thermometer'] }, now);
      roomLink.set(found.id, link);
    },
    [db],
  );

  const storeFirst = useCallback(
    async (id: string, sample: { tempC: number; rhPct: number; batteryPct: number | null }, now: number) => {
      await insertEnvSample(db, { sensorId: id, ts: now, tempC: sample.tempC, rhPct: sample.rhPct, batteryPct: sample.batteryPct });
      await updateSensorInfo(db, id, { seenAt: now, ...(sample.batteryPct !== null ? { battery: sample.batteryPct } : {}) });
    },
    [db],
  );

  const pair = useCallback(
    async (found: FoundThermometer) => {
      const now = Date.now();
      await replaceWith(found, 'advert', now);
      await roomLink.deleteBindkey(found.id).catch(() => {});
      // What the picker just read is the first reading, so the card has one at once.
      if (found.reading) await storeFirst(found.id, found.reading, now);
      pairingVersion.bump();
      envVersion.bump();
    },
    [replaceWith, storeFirst],
  );

  const pairGatt = useCallback(
    async (found: FoundThermometer): Promise<GattResult> => {
      const read = readGattNow(found.id);
      const result: GattResult = read ? await read : { ok: false, reason: 'error', detail: 'reader not ready' }; // i18n-ok: log detail, never shown
      if (!result.ok) return result;
      const now = Date.now();
      await replaceWith(found, 'gatt', now);
      await roomLink.deleteBindkey(found.id).catch(() => {});
      await storeFirst(found.id, result.sample, now);
      setReadProblem(found.id, null);
      pairingVersion.bump();
      envVersion.bump();
      return result;
    },
    [replaceWith, storeFirst],
  );

  const pairBindkey = useCallback(
    async (found: FoundThermometer, text: string): Promise<BindkeyPairResult> => {
      const bindkey = parseBindkey(text);
      if (bindkey === null) return 'invalid';
      const check = checkBindkey(found, bindkey);
      if (check !== 'ok') return check;
      const now = Date.now();
      await replaceWith(found, 'bindkey', now);
      await roomLink.saveBindkey(found.id, bindkey);
      const reading = readingFromFrames(found, bindkey, now);
      if (reading) await storeFirst(found.id, reading, now);
      pairingVersion.bump();
      envVersion.bump();
      return 'saved';
    },
    [replaceWith, storeFirst],
  );

  const readNow = useCallback(async (): Promise<GattResult | null> => {
    const [sensor] = await listThermometers(db);
    return sensor && roomLink.get(sensor.id) === 'gatt' ? (readGattNow(sensor.id) ?? null) : null;
  }, [db]);

  const forget = useCallback(async () => {
    for (const old of await listThermometers(db)) {
      await removeSensor(db, old.id);
      await deleteEnvSamples(db, old.id);
      await roomLink.forget(old.id);
      setReadProblem(old.id, null);
    }
    await roomCaptureNative()?.stopRoomCapture().catch(() => {});
    pairingVersion.bump();
    envVersion.bump();
  }, [db]);

  return { ...state, pair, pairGatt, pairBindkey, readNow, forget };
}
