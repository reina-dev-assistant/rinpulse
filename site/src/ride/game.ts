import { DEFAULT_RIDER_KG, GEARS, GEAR_COUNT } from "../../../src/features/ride/physics.ts";
import type { CtlAction } from "../../../src/features/ride/protocol.ts";
import { CAMERA_MODES, type CameraMode, type Engine } from "./engine.ts";
import { STALE_MS, type DataSource, type LiveSample } from "./live.ts";
import { ROUTES, routeById, type RouteDef } from "./routes.ts";
import { RideSession, hrZone, type RideEvent, type RideResult, type SegmentProgress } from "./session.ts";
import { BleSource } from "./sources/ble.ts";
import { DemoSource } from "./sources/demo.ts";
import { submitResult } from "./sources/leaderboard-api.ts";
import { RoomSource, type RoomCommand } from "./sources/room.ts";
import {
  IntervalTracker,
  dailyChallenge,
  medalFor,
  targetGapS,
  workoutById,
  type DailyChallenge,
  type IntervalBlock,
  type IntervalSnapshot,
  type Medal,
  type ModeId,
} from "./modes.ts";
import {
  loadDailyBest,
  loadGhost,
  loadSegmentBests,
  loadSettings,
  saveDailyBest,
  saveGhost,
  saveSegmentBests,
  saveSettings,
} from "./storage.ts";
import { RideAudio } from "./audio.ts";
import { makeBots } from "./riders.ts";
import { Track } from "./track.ts";

export type Screen = "pair" | "routes" | "ride" | "summary";

/** One row of the riders-nearby list: the player, the ghost, or a pacer bot. */
export interface NearbyRider {
  key: string;
  kind: "you" | "ghost" | "bot";
  name: string;
  /** Metres ahead of the player (negative = behind). */
  gapM: number;
  /** Seconds ahead of the player at the current pace (negative = behind). */
  gapS: number;
  wkg: number | null;
  jersey: number;
}

const NEARBY_BOTS = 5;
export type SummaryDelivery = "sent" | "pending" | "none";

export interface Hud {
  speedKmh: number;
  cad: number | null;
  hr: number | null;
  hrZone: number;
  powerW: number;
  /** Watts per kilogram of the rider's weight. */
  wkg: number;
  powerMeasured: boolean;
  distM: number;
  remainingM: number;
  elevGainM: number;
  grade: number;
  timeS: number;
  gear: number;
  gearLabel: string;
  phase: RideSession["phase"];
  countdownS: number;
  drafting: boolean;
  ghostGapM: number | null;
  signal: boolean;
  lapCount: number;
  segment: { id: string; kind: SegmentProgress["def"]["kind"]; elapsedS: number; bestS: number | null } | null;
  positionM: number;
  ghostPositionM: number | null;
  interval: IntervalSnapshot | null;
  /** Daily challenge: the target and the gap to an even pace towards it (negative = ahead). */
  daily: { targetS: number; gapS: number } | null;
  nearby: NearbyRider[];
  /** Pacer bots' route positions, for the profile. */
  botPositionsM: number[];
}

export const JERSEYS: readonly number[] = [0xe8e4d8, 0x0a6580, 0xd94a3d, 0xf2c230, 0x2f8f4e, 0x1d1d22, 0xe86aa6];

export type Toast =
  | { id: number; kind: "segment-start"; segmentId: string; segKind: "sprint" | "kom"; bestS: number | null }
  | { id: number; kind: "segment-end"; segmentId: string; segKind: "sprint" | "kom"; timeS: number; pb: boolean }
  | { id: number; kind: "lap"; index: number; sec: number }
  | { id: number; kind: "block"; index: number; count: number; block: IntervalBlock };

const HUD_MS = 100;
const STATE_MS = 1000;
const TOAST_MS = 4200;

const EMPTY_HUD: Hud = {
  speedKmh: 0,
  cad: null,
  hr: null,
  hrZone: 1,
  powerW: 0,
  wkg: 0,
  powerMeasured: false,
  distM: 0,
  remainingM: 0,
  elevGainM: 0,
  grade: 0,
  timeS: 0,
  gear: 0,
  gearLabel: "",
  phase: "idle",
  countdownS: 3,
  drafting: false,
  ghostGapM: null,
  signal: false,
  lapCount: 0,
  segment: null,
  positionM: 0,
  ghostPositionM: null,
  interval: null,
  daily: null,
  nearby: [],
  botPositionsM: [],
};

