import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { removeSensor, saveSensor, updateSensorInfo, type SavedSensor } from '@/features/sensors/store';

import type { FoundThermometer } from './discovery';
import { envVersion, pairingVersion, useEnvVersion, usePairingVersion } from './events';
import { roomCaptureNative } from './native';
import { deleteEnvSamples, insertEnvSample, latestEnvSample, listThermometers, type EnvSample } from './store';

export interface ThermometerState {
  /** The paired thermometer; null when none. */
  sensor: SavedSensor | null;
  /** Its newest stored reading. */
  last: EnvSample | null;
  loaded: boolean;
  /** Makes this device the room thermometer (replacing an earlier one, whose readings stay: same room). */
  pair: (found: FoundThermometer) => Promise<void>;
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
  const [state, setState] = useState<{ sensor: SavedSensor | null; last: EnvSample | null; loaded: boolean }>({ sensor: null, last: null, loaded: false });

  useEffect(() => {
    let live = true;
    void (async () => {
      const [sensor] = await listThermometers(db);
      const last = sensor ? await latestEnvSample(db, sensor.id) : null;
      if (live) setState({ sensor: sensor ?? null, last, loaded: true });
    })();
    return () => {
      live = false;
    };
  }, [db, pairing, env]);

  const pair = useCallback(
    async (found: FoundThermometer) => {
      const now = Date.now();
      for (const old of await listThermometers(db)) if (old.id !== found.id) await removeSensor(db, old.id);
      await saveSensor(db, { id: found.id, name: found.name ?? unnamed(found.id), kinds: ['thermometer'] }, now);
      // What the picker just read is the first reading, so the card has one at once.
      if (found.reading) {
        await insertEnvSample(db, { sensorId: found.id, ts: now, tempC: found.reading.tempC, rhPct: found.reading.rhPct, batteryPct: found.reading.batteryPct });
        await updateSensorInfo(db, found.id, { seenAt: now, ...(found.reading.batteryPct !== null ? { battery: found.reading.batteryPct } : {}) });
      }
      pairingVersion.bump();
      envVersion.bump();
    },
    [db],
  );

  const forget = useCallback(async () => {
    for (const old of await listThermometers(db)) {
      await removeSensor(db, old.id);
      await deleteEnvSamples(db, old.id);
    }
    await roomCaptureNative()?.stopRoomCapture().catch(() => {});
    pairingVersion.bump();
    envVersion.bump();
  }, [db]);

  return { ...state, pair, forget };
}
