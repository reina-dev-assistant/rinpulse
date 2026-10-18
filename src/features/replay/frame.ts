/**
 * The state of the replay at one instant: a pure function of the plan and a timeline second, with no memory of earlier
 * frames, so the player, the exporter and the tests all get the same frame for the same time (a frame can be rendered
 * out of order, or twice). Numbers only; `build.ts` turns it into a scene.
 */
import { cameraAt, project, type Camera } from './camera';
import type { CalloutDef } from './callouts';
import type { ReplayPlan } from './plan';
import { odometerAt, pointAt, sampleAt } from './route';
import { phaseAt, timeOfProgress, type Phase } from './timing';

/** Seconds a pin's chip stays up after the rider reaches it (replay time), and its fade in and out. */
export const CHIP_HOLD_SEC = 2.4;
export const CHIP_IN_SEC = 0.3;
export const CHIP_OUT_SEC = 0.45;
export const POP_SEC = 0.45;
/** The counter fades out and the summary card in over the outro. */
export const COUNTER_FADE_OUTRO = 0.2;
export const SUMMARY_FROM_OUTRO = 0.55;
export const SUMMARY_TO_OUTRO = 0.9;

export interface PinState {
  def: CalloutDef;
  /** Pop scale of the pin: 0 before the rider arrives, overshoots to ~1.15, settles at 1. */
  pop: number;
  /** Alpha of the chip beside the pin. */
  chip: number;
  /** Screen position of the pin. */
  x: number;
  y: number;
}

export interface MarkState {
  km: number;
  alpha: number;
  x: number;
  y: number;
}

export interface FrameState {
  t: number;
  phase: Phase;
  p: number;
  camera: Camera;
  rider: { x: number; y: number; mx: number; my: number };
  /** Length of the route drawn so far, local px of the basemap ref zoom. */
  drawnPx: number;
  /** The distance and clock counters, scaled so they run 0 .. workout total across the drawn path. */
  distanceM: number;
  elapsedSec: number;
  live: { speedMs: number | null; hr: number | null; power: number | null; altM: number | null; paceSec: number | null };
  pins: PinState[];
  marks: MarkState[];
  counterAlpha: number;
  summaryAlpha: number;
  introP: number;
  outroP: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function frameAt(plan: ReplayPlan, t: number): FrameState {
  const { track, path, timing, vp } = plan;
  const pos = phaseAt(timing, t);
  const camera = cameraAt(plan.camera, pos);
  const d = pos.p * path.lengthM;
  const at = pointAt(path, d);
  const screen = project(camera, vp, at.mx, at.my);

  // Counters: odometer / clock at the rider, scaled over the drawn path to the workout's totals.
  const span = Math.max(plan.odo1 - plan.odo0, 1);
  const distanceM = Math.min(track.totals.distanceM, Math.max(0, ((odometerAt(track.dist, at.idx) - plan.odo0) / span) * track.totals.distanceM));
  const timeSpan = Math.max(plan.t1 - plan.t0, 1);
  const clock = track.totals.movingSec > 0 ? track.totals.movingSec : track.totals.elapsedSec;
  const elapsedSec = Math.min(clock, Math.max(0, ((at.idx * track.stepSec - plan.t0) / timeSpan) * clock));

  const speed = sampleAt(track.speed, at.idx);
  const live = {
    speedMs: speed !== null && speed > 0 ? speed : null,
    hr: sampleAt(track.hr, at.idx),
    power: sampleAt(track.power, at.idx),
    altM: sampleAt(track.alt, at.idx),
    paceSec: speed !== null && speed > 0.3 ? 1000 / speed : null,
  };

  const pins: PinState[] = [];
  for (const def of plan.callouts) {
    const reached = timeOfProgress(timing, def.p);
    const age = t - reached;
    if (age < 0) continue;
    const pin = project(camera, vp, def.mx, def.my);
    let chip = 0;
    if (pos.phase !== 'outro' || pos.outroP < 0.001) {
      chip = clamp01(age / CHIP_IN_SEC) * (1 - clamp01((age - CHIP_HOLD_SEC) / CHIP_OUT_SEC));
    }
    pins.push({ def, pop: easeOutBack(clamp01(age / POP_SEC)), chip, x: pin.x, y: pin.y });
  }

  const marks: MarkState[] = [];
  for (const m of plan.marks) {
    const reached = timeOfProgress(timing, m.p);
    if (t < reached) continue;
    const s = project(camera, vp, m.mx, m.my);
    marks.push({ km: m.km, alpha: clamp01((t - reached) / 0.25), x: s.x, y: s.y });
  }

  return {
    t,
    phase: pos.phase,
    p: pos.p,
    camera,
    rider: { x: screen.x, y: screen.y, mx: at.mx, my: at.my },
    drawnPx: d * plan.pxPerM,
    distanceM,
    elapsedSec,
    live,
    pins,
    marks,
    counterAlpha: 1 - clamp01(pos.outroP / COUNTER_FADE_OUTRO),
    summaryAlpha: smooth(SUMMARY_FROM_OUTRO, SUMMARY_TO_OUTRO, pos.outroP),
    introP: pos.introP,
    outroP: pos.outroP,
  };
}
