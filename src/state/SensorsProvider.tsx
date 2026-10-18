import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { type SensorKind } from '@/features/sensors/gatt';
import { type HubSnapshot } from '@/features/sensors/hub';
import { sensorHub } from '@/features/sensors/instance';
import { ensureSensorPermissions, type Granted } from '@/features/sensors/permissions';
import { getWheelMm } from '@/features/sensors/settings';
import {
  listSensors,
  removeSensor,
  renameSensor,
  saveSensor,
  setSensorAutoConnect,
  updateSensorInfo,
  type SavedSensor,
} from '@/features/sensors/store';

export interface SensorsContextValue {
  /** The sensors the person paired, in pairing order. Empty until `loaded`. */
  saved: SavedSensor[];
  loaded: boolean;
  /** Bluetooth state, scan results and live link state of every sensor the radio knows (see `HubSnapshot`). */
  hub: HubSnapshot;
  /**
   * Starts a scan for sensors. Asks for the Bluetooth permission first and resolves with what the person answered; the scan
   * only starts on `granted`. Results arrive in `hub.results`; it stops by itself after 20 s.
   */
  startScan: () => Promise<Granted>;
  stopScan: () => Promise<void>;
  /** Remembers a scan result and connects to it at once (so its battery shows). */
  pair: (found: { id: string; name: string | null; kinds: SensorKind[] }) => Promise<void>;
  rename: (id: string, alias: string) => Promise<void>;
  /** Forgets the sensor and drops its link. */
  remove: (id: string) => Promise<void>;
  setAutoConnect: (id: string, on: boolean) => Promise<void>;
  /**
   * Connects one paired sensor (a "Connect" button); the link keeps itself up afterwards until `disconnect`. Asks for the Bluetooth
   * permission first and resolves with the answer; it connects only on `granted`.
   */
  connect: (id: string) => Promise<Granted>;
  disconnect: (id: string) => Promise<void>;
}

const SensorsContext = createContext<SensorsContextValue | null>(null);

export function useSensors(): SensorsContextValue {
  const value = useContext(SensorsContext);
  if (!value) throw new Error('useSensors must be used inside <SensorsProvider>');
  return value;
}

/** A sensor that advertises no name still needs a label to show; the platform id's tail tells two of them apart. */
const unnamed = (id: string): string => id.slice(-5);

/**
 * Paired sensors from the database and the live radio state from the sensor hub, as one context. Battery, manufacturer and model
 * the sensors report are written back to the paired row. The radio links themselves are started by the screens that need them (a
 * sensor's "Connect") and by a recording (`RecorderProvider`), never at app start.
 */
export function SensorsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const hub = useSyncExternalStore(sensorHub.subscribe, sensorHub.getSnapshot);
  const [saved, setSaved] = useState<SavedSensor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const live = useRef(true);

  const reload = useCallback(async () => {
    const rows = await listSensors(db);
    if (live.current) {
      setSaved(rows);
      setLoaded(true);
    }
  }, [db]);

  useEffect(() => {
    live.current = true;
    sensorHub.setWheelCircumferenceM(getWheelMm() / 1000);
    void sensorHub.start();
    void reload();
    const off = sensorHub.onInfo((info) => {
      void updateSensorInfo(db, info.id, { ...info, seenAt: Date.now() }).then(reload);
    });
    return () => {
      live.current = false;
      off();
    };
  }, [db, reload]);

  const startScan = useCallback(async (): Promise<Granted> => {
    const permission = await ensureSensorPermissions();
    if (permission !== 'granted') return permission;
    await sensorHub.startScan();
    return 'granted';
  }, []);

  const value = useMemo<SensorsContextValue>(
    () => ({
      saved,
      loaded,
      hub,
      startScan,
      stopScan: () => sensorHub.stopScan(),
      pair: async (found) => {
        await saveSensor(db, { id: found.id, name: found.name ?? unnamed(found.id), kinds: found.kinds }, Date.now());
        await reload();
        await sensorHub.connect(found.id);
      },
      rename: async (id, alias) => {
        await renameSensor(db, id, alias);
        await reload();
      },
      remove: async (id) => {
        await sensorHub.disconnect(id).catch(() => {});
        await removeSensor(db, id);
        await reload();
      },
      setAutoConnect: async (id, on) => {
        await setSensorAutoConnect(db, id, on);
        await reload();
      },
      connect: async (id) => {
        const permission = await ensureSensorPermissions();
        if (permission === 'granted') await sensorHub.connect(id);
        return permission;
      },
      disconnect: (id) => sensorHub.disconnect(id),
    }),
    [db, hub, loaded, reload, saved, startScan],
  );

  return <SensorsContext.Provider value={value}>{children}</SensorsContext.Provider>;
}

