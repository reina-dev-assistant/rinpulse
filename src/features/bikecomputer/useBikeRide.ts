import { useContext, useMemo } from 'react';

import { useNow } from '@/hooks/useNow';

import { userMaxHr } from '@/features/workouts/useWorkoutStrain';
import { getFtp } from '@/features/cycling/settings';
import { useRecorder } from '@/state/RecorderProvider';

import { BikeRideContext } from './BikeRideProvider';
import type { FieldContext } from './fields/values';
import { useDimming } from './ui/useDim';
import { useBikeSettings } from './ui/useBikeSettings';
import type { NavSnapshot, RideAlert } from './types';

export interface BikeRide {
  /** Everything the data fields read; null until the first tick of the ride. */
  ctx: FieldContext | null;
  nav: NavSnapshot | null;
  /** The newest alert, cleared by the provider after a few seconds. */
  alert: RideAlert | null;
  dismissAlert: () => void;
  paused: boolean;
  /** The recorder was paused by auto-pause, not by the rider. */
  autoPaused: boolean;
  gps: { accuracyM: number | null; ageSec: number | null } | null;
  sensorsLost: number;
  /** Route elevation for the climb page, null without a route or altitude. */
  elevation: { distM: number; altM: number }[] | null;
  routeName: string | null;
  hasRoute: boolean;
  batteryPct: number | null;
  /** The route to draw on the map page, null without a route. */
  route: { lat: number; lon: number }[] | null;
  /** Newest GPS position with the heading, null before the first fix. */
  position: { lat: number; lon: number; headingDeg: number | null } | null;
  /**
   * Battery saver: `active` hides the map page and sounds and dims the screen sooner; `prompt` is what the screen should ask now
   * (`propose` at 20 % battery: a question answered by `accept` or `dismiss`; `forced` at 10 %: a notice closed by `dismiss`).
   */
  saver: { active: boolean; prompt: 'none' | 'propose' | 'forced'; accept: () => void; dismiss: () => void };
}

const NOOP = () => undefined;
const SAVER_DIM_AFTER_SEC = 10;
const SAVER_DIM_LEVEL = 0.1;

/** The live state of a bike-mode ride. Outside a ride (or with the mode off) `ctx` is null. */
export function useBikeRide(): BikeRide {
  const value = useContext(BikeRideContext);
  const { snapshot } = useRecorder();
  const bike = value?.snapshot ?? null;
  const live = snapshot.live;
  const batteryPct = value?.batteryPct ?? null;
  const nowMs = useNow(1000);

  const ctx = useMemo<FieldContext | null>(
    () =>
      live && bike
        ? {
            live,
            metrics: bike.metrics,
            nav: bike.nav,
            maxHr: userMaxHr(),
            ftp: getFtp(),
            batteryPct,
            nowMs,
            lapSpeedMps: bike.lapSpeedMps,
          }
        : null,
    [live, bike, batteryPct, nowMs],
  );

  return {
    ctx,
    nav: bike?.nav ?? null,
    alert: value?.alert ?? null,
    dismissAlert: value?.dismissAlert ?? NOOP,
    paused: snapshot.status === 'paused',
    autoPaused: bike?.autoPaused ?? false,
    gps: bike?.gps ?? null,
    sensorsLost: bike?.sensorsLost ?? 0,
    elevation: value?.elevation ?? null,
    routeName: value?.routeName ?? null,
    hasRoute: value?.hasRoute ?? false,
    batteryPct,
    route: value?.routeLine ?? null,
    position: bike?.position ?? null,
    saver: {
      active: value?.saver.active ?? false,
      prompt: value?.saver.prompt ?? 'none',
      accept: value?.acceptSaver ?? NOOP,
      dismiss: value?.dismissSaver ?? NOOP,
    },
  };
}

/** Dimming of the ride screen; call once, in the screen. A touch anywhere calls `touch`. */
export function useRideDimming(): { dimmed: boolean; touch: () => void } {
  const settings = useBikeSettings();
  const value = useContext(BikeRideContext);
  const saver = value?.saver.active ?? false;
  // The battery saver dims sooner and deeper whatever the rider chose.
  return useDimming({
    enabled: settings.dim || saver,
    afterSec: saver ? Math.min(settings.dimAfterSec, SAVER_DIM_AFTER_SEC) : settings.dimAfterSec,
    level: saver ? Math.min(settings.dimLevel, SAVER_DIM_LEVEL) : settings.dimLevel,
    alertAt: value?.alertAt ?? null,
  });
}
