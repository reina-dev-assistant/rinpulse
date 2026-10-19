import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { shouldRefreshOtaAtLaunch } from '@/features/updates/forceUpdatePolicy';
import { otaPercent, otaPhase, otaSource } from '@/features/updates/otaPolicy';
import { parseTimestamp } from '@/features/updates/updatePolicy';

/** True in a release build that embeds expo-updates; false in dev clients and Expo Go. */
export const OTA_ENABLED = Platform.OS !== 'web' && Updates.isEnabled;

/**
 * Asks the update server for a newer JS bundle and downloads it. The launch-time check is done by
 * expo-updates itself (`checkAutomatically: ON_LOAD`); this is for the manual button and the foreground
 * re-check. A downloaded update waits for the next cold start, or `restartOta()`. Any failure leaves the
 * running bundle (and the one already cached) untouched. Resolves true when a bundle is downloaded and waits for a
 * restart; `onDownloading` runs when the server has one and the download starts.
 */
export async function checkAndFetchOta(onDownloading?: () => void): Promise<boolean> {
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable && !check.isRollBackToEmbedded) return false;
  onDownloading?.();
  const fetched = await Updates.fetchUpdateAsync();
  return fetched.isNew || fetched.isRollBackToEmbedded;
}

const LAUNCH_RELOAD_KEY = 'joyofit_launch_ota_reload_at';

/**
 * Cold-start freshness (docs/force-update.md): look for a newer JS bundle for this runtime and, if there is one,
 * download it and reload into it before the app is shown. Waits at most `timeoutMs`; after that the app opens on
 * the bundle it has and a later reload is cancelled (the download may still finish: the banner offers the restart,
 * or the next cold start applies it). Never throws. `onDownloading` runs when an update is found.
 */
export async function refreshOtaAtLaunch(timeoutMs: number, onDownloading: () => void): Promise<void> {
  if (!OTA_ENABLED || timeoutMs <= 0) return;
  const lastReload = parseTimestamp(await SecureStore.getItemAsync(LAUNCH_RELOAD_KEY).catch(() => null));
  if (!shouldRefreshOtaAtLaunch(lastReload, Date.now())) return;

  let expired = false;
  const work = (async () => {
    const ready = await checkAndFetchOta(onDownloading);
    if (!ready || expired) return;
    await SecureStore.setItemAsync(LAUNCH_RELOAD_KEY, String(Date.now())).catch(() => {});
    await restartOta();
    // The reload is under way: keep the app hidden until it lands (the deadline frees us if it never does).
    await new Promise<void>(() => {});
  })().catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
    }, timeoutMs);
  });
  await Promise.race([work, deadline]);
  clearTimeout(timer);
}

/** Reloads into the downloaded update (or the embedded bundle after a rollback). */
export async function restartOta(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    // Reload refused (no pending update, updates disabled): the app just keeps running.
  }
}

/** OTA state for the About screen and the banner. Shares expo-updates' global state across callers. */
export function useOtaUpdate() {
  const state = Updates.useUpdates();
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    if (!OTA_ENABLED) return;
    setFailed(false);
    try {
      await checkAndFetchOta();
    } catch {
      setFailed(true);
    }
  }, []);

  const phase = otaPhase({
    enabled: OTA_ENABLED,
    isChecking: state.isChecking,
    isDownloading: state.isDownloading,
    isUpdatePending: state.isUpdatePending,
    hasError: failed || Boolean(state.checkError ?? state.downloadError),
  });
  const running = state.currentlyRunning;

  return {
    phase,
    percent: otaPercent(state.downloadProgress),
    source: otaSource(running.isEmbeddedLaunch, running.isEmergencyLaunch),
    updateId: running.updateId ?? null,
    createdAt: running.createdAt ?? null,
    runtimeVersion: running.runtimeVersion ?? null,
    channel: running.channel ?? null,
    check,
    restart: restartOta,
  };
}
