import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { scaleHub } from '@/features/scale/instance';
import type { AdFrame } from '@/features/scale/types';
import { updateSensorInfo } from '@/features/sensors/store';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';

import { startNightCapture } from './capture';
import { GattPoller } from './gattPoller';
import { readLywsdOnce } from './gattRead';
import { setGattPoller } from './gattRuntime';
import { roomLink } from './linkStore';
import { keepsMiBeacon } from './roomNative';
import { setReadProblem } from './readStatus';
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
 * - **Stock Xiaomi firmware** (set up in Settings): with a bind key the same scan reads its encrypted MiBeacon frames (and the overnight
 *   scan keeps them when this build supports it, `keepsMiBeacon`); without a key a connected read every 10 minutes (`GattPoller`) takes
 *   one sample, only while the app is open and in the foreground.
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
    /** The sensors read over a connection right now; a result for any other id (a pairing in progress) is the caller's to store. */
    let gattIds = new Set<string>();

    const poller = new GattPoller({
      now: Date.now,
      read: (id) => readLywsdOnce(scaleHub.native, id),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onResult: async (id, result, at) => {
        if (!gattIds.has(id)) return;
        if (!result.ok) {
          setReadProblem(id, result.reason);
          log('info', `Thermometer: connected read failed (${result.reason})`);
          return;
        }
        setReadProblem(id, null);
        const { sample } = result;
        try {
          if (await insertEnvSample(db, { sensorId: id, ts: at, tempC: sample.tempC, rhPct: sample.rhPct, batteryPct: sample.batteryPct })) {
            await updateSensorInfo(db, id, { seenAt: at, battery: sample.batteryPct });
            envVersion.bump();
          }
        } catch (e) {
          log('error', `Thermometer: ${errorMessage(e)}`);
        }
      },
    });
    setGattPoller(poller);

    const stopScan = () => {
      release?.();
      release = null;
    };

    const stopListening = () => {
      stopScan();
      poller.stop();
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
      const all = thermometers.map((s) => s.id);
      thermometerSampler.setPaired(all);
      gattIds = new Set(all.filter((id) => roomLink.get(id) === 'gatt'));
      const keyed: string[] = [];
      for (const id of all) {
        const link = roomLink.get(id);
        const bindkey = link === 'bindkey' ? await roomLink.loadBindkey(id).catch(() => null) : null;
        thermometerSampler.setBindkey(id, bindkey);
        if (bindkey !== null) keyed.push(id);
      }
      if (!alive) return;
      // Heard in advertisements: community firmware and bind-key sensors. A connected-read sensor is never scanned for.
      const heard = all.filter((id) => !gattIds.has(id) && (roomLink.get(id) === 'advert' || keyed.includes(id)));
      if (all.length === 0) {
        stopListening();
        return;
      }
      const lastSamples = new Map<string, number>();
      for (const id of all) {
        const last = await latestEnvSample(db, id);
        if (last) {
          thermometerSampler.seed(id, last.ts);
          lastSamples.set(id, last.ts);
        }
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
          // A stock-firmware sensor is heard overnight only by a build whose scan keeps MiBeacon frames.
          const overnightIds = heard.filter((id) => roomLink.get(id) === 'advert' || keepsMiBeacon(overnight));
          const end = getAutoArm() && overnightIds.length > 0 ? autoArmEnd(new Date(), getWakeHour(), await overnight.roomCaptureState()) : null;
          if (end !== null && (await scanPermissionsGranted())) {
            await startNightCapture(overnight, overnightIds, end);
            log('info', 'Thermometer: overnight scan started');
          }
        } catch (e) {
          log('error', `Thermometer overnight scan: ${errorMessage(e)}`);
        }
      }
      if (heard.length > 0) await listen(heard);
      else stopScan();
      if (gattIds.size > 0 && AppState.currentState === 'active' && (await scanPermissionsGranted()) && alive) poller.start([...gattIds], lastSamples);
      else poller.stop();
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
      setGattPoller(null);
    };
  }, [db, pairing]);
}
