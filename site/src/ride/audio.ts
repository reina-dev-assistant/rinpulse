/**
 * Procedural ride sound with Web Audio, no sample files: wind that grows with the square of the speed, the hum of the tyres on the
 * tarmac, the freewheel's buzz while coasting, a crowd near the finish and the segment banners, and a click on each shift.
 */

const NOISE_S = 2;
/** Clicks in one loop of the freewheel buffer; with the loop length this sets the rate at playbackRate 1. */
const RATCHET_CLICKS = 4;
const RATCHET_LOOP_S = 0.1;
/** Ratchet engagement points per wheel turn and the wheel's circumference, for the buzz rate. */
const RATCHET_POINTS = 24;
const WHEEL_M = 2.105;

export interface SoundState {
  speedMs: number;
  /** The rider is moving without pedalling (or pedalling slower than the wheel). */
  coasting: boolean;
  /** 0..1, how loud the roadside crowd is. */
  crowd: number;
}

interface Channel {
  gain: GainNode;
}

export class RideAudio {
  muted: boolean;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: (Channel & { filter: BiquadFilterNode }) | null = null;
  private tyre: Channel | null = null;
  private ratchet: (Channel & { source: AudioBufferSourceNode }) | null = null;
  private crowd: (Channel & { swell: GainNode }) | null = null;
  private clickBuffer: AudioBuffer | null = null;
  private clock = 0;
  private unlock: (() => void) | null = null;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  /** Builds the graph on first use. Call from a click or key handler: browsers only start audio after a user gesture. */
  start(): void {
    if (!this.ctx) {
      if (typeof AudioContext === "undefined") return;
      this.build(new AudioContext());
    }
    const ctx = this.ctx!;
    if (ctx.state === "suspended") {
      void ctx.resume();
      // Started by the phone rather than a click: resume on the player's next gesture.
      if (!this.unlock) {
        this.unlock = () => {
          void ctx.resume();
          this.dropUnlock();
        };
        window.addEventListener("pointerdown", this.unlock);
        window.addEventListener("keydown", this.unlock);
      }
    }
  }

  private dropUnlock(): void {
    if (!this.unlock) return;
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
    this.unlock = null;
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ctx.destination);
    this.master = master;

    const noise = ctx.createBuffer(1, ctx.sampleRate * NOISE_S, ctx.sampleRate);
    const data = noise.getChannelData(0);
    // Pink-ish noise (Paul Kellet's economy filter): softer and more like air than white noise.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }
    const loop = (offset: number) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.start(0, offset);
      return src;
    };
    const channel = (input: AudioNode): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      input.connect(gain).connect(master);
      return gain;
    };

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 300;
    windFilter.Q.value = 0.6;
    loop(0).connect(windFilter);
    this.wind = { gain: channel(windFilter), filter: windFilter };

    const tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = "bandpass";
    tyreFilter.frequency.value = 160;
    tyreFilter.Q.value = 0.9;
    loop(0.7).connect(tyreFilter);
    this.tyre = { gain: channel(tyreFilter) };

    // Freewheel: a short loop of sharp clicks, sped up with the wheel.
    const ratchet = ctx.createBuffer(1, Math.round(ctx.sampleRate * RATCHET_LOOP_S), ctx.sampleRate);
    const r = ratchet.getChannelData(0);
    for (let c = 0; c < RATCHET_CLICKS; c++) {
      const at = Math.round((c / RATCHET_CLICKS) * r.length);
      for (let k = 0; k < 90 && at + k < r.length; k++) r[at + k] = (Math.random() * 2 - 1) * Math.exp(-k / 14) * 0.9;
    }
    const ratchetSrc = ctx.createBufferSource();
    ratchetSrc.buffer = ratchet;
    ratchetSrc.loop = true;
    ratchetSrc.start();
    const ratchetFilter = ctx.createBiquadFilter();
    ratchetFilter.type = "highpass";
    ratchetFilter.frequency.value = 1800;
    ratchetSrc.connect(ratchetFilter);
    this.ratchet = { gain: channel(ratchetFilter), source: ratchetSrc };

    // Crowd: voices band of noise, swelling and fading like cheering.
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = "bandpass";
    crowdFilter.frequency.value = 1100;
    crowdFilter.Q.value = 0.6;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    loop(1.3).connect(crowdFilter).connect(swell);
    this.crowd = { gain: channel(swell), swell };

    const click = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate);
    const cd = click.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.004));
    this.clickBuffer = click;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** Follows the ride: called every frame while riding. */
  update(dt: number, s: SoundState): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.wind || !this.tyre || !this.ratchet || !this.crowd) return;
    this.clock += dt;
    const now = ctx.currentTime;
    const v = Math.max(0, s.speedMs);
    // Gusts: two slow waves so the wind never sounds like a fan.
    const gust = 1 + 0.18 * Math.sin(this.clock * 0.7) + 0.1 * Math.sin(this.clock * 1.9 + 1);
    this.wind.gain.gain.setTargetAtTime(Math.min(0.5, (v / 14) ** 2 * 0.28) * gust, now, 0.25);
    this.wind.filter.frequency.setTargetAtTime(250 + v * 55, now, 0.3);
    this.tyre.gain.gain.setTargetAtTime(Math.min(0.3, (v / 15) * 0.2), now, 0.2);
    const clicksPerS = (v / WHEEL_M) * RATCHET_POINTS;
    this.ratchet.source.playbackRate.setTargetAtTime(Math.max(0.05, clicksPerS / (RATCHET_CLICKS / RATCHET_LOOP_S)), now, 0.1);
    this.ratchet.gain.gain.setTargetAtTime(s.coasting && v > 1.2 ? 0.09 : 0, now, 0.06);
    this.crowd.gain.gain.setTargetAtTime(Math.min(1, s.crowd) * 0.32, now, 0.4);
    this.crowd.swell.gain.setTargetAtTime(0.55 + 0.45 * Math.sin(this.clock * 1.3) * Math.sin(this.clock * 0.47), now, 0.2);
  }

  /** Fades everything out (paused, finished, back to the menus). */
  silence(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const ch of [this.wind, this.tyre, this.ratchet, this.crowd]) ch?.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  }

  /** The derailleur's click on a shift. */
  shift(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.clickBuffer || ctx.state !== "running") return;
    const src = ctx.createBufferSource();
    src.buffer = this.clickBuffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(gain).connect(this.master);
    src.start();
  }

  dispose(): void {
    this.dropUnlock();
    void this.ctx?.close();
    this.ctx = null;
  }
}
