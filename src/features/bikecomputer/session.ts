/**
 * Bike mode for one ride: runs the engines (metrics, auto-pause, auto-lap, route following, alerts) once a second from the recorder's
 * tick and publishes what the ride screen shows. Pure: the recorder, the clock, the actions and the phone battery come in as arguments,
 * so the whole thing runs under bun test with fakes. No React Native imports.
 *
 * A restored recording (app killed) needs nothing special: the first tick replays every sample the recorder holds into the metrics.
 */
import type { Recorder } from '@/features/record/recorder';
import { haversineM, type RoutePoint } from '@/features/routes/routeModel';

import { RouteFollower } from './nav';
import { AlertEngine } from './ride/alerts';
import { AutoLap } from './ride/autoLap';
import { AutoPause } from './ride/autoPause';
import { BikeMetrics } from './ride/metrics';
import type { AlertConfig, AutoLapConfig, BikeMetricsSnapshot, BikeSettings, NavSnapshot, RideAlert } from './types';

export interface BikeSessionDeps {
  settings: () => BikeSettings;
  profile: () => { weightKg: number; maxHr: number; ftp: number | null };
  route: { id: string; points: readonly RoutePoint[] } | null;
  /** The recorder's own controls (they journal and publish). */
  actions: { pause(): void; resume(): void; lap(): void };
  battery: () => { pct: number | null; charging: boolean };
  /** Ids of sensors that were connected during this ride and are not now. */
  lostSensors: () => string[];
  /** Called for every alert the engine fires; the app vibrates, shows a banner and posts a notification. */
  onAlert: (alert: RideAlert) => void;
}

export interface BikeSnapshot {
  metrics: BikeMetricsSnapshot;
  nav: NavSnapshot | null;
  /** Average speed of the lap in progress, m/s. */
  lapSpeedMps: number | null;
  /** The recorder was paused by auto-pause (not by the rider). */
  autoPaused: boolean;
  gps: { accuracyM: number | null; ageSec: number | null } | null;
  sensorsLost: number;
  /** Newest fix with the direction of travel (degrees clockwise from north, null until the rider has moved), null before the first fix. */
  position: { lat: number; lon: number; headingDeg: number | null } | null;
}

/** The heading is taken from the last stretch of at least this many metres. */
const HEADING_MIN_M = 6;

