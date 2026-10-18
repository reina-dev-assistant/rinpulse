import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { useCallback, useEffect, useState } from 'react';

import { fetchRegionIndex } from './catalogClient';
import type { DownloadState } from './download';
import { expoFileApi, getDownloadManager } from './fileApi';
import type { MapRegion, RegionIndex } from './regions';
import type { InstalledRegion } from './storage';

export type CatalogState = { status: 'loading' } | { status: 'ready'; index: RegionIndex } | { status: 'failed' };
export type NetworkKind = 'unknown' | 'cellular' | 'offline' | 'other';

export interface OfflineMaps {
  catalog: CatalogState;
  installed: InstalledRegion[];
  state: DownloadState;
  network: NetworkKind;
  /** Free disk space in bytes, read when the screen opens and after each change. */
  freeBytes: number;
  reloadCatalog: () => void;
  download: (region: MapRegion) => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  remove: (id: string) => void;
  acknowledge: () => void;
}

async function readNetwork(): Promise<NetworkKind> {
  try {
    const state = await getNetworkStateAsync();
    if (state.isConnected === false) return 'offline';
    return state.type === NetworkStateType.CELLULAR ? 'cellular' : 'other';
  } catch {
    return 'unknown';
  }
}

/** Settings > Peta offline: catalog, installed regions, the shared download manager's state, network kind and free space. */
export function useOfflineMaps(): OfflineMaps {
  const manager = getDownloadManager();
  const [state, setState] = useState<DownloadState>(() => manager.getState());
  const [installed, setInstalled] = useState<InstalledRegion[]>(() => manager.installed());
  const [freeBytes, setFreeBytes] = useState(() => expoFileApi.freeBytes());
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [network, setNetwork] = useState<NetworkKind>('unknown');
  const [attempt, setAttempt] = useState(0);

  useEffect(
    () =>
      manager.subscribe((next) => {
        setState(next);
        if (next.phase === 'installed' || next.phase === 'cancelled' || next.phase === 'failed' || next.phase === 'idle') {
          setInstalled(manager.installed());
          setFreeBytes(expoFileApi.freeBytes());
        }
      }),
    [manager],
  );

  useEffect(() => {
    let live = true;
    void fetchRegionIndex().then((index) => {
      if (live) setCatalog(index ? { status: 'ready', index } : { status: 'failed' });
    });
    void readNetwork().then((kind) => {
      if (live) setNetwork(kind);
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  return {
    catalog,
    installed,
    state,
    network,
    freeBytes,
    reloadCatalog: useCallback(() => {
      setCatalog({ status: 'loading' });
      setAttempt((n) => n + 1);
    }, []),
    download: useCallback((region: MapRegion) => void manager.start(region), [manager]),
    pause: useCallback(() => void manager.pause(), [manager]),
    resume: useCallback(() => void manager.resume(), [manager]),
    cancel: useCallback(() => manager.cancel(), [manager]),
    remove: useCallback(
      (id: string) => {
        manager.remove(id);
        setInstalled(manager.installed());
        setFreeBytes(expoFileApi.freeBytes());
      },
      [manager],
    ),
    acknowledge: useCallback(() => manager.acknowledge(), [manager]),
  };
}
