import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  Group,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";

import { createAvatar, type Avatar } from "./avatar.ts";
import { GHOST_LAT, RIDER_LAT } from "./riders.ts";
import type { RideSession } from "./session.ts";
import type { RouteDef } from "./routes.ts";
import { QUALITY, type Quality, type QualityId } from "./theme.ts";
import { makeTrackPoint, POST_M, PRE_M, roadCrown, type TrackPoint } from "./track.ts";
import { World } from "./world.ts";

export type CameraMode = "chase" | "follow" | "side" | "pov";
export const CAMERA_MODES: readonly CameraMode[] = ["chase", "follow", "side", "pov"];

export interface EngineStats {
  fps: number;
  frameMs: number;
  dpr: number;
  drawCalls: number;
  triangles: number;
}

const WHEEL_RADIUS_M = 0.34;
/** Metres per crank turn in the default gear (ratio about 2.3 x 2.105 m wheel); sets the ghost's pedalling rate. */
const GHOST_M_PER_REV = 5.5;
const BASE_FOV = 62;
const GRAVITY = 9.81;
/** Bots further than this from the rider are not drawn. */
const BOT_DRAW_M = 180;
/** Name tags show between these camera distances, fading out towards the far one. */
const LABEL_MIN_M = 4;
const LABEL_NEAR_M = 28;
const LABEL_FAR_M = 45;
/** A bot this close to the camera is hidden so it never fills the screen as it rides past the lens. */
const BOT_CAMERA_CLEARANCE_M = 2.4;

interface CameraRig {
  distance: number;
  height: number;
  lookAhead: number;
  lookHeight: number;
  lambda: number;
}

const RIGS: Record<"chase" | "follow", CameraRig> = {
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
  /** Roll into the bend, radians (positive leans left). */
  lean: number;
  /** Which bot this actor draws, -1 for none (or not a bot actor). */
  botIndex: number;
  label: Sprite | null;
  labelTexture: CanvasTexture | null;
}

/** A dark rounded tag with the bot's name and a small "BOT" mark, so nobody mistakes it for a person. */
function drawLabel(texture: CanvasTexture, name: string): void {
  const canvas = texture.image as HTMLCanvasElement;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.font = "700 34px 'Plus Jakarta Sans Variable', system-ui, sans-serif";
  const nameW = g.measureText(name).width;
  g.font = "800 22px 'Plus Jakarta Sans Variable', system-ui, sans-serif";
  const tagW = g.measureText("BOT").width + 16;
  const w = Math.min(canvas.width - 4, nameW + tagW + 36);
  const x = (canvas.width - w) / 2;
  g.fillStyle = "rgba(14,16,18,0.72)";
  g.beginPath();
  g.roundRect(x, 8, w, 48, 24);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = "700 34px 'Plus Jakarta Sans Variable', system-ui, sans-serif";
  g.textBaseline = "middle";
  g.fillText(name, x + 16, 33);
  g.fillStyle = "#58c4de";
  g.beginPath();
  g.roundRect(x + 24 + nameW, 18, tagW, 28, 8);
  g.fill();
  g.fillStyle = "#0e1012";
  g.font = "800 22px 'Plus Jakarta Sans Variable', system-ui, sans-serif";
  g.fillText("BOT", x + 32 + nameW, 33);
  texture.needsUpdate = true;
}