/** Initial bearing from a to b in degrees, 0 = north, clockwise. */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLon = (b.lon - a.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** A GPS fix older than this (seconds) counts as lost for the alert and for navigation. */
export const GPS_LOST_SEC = 10;

const sameAutoLap = (a: AutoLapConfig, b: AutoLapConfig): boolean => JSON.stringify(a) === JSON.stringify(b);

export class BikeSession {
  private metrics: BikeMetrics | null = null;
  private cursor = 0;
  private readonly autoPause = new AutoPause();
  private autoLap: AutoLap | null = null;
  private autoLapCfg: AutoLapConfig | null = null;
  private alerts: AlertEngine | null = null;
  private alertCfg: AlertConfig | null = null;
  private readonly follower: RouteFollower | null;
  private lapNumber = 1;
  private lapStartSec: number | null = null;
  private autoPaused = false;
  private lastFixTs: number | null = null;
  private headingFrom: { lat: number; lon: number } | null = null;
  private heading: number | null = null;
  private snap: BikeSnapshot | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: BikeSessionDeps) {
    this.follower = deps.route && deps.route.points.length >= 2 ? new RouteFollower(deps.route.id, deps.route.points, { offCourseM: deps.settings().offCourseM }) : null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BikeSnapshot | null => this.snap;

  get hasRoute(): boolean {
    return this.follower !== null;
  }

  /** One second of the ride. `recorder` is the controller's; `now` is epoch ms. */
  onTick({ recorder, now }: { recorder: Recorder; now: number }): void {
    const settings = this.deps.settings();
    const profile = this.deps.profile();
    const nowSec = Math.floor(now / 1000);

    this.metrics ??= new BikeMetrics({ weightKg: profile.weightKg, maxHr: profile.maxHr });
    const fresh = recorder.samplesSince(this.cursor);
    for (const sample of fresh) this.metrics.ingest(sample);
    this.cursor += fresh.length;

    const live = recorder.live(now);
    if (live.lapNumber !== this.lapNumber || this.lapStartSec === null) {
      if (this.lapStartSec !== null) this.metrics.lap(nowSec);
      this.lapNumber = live.lapNumber;
      this.lapStartSec = nowSec;
      this.autoLap?.notifyLap(live.distanceM);
    }

    const recording = recorder.status === 'recording';
    const pos = recorder.latestPosition(now);
    const speed = recorder.instantSpeedMps(now);

    // Auto-pause: a pause the rider made by hand is never auto-resumed.
    if (settings.autoPause) {
      if (recorder.status === 'paused' && !this.autoPaused) this.autoPause.notePaused('manual');
      const action = this.autoPause.update(speed, now, recording);
      if (action === 'pause') {
        this.autoPaused = true;
        this.autoPause.notePaused('auto');
        this.deps.actions.pause();
      } else if (action === 'resume') {
        this.autoPaused = false;
        this.deps.actions.resume();
      }
    } else if (this.autoPaused) {
      this.autoPaused = false;
      if (recorder.status === 'paused') this.deps.actions.resume();
    }
    if (recorder.status !== 'paused') this.autoPaused = false;

    // Auto-lap.
    if (!this.autoLap || !this.autoLapCfg || !sameAutoLap(this.autoLapCfg, settings.autoLap)) {
      this.autoLapCfg = settings.autoLap;
      this.autoLap = new AutoLap(settings.autoLap);
      this.autoLap.notifyLap(live.distanceM);
    }
    let autoLapped = false;
    if (recording && this.autoLap.update({ distanceM: live.distanceM, lat: pos?.lat ?? null, lon: pos?.lon ?? null, lapNow: false })) {
      autoLapped = true;
      this.deps.actions.lap();
    }

    if (pos) {
      if (!this.headingFrom) this.headingFrom = { lat: pos.lat, lon: pos.lon };
      else if (haversineM(this.headingFrom, pos) >= HEADING_MIN_M) {
        this.heading = bearingDeg(this.headingFrom, pos);
        this.headingFrom = { lat: pos.lat, lon: pos.lon };
      }
    }

    // Navigation: a fix is matched once, however many ticks it stays the newest.
    let nav = this.follower?.snapshot() ?? null;
    if (this.follower && pos && pos.ageMs <= GPS_LOST_SEC * 1000 && pos.ts !== this.lastFixTs) {
      this.lastFixTs = pos.ts;
      nav = this.follower.update({ ts: pos.ts, lat: pos.lat, lon: pos.lon, speedMps: speed, accuracy: pos.accuracy }, now);
    }

    // Alerts.
    if (!this.alerts || this.alertCfg !== settings.alerts) {
      this.alertCfg = settings.alerts;
      this.alerts = new AlertEngine(settings.alerts, { maxHr: profile.maxHr, ftp: profile.ftp });
    }
    const battery = this.deps.battery();
    const lost = this.deps.lostSensors();
    const fixAgeSec = pos ? Math.floor(pos.ageMs / 1000) : null;
    const fired = this.alerts.update({
      nowMs: now,
      movingSec: live.movingSec,
      distanceM: live.distanceM,
      hr: live.hr,
      watts: live.watts,
      cadence: live.cadence,
      offCourse: nav?.offCourse ?? false,
      batteryPct: battery.pct,
      charging: battery.charging,
      sensorsLost: lost,
      fixAgeSec,
      autoLapped,
      turnInM: nav?.nextCue?.distanceM ?? null,
    });
    for (const alert of fired) this.deps.onAlert(alert);

    this.snap = {
      metrics: this.metrics.snapshot(),
      nav,
      lapSpeedMps: this.metrics.snapshot().lapAvgSpeedMps,
      autoPaused: this.autoPaused,
      gps: pos ? { accuracyM: pos.accuracy, ageSec: fixAgeSec } : null,
      sensorsLost: lost.length,
      position: pos ? { lat: pos.lat, lon: pos.lon, headingDeg: this.heading } : null,
    };
    for (const l of this.listeners) l();
  }
}
