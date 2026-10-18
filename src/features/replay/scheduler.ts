/**
 * Frame scheduling for playback and export. Pure, no React Native imports: the player advances a `Clock` from the display
 * refresh, the exporter walks `frameJobs` and streams each captured frame to a `FrameSink` (the native encoder) one at a
 * time, so memory stays at two frames whatever the length of the video.
 */
import type { ReplaySpeed } from './timing';

export const EXPORT_FPS = 30;
export const EXPORT_WIDTH = 1080;
export const EXPORT_HEIGHT = 1920;
/** The last frame (the summary card) stays up this long at the end of a video. */
export const EXPORT_TAIL_SEC = 1;

export interface Clock {
  /** Timeline second shown. */
  t: number;
  playing: boolean;
  speed: ReplaySpeed;
}

export function advanceClock(clock: Clock, dtSec: number, totalSec: number): Clock {
  if (!clock.playing) return clock;
  const t = clock.t + Math.max(0, dtSec) * clock.speed;
  return t >= totalSec ? { ...clock, t: totalSec, playing: false } : { ...clock, t };
}

export const isEnded = (clock: Clock, totalSec: number) => clock.t >= totalSec;

export interface FrameJob {
  /** 0-based, strictly increasing by one. */
  index: number;
  /** Timeline second the frame shows. */
  t: number;
  /** Same picture as the previous frame (the tail hold): the exporter reuses the file instead of capturing again. */
  repeat: boolean;
}

/** Frames of a video of a replay lasting `totalSec` on the timeline, played at `speed`, plus the tail hold. */
export function exportFrameCount(totalSec: number, speed: number, fps: number = EXPORT_FPS): number {
  return Math.ceil((totalSec / speed + EXPORT_TAIL_SEC) * fps);
}

/** The timeline second of frame `index`, computed from the integer index so it never drifts. */
export function frameTime(index: number, totalSec: number, speed: number, fps: number = EXPORT_FPS): number {
  return Math.min(totalSec, (index * speed) / fps);
}

export function* frameJobs(totalSec: number, speed: number, fps: number = EXPORT_FPS): Generator<FrameJob> {
  const count = exportFrameCount(totalSec, speed, fps);
  let prev = -1;
  for (let index = 0; index < count; index++) {
    const t = frameTime(index, totalSec, speed, fps);
    yield { index, t, repeat: t === prev };
    prev = t;
  }
}

/** What the exporter needs from the native encoder (see `modules/replay-encoder`). */
export interface FrameSink {
  appendFrame(index: number, uri: string): Promise<void>;
  finish(): Promise<{ uri: string; bytes: number; frames: number; durationMs: number }>;
  cancel(): Promise<void>;
}

export interface ExportProgress {
  frame: number;
  frames: number;
  fraction: number;
}

export interface ExportDeps {
  totalSec: number;
  speed: number;
  fps?: number;
  /** Draws the frame and returns the image file (`file://`) of it. Called once per job that is not a repeat. */
  renderFrame: (job: FrameJob, signal: AbortSignal) => Promise<string>;
  sink: FrameSink;
  /** Deletes a frame file once the encoder has taken it. */
  discard: (uri: string) => Promise<void> | void;
  onProgress?: (progress: ExportProgress) => void;
  signal: AbortSignal;
}

export class ExportCancelled extends Error {
  constructor() {
    super('export cancelled');
    this.name = 'ExportCancelled';
  }
}

/**
 * Renders and encodes every frame in order. Rendering the next frame overlaps with the encoder taking the previous one, never
 * more: at most two frame files exist at a time. On cancel or on any failure the encoder is cancelled (its partial file is
 * deleted by the native side) and the frame files still on disk are discarded.
 */
export async function runExport(deps: ExportDeps): Promise<{ uri: string; bytes: number; frames: number; durationMs: number }> {
  const fps = deps.fps ?? EXPORT_FPS;
  const frames = exportFrameCount(deps.totalSec, deps.speed, fps);
  let pending: Promise<void> | null = null;
  const owned = new Set<string>();
  let last: string | null = null;

  const drain = async () => {
    const p = pending;
    pending = null;
    if (p) await p;
  };

  const jobs = [...frameJobs(deps.totalSec, deps.speed, fps)];
  try {
    for (const [i, job] of jobs.entries()) {
      if (deps.signal.aborted) throw new ExportCancelled();
      let uri: string;
      if (job.repeat && last !== null) {
        uri = last;
      } else {
        uri = await deps.renderFrame(job, deps.signal);
        owned.add(uri);
        if (deps.signal.aborted) throw new ExportCancelled();
      }
      await drain();
      // A repeated frame shares the file of the one before: the file goes after the last frame that shows it.
      const shared = jobs[i + 1]?.repeat === true;
      const append = deps.sink.appendFrame(job.index, uri).then(async () => {
        if (!shared && owned.delete(uri)) await deps.discard(uri);
      });
      pending = append;
      append.catch(() => undefined);
      last = uri;
      deps.onProgress?.({ frame: job.index + 1, frames, fraction: (job.index + 1) / frames });
    }
    await drain();
    if (deps.signal.aborted) throw new ExportCancelled();
    return await deps.sink.finish();
  } catch (error) {
    try {
      await drain();
    } catch {
      // The failure being reported is the first one.
    }
    await deps.sink.cancel().catch(() => undefined);
    for (const uri of owned) await Promise.resolve(deps.discard(uri)).catch(() => undefined);
    if (deps.signal.aborted && !(error instanceof ExportCancelled)) throw new ExportCancelled();
    throw error;
  }
}
