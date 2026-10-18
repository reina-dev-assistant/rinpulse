import { Color, Group, PerspectiveCamera, Vector3, WebGLRenderer } from "three";

import { createAvatar, type Avatar } from "./avatar.ts";
import type { RideSession } from "./session.ts";
import type { RouteDef } from "./routes.ts";
import { QUALITY, type Quality, type QualityId } from "./theme.ts";
import { makeTrackPoint, type TrackPoint } from "./track.ts";
import { World } from "./world.ts";

export type CameraMode = "chase" | "follow" | "side";
export const CAMERA_MODES: readonly CameraMode[] = ["chase", "follow", "side"];

export interface EngineStats {
  fps: number;
  frameMs: number;
  dpr: number;
  drawCalls: number;
  triangles: number;
}

const RIDER_LAT = 0.9;
const GHOST_LAT = -0.9;
const WHEEL_RADIUS_M = 0.34;
/** Metres per crank turn in the default gear (ratio about 2.3 x 2.105 m wheel); sets the ghost's pedalling rate. */
const GHOST_M_PER_REV = 5.5;
const BASE_FOV = 62;

interface CameraRig {
  distance: number;
  height: number;
  lookAhead: number;
  lookHeight: number;
  lambda: number;
}

const RIGS: Record<Exclude<CameraMode, "side">, CameraRig> = {
  chase: { distance: 4.6, height: 2.0, lookAhead: 6, lookHeight: 1.0, lambda: 9 },
  follow: { distance: 9.5, height: 4.4, lookAhead: 5, lookHeight: 0.8, lambda: 6 },
};

