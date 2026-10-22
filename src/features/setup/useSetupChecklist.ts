import { useFocusEffect } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useState } from 'react';

import { CLOUD_CONFIGURED } from '@/cloud/config';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { useCloud } from '@/state/CloudProvider';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type HealthConnectStatus } from '@/wear';

import { finishedSetup, setupProgress, setupRows, showsSetup, type SetupMemory, type SetupRow } from './checklist';

/** The kv-store key of what the person did with the card; local to this phone like the arrangement of the Today cards. */
const KEY = 'joyofit.today.setup';

function readMemory(): SetupMemory {
  try {
    const value = Storage.getItemSync(KEY);
    return value === 'dismissed' || value === 'complete' ? value : null;
  } catch {
    return null;
  }
}

function remember(value: Exclude<SetupMemory, null>): void {
  try {
    Storage.setItemSync(KEY, value);
  } catch {
    // The card just shows again next time.
  }
}

export interface SetupChecklist {
  rows: SetupRow[];
  done: number;
  total: number;
  dismiss: () => void;
}

/**
 * The checklist's rows from the app's own state, or null when the card should not show: the person hid it, every row was seen done,
 * or what decides a row (the Health Connect / Apple Health state) has not been read yet, which would make a row pop in a moment later.
 */
export function useSetupChecklist(): SetupChecklist | null {
  const presence = useWatchPresence();
  const { lastSync } = useWatch();
  const cloud = useCloud();
  const [memory, setMemory] = useState<SetupMemory>(readMemory);
  const [store, setStore] = useState<HealthConnectStatus | 'error' | null>(null);
  const [profileSaved, setProfileSaved] = useState(() => HuaweiWear.getUserProfile() !== null);

  const refreshStore = useCallback(() => {
    HuaweiWear.getHealthConnectStatus().then(setStore, () => setStore('error'));
  }, []);
  useNativeRefresh(refreshStore);
  useFocusEffect(
    useCallback(() => {
      setProfileSaved(HuaweiWear.getUserProfile() !== null);
    }, []),
  );

  const loaded = store !== null && presence !== null;
  const rows = loaded
    ? setupRows({
        paired: presence === 'watch',
        synced: lastSync !== null,
        healthStoreOn: store === 'error' || store.availability === 'unavailable' ? null : store.enabled && store.granted.length > 0,
        signedIn: CLOUD_CONFIGURED ? cloud.signedIn : null,
        profileSaved,
      })
    : [];

  const finished = finishedSetup(rows, memory);
  useEffect(() => {
    if (!finished) return;
    // The card is already gone (no row is pending); this makes it stay gone if a row is undone later.
    remember('complete');
  }, [finished]);

  const dismiss = useCallback(() => {
    remember('dismissed');
    setMemory('dismissed');
  }, []);

  if (!loaded || !showsSetup(rows, memory)) return null;
  return { rows, ...setupProgress(rows), dismiss };
}
