import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { scaleHub } from '@/features/scale/instance';
import type { AdFrame } from '@/features/scale/types';
import { updateSensorInfo } from '@/features/sensors/store';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';

import { startNightCapture } from './capture';
import { drainRoomAdverts } from './drain';
import { envVersion, usePairingVersion } from './events';
import { thermometerSampler } from './instance';
import { roomCaptureNative, scanPermissionsGranted } from './native';
import { autoArmEnd } from './nightWindow';
import { getAutoArm, getWakeHour } from './settings';
import { insertEnvSample, latestEnvSample, listThermometers, pruneEnvSamples } from './store';

const log = (direction: 'info' | 'error', message: string) =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message });

/**
 * Keeps the bedroom thermometer's readings coming in while a thermometer is paired, and does nothing without one (no scan, no prompt).
 *
 * - **App open**: a low-power scan of the paired sensor through the shared scale scan (`scaleHub`, iOS and Android), one sample per
 *   five minutes into `env_sample`. It stops when the app goes to the background, and starts only when the Bluetooth permissions are
 *   already granted (pairing asked for them).
 * - **Android store build**: whenever the app comes to the foreground it reads what the overnight scan kept while it was closed, and
 *   in the evening-to-morning window starts that scan by itself (unless turned off in Settings or stopped tonight). On iOS, and on an
 *   Android binary from before the overnight scan, only the foreground scan exists (docs/sleep-insights.md).
 * - Raw samples older than 120 days are deleted.
 *
 * Log lines carry counts only.
 */
export function useRoomCapture(): void {
  const db = useSQLiteContext();
  const pairing = usePairingVersion();

  useEffect(() => {
    let alive = true;
    let release: (() => void) | null = null;
    let starting = false;
    let chain: Promise<void> = Promise.resolve();

    const stopListening = () => {
      release?.();
      release = null;
    };

    const onAdvert = (frame: AdFrame) => {
      const accepted = thermometerSampler.accept(frame);
      if (!accepted) return;
      const { sample } = accepted;
      void (async () => {
        try {
          if (!(await insertEnvSample(db, sample))) return;
          await updateSensorInfo(db, sample.sensorId, { seenAt: sample.ts, ...(sample.batteryPct !== null ? { battery: sample.batteryPct } : {}) });
          envVersion.bump();
        } catch (e) {
          log('error', `Thermometer: ${errorMessage(e)}`);
        }
      })();
    };

    const listen = async (ids: string[]) => {
      if (release || starting || AppState.currentState !== 'active') return;
      starting = true;
      try {
        if (!(await scanPermissionsGranted()) || !alive) return;
        const offAdvert = scaleHub.onAdvertisement(onAdvert);
        const offError = scaleHub.onScanError(() => {});
        try {
          const off = await scaleHub.acquire({ ids, lowLatency: false });
          release = () => {
            offAdvert();
            offError();
            off();
          };
          if (!alive) stopListening();
        } catch {
          // Bluetooth off or the permission taken away: nothing to scan, and the next foreground tries again.
          offAdvert();
          offError();
        }
      } finally {
        starting = false;
      }
    };

    const refresh = async () => {
      const thermometers = await listThermometers(db);
      if (!alive) return;
      const ids = thermometers.map((s) => s.id);
      thermometerSampler.setPaired(ids);
      if (ids.length === 0) {
        stopListening();
        return;
      }
      for (const id of ids) {
        const last = await latestEnvSample(db, id);
        if (last) thermometerSampler.seed(id, last.ts);
      }
      await pruneEnvSamples(db, Date.now());

      const overnight = roomCaptureNative();
      if (overnight) {
        try {
          const stored = await drainRoomAdverts(overnight, thermometerSampler, db);
          if (stored.length > 0) {
            log('info', `Thermometer: stored ${stored.length} sample${stored.length === 1 ? '' : 's'} from the overnight scan`);
            envVersion.bump();
          }
          const end = getAutoArm() ? autoArmEnd(new Date(), getWakeHour(), await overnight.roomCaptureState()) : null;
          if (end !== null && (await scanPermissionsGranted())) {
            await startNightCapture(overnight, ids, end);
            log('info', 'Thermometer: overnight scan started');
          }
        } catch (e) {
          log('error', `Thermometer overnight scan: ${errorMessage(e)}`);
        }
      }
      await listen(ids);
    };

    const schedule = () => {
      chain = chain.then(refresh).catch((e: unknown) => log('error', `Thermometer: ${errorMessage(e)}`));
    };

    schedule();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') schedule();
      else stopListening();
    });
    return () => {
      alive = false;
      sub.remove();
      stopListening();
    };
  }, [db, pairing]);
}
