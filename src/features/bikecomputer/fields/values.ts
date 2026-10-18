/**
 * What each data field of the ride screen shows: one pure function from the ride's readings to text. No React Native; runs under bun test.
 * A source without a reading gives `--`, never a made-up number.
 */
import { zoneBounds } from '@/features/cycling/power';
import { heartZone } from '@/features/live/liveWorkout';
import type { LiveStats } from '@/features/record/recorder';
import { formatElapsed, workoutDistanceParts } from '@/features/workouts/summary';
import { fmtClock, fmtDecimal, fmtInt, t } from '@/i18n';

import type { BikeMetricsSnapshot, FieldId, FieldTone, FieldValue, NavSnapshot } from '../types';

const DASH = '--';

export interface FieldContext {
  live: LiveStats;
  metrics: BikeMetricsSnapshot;
  nav: NavSnapshot | null;
  maxHr: number;
  ftp: number | null;
  /** Phone battery percent, null when unknown. */
  batteryPct: number | null;
  nowMs: number;
  /** Average speed of the current lap, m/s. */
  lapSpeedMps: number | null;
}

/** Below this the battery field turns to the warning tone. */
export const BATTERY_WARN_PCT = 20;

const none = (unit: string | null = null): FieldValue => ({ value: DASH, unit, tone: 'neutral', sub: null });
const plain = (value: string, unit: string | null, tone: FieldTone = 'neutral', sub: string | null = null): FieldValue => ({ value, unit, tone, sub });

const kmh = (mps: number | null): FieldValue =>
  mps === null || !Number.isFinite(mps) ? none(t('workouts:analysis.unit.kmh')) : plain(fmtDecimal(Math.max(0, mps) * 3.6, 1), t('workouts:analysis.unit.kmh'));

const rpm = (v: number | null): FieldValue => (v === null ? none(t('workouts:analysis.unit.rpm')) : plain(fmtInt(v), t('workouts:analysis.unit.rpm')));
const bpm = (v: number | null): FieldValue => (v === null ? none(t('workouts:analysis.unit.bpm')) : plain(fmtInt(v), t('workouts:analysis.unit.bpm')));
const watts = (v: number | null): FieldValue => (v === null ? none(t('workouts:analysis.unit.w')) : plain(fmtInt(v), t('workouts:analysis.unit.w')));
const metres = (v: number | null): FieldValue => (v === null ? none(t('workouts:analysis.unit.m')) : plain(fmtInt(v), t('workouts:analysis.unit.m')));

function distance(m: number | null): FieldValue {
  if (m === null) return none(t('workouts:analysis.unit.km'));
  const parts = workoutDistanceParts(Math.max(0, m));
  return plain(parts.value, parts.unit);
}

const clock = (ms: number): FieldValue => plain(fmtClock(ms), null);

/** Zone number of `watts` in Coggan's seven zones of `ftp` (1..7). */
export function powerZoneOf(w: number, ftp: number): number {
  const bounds = zoneBounds(ftp);
  let zone = 1;
  bounds.forEach((b, i) => {
    if (w >= b.fromW) zone = i + 1;
  });
  return zone;
}

const zoneTone = (zone: number): FieldTone => `zone${Math.min(7, Math.max(1, zone))}` as FieldTone;

export function fieldValue(id: FieldId, ctx: FieldContext): FieldValue {
  const { live, metrics: m, nav } = ctx;
  switch (id) {
    case 'speed':
      return kmh(live.speedMps);
    case 'avgSpeed':
      return kmh(m.avgSpeedMps);
    case 'maxSpeed':
      return kmh(m.maxSpeedMps);
    case 'lapSpeed':
      return kmh(ctx.lapSpeedMps ?? m.lapAvgSpeedMps);
    case 'cadence':
      return rpm(live.cadence);
    case 'avgCadence':
      return rpm(m.avgCadence);
    case 'hr':
      return bpm(live.hr);
    case 'avgHr':
      return bpm(m.avgHr);
    case 'hrZone': {
      const zone = live.hr !== null ? heartZone(live.hr, ctx.maxHr) : null;
      return zone ? plain(fmtInt(zone.zone), null, zoneTone(zone.zone), zone.label) : none();
    }
    case 'power':
      return watts(live.watts);
    case 'power3s':
      return watts(m.power3s);
    case 'power10s':
      return watts(m.power10s);
    case 'avgPower':
      return watts(m.avgPower);
    case 'normPower':
      return watts(m.normPower);
    case 'powerZone': {
      if (live.watts === null || ctx.ftp === null) return none();
      const zone = powerZoneOf(live.watts, ctx.ftp);
      return plain(fmtInt(zone), null, zoneTone(zone), t(`cycling:powerZones.name.z${zone}` as 'cycling:powerZones.name.z1'));
    }
    case 'estPower':
      return m.estPowerW === null ? none(t('workouts:analysis.unit.w')) : plain(fmtInt(Math.round(m.estPowerW)), t('workouts:analysis.unit.w'), 'neutral', t('bikecomp:field.estPower.estimate'));
    case 'distance':
      return distance(live.distanceM);
    case 'lapDistance':
      return distance(live.lapDistanceM);
    case 'distanceToFinish':
      return nav ? distance(nav.distanceToFinishM) : none(t('workouts:analysis.unit.km'));
    case 'distanceToTurn':
      return nav?.nextCue ? distance(nav.nextCue.distanceM) : none(t('workouts:analysis.unit.m'));
    case 'movingTime':
      return plain(formatElapsed(live.movingSec), null);
    case 'elapsedTime':
      return plain(formatElapsed(live.elapsedSec), null);
    case 'lapTime':
      return plain(formatElapsed(live.lapMovingSec), null);
    case 'timeOfDay':
      return clock(ctx.nowMs);
    case 'eta':
      return nav?.etaSec != null ? clock(ctx.nowMs + nav.etaSec * 1000) : none();
    case 'altitude':
      return m.altitudeM === null ? none(t('workouts:analysis.unit.m')) : metres(Math.round(m.altitudeM));
    case 'ascent':
      return metres(Math.round(m.ascentM));
    case 'descent':
      return metres(Math.round(m.descentM));
    case 'grade':
      return m.gradePct === null ? none('%') : plain(fmtDecimal(m.gradePct, 1), '%');
    case 'climbRemaining':
      return nav?.climb ? metres(Math.round(nav.climb.remainingAscentM)) : none(t('workouts:analysis.unit.m'));
    case 'calories':
      return plain(fmtInt(live.calories), t('workouts:analysis.unit.kcal'));
    case 'battery':
      return ctx.batteryPct === null
        ? none('%')
        : plain(fmtInt(Math.round(ctx.batteryPct)), '%', ctx.batteryPct <= BATTERY_WARN_PCT ? 'warn' : 'neutral');
  }
}

/** i18n keys (namespace `bikecomp`) of a field's name, short name and description. */
export const fieldNameKey = (id: FieldId): string => `field.${id}.name`;
export const fieldShortKey = (id: FieldId): string => `field.${id}.short`;
export const fieldDescKey = (id: FieldId): string => `field.${id}.desc`;
