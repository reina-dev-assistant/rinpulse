import type { DataSource, LiveSample, SourceState } from "../live.ts";

const TICK_MS = 250;
/** Seconds the demo heart rate takes to follow effort (first-order lag). */
const HR_TAU_S = 22;

/**
 * Synthetic rider so anyone can try the game and so it can be developed without a phone. In auto mode cadence
 * wanders around 85 rpm and drops on climbs; in manual mode the slider sets it. Heart rate rises with the
 * model's power estimate that the game feeds back through [feed].
 */
export class DemoSource implements DataSource {
  readonly kind = "demo" as const;
  state: SourceState = "idle";
  detail = "demo";
  auto = true;
  manualCad = 85;

  private sampleListeners = new Set<(s: LiveSample) => void>();
  private stateListeners = new Set<() => void>();
  private timer = 0;
  private t = 0;
  private hr = 72;
  private powerW = 0;
  private grade = 0;
  private cad = 0;

  async start(): Promise<void> {
    if (this.timer) return;
    this.setState("live");
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.setState("idle");
  }

  /** The game reports what the physics made of the last input, so the heart rate follows the effort. */
  feed(powerW: number, grade: number): void {
    this.powerW = powerW;
    this.grade = grade;
  }

  onSample(fn: (s: LiveSample) => void): () => void {
    this.sampleListeners.add(fn);
    return () => this.sampleListeners.delete(fn);
  }

  onState(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(state: SourceState): void {
    this.state = state;
    for (const fn of this.stateListeners) fn();
  }

  private tick(): void {
    const dt = TICK_MS / 1000;
    this.t += dt;
    const wobble = Math.sin(this.t / 7) * 5 + Math.sin(this.t / 2.3) * 2.5 + Math.sin(this.t * 1.7) * 1.2;
    const target = this.auto ? 88 - Math.max(0, this.grade) * 3.2 + wobble : this.manualCad;
    this.cad += (Math.max(0, target) - this.cad) * 0.35;

    const effort = Math.min(1.3, this.powerW / 300);
    const hrTarget = 70 + effort * 105;
    this.hr += (hrTarget - this.hr) * (1 - Math.exp(-dt / HR_TAU_S));

    const sample: LiveSample = {
      cad: Math.round(this.cad),
      hr: Math.round(this.hr + Math.sin(this.t * 0.9)),
      at: Date.now(),
    };
    for (const fn of this.sampleListeners) fn(sample);
  }
}
