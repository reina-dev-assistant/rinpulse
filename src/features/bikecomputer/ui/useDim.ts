import { useCallback, useEffect, useRef, useState } from 'react';

import { beginBrightnessControl, endBrightnessControl, restoreRideBrightness, setRideBrightness } from './brightness';
import { initDim, msUntilDim, stepDim, type DimConfig, type DimEvent, type DimState } from './dimMachine';

interface DimmingOptions {
  enabled: boolean;
  afterSec: number;
  /** 0..1 brightness while dimmed. */
  level: number;
  /** Epoch ms of the newest alert; a change wakes the screen. */
  alertAt?: number | null;
}

/**
 * Dims the screen after `afterSec` without a touch and wakes it on a touch or a new alert (`dimMachine.ts`). The system brightness is
 * saved when dimming is enabled and restored when it is disabled and on unmount. `touch()` is for the UI to call on every touch.
 */
export function useDimming({ enabled, afterSec, level, alertAt = null }: DimmingOptions): { dimmed: boolean; touch: () => void } {
  const [dimmed, setDimmed] = useState(false);
  const state = useRef<DimState>(initDim(0));
  const config = useRef<DimConfig>({ enabled, afterSec });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyRef = useRef<(event: DimEvent) => void>(() => undefined);

  useEffect(() => {
    config.current = { enabled, afterSec };
  });

  const apply = useCallback((event: DimEvent) => {
    state.current = stepDim(state.current, event, config.current);
    setDimmed(state.current.dimmed);
    if (timer.current !== null) clearTimeout(timer.current);
    const wait = msUntilDim(state.current, config.current, event.nowMs);
    timer.current = wait === null ? null : setTimeout(() => applyRef.current({ type: 'tick', nowMs: Date.now() }), wait);
  }, []);

  useEffect(() => {
    applyRef.current = apply;
    state.current = initDim(Date.now());
  }, [apply]);

  const touch = useCallback(() => apply({ type: 'touch', nowMs: Date.now() }), [apply]);

  // A setting change re-evaluates now: off wakes the screen, a new timeout applies to the idle time already spent.
  useEffect(() => {
    config.current = { enabled, afterSec };
    apply({ type: 'tick', nowMs: Date.now() });
  }, [apply, enabled, afterSec]);

  useEffect(() => {
    if (alertAt !== null) apply({ type: 'alert', nowMs: Date.now() });
  }, [apply, alertAt]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    void beginBrightnessControl();
    return () => void endBrightnessControl();
  }, [enabled]);

  const wasDimmed = useRef(false);
  useEffect(() => {
    if (enabled && dimmed) {
      wasDimmed.current = true;
      void setRideBrightness(level);
    } else if (wasDimmed.current) {
      wasDimmed.current = false;
      void restoreRideBrightness();
    }
  }, [enabled, dimmed, level]);

  return { dimmed: enabled && dimmed, touch };
}