/**
 * Owns one play session: which data source feeds it, which route is picked, the running ride, and what the
 * relay should hear. React reads it through useGame (src/ride/ui/hooks.ts); the 3D engine reads `session`.
 */
export class Game {
  screen: Screen = "pair";
  source: DataSource | null = null;
  route: RouteDef = ROUTES[0]!;
  session: RideSession | null = null;
  result: RideResult | null = null;
  delivery: SummaryDelivery = "none";
  hud: Hud = EMPTY_HUD;
  toast: Toast | null = null;
  cameraMode: CameraMode = "chase";
  /** Latest sensor reading, for the pair screen's live preview. */
  preview: LiveSample | null = null;
  bleError: string | null = null;
  mode: ModeId = "free";
  workoutId = "tempo";
  daily: DailyChallenge = dailyChallenge(Date.now());
  interval: IntervalTracker | null = null;
  /** Medal from the daily challenge, set at the finish. */
  medal: Medal | null = null;
  /** The day's best before this ride, for the summary. */
  dailyBestS: number | null = null;
  jersey: number = loadSettings().jersey ?? JERSEYS[0]!;
  /** Hide the rider's name on the leaderboard. */
  anon: boolean = loadSettings().anon ?? false;
  /** Wind, tyres, freewheel, crowd and shift clicks. */
  readonly audio = new RideAudio(loadSettings().muted ?? false);
  /** What happened to this ride's leaderboard entry. */
  board: BoardSubmit = { state: "none" };
  version = 0;

  private engine: Engine | null = null;
  private listeners = new Set<() => void>();
  private latest: LiveSample | null = null;
  private hudAcc = 0;
  private stateAcc = 0;
  private unsubs: (() => void)[] = [];
  private toastId = 0;
  private toastTimer = 0;
  private previewAt = 0;
  private bests: Record<string, number> = {};

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get room(): RoomSource | null {
    return this.source instanceof RoomSource ? this.source : null;
  }

  get demo(): DemoSource | null {
    return this.source instanceof DemoSource ? this.source : null;
  }

  get ble(): BleSource | null {
    return this.source instanceof BleSource ? this.source : null;
  }

  attachEngine(engine: Engine | null): void {
    if (this.engine) this.engine.onTick = null;
    this.engine = engine;
    if (!engine) return;
    engine.cameraMode = this.cameraMode;
    engine.setJersey(this.jersey);
    engine.onTick = (dt) => this.tick(dt);
    engine.loadRoute(this.route);
    engine.setSession(this.session);
  }

  /** Lets a UI control that changed a source setting (the demo slider) re-render. */
  refresh(): void {
    this.emit();
  }

  dispose(): void {
    this.dropSource();
    window.clearTimeout(this.toastTimer);
    this.audio.dispose();
  }

  // Sources ---------------------------------------------------------------------------------------------------

  private useSource(source: DataSource): void {
    this.dropSource();
    this.source = source;
    this.latest = null;
    this.preview = null;
    this.bleError = null;
    this.unsubs.push(
      source.onSample((s) => {
        this.latest = s;
        if (s.at - this.previewAt > 400) {
          this.previewAt = s.at;
          this.preview = s;
          if (this.screen === "pair") this.emit();
        }
      }),
      source.onState(() => this.emit()),
    );
    if (source instanceof RoomSource) this.unsubs.push(source.onCommand((c) => this.command(c)));
  }

  private dropSource(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.source?.stop();
    this.source = null;
  }

  startPhone(): void {
    const room = new RoomSource();
    this.useSource(room);
    void room.start();
    this.emit();
  }

  async renewRoom(): Promise<void> {
    if (this.room) await this.room.renew();
    else this.startPhone();
    this.emit();
  }

  startDemo(): void {
    const demo = new DemoSource();
    this.useSource(demo);
    void demo.start();
    this.toRoutes();
  }

