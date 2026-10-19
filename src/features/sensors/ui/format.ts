/**
 * Pure helpers of the sensor screens: icons and labels per kind, signal strength from RSSI, the one-line live reading, the battery
 * line, the hint under a sensor that is quiet, and the wheel size field. Text goes through i18n at call time (never at module load).
 */
import type { ChipGlyph } from '@/components/IconChip';
import { fmtDecimal, fmtInt, fmtPercent, t } from '@/i18n';

import { WHEEL_CIRCUMFERENCE_MM, type CscMode, type SensorKind, type SensorReadings } from '../gatt';
import type { HubSnapshot, LinkInfo, ScanItem } from '../hub';
import { sensorStatus, type SensorStatus, type StatusLink } from '../linkStatus';
import type { Granted } from '../permissions';

/** The order sensor kinds are listed in everywhere: the same as `kindsOfServices`. */
const KIND_ORDER: readonly SensorKind[] = ['hr', 'power', 'csc', 'rsc'];

const KIND_GLYPH: Readonly<Record<SensorKind, ChipGlyph>> = {
  hr: { icon: 'heart' },
  csc: { icon: 'speedometer' },
  power: { icon: 'flash' },
  // A running speed and cadence sensor sits on a shoe: the runner, not a speed dial.
  rsc: { sport: 'run' },
};

export function sortKinds(kinds: readonly SensorKind[]): SensorKind[] {
  return KIND_ORDER.filter((kind) => kinds.includes(kind));
}

export function kindGlyph(kind: SensorKind): ChipGlyph {
  return KIND_GLYPH[kind];
}

/** The glyph that stands for a sensor: its first kind's, or plain Bluetooth when the kinds are not known yet. */
export function sensorGlyph(kinds: readonly SensorKind[]): ChipGlyph {
  const first = sortKinds(kinds)[0];
  return first ? KIND_GLYPH[first] : { icon: 'bluetooth' };
}

export function kindLabel(kind: SensorKind): string {
  return t(`watch:sensors.kind.${kind}`);
}

/** "Detak jantung, Daya". */
export function kindsLabel(kinds: readonly SensorKind[]): string {
  return sortKinds(kinds).map(kindLabel).join(', ');
}

export type SignalLevel = 'strong' | 'good' | 'fair' | 'weak';

/** Four bars out of the RSSI in dBm: closer than about a metre is -60 or better; below -80 the link drops often. */
export function signalBars(rssi: number): 1 | 2 | 3 | 4 {
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  return 1;
}

export function signalLevel(rssi: number): SignalLevel {
  return (['weak', 'fair', 'good', 'strong'] as const)[signalBars(rssi) - 1];
}

/** "Baterai 80%", or null while the sensor has not reported its level. */
export function batteryLabel(battery: number | null): string | null {
  return battery === null ? null : t('watch:sensors.battery', { value: fmtPercent(battery) });
}

/** A scan result's name; a sensor that advertises none is told apart by the tail of its id (the same tail pairing stores). */
export function scanName(item: Pick<ScanItem, 'id' | 'name'>): string {
  return item.name?.trim() || t('watch:sensors.unnamed', { tail: item.id.slice(-5) });
}

const MPS_TO_KMH = 3.6;

/**
 * What a sensor reads right now, one entry per value ("72 bpm", "185 W", "84 rpm", "28,4 km/j"). A heart rate whose strap has lost
 * skin contact is left out: the strap itself says that value is not to be trusted.
 */
export function readingParts(r: SensorReadings): string[] {
  const parts: string[] = [];
  if (r.hr !== undefined && r.hrContact !== 'lost') parts.push(t('common:units.bpm', { value: fmtInt(r.hr) }));
  if (r.watts !== undefined) parts.push(t('common:units.w', { value: fmtInt(r.watts) }));
  if (r.cadenceRpm !== undefined) parts.push(t('watch:sensors.reading.rpm', { value: fmtInt(r.cadenceRpm) }));
  if (r.speedMps !== undefined) parts.push(t('watch:sensors.reading.kmh', { value: fmtDecimal(r.speedMps * MPS_TO_KMH, 1) }));
  if (r.podSpeedMps !== undefined) parts.push(t('watch:sensors.reading.kmh', { value: fmtDecimal(r.podSpeedMps * MPS_TO_KMH, 1) }));
  if (r.podCadenceSpm !== undefined) parts.push(t('common:units.spm', { value: fmtInt(r.podCadenceSpm) }));
  return parts;
}

/** The parts on one line, or null when there is nothing to show. */
export function readingLine(r: SensorReadings): string | null {
  const parts = readingParts(r);
  return parts.length === 0 ? null : parts.join(' · ');
}

export type LinkHint = 'notFound' | 'lost' | 'failed' | 'contactLost' | 'waitingHr' | 'waitingBike' | 'waitingPod' | 'speedMode';

/** Link fields `linkHint` reads: the status fields and what the sensor reports. */
export type HintLink = StatusLink & Pick<LinkInfo, 'contact' | 'preview'>;

