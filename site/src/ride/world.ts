import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { RouteDef, SegmentDef } from "./routes.ts";
import { Scenery } from "./scenery.ts";
import { buildTerrain, chunkGeometry, CHUNK_M, ROWS_PER_CHUNK, SEA_LEVEL } from "./terrain.ts";
import { THEMES, type Quality, type Theme } from "./theme.ts";
import { ROAD_HALF, STEP, Track, makeTrackPoint, PRE_M, type TrackPoint } from "./track.ts";

const ROAD_TILE_M = 8;

function roadTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#4b4d50";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = 58 + Math.floor(Math.random() * 40);
    g.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const px = size / (ROAD_HALF * 2);
  g.fillStyle = "#e9e6dc";
  g.fillRect(px * 0.35, 0, px * 0.12, size);
  g.fillRect(size - px * 0.47, 0, px * 0.12, size);
  g.fillStyle = "#e3c25a";
  g.fillRect(size / 2 - px * 0.07, 0, px * 0.14, size * 0.45);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function bannerTexture(text: string, fg: string, bg: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const g = canvas.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg;
  g.font = "800 54px 'Plus Jakarta Sans Variable', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 52);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function finishTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const g = canvas.getContext("2d")!;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 ? "#f4f4f0" : "#141414";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 col = mix(horizon, top, pow(h, 0.55));
    float sun = max(dot(normalize(vDir), sunDir), 0.0);
    col += sunColor * (pow(sun, 900.0) * 1.6 + pow(sun, 14.0) * 0.18);
    if (vDir.y < 0.0) col = horizon;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function cloudGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [
    [0, 0, 0, 1],
    [1.1, -0.1, 0.2, 0.8],
    [-1.2, -0.15, -0.1, 0.75],
    [0.4, 0.35, 0.1, 0.7],
    [-0.5, 0.25, 0.3, 0.6],
  ];
  for (const [x, y, z, r] of blobs) {
    const g = new IcosahedronGeometry(r * 40, 1).toNonIndexed();
    g.translate(x * 40, y * 40, z * 40);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  merged.scale(1.6, 0.45, 1);
  return merged;
}

export class World {
  readonly scene = new Scene();
  readonly track: Track;
  readonly theme: Theme;
  private readonly sky: Mesh;
  private readonly clouds: Group | null;
  private readonly water: Mesh | null;
  private readonly sunDir: Vector3;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly point: TrackPoint = makeTrackPoint();

  constructor(
    readonly route: RouteDef,
    private readonly quality: Quality,
  ) {
    this.track = new Track(route);
    this.theme = THEMES[route.id];
    const theme = this.theme;
    const own = <T extends { dispose(): void }>(x: T): T => {
      this.disposables.push(x);
      return x;
    };

    this.scene.fog = new Fog(theme.fog, 70, quality.fogFar);
    this.sunDir = new Vector3(...theme.sunDir).normalize();

    this.scene.add(new HemisphereLight(theme.hemiSky, theme.hemiGround, 1.7));
    const sun = new DirectionalLight(theme.sun, 2.4);
    sun.position.copy(this.sunDir).multiplyScalar(200);
    this.scene.add(sun);

    this.sky = new Mesh(
      own(new SphereGeometry(1800, 24, 12)),
      own(
        new ShaderMaterial({
          vertexShader: SKY_VERT,
          fragmentShader: SKY_FRAG,
          side: BackSide,
          depthWrite: false,
          fog: false,
          uniforms: {
            top: { value: new Color(theme.skyTop) },
            horizon: { value: new Color(theme.skyHorizon) },
            sunColor: { value: new Color(theme.sun) },
            sunDir: { value: this.sunDir },
          },
        }),
      ),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    if (quality.clouds) {
      this.clouds = new Group();
      const geometry = own(cloudGeometry());
      const material = own(new MeshLambertMaterial({ color: 0xffffff, emissive: new Color(theme.skyHorizon).multiplyScalar(0.55), fog: false }));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + (i % 3) * 0.2;
        const r = 650 + ((i * 97) % 5) * 90;
        const mesh = new Mesh(geometry, material);
        mesh.position.set(Math.cos(a) * r, 230 + ((i * 53) % 4) * 45, Math.sin(a) * r);
        mesh.rotation.y = a + 1;
        mesh.scale.setScalar(0.8 + ((i * 31) % 5) * 0.2);
        this.clouds.add(mesh);
      }
      this.scene.add(this.clouds);
    } else {
      this.clouds = null;
    }

    this.buildGround();
    this.buildRoad(own);
    this.buildGantries(own);

    if (theme.hasSea) {
      this.water = new Mesh(
        own(new PlaneGeometry(9000, 9000)),
        own(new MeshBasicMaterial({ color: theme.sea, transparent: true, opacity: 0.9 })),
      );
      this.water.rotation.x = -Math.PI / 2;
      this.water.position.y = SEA_LEVEL;
      this.scene.add(this.water);
    } else {
      this.water = null;
    }
  }

  private buildGround(): void {
    const grid = buildTerrain(this.track, this.theme);
    const scenery = new Scenery(this.track, this.theme, this.quality.treeScale, this.route.segments);
    this.disposables.push(scenery);
    const material = new MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(material);
    let chunk = 0;
    for (let r0 = 0; r0 < grid.rows - 1; r0 += ROWS_PER_CHUNK) {
      const r1 = Math.min(grid.rows - 1, r0 + ROWS_PER_CHUNK);
      const geometry = chunkGeometry(grid, r0, r1);
      this.disposables.push(geometry);
      this.scene.add(new Mesh(geometry, material));
      const s0 = r0 * 2 * STEP - PRE_M;
      this.scene.add(scenery.buildChunk(s0, s0 + CHUNK_M, chunk));
      chunk++;
    }
  }

  private buildRoad(own: <T extends { dispose(): void }>(x: T) => T): void {
    const { track } = this;
    const n = track.count;
    const positions = new Float32Array(n * 2 * 3);
    const normals = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    for (let i = 0; i < n; i++) {
      const yaw = track.yaw[i]!;
      const rx = Math.cos(yaw) * ROAD_HALF;
      const rz = -Math.sin(yaw) * ROAD_HALF;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        const o = (i * 2 + side) * 3;
        positions[o] = track.x[i]! + rx * sign;
        positions[o + 1] = track.y[i]! + 0.02;
        positions[o + 2] = track.z[i]! + rz * sign;
        normals[o + 1] = 1;
        const u = (i * 2 + side) * 2;
        uvs[u] = side;
        uvs[u + 1] = (i * STEP) / ROAD_TILE_M;
      }
    }
    const index = new Uint32Array((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    const geometry = own(new BufferGeometry());
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    const material = own(new MeshLambertMaterial({ map: own(roadTexture()) }));
    // The road is one mesh for the whole route, so its bounding sphere always intersects the frustum; the cost is a single draw call.
    this.scene.add(new Mesh(geometry, material));
  }

  /** Start and finish arches, a chequered finish line, and a banner arch at each segment's start and end. */
  private buildGantries(own: <T extends { dispose(): void }>(x: T) => T): void {
    const postGeometry = own(new BoxGeometry(0.3, 6.2, 0.3));
    const postMaterial = own(new MeshLambertMaterial({ color: 0xdedbd2 }));
    const bannerGeometry = own(new PlaneGeometry((ROAD_HALF + 0.8) * 2, 1.1));

    const gantry = (s: number, text: string, fg: string, bg: string) => {
      const t = this.track.at(s, this.point);
      const group = new Group();
      for (const side of [-1, 1]) {
        const post = new Mesh(postGeometry, postMaterial);
        post.position.set(side * (ROAD_HALF + 0.8), 3.1, 0);
        group.add(post);
      }
      const banner = new Mesh(
        bannerGeometry,
        own(new MeshBasicMaterial({ map: own(bannerTexture(text, fg, bg)), side: DoubleSide })),
      );
      banner.position.set(0, 6.0, 0);
      group.add(banner);
      group.position.set(t.x, t.y, t.z);
      group.rotation.y = t.yaw;
      this.scene.add(group);
    };

    gantry(0, "START", "#141414", "#f1efe6");
    gantry(this.route.lengthM, "FINISH", "#f1efe6", "#141414");

    const finish = new Mesh(
      own(new PlaneGeometry(ROAD_HALF * 2, 1.6)),
      own(new MeshBasicMaterial({ map: own(finishTexture()) })),
    );
    const t = this.track.at(this.route.lengthM, this.point);
    finish.rotation.set(-Math.PI / 2, 0, 0);
    const holder = new Group();
    holder.add(finish);
    finish.position.y = 0.05;
    holder.position.set(t.x, t.y, t.z);
    holder.rotation.y = t.yaw;
    this.scene.add(holder);

    for (const seg of this.route.segments) {
      const kom = seg.kind === "kom";
      const bg = kom ? "#c4382c" : "#2f8f4e";
      const label = kom ? "KOM" : "SPRINT";
      gantry(seg.startM, label, "#ffffff", bg);
      gantry(seg.endM, `${label} END`, "#ffffff", bg);
    }
  }

  /** Keeps the sky and the sea centred on the camera, and drifts the clouds slowly. */
  update(camera: PerspectiveCamera, timeS: number, drift: boolean): void {
    const { x, z } = camera.position;
    this.sky.position.set(x, camera.position.y, z);
    if (this.clouds) {
      this.clouds.position.set(x, 0, z);
      if (drift) this.clouds.rotation.y = timeS * 0.002;
    }
    if (this.water) this.water.position.set(x, SEA_LEVEL, z);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.material && !Array.isArray(m.material)) {
        const mat = m.material as MeshBasicMaterial;
        mat.map?.dispose();
      }
    });
    for (const d of this.disposables) d.dispose();
    this.scene.clear();
  }
}
