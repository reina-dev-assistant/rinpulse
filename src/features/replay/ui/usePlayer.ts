import { useCallback, useEffect, useRef, useState } from 'react';

import { advanceClock, isEnded, type Clock } from '../scheduler';
import type { ReplaySpeed } from '../timing';

/** The screen is redrawn at most this often: the SVG scene is heavier than a typical view. */
const MIN_STEP_MS = 1000 / 30;

export interface Player {
  t: number;
  playing: boolean;
  speed: ReplaySpeed;
  ended: boolean;
  play: () => void;
  pause: () => void;
  restart: () => void;
  setSpeed: (speed: ReplaySpeed) => void;
  /** Jumps to a timeline second and pauses (the exporter drives frames this way). */
  seek: (t: number) => void;
}

/** A playback clock on the display refresh: `t` is the timeline second to draw. `enabled` false holds it still. */
export function usePlayer(totalSec: number, enabled: boolean): Player {
  const [clock, setClock] = useState<Clock>({ t: 0, playing: false, speed: 1 });
  const live = useRef(clock);
  useEffect(() => {
    live.current = clock;
  }, [clock]);

  useEffect(() => {
    if (!enabled || !clock.playing) return;
    let raf = 0;
    let last = performance.now();
    let shown = last;
    const tick = (now: number) => {
      const next = advanceClock(live.current, (now - last) / 1000, totalSec);
      last = now;
      live.current = next;
      if (!next.playing || now - shown >= MIN_STEP_MS) {
        shown = now;
        setClock(next);
      }
      if (next.playing) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, clock.playing, totalSec]);

  const play = useCallback(() => setClock((c) => (isEnded(c, totalSec) ? { ...c, t: 0, playing: true } : { ...c, playing: true })), [totalSec]);
  const pause = useCallback(() => setClock((c) => ({ ...c, playing: false })), []);
  const restart = useCallback(() => setClock((c) => ({ ...c, t: 0, playing: true })), []);
  const setSpeed = useCallback((speed: ReplaySpeed) => setClock((c) => ({ ...c, speed })), []);
  const seek = useCallback((t: number) => setClock((c) => ({ ...c, t: Math.min(totalSec, Math.max(0, t)), playing: false })), [totalSec]);

  return { t: clock.t, playing: clock.playing, speed: clock.speed, ended: isEnded(clock, totalSec), play, pause, restart, setSpeed, seek };
}