export class Engine {
  readonly stats: EngineStats = { fps: 0, frameMs: 0, dpr: 1, drawCalls: 0, triangles: 0 };
  /** Runs once per frame before drawing, with the clamped frame time in seconds. */
  onTick: ((dt: number) => void) | null = null;
  cameraMode: CameraMode = "chase";
  private jersey = 0xe8e4d8;

  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.25, 4200);
  private readonly quality: Quality;
  private world: World | null = null;
  private env: WebGLRenderTarget | null = null;
  private rider: Actor | null = null;
  private ghost: Actor | null = null;
  private bots: Actor[] = [];
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
  private readonly eye = new Vector3();
  private fov = BASE_FOV;
  private previewAngle = 0.6;
  private running = false;
  private readonly wanted: number[] = [];

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
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    if (this.quality.shadowMap > 0) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFSoftShadowMap;
    }
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

  private makeActor(jersey: number, kind: "rider" | "ghost" | "bot"): Actor {
    const ghost = kind === "ghost";
    const avatar = createAvatar({ jersey, ghost, pbr: this.quality.pbr, shadows: !ghost && this.quality.shadowMap > 0 });
    avatar.group.rotation.y = Math.PI;
    const root = new Group();
    root.rotation.order = "YXZ";
    root.add(avatar.group);
    let label: Sprite | null = null;
    let labelTexture: CanvasTexture | null = null;
    if (kind === "bot") {
      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = 64;
      labelTexture = new CanvasTexture(canvas);
      labelTexture.colorSpace = SRGBColorSpace;
      label = new Sprite(new SpriteMaterial({ map: labelTexture, transparent: true, depthWrite: false, fog: false }));
      label.scale.set(2.1, 0.35, 1);
      label.position.set(0, 2.05, 0);
      label.renderOrder = 5;
      root.add(label);
    }
    return { root, avatar, crank: 0, wheel: 0, stand: 0, tuck: 0, lean: 0, botIndex: -1, label, labelTexture };
  }

  private disposeActor(actor: Actor | null): void {
    if (!actor) return;
    actor.avatar.dispose();
    actor.labelTexture?.dispose();
    actor.label?.material.dispose();
  }

  loadRoute(route: RouteDef): void {
    this.unloadRoute();
    const world = new World(route, this.quality);
    this.world = world;
    this.renderer.setClearColor(new Color(world.theme.fog));
    if (this.quality.pbr) {
      const pmrem = new PMREMGenerator(this.renderer);
      this.env = pmrem.fromScene(world.envScene(), 0.02);
      pmrem.dispose();
      world.scene.environment = this.env.texture;
      world.scene.environmentIntensity = 0.55;
    }
    this.rider = this.makeActor(this.jersey, "rider");
    this.ghost = this.makeActor(0x6fd3a2, "ghost");
    this.ghost.root.visible = false;
    world.scene.add(this.rider.root, this.ghost.root);
    this.bots = [];
    for (let i = 0; i < this.quality.botAvatars; i++) {
      const bot = this.makeActor(0xffffff, "bot");
      bot.root.visible = false;
      world.scene.add(bot.root);
      this.bots.push(bot);
    }
    this.placeActor(this.rider, 0, RIDER_LAT, 0, 0, 1);
    this.cameraSnap();
  }

  /** Recolours the rider's jersey and frame, keeping its place and pedal phase. */
  setJersey(color: number): void {
    this.jersey = color;
    this.rider?.avatar.setJersey(color);
  }

  private unloadRoute(): void {
    this.disposeActor(this.rider);
    this.disposeActor(this.ghost);
    for (const b of this.bots) this.disposeActor(b);
    this.bots = [];
    this.world?.dispose();
    this.env?.dispose();
    this.env = null;
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
    for (const b of this.bots) b.botIndex = -1;
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

  /** Puts [actor] on the road at distance [s] and lateral offset [lat], pitched to the grade and leaning into the bend at [speedMs]. */
  private placeActor(actor: Actor, s: number, lat: number, pitchGrade: number, speedMs: number, dt: number): void {
    const world = this.world;
    if (!world) return;
    const track = world.track;
    const curvature = (track.at(s + 3, this.point).yaw - track.at(s - 3, this.point).yaw) / 6;
    const lean = Math.max(-0.5, Math.min(0.5, Math.atan((speedMs * speedMs * curvature) / GRAVITY)));
    actor.lean = smooth(actor.lean, lean, 5, dt);
    const t = track.at(s, this.point);
    actor.root.position.set(t.x + Math.cos(t.yaw) * lat, t.y + roadCrown(lat), t.z - Math.sin(t.yaw) * lat);
    actor.root.rotation.set(Math.atan(pitchGrade / 100), t.yaw, actor.lean);
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

  /** Draws the nearest bots with the actor pool; an actor keeps its bot while that bot stays among the nearest. */
  private updateBots(session: RideSession, dt: number, moving: boolean): void {
    const world = this.world;
    if (!world) return;
    const { peloton } = session;
    const wanted = this.wanted;
    wanted.length = 0;
    const lo = -PRE_M + 6;
    const hi = world.route.lengthM + POST_M - 6;
    for (let i = 0; i < peloton.bots.length; i++) {
      const gap = peloton.gap(session.distM, peloton.bots[i]!.distM);
      const s = session.distM + gap;
      if (Math.abs(gap) < BOT_DRAW_M && s > lo && s < hi) wanted.push(i);
    }
    wanted.sort((a, b) => Math.abs(peloton.gap(session.distM, peloton.bots[a]!.distM)) - Math.abs(peloton.gap(session.distM, peloton.bots[b]!.distM)));
    wanted.length = Math.min(wanted.length, this.bots.length);
    for (const actor of this.bots) if (actor.botIndex >= 0 && !wanted.includes(actor.botIndex)) actor.botIndex = -1;
    for (const index of wanted) {
      if (this.bots.some((a) => a.botIndex === index)) continue;
      const free = this.bots.find((a) => a.botIndex < 0)!;
      const spec = peloton.bots[index]!.spec;
      free.botIndex = index;
      free.lean = 0;
      free.avatar.setJersey(spec.jersey);
      drawLabel(free.labelTexture!, spec.name);
    }
    for (const actor of this.bots) {
      actor.root.visible = actor.botIndex >= 0;
      if (actor.botIndex < 0) continue;
      const bot = peloton.bots[actor.botIndex]!;
      const s = session.distM + peloton.gap(session.distM, bot.distM);
      const speed = moving ? bot.speedMs : 0;
      this.placeActor(actor, s, bot.lat, world.track.gradeAt(s), speed, dt);
      this.animateActor(actor, moving ? bot.cad : 0, speed, world.track.gradeAt(s), dt);
      // Measured to the rider's chest, about a metre above the road.
      const p = actor.root.position;
      const c = this.camera.position;
      const d = Math.hypot(c.x - p.x, c.y - p.y - 1, c.z - p.z);
      actor.root.visible = d > BOT_CAMERA_CLEARANCE_M;
      const label = actor.label!;
      label.visible = d > LABEL_MIN_M && d < LABEL_FAR_M;
      label.material.opacity = 1 - smoothstep(LABEL_NEAR_M, LABEL_FAR_M, d);
    }
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
    const pov = live && this.cameraMode === "pov";
    rider.root.visible = !pov;

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
    } else if (this.cameraMode === "pov") {
      // From the rider's eyes: over the bars, looking up the road.
      this.eye.set(0, 1.5, -0.42);
      rider.root.localToWorld(this.camGoal.copy(this.eye));
      const ahead = world.track.at(s + 22, this.point);
      this.look.set(ahead.x + Math.cos(ahead.yaw) * RIDER_LAT, ahead.y + 1.15, ahead.z - Math.sin(ahead.yaw) * RIDER_LAT);
      lambda = 30;
      targetFov = 70;
    } else if (this.cameraMode === "side") {
      this.camGoal.set(px - rx * 6.2 + fx * 1.2, py + 1.3, pz - rz * 6.2 + fz * 1.2);
      this.look.set(px + fx * 1.5, py + 0.9, pz + fz * 1.5);
      lambda = 7;
    } else {
      const rig = RIGS[this.cameraMode];
      const speed = session?.speedMs ?? 0;
      const extra = this.reducedMotion ? 0 : Math.min(1.2, speed * 0.05);
      // Sit a little towards the road centre so the rider is framed off-centre, as on TV.
      this.camGoal.set(
        px - fx * (rig.distance + extra) + rx * 0.5,
        py + rig.height,
        pz - fz * (rig.distance + extra) + rz * 0.5,
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
      const amp = Math.min(1, session.speedMs / 18) * (pov ? 0.006 : 0.012);
      this.camera.position.y += Math.sin(this.clock * 31) * amp + Math.sin(this.clock * 17.3) * amp * 0.6;
    }
    this.camera.lookAt(this.look);
    if (pov && !this.reducedMotion) this.camera.rotateZ(rider.lean * 0.6);
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
      const speed = moving ? session.speedMs : 0;
      this.placeActor(rider, session.distM, RIDER_LAT, session.grade, speed, dt);
      this.animateActor(rider, cad, speed, session.grade, dt);
      const gd = session.ghostDistM;
      if (this.ghost) {
        this.ghost.root.visible = gd !== null;
        if (gd !== null) {
          const gt = world.track.at(gd, this.point);
          const ghostSpeed = (session.ghostDistAt(session.timeS + 0.5)! - gd) * 2;
          this.placeActor(this.ghost, gd, GHOST_LAT, gt.grade, moving ? ghostSpeed : 0, dt);
          this.animateActor(this.ghost, moving ? Math.min(110, (ghostSpeed / GHOST_M_PER_REV) * 60) : 0, moving ? ghostSpeed : 0, gt.grade, dt);
        }
      }
      this.updateBots(session, dt, moving);
    } else {
      this.placeActor(rider, 0, RIDER_LAT, world.track.gradeAt(0), 0, dt);
      this.animateActor(rider, 38, 0, 0, dt);
      if (this.ghost) this.ghost.root.visible = false;
      for (const b of this.bots) b.root.visible = false;
    }

    this.updateCamera(dt, false);
    world.update(this.camera, this.clock, dt, !this.reducedMotion, rider.root.position, session ? session.distM : 0);
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