  /** Must run inside a click handler: the browser only shows the Bluetooth chooser for a user gesture. */
  async addBle(): Promise<void> {
    const ble = this.ble ?? new BleSource();
    if (this.source !== ble) this.useSource(ble);
    this.bleError = null;
    try {
      await ble.start();
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      // The player closing the chooser is not a failure worth showing.
      if (name !== "NotFoundError") this.bleError = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  backToPair(): void {
    if (this.session && this.session.phase !== "finished") this.session.stop();
    this.toScreen("pair");
    this.session = null;
    this.engine?.setSession(null);
    if (!this.room) this.startPhone();
  }

  // Screens ---------------------------------------------------------------------------------------------------

  private toScreen(screen: Screen): void {
    this.screen = screen;
    this.emit();
  }

  toRoutes(): void {
    this.session = null;
    this.audio.silence();
    this.interval = null;
    this.engine?.setSession(null);
    this.hud = EMPTY_HUD;
    this.daily = dailyChallenge(Date.now());
    if (this.mode === "daily") this.selectRoute(this.daily.routeId);
    this.toScreen("routes");
  }

  selectMode(mode: ModeId): void {
    this.mode = mode;
    if (mode === "daily") {
      this.daily = dailyChallenge(Date.now());
      this.selectRoute(this.daily.routeId);
    }
    this.emit();
  }

  selectWorkout(id: string): void {
    this.workoutId = workoutById(id).id;
    this.emit();
  }

  setJersey(color: number): void {
    this.jersey = color;
    saveSettings({ jersey: color });
    this.engine?.setJersey(color);
    this.emit();
  }

  selectRoute(id: string): void {
    const route = routeById(id);
    if (route.id === this.route.id) return;
    this.route = route;
    this.engine?.loadRoute(route);
    this.emit();
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    if (this.engine) this.engine.cameraMode = mode;
    this.emit();
  }

  cycleCamera(): void {
    this.setCameraMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.cameraMode) + 1) % CAMERA_MODES.length]!);
  }

  startRide(): void {
    if (this.mode === "daily" && this.route.id !== this.daily.routeId) this.selectRoute(this.daily.routeId);
    const route = this.route;
    this.bests = loadSegmentBests(route.id);
    const massKg = this.room?.massKg ?? DEFAULT_RIDER_KG;
    const loop = this.mode === "interval";
    this.session = new RideSession(route, new Track(route), {
      massKg,
      ghost: loadGhost(route.id),
      segmentBests: this.bests,
      loop,
      bots: makeBots(route),
    });
    this.interval = loop ? new IntervalTracker(workoutById(this.workoutId)) : null;
    this.medal = null;
    this.dailyBestS = this.mode === "daily" ? loadDailyBest(this.daily.day) : null;
    this.result = null;
    this.delivery = "none";
    this.board = { state: "none" };
    this.hudAcc = 0;
    this.stateAcc = STATE_MS;
    this.engine?.setSession(this.session);
    this.session.startCountdown();
    this.audio.start();
    this.toScreen("ride");
    this.updateHud();
  }

  // Ride controls ---------------------------------------------------------------------------------------------

  shift(d: 1 | -1): void {
    const before = this.session?.gear;
    this.session?.shift(d);
    if (this.session && this.session.gear !== before) this.audio.shift();
    this.updateHud();
    this.emit();
  }

  togglePause(): void {
    const s = this.session;
    if (!s) return;
    if (s.phase === "riding") {
      s.pause();
      this.room?.sendCtl("pause");
    } else if (s.phase === "paused") {
      s.resume();
      this.room?.sendCtl("resume");
    }
    this.updateHud();
    this.emit();
  }

  lap(): void {
    this.session?.lap();
    this.room?.sendCtl("lap");
  }

  finishRide(): void {
    this.session?.stop();
  }

  private command(c: RoomCommand): void {
    if (c.type === "gear") {
      this.shift(c.d);
      return;
    }
    this.fromPhone(c.action);
  }

  /** The phone asked; apply it here without echoing it back. */
  private fromPhone(action: CtlAction): void {
    const s = this.session;
    switch (action) {
      case "start":
        if (this.screen === "routes") this.startRide();
        break;
      case "pause":
        if (s?.phase === "riding") {
          s.pause();
          this.emit();
        }
        break;
      case "resume":
        if (s?.phase === "paused") {
          s.resume();
          this.emit();
        }
        break;
      case "lap":
        s?.lap();
        break;
      case "stop":
        s?.stop();
        break;
    }
  }

  // Frame loop ------------------------------------------------------------------------------------------------

  private signalLive(): boolean {
    return this.latest !== null && Date.now() - this.latest.at < STALE_MS;
  }

  private tick(dt: number): void {
    const s = this.session;
    if (!s) return;
    const live = this.signalLive() ? this.latest : null;
    const wasRiding = s.phase === "riding";
    s.step(dt, { cad: live?.cad, hr: live?.hr, pwr: live?.pwr });
    if (!wasRiding && s.phase === "riding") this.room?.sendCtl("start");
    this.demo?.feed(s.powerW, s.grade);
    const iv = this.interval;
    if (iv && wasRiding && s.phase === "riding") {
      iv.step(dt, live?.cad);
      for (const ev of iv.drainEvents()) {
        if (ev.type === "block") {
          if (ev.index > 0) this.showToast({ kind: "block", index: ev.index, count: iv.workout.blocks.length, block: ev.block });
        } else {
          s.stop();
        }
      }
    }
    for (const ev of s.drainEvents()) this.onEvent(ev);
    if (s.phase === "riding") {
      this.audio.update(dt, { speedMs: s.speedMs, coasting: s.powerW < 1, crowd: this.crowdAt(s.distM) });
    } else {
      this.audio.silence();
    }

    this.hudAcc += dt;
    if (this.hudAcc >= HUD_MS / 1000) {
      this.hudAcc = 0;
      this.updateHud();
      this.emit();
    }
    this.stateAcc += dt;
    if (this.stateAcc >= STATE_MS / 1000) {
      this.stateAcc = 0;
      this.room?.sendState({ ...s.state(), gearCount: GEAR_COUNT, route: this.route.name });
    }
  }

  private updateHud(): void {
    const s = this.session;
    if (!s) return;
    const active = s.segments.find((x) => x.state === "active");
    const hr = s.hr ?? null;
    this.hud = {
      speedKmh: s.speedMs * 3.6,
      cad: s.cad ?? null,
      hr,
      hrZone: hr === null ? 1 : hrZone(hr),
      powerW: s.powerW,
      wkg: s.powerW / s.massKg,
      powerMeasured: s.powerMeasured,
      distM: s.distM,
      remainingM: s.remainingM,
      elevGainM: s.elevGainM,
      grade: s.grade,
      timeS: s.timeS,
      gear: s.gear,
      gearLabel: GEARS[s.gear]?.label ?? "",
      phase: s.phase,
      countdownS: s.countdownS,
      drafting: s.drafting,
      ghostGapM: s.ghostGapM,
      signal: this.signalLive(),
      lapCount: s.laps.length,
      segment: active
        ? { id: active.def.id, kind: active.def.kind, elapsedS: active.elapsedS, bestS: active.bestS }
        : null,
      positionM: s.distM,
      ghostPositionM: s.ghostDistM,
      interval: this.interval?.snapshot() ?? null,
      daily:
        this.mode === "daily"
          ? { targetS: this.daily.targetS, gapS: targetGapS(s.timeS, s.distM, this.route.lengthM, this.daily.targetS) }
          : null,
      nearby: this.nearby(s),
      botPositionsM: s.peloton.bots.map((b) => s.distM + s.peloton.gap(s.distM, b.distM)),
    };
  }

  /** The player, the ghost and the nearest bots, furthest ahead first. A gap in seconds is metres over the slower of the two speeds (at least 3 m/s). */
  private nearby(s: RideSession): NearbyRider[] {
    const rows: NearbyRider[] = [];
    const bots = s.peloton.bots
      .map((b) => ({ b, gapM: s.peloton.gap(s.distM, b.distM) }))
      .sort((x, y) => Math.abs(x.gapM) - Math.abs(y.gapM))
      .slice(0, NEARBY_BOTS);
    for (const { b, gapM } of bots) {
      const gapS = gapM / Math.max(3, Math.min(s.speedMs, b.speedMs));
      rows.push({ key: b.spec.name, kind: "bot", name: b.spec.name, gapM, gapS, wkg: b.powerW / b.spec.kg, jersey: b.spec.jersey });
    }
    const ghostGap = s.ghostGapM;
    if (ghostGap !== null) {
      rows.push({ key: "ghost", kind: "ghost", name: "", gapM: -ghostGap, gapS: -ghostGap / Math.max(3, s.speedMs), wkg: null, jersey: 0x6fd3a2 });
    }
    rows.push({ key: "you", kind: "you", name: "", gapM: 0, gapS: 0, wkg: s.powerW / s.massKg, jersey: this.jersey });
    return rows.sort((a, b) => b.gapM - a.gapM);
  }

  private onEvent(ev: RideEvent): void {
    switch (ev.type) {
      case "segment-start":
        this.showToast({
          kind: "segment-start",
          segmentId: ev.segment.def.id,
          segKind: ev.segment.def.kind,
          bestS: ev.segment.bestS,
        });
        break;
      case "segment-end":
        this.showToast({
          kind: "segment-end",
          segmentId: ev.segment.def.id,
          segKind: ev.segment.def.kind,
          timeS: ev.segment.elapsedS,
          pb: ev.segment.pb,
        });
        break;
      case "lap":
        this.showToast({ kind: "lap", index: ev.index, sec: ev.lap.sec });
        break;
      case "finish":
        this.onFinish();
        break;
    }
  }

  private showToast(toast: DistributiveOmit<Toast, "id">): void {
    this.toast = { ...toast, id: ++this.toastId } as Toast;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.emit();
    }, TOAST_MS);
    this.emit();
  }

  toggleMute(): void {
    this.audio.setMuted(!this.audio.muted);
    saveSettings({ muted: this.audio.muted });
    this.emit();
  }

  /** 0..1: the crowd's loudness, highest in the last metres before the finish and each segment's end banner. */
  private crowdAt(distM: number): number {
    let crowd = 0;
    for (const end of [this.route.lengthM, ...this.route.segments.map((g) => g.endM)]) {
      crowd = Math.max(crowd, 1 - Math.abs(distM - (end - 20)) / 70);
    }
    return crowd;
  }

  private onFinish(): void {
    const s = this.session;
    const result = s?.result;
    if (!s || !result) return;
    this.result = result;
    if (result.complete && result.newBest) {
      saveGhost({ routeId: this.route.id, timeS: result.timeS, trace: result.trace });
    }
    const bests = { ...this.bests };
    for (const seg of result.segments) {
      if (seg.state === "done" && seg.pb) bests[seg.def.id] = seg.elapsedS;
    }
    saveSegmentBests(this.route.id, bests);

    if (this.mode === "daily" && result.complete && this.route.id === this.daily.routeId) {
      this.medal = medalFor(result.timeS, this.daily.targetS);
      if (this.dailyBestS === null || result.timeS < this.dailyBestS) saveDailyBest(this.daily.day, result.timeS);
    }

    const room = this.room;
    const sum = s.summaryMessage();
    if (room && sum) {
      const live = room.state === "live";
      room.sendSum(sum);
      room.sendCtl("stop");
      this.delivery = live ? "sent" : "pending";
    } else {
      this.delivery = "none";
    }
    this.submitToBoard(result);
    this.updateHud();
    window.clearTimeout(this.toastTimer);
    this.toast = null;
    this.toScreen("summary");
  }

  setAnon(anon: boolean): void {
    this.anon = anon;
    saveSettings({ anon });
    this.emit();
  }

  /** Complete route rides through the phone go to the leaderboard; the relay checks it saw the cadence. */
  private submitToBoard(result: RideResult): void {
    if (!result.complete) return;
    const info = this.room?.room;
    if (!info || this.mode === "interval" || result.avgCad === null) {
      this.board = { state: "ineligible" };
      return;
    }
    this.board = { state: "pending" };
    const routeId = this.route.id;
    void submitResult(info, { routeId, timeS: result.timeS, distM: result.distM, avgCad: result.avgCad, anon: this.anon }).then((outcome) => {
      this.board = outcome.ok ? { state: "ok", rank: outcome.rank, routeId } : { state: "failed", error: outcome.error };
      this.emit();
    });
  }
}

export type BoardSubmit =
  | { state: "none" | "pending" | "ineligible" }
  | { state: "ok"; rank: number; routeId: string }
  | { state: "failed"; error: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