/**
 * Why a sensor row has no number or a number that is not the whole story, or null when there is nothing to add. A link that failed and
 * keeps trying is "not found" (it never reached the sensor) or "lost" (it was up and dropped); a CSC sensor whose frames carry wheel
 * revolutions only is in speed mode, whatever it is mounted on.
 */
export function linkHint(link: HintLink, kinds: readonly SensorKind[], now: number): LinkHint | null {
  const status = sensorStatus(link, now);
  if (status.phase === 'searching') return status.failure === 'lost' ? 'lost' : 'notFound';
  if (status.phase === 'failed') return 'failed';
  if (status.phase === 'idle' || status.phase === 'connecting') return null;
  if (link.contact === 'lost' || link.preview.hrContact === 'lost') return 'contactLost';
  if (status.mode === 'speed' && kinds.includes('csc')) return 'speedMode';
  if (status.phase === 'receiving' && readingParts(link.preview).length > 0) return null;
  const first = sortKinds(kinds)[0];
  if (first === 'hr') return status.phase === 'receiving' ? null : 'waitingHr';
  if (first === 'rsc') return 'waitingPod';
  return first ? 'waitingBike' : null;
}

/** "just now", "5 s ago", "2 min ago", "3 h ago". */
export function ageText(seconds: number): string {
  if (seconds < 2) return t('watch:sensors.age.now');
  if (seconds < 60) return t('watch:sensors.age.seconds', { value: seconds });
  if (seconds < 3600) return t('watch:sensors.age.minutes', { value: Math.floor(seconds / 60) });
  return t('watch:sensors.age.hours', { value: Math.floor(seconds / 3600) });
}

/**
 * The state of a sensor in words, with how long ago it was heard once it has been ("Tersambung, data masuk · 2 dtk lalu",
 * "Mencari sensor · nilai terakhir 3 mnt lalu").
 */
export function statusLabel(status: SensorStatus): string {
  const label = t(`watch:sensors.status.${status.phase}`);
  if (status.ageSec === null || status.phase === 'connecting' || status.phase === 'failed') return label;
  if (status.phase === 'receiving') return `${label} · ${ageText(status.ageSec)}`;
  return `${label} · ${t('watch:sensors.status.lastValue', { age: ageText(status.ageSec) })}`;
}

/** "Mode kadence": what a CSC sensor's frames carry, as its own words for the person. */
export function modeLabel(mode: CscMode): string {
  return t(`watch:sensors.mode.${mode}`);
}

export const WHEEL_MIN_MM = 1000;
export const WHEEL_MAX_MM = 3000;

/** A wheel circumference typed in millimetres; null when it is not a whole number in the range a bike wheel can have. */
export function parseWheelMm(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{4}$/.test(clean)) return null;
  const mm = Number(clean);
  return mm >= WHEEL_MIN_MM && mm <= WHEEL_MAX_MM ? mm : null;
}

export type WheelPreset = keyof typeof WHEEL_CIRCUMFERENCE_MM;

export const WHEEL_PRESETS = Object.keys(WHEEL_CIRCUMFERENCE_MM) as WheelPreset[];

/** The preset a circumference belongs to, or null for a custom size. */
export function wheelPresetOf(mm: number): WheelPreset | null {
  return WHEEL_PRESETS.find((name) => WHEEL_CIRCUMFERENCE_MM[name] === mm) ?? null;
}

/** A speed or power sensor is what turns the wheel size into speed and distance. */
export function needsWheelSize(kinds: readonly SensorKind[]): boolean {
  return kinds.includes('csc') || kinds.includes('power');
}

/** The `code` of an error from the native module (ERR_BLUETOOTH_OFF, ...); anything without one counts as unknown. */
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return 'ERR_UNKNOWN';
}

export type RadioProblem = 'permission' | 'unsupported' | 'bluetoothOff' | 'scanFailed' | 'connectFailed';

export interface RadioFailure {
  code: string;
  /** What the person was doing when it failed. */
  during: 'scan' | 'connect';
}

/**
 * The one thing to tell the person about the radio, most blocking first: no permission, no Bluetooth LE, Bluetooth off, then a scan
 * or connect that failed for another reason. `permission` is the answer of the last permission prompt, `failure` the last error a
 * call threw; the hub's own `bluetooth` and `scanError` fields cover what the radio reports by itself.
 */
export function radioProblem(
  hub: Pick<HubSnapshot, 'bluetooth' | 'scanError'>,
  permission: Granted | null,
  failure: RadioFailure | null,
): RadioProblem | null {
  if (permission === 'denied' || permission === 'blocked' || hub.bluetooth === 'unauthorized') return 'permission';
  if (hub.bluetooth === 'unsupported') return 'unsupported';
  if (hub.bluetooth === 'off') return 'bluetoothOff';
  const code = hub.scanError ?? failure?.code ?? null;
  if (code === null) return null;
  if (code === 'ERR_BLUETOOTH_PERMISSION') return 'permission';
  if (code === 'ERR_BLUETOOTH_OFF') return 'bluetoothOff';
  return hub.scanError === null && failure?.during === 'connect' ? 'connectFailed' : 'scanFailed';
}
