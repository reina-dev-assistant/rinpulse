import { createContext, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import DeviceInfo from 'react-native-device-info';

import { cloudLog as log } from '@/cloud/log';
import { simplifyRoute, type RoutePoint, type SavedRoute } from '@/features/routes/routeModel';
import { loadRoute } from '@/features/routes/routeStore';
import { useRecorder } from '@/state/RecorderProvider';
import { useSensors } from '@/state/SensorsProvider';
import { userHrZones } from '@/features/hrzones/settings';
import { userEnergyProfile } from '@/features/strength/profile';
import { SPORT_ROWS } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { getFtp } from '@/features/cycling/settings';

import { clearAlertNotification, presentAlert } from './alertPresenter';
import { hasLiveConsent, liveTracker } from './live/liveConfig';
import { elevationStrip } from './nav';
import { BikeSession, type BikeSnapshot } from './session';
import { alertPriority } from './ride/alerts';
import { recordRideDrain } from './ride/batteryStore';
import { SAVER_IDLE, saverAccept, saverDismiss, saverStep, type SaverState } from './ride/saver';
import { bikeSettingsStore, chosenRoute } from './settings';
import type { RideAlert } from './types';

/** How long an alert banner stays when the rider does not tap it: information and warnings, then the ones that must be seen. */
const ALERT_SHOWN_MS = 8000;
const URGENT_ALERT_SHOWN_MS = 20_000;
const BATTERY_POLL_MS = 30_000;
const STRIP_BINS = 120;
const MAP_LINE_POINTS = 1500;

export interface BikeRideContextValue {
  /** A bike-mode ride is under way (ready or recording) and the session exists. */
  session: BikeSession | null;
  snapshot: BikeSnapshot | null;
  alert: RideAlert | null;
  /** Epoch ms of the newest alert (wakes the dimmed screen). */
  alertAt: number | null;
  dismissAlert: () => void;
  batteryPct: number | null;
  routeName: string | null;
  hasRoute: boolean;
  elevation: { distM: number; altM: number }[] | null;
  /** The route to draw, decimated; null without a route. */
  routeLine: { lat: number; lon: number }[] | null;
  saver: SaverState;
  acceptSaver: () => void;
  dismissSaver: () => void;
}

export const BikeRideContext = createContext<BikeRideContextValue | null>(null);

/**
 * Runs bike mode for the ride the recorder is holding: builds the `BikeSession` when a ride starts in bike mode (loading the chosen
 * route first), feeds it from the recorder's tick, presents its alerts, and drops it when the recording ends. Must sit inside
 * `RecorderProvider` and `SensorsProvider`.
 */
export function BikeRideProvider({ children }: { children: ReactNode }) {
  const { snapshot, observe, pause, resume, lap } = useRecorder();
  const { hub } = useSensors();
  const settings = useSyncExternalStore(bikeSettingsStore.subscribe, () => bikeSettingsStore.get());

  const [session, setSession] = useState<BikeSession | null>(null);
  const [alert, setAlert] = useState<RideAlert | null>(null);
  const [batteryPct, setBatteryPct] = useState<number | null>(null);
  const [route, setRoute] = useState<{ name: string; elevation: { distM: number; altM: number }[] | null; line: { lat: number; lon: number }[] } | null>(null);
  const charging = useRef(false);
  const linksRef = useRef(hub.links);
  const sensorIdsRef = useRef<string[]>([]);
  const everConnected = useRef(new Set<string>());
  const actions = useRef({ pause, resume, lap });
  const batteryRef = useRef<number | null>(null);
  const [saver, setSaver] = useState<SaverState>(SAVER_IDLE);
  const battery = useRef({ start: null as number | null, last: null as number | null, charged: false, movingSec: 0, sensors: 0, saver: false });

  // The session's callbacks read the newest values through refs, written after each render.
  useEffect(() => {
    linksRef.current = hub.links;
    sensorIdsRef.current = snapshot.sensorIds;
    actions.current = { pause, resume, lap };
    batteryRef.current = batteryPct;
    battery.current.movingSec = snapshot.live?.movingSec ?? battery.current.movingSec;
    battery.current.sensors = snapshot.sensorIds.length;
    battery.current.saver = saver.active;
  });

  const rideOn = settings.enabled && snapshot.sport === 'ride' && snapshot.phase === 'active';

  // The session of one ride. The route is loaded before it starts so following begins at the first fix.
  useEffect(() => {
    if (!rideOn) return;
    let cancelled = false;
    let off: (() => void) | null = null;
    void (async () => {
      let loaded: { route: SavedRoute; points: RoutePoint[] } | null = null;
      const id = chosenRoute.get();
      if (id) {
        try {
          loaded = await loadRoute(id);
        } catch (error) {
          log(`bike route load failed: ${String(error)}`, 'error');
        }
      }
      if (cancelled) return;
      everConnected.current = new Set();
      const next = new BikeSession({
        settings: () => bikeSettingsStore.get(),
        profile: () => ({ weightKg: userEnergyProfile().weightKg, maxHr: userHrZones().maxHr, ftp: getFtp() }),
        route: loaded ? { id: loaded.route.id, points: loaded.points } : null,
        actions: { pause: () => actions.current.pause(), resume: () => actions.current.resume(), lap: () => actions.current.lap() },
        battery: () => ({ pct: batteryRef.current, charging: charging.current }),
        lostSensors: () => {
          const lost: string[] = [];
          for (const id of sensorIdsRef.current) {
            const state = linksRef.current[id]?.state;
            if (state === 'connected') everConnected.current.add(id);
            else if (everConnected.current.has(id)) lost.push(id);
          }
          return lost;
        },
        onAlert: (a) => {
          setAlert(a);
          void presentAlert(a, bikeSettingsStore.get().alerts);
        },
      });
      setRoute(loaded ? { name: loaded.route.name, elevation: elevationOf(loaded.points), line: simplifyRoute(loaded.points, MAP_LINE_POINTS).map((p) => ({ lat: p.lat, lon: p.lon })) } : null);
      setSession(next);
      off = observe((tick) => {
        next.onTick(tick);
        // The live link follows the same second: a position, the speed and the heart rate (the tracker keeps one point per 5 s).
        const pos = tick.recorder.latestPosition(tick.now);
        if (pos && pos.ageMs <= 10_000) {
          liveTracker.addPoint({ ts: pos.ts, lat: pos.lat, lon: pos.lon, speed: tick.recorder.instantSpeedMps(tick.now), hr: tick.recorder.live(tick.now).hr });
        }
        void liveTracker.flush(tick.now);
      });
    })();
    return () => {
      cancelled = true;
      off?.();
      const b = battery.current;
      const current = bikeSettingsStore.get();
      recordRideDrain(
        { screen: current.dim || b.saver ? 'dim' : 'bright', map: !b.saver, sensors: b.sensors, liveShare: current.liveShare, gps: true },
        b.start,
        b.last,
        b.movingSec,
        b.charged,
      );
      battery.current = { start: null, last: null, charged: false, movingSec: 0, sensors: 0, saver: false };
      setSession(null);
      setAlert(null);
      setRoute(null);
      setSaver(SAVER_IDLE);
      void clearAlertNotification();
    };
  }, [rideOn, observe]);

  // The saver follows the battery reading.
  useEffect(() => {
    if (!rideOn) return;
    setSaver((state) => saverStep(state, batteryPct, charging.current));
  }, [rideOn, batteryPct]);

  // The live tracking link, while the rider has it on: continued after a restart, else started.
  const liveShare = settings.liveShare;
  useEffect(() => {
    if (!rideOn || !liveShare || !hasLiveConsent()) return;
    void (async () => {
      if (!(await liveTracker.resume())) await liveTracker.begin(sportLabel(SPORT_ROWS.ride.name));
    })();
    return () => void liveTracker.end();
  }, [rideOn, liveShare]);

  // A banner stays for a few seconds.
  useEffect(() => {
    if (!alert) return;
    const shownMs = alertPriority(alert.kind) === 'urgent' ? URGENT_ALERT_SHOWN_MS : ALERT_SHOWN_MS;
    const timer = setTimeout(() => setAlert((current) => (current === alert ? null : current)), shownMs);
    return () => clearTimeout(timer);
  }, [alert]);

  // The phone's battery, while a bike-mode ride is ready or recording.
  const watching = settings.enabled && snapshot.sport === 'ride' && (snapshot.phase === 'ready' || snapshot.phase === 'active');
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    const read = async () => {
      try {
        const [level, plugged] = await Promise.all([DeviceInfo.getBatteryLevel(), DeviceInfo.isBatteryCharging()]);
        if (stopped) return;
        const pct = level >= 0 ? Math.round(level * 100) : null;
        setBatteryPct(pct);
        charging.current = plugged;
        const b = battery.current;
        if (plugged) b.charged = true;
        if (pct !== null) {
          b.start ??= pct;
          b.last = pct;
        }
      } catch {
        // no battery reading: the battery field shows --
      }
    };
    void read();
    const timer = setInterval(() => void read(), BATTERY_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [watching]);

  const snap = useSyncExternalStore(
    useCallback((listener: () => void) => (session ? session.subscribe(listener) : () => undefined), [session]),
    () => session?.getSnapshot() ?? null,
  );

  const value = useMemo<BikeRideContextValue>(
    () => ({
      session,
      snapshot: snap,
      alert,
      alertAt: alert?.at ?? null,
      dismissAlert: () => setAlert(null),
      batteryPct,
      routeName: route?.name ?? null,
      hasRoute: session?.hasRoute ?? false,
      elevation: route?.elevation ?? null,
      routeLine: route?.line ?? null,
      saver,
      acceptSaver: () => setSaver(saverAccept),
      dismissSaver: () => setSaver(saverDismiss),
    }),
    [session, snap, alert, batteryPct, route, saver],
  );

  return <BikeRideContext.Provider value={value}>{children}</BikeRideContext.Provider>;
}

function elevationOf(points: readonly RoutePoint[]): { distM: number; altM: number }[] | null {
  if (points.length < 2 || points.some((p) => p.alt === null)) return null;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += Math.hypot((b.lat - a.lat) * 111_000, (b.lon - a.lon) * 111_000 * Math.cos((a.lat * Math.PI) / 180));
  }
  const strip = elevationStrip(points, 0, total, STRIP_BINS);
  return strip.length > 1 ? strip : null;
}