function smooth(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface Actor {
  root: Group;
  avatar: Avatar;
  crank: number;
  wheel: number;
  stand: number;
  tuck: number;
}

export class Engine {
  readonly stats: EngineStats = { fps: 0, frameMs: 0, dpr: 1, drawCalls: 0, triangles: 0 };
  /** Runs once per frame before drawing, with the clamped frame time in seconds. */
  onTick: ((dt: number) => void) | null = null;
  cameraMode: CameraMode = "chase";
  private jersey = 0xe8e4d8;

  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.3, 3000);
  private readonly quality: Quality;
  private world: World | null = null;
  private rider: Actor | null = null;
  private ghost: Actor | null = null;
  private session: RideSession | null = null;
  private raf = 0;
  private last = 0;
  private clock = 0;
  private dpr: number;
  private slowFrames = 0;
  private fastFrames = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private resizeObserver: ResizeObserver;
  private readonly point: TrackPoint = makeTrackPoint();
  private readonly look = new Vector3();
  private readonly camGoal = new Vector3();
  private fov = BASE_FOV;
  private previewAngle = 0.6;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    qualityId: QualityId,
    private readonly reducedMotion: boolean,
  ) {
    this.quality = QUALITY[qualityId];
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.quality.antialias,
      powerPreference: "high-performance",
    });
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality.dprMax);
    this.renderer.setPixelRatio(this.dpr);
    this.stats.dpr = this.dpr;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private makeActor(jersey: number, ghost: boolean): Actor {
    const avatar = createAvatar({ jersey, ghost });
    avatar.group.rotation.y = Math.PI;
    const root = new Group();
    root.rotation.order = "YXZ";
    root.add(avatar.group);
    return { root, avatar, crank: 0, wheel: 0, stand: 0, tuck: 0 };
  }

  loadRoute(route: RouteDef): void {
    this.unloadRoute();
    const world = new World(route, this.quality);
    this.world = world;
    this.renderer.setClearColor(new Color(world.theme.fog));
    this.rider = this.makeActor(this.jersey, false);
    this.ghost = this.makeActor(0x6fd3a2, true);
    this.ghost.root.visible = false;
    world.scene.add(this.rider.root, this.ghost.root);
    this.placeActor(this.rider, 0, RIDER_LAT, 0);
    this.cameraSnap();
  }

  /** Rebuilds the rider in a new jersey colour, keeping its place and pedal phase. */
  setJersey(color: number): void {
    this.jersey = color;
    const world = this.world;
    const old = this.rider;
    if (!world || !old) return;
    const next = this.makeActor(color, false);
    next.root.position.copy(old.root.position);
    next.root.rotation.copy(old.root.rotation);
    next.crank = old.crank;
    next.wheel = old.wheel;
    world.scene.remove(old.root);
    old.avatar.dispose();
    world.scene.add(next.root);
    this.rider = next;
  }

  private unloadRoute(): void {
    this.rider?.avatar.dispose();
    this.ghost?.avatar.dispose();
    this.world?.dispose();
    this.rider = null;
    this.ghost = null;
    this.world = null;
  }

  setSession(session: RideSession | null): void {
    this.session = session;
    if (this.rider) {
      this.rider.crank = 0;
      this.rider.wheel = 0;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.fpsSince = this.last;
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.unloadRoute();
    this.renderer.dispose();
  }

  private placeActor(actor: Actor, s: number, lat: number, pitchGrade: number): void {
    const world = this.world;
    if (!world) return;
    const t = world.track.at(s, this.point);
    actor.root.position.set(t.x + Math.cos(t.yaw) * lat, t.y + 0.02, t.z - Math.sin(t.yaw) * lat);
    actor.root.rotation.y = t.yaw;
    actor.root.rotation.x = Math.atan(pitchGrade / 100);
  }

  private animateActor(actor: Actor, cadRpm: number, speedMs: number, grade: number, dt: number): void {
    actor.crank += ((cadRpm * Math.PI * 2) / 60) * dt;
    actor.wheel += (speedMs / WHEEL_RADIUS_M) * dt;
    const climbing = cadRpm > 0 ? smoothstep(5.5, 8, grade) : 0;
    const fast = smoothstep(11, 15, speedMs) * (1 - smoothstep(1.5, 3, Math.abs(grade)));
    actor.stand = smooth(actor.stand, climbing, 3, dt);
    actor.tuck = smooth(actor.tuck, fast, 2, dt);
    actor.avatar.update({ crankAngle: actor.crank, wheelAngle: actor.wheel, stand: actor.stand, tuck: actor.tuck });
  }

  private cameraSnap(): void {
    this.camera.position.set(0, 0, 0);
    this.updateCamera(0.5, true);
  }

  private updateCamera(dt: number, snap: boolean): void {
    const world = this.world;
    const rider = this.rider;
    if (!world || !rider) return;
    const session = this.session;
    const live = session !== null && session.phase !== "idle";
    const s = session ? session.distM : 0;
    const t = world.track.at(s, this.point);
    const fx = t.tx;
    const fz = t.tz;
    const rx = Math.cos(t.yaw);
    const rz = -Math.sin(t.yaw);
    const px = rider.root.position.x;
    const py = rider.root.position.y;
    const pz = rider.root.position.z;

    let lambda: number;
    let targetFov = BASE_FOV;
    if (!live) {
      // Attract view while the player pairs and picks a route: a slow sway behind the rider on the start line,
      // kept between the start gantry's posts.
      if (!this.reducedMotion) this.previewAngle += dt * 0.12;
      const r = 4.6;
      const a = 0.55 + Math.sin(this.previewAngle) * 0.35;
      this.camGoal.set(px + (rx * Math.sin(a) - fx * Math.cos(a)) * r, py + 2.1, pz + (rz * Math.sin(a) - fz * Math.cos(a)) * r);
      this.look.set(px, py + 1.0, pz);
      lambda = 4;
    } else if (this.cameraMode === "side") {
      this.camGoal.set(px - rx * 6.2 + fx * 1.2, py + 1.3, pz - rz * 6.2 + fz * 1.2);
      this.look.set(px + fx * 1.5, py + 0.9, pz + fz * 1.5);
      lambda = 7;
    } else {
      const rig = RIGS[this.cameraMode];
      const speed = session?.speedMs ?? 0;
      const extra = this.reducedMotion ? 0 : Math.min(1.2, speed * 0.05);
      this.camGoal.set(
        px - fx * (rig.distance + extra) - rx * RIDER_LAT * 0.6,
        py + rig.height,
        pz - fz * (rig.distance + extra) - rz * RIDER_LAT * 0.6,
      );
      this.look.set(px + fx * rig.lookAhead, py + rig.lookHeight, pz + fz * rig.lookAhead);
      lambda = rig.lambda;
      if (!this.reducedMotion) targetFov = BASE_FOV + Math.min(11, speed * 0.4);
    }

    if (snap) this.camera.position.copy(this.camGoal);
    else {
      const k = 1 - Math.exp(-lambda * dt);
      this.camera.position.lerp(this.camGoal, k);
    }
    this.fov = smooth(this.fov, targetFov, 2.5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.02) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Shake only at speed and only when the player has not asked for reduced motion.
    if (live && !this.reducedMotion && session) {
      const amp = Math.min(1, session.speedMs / 18) * 0.012;
      this.camera.position.y += Math.sin(this.clock * 31) * amp + Math.sin(this.clock * 17.3) * amp * 0.6;
    }
    this.camera.lookAt(this.look);
  }

  private frame(now: number): void {
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(0.1, Math.max(0, raw));
    this.clock += dt;
    this.onTick?.(dt);

    const world = this.world;
    const rider = this.rider;
    if (!world || !rider) return;
    const session = this.session;

    if (session && session.phase !== "idle") {
      const moving = session.phase === "riding";
      const cad = moving ? (session.cad ?? 0) : 0;
      this.placeActor(rider, session.distM, RIDER_LAT, session.grade);
      this.animateActor(rider, cad, moving ? session.speedMs : 0, session.grade, dt);
      const gd = session.ghostDistM;
      if (this.ghost) {
        this.ghost.root.visible = gd !== null;
        if (gd !== null) {
          const gt = world.track.at(gd, this.point);
          const ghostSpeed = (session.ghostDistAt(session.timeS + 0.5)! - gd) * 2;
          this.placeActor(this.ghost, gd, GHOST_LAT, gt.grade);
          this.animateActor(this.ghost, moving ? Math.min(110, (ghostSpeed / GHOST_M_PER_REV) * 60) : 0, moving ? ghostSpeed : 0, gt.grade, dt);
        }
      }
    } else {
      this.placeActor(rider, 0, RIDER_LAT, world.track.gradeAt(0));
      this.animateActor(rider, 38, 0, 0, dt);
      if (this.ghost) this.ghost.root.visible = false;
    }

    this.updateCamera(dt, false);
    world.update(this.camera, this.clock, !this.reducedMotion);
    this.renderer.render(world.scene, this.camera);

    this.measure(now, raw);
  }

  /** FPS counter and the dynamic resolution loop: shed pixels when frames run long, win them back when there is headroom. */
  private measure(now: number, rawDt: number): void {
    const ms = rawDt * 1000;
    this.fpsFrames++;
    this.fpsAcc += ms;
    if (now - this.fpsSince >= 1000) {
      this.stats.fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
      this.stats.frameMs = this.fpsAcc / this.fpsFrames;
      this.fpsFrames = 0;
      this.fpsAcc = 0;
      this.fpsSince = now;
      const info = this.renderer.info.render;
      this.stats.drawCalls = info.calls;
      this.stats.triangles = info.triangles;
    }
    if (ms > 24 && ms < 250) {
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (ms < 15) {
      this.fastFrames++;
      this.slowFrames = 0;
    } else {
      this.slowFrames = 0;
      this.fastFrames = 0;
    }
    if (this.slowFrames >= 45 && this.dpr > this.quality.dprMin) {
      this.setDpr(Math.max(this.quality.dprMin, this.dpr - 0.15));
      this.slowFrames = 0;
    } else if (this.fastFrames >= 300) {
      const ceiling = Math.min(window.devicePixelRatio || 1, this.quality.dprMax);
      if (this.dpr < ceiling) this.setDpr(Math.min(ceiling, this.dpr + 0.1));
      this.fastFrames = 0;
    }
  }

  private setDpr(dpr: number): void {
    this.dpr = dpr;
    this.stats.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.resize();
  }
}
