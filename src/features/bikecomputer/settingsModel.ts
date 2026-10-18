/**
 * Defaults and repair of the bike computer settings. Pure (the key-value store sits in `settings.ts`), so a stored value written by an
 * older or newer version, or by hand, can never reach the engines unchecked.
 */
import type { AlertConfig, AutoLapConfig, BikeSettings, CadenceAlert, ReminderAlert, RideThemeSetting, ZoneAlert } from './types';

export const OFF_COURSE_MIN_M = 30;
export const OFF_COURSE_MAX_M = 200;
export const AUTO_LAP_MIN_M = 1000;
export const AUTO_LAP_MAX_M = 100_000;
export const DIM_AFTER_MIN_SEC = 5;
export const DIM_AFTER_MAX_SEC = 120;

export const DEFAULT_BIKE_SETTINGS: BikeSettings = {
  enabled: false,
  theme: 'auto',
  dim: true,
  dimAfterSec: 20,
  dimLevel: 0.15,
  autoPause: true,
  autoLap: { mode: 'off' },
  alerts: {
    hr: { enabled: false, minZone: 2, maxZone: 4 },
    power: { enabled: false, minZone: 1, maxZone: 5 },
    cadence: { enabled: false, minRpm: 60, maxRpm: 110 },
    eat: { enabled: false, everySec: 30 * 60, everyM: null },
    drink: { enabled: false, everySec: 15 * 60, everyM: null },
    offCourse: true,
    lowBattery: true,
    sensorLost: true,
    gpsLost: true,
    vibrate: true,
    sound: false,
  },
  offCourseM: 50,
  liveShare: false,
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const numOrNull = (v: unknown, d: number | null, min: number, max: number): number | null =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;

const zoneAlert = (v: unknown, d: ZoneAlert, maxZone: number): ZoneAlert => {
  const o = obj(v);
  const minZone = Math.round(num(o.minZone, d.minZone, 1, maxZone));
  const max = Math.round(num(o.maxZone, d.maxZone, 1, maxZone));
  return { enabled: bool(o.enabled, d.enabled), minZone: Math.min(minZone, max), maxZone: Math.max(minZone, max) };
};

const cadenceAlert = (v: unknown, d: CadenceAlert): CadenceAlert => {
  const o = obj(v);
  const minRpm = Math.round(num(o.minRpm, d.minRpm, 20, 200));
  const maxRpm = Math.round(num(o.maxRpm, d.maxRpm, 20, 200));
  return { enabled: bool(o.enabled, d.enabled), minRpm: Math.min(minRpm, maxRpm), maxRpm: Math.max(minRpm, maxRpm) };
};

const reminder = (v: unknown, d: ReminderAlert): ReminderAlert => {
  const o = obj(v);
  let everySec = numOrNull(o.everySec, d.everySec, 60, 6 * 3600);
  let everyM = numOrNull(o.everyM, d.everyM, 1000, 200_000);
  // A reminder with neither trigger can never fire: keep the default trigger.
  if (everySec === null && everyM === null) {
    everySec = d.everySec;
    everyM = d.everyM;
  }
  return { enabled: bool(o.enabled, d.enabled), everySec: everySec === null ? null : Math.round(everySec), everyM: everyM === null ? null : Math.round(everyM) };
};

function autoLap(v: unknown, d: AutoLapConfig): AutoLapConfig {
  const o = obj(v);
  if (o.mode === 'off' || o.mode === 'start') return { mode: o.mode };
  if (o.mode === 'distance') return { mode: 'distance', everyM: Math.round(num(o.everyM, 5000, AUTO_LAP_MIN_M, AUTO_LAP_MAX_M)) };
  return d;
}

const THEMES: readonly RideThemeSetting[] = ['auto', 'day', 'night'];

export function sanitizeAlerts(raw: unknown): AlertConfig {
  const o = obj(raw);
  const d = DEFAULT_BIKE_SETTINGS.alerts;
  return {
    hr: zoneAlert(o.hr, d.hr, 5),
    power: zoneAlert(o.power, d.power, 7),
    cadence: cadenceAlert(o.cadence, d.cadence),
    eat: reminder(o.eat, d.eat),
    drink: reminder(o.drink, d.drink),
    offCourse: bool(o.offCourse, d.offCourse),
    lowBattery: bool(o.lowBattery, d.lowBattery),
    sensorLost: bool(o.sensorLost, d.sensorLost),
    gpsLost: bool(o.gpsLost, d.gpsLost),
    vibrate: bool(o.vibrate, d.vibrate),
    sound: bool(o.sound, d.sound),
  };
}

/** Anything stored (or a partial patch) turned into complete, in-range settings. */
export function sanitizeSettings(raw: unknown): BikeSettings {
  const o = obj(raw);
  const d = DEFAULT_BIKE_SETTINGS;
  return {
    enabled: bool(o.enabled, d.enabled),
    theme: THEMES.includes(o.theme as RideThemeSetting) ? (o.theme as RideThemeSetting) : d.theme,
    dim: bool(o.dim, d.dim),
    dimAfterSec: Math.round(num(o.dimAfterSec, d.dimAfterSec, DIM_AFTER_MIN_SEC, DIM_AFTER_MAX_SEC)),
    dimLevel: num(o.dimLevel, d.dimLevel, 0, 1),
    autoPause: bool(o.autoPause, d.autoPause),
    autoLap: autoLap(o.autoLap, d.autoLap),
    alerts: sanitizeAlerts(o.alerts),
    offCourseM: Math.round(num(o.offCourseM, d.offCourseM, OFF_COURSE_MIN_M, OFF_COURSE_MAX_M)),
    liveShare: bool(o.liveShare, d.liveShare),
  };
}

/** `current` with `patch` applied (a nested group in `patch` replaces that group), then repaired. */
export function mergeSettings(current: BikeSettings, patch: Partial<BikeSettings>): BikeSettings {
  return sanitizeSettings({ ...current, ...patch });
}
