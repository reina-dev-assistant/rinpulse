import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { BRAND_DOT, BRAND_INK, BRAND_RING, drawMark } from "./brand.ts";
import { buildRoadside } from "./roadside.ts";
import type { RouteDef } from "./routes.ts";
import { Scenery } from "./scenery.ts";
import { buildTerrain, chunkGeometry, CHUNK_M, groundDetailTexture, ROWS_PER_CHUNK, SEA_LEVEL, terrainMaterial } from "./terrain.ts";
import { THEMES, type Quality, type Theme } from "./theme.ts";
import { ROAD_HALF, STEP, Track, makeTrackPoint, PRE_M, roadCrown, type TrackPoint } from "./track.ts";
import { Traffic } from "./traffic.ts";

/** Metres of road one repeat of the asphalt texture covers. */
const ROAD_TILE_M = 32;
/** Half-extent of the sun's shadow box around the rider, metres. */
const SHADOW_HALF_M = 30;

type Own = <T extends { dispose(): void }>(x: T) => T;

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise repeating every [px] by [py] cells. */
function tiled(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const wx = (v: number) => ((v % px) + px) % px;
  const wy = (v: number) => ((v % py) + py) % py;
  const a = hash(wx(ix), wy(iy), seed);
  const b = hash(wx(ix + 1), wy(iy), seed);
  const c = hash(wx(ix), wy(iy + 1), seed);
  const d = hash(wx(ix + 1), wy(iy + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Asphalt for one ROAD_TILE_M stretch, across the full road width: aggregate grain, darker polished wheel tracks in each lane, repair
 * patches, hairline cracks, white edge lines and the broken white centre line (3 m paint, 5 m gap). Returns the colour map and a
 * matching height map for the bump.
 */
function roadTextures(): { map: CanvasTexture; bump: CanvasTexture } {
  const W = 256;
  const H = 1024;
  const pxPerM = W / (ROAD_HALF * 2);
  const pyPerM = H / ROAD_TILE_M;
  const color = new Uint8ClampedArray(W * H * 4);
  const height = new Uint8ClampedArray(W * H * 4);
  const patches = [
    [0.3, 0.45, 3.2, 9.5, 1.6, 2.4],
    [-2.6, -1.2, 18, 22.5, -1.4, 1.6],
    [1.2, 3.3, 26, 27.6, 0, 0],
  ];
  for (let y = 0; y < H; y++) {
    const along = y / pyPerM;
    for (let x = 0; x < W; x++) {
      const lat = x / pxPerM - ROAD_HALF;
      const grain = hash(x, y, 1);
      const blot = tiled(x / 24, y / 24, W / 24, H / 24, 2) * 0.6 + tiled(x / 6, y / 6, W / 6, H / 6, 3) * 0.4;
      let v = 0.27 + blot * 0.07 + (grain - 0.5) * 0.09;
      if (grain > 0.985) v += 0.16;
      let bump = 0.5 + (grain - 0.5) * 0.7;
      // Wheel tracks: the tyres polish the stone, darker and smoother.
      const laneCentre = Math.abs(lat) - ROAD_HALF / 2;
      const track = Math.max(0, 1 - Math.abs(Math.abs(laneCentre) - 0.8) / 0.35);
      v -= track * 0.035;
      bump = 0.5 + (bump - 0.5) * (1 - track * 0.6);
      // Oil down the middle of each lane.
      v -= Math.max(0, 1 - Math.abs(laneCentre) / 0.3) * 0.02 * tiled(x / 10, y / 40, W / 10, H / 40, 4);
      for (const [l0, l1, a0, a1] of patches) {
        if (lat > l0! && lat < l1! && along > a0! && along < a1!) {
          v = 0.22 + (grain - 0.5) * 0.05 + blot * 0.03;
          bump = 0.5 + (grain - 0.5) * 0.3;
        }
      }
      // Paint: edge lines 0.3 m in from each side, the centre line in 3 m dashes every 8 m. Worn by the traffic.
      const edge = Math.abs(Math.abs(lat) - (ROAD_HALF - 0.36)) < 0.07;
      const centre = Math.abs(lat) < 0.065 && along % 8 < 3;
      if (edge || centre) {
        const wear = tiled(x / 3, y / 3, W / 3, H / 3, 5);
        const paint = 0.78 + wear * 0.12 - (grain > 0.8 ? 0.15 : 0);
        v = v + (paint - v) * (wear > 0.18 ? 1 : 0.4);
        bump = 0.62;
      }
      const o = (y * W + x) * 4;
      color[o] = v * 255;
      color[o + 1] = v * 255 * 1.01;
      color[o + 2] = v * 255 * 1.035;
      color[o + 3] = 255;
      height[o] = height[o + 1] = height[o + 2] = bump * 255;
      height[o + 3] = 255;
    }
  }
  // Hairline cracks: random walks, darker and lower.
  for (let c = 0; c < 14; c++) {
    let x = hash(c, 0, 7) * W;
    let y = hash(c, 1, 7) * H;
    let dir = hash(c, 2, 7) * Math.PI * 2;
    for (let k = 0; k < 120; k++) {
      dir += (hash(c, k, 8) - 0.5) * 0.9;
      x = (x + Math.cos(dir) + W) % W;
      y = (y + Math.sin(dir) * 1.6 + H) % H;
      const o = (Math.floor(y) * W + Math.floor(x)) * 4;
      color[o] = color[o]! * 0.6;
      color[o + 1] = color[o + 1]! * 0.6;
      color[o + 2] = color[o + 2]! * 0.6;
      height[o] = height[o + 1] = height[o + 2] = 40;
    }
  }
  const make = (data: Uint8ClampedArray<ArrayBuffer>, srgb: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.getContext("2d")!.putImageData(new ImageData(data, W, H), 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  };
  return { map: make(color, true), bump: make(height, false) };
}

/** Tileable ripple normal map for the sea. */
function waveNormalTexture(): CanvasTexture {
  const size = 128;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[y * size + x] = tiled(x / 16, y / 16, 8, 8, 21) * 0.6 + tiled(x / 6, y / 6, size / 6, size / 6, 22) * 0.3 + tiled(x / 32, y / 8, 4, 16, 23) * 0.5;
    }
  }
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (xx: number, yy: number) => h[((yy + size) % size) * size + ((xx + size) % size)]!;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 3;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      data[o] = (-dx / len) * 127 + 128;
      data[o + 1] = (-dy / len) * 127 + 128;
      data[o + 2] = (1 / len) * 127 + 128;
      data[o + 3] = 255;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")!.putImageData(new ImageData(data, size, size), 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** A gantry banner; the start and finish ones carry the JoyoFit mark at both ends. */
function bannerTexture(text: string, fg: string, bg: string, mark: { ring: string; dot: string } | null = null): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const g = canvas.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  if (mark) for (const x of [52, 460]) drawMark(g, x, 48, 76, mark.ring, mark.dot);
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

/** A soft round puff for the volcano's plume. */
function puffTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  for (let i = 0; i < 9; i++) {
    const x = 64 + Math.cos(i * 2.4) * 22 * (i % 3 === 0 ? 0 : 1);
    const y = 64 + Math.sin(i * 2.4) * 18 * (i % 3 === 0 ? 0 : 1);
    const r = i % 3 === 0 ? 58 : 34;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
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

/** Gradient sky with a bright haze band on the horizon (warmer towards the sun), the sun's disc, its glow and a wide forward scatter. */
const SKY_FRAG = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = max(dir.y, 0.0);
    float sun = max(dot(dir, sunDir), 0.0);
    vec3 col = mix(horizon, top, pow(h, 0.5));
    // Haze hugging the horizon, lifted and warmed on the sun's side.
    float haze = exp(-h * 9.0);
    col = mix(col, horizon * 1.04 + sunColor * 0.06 * pow(sun, 3.0), haze * 0.75);
    col += sunColor * (smoothstep(0.9994, 0.99965, sun) * 6.0 + pow(sun, 220.0) * 0.9 + pow(sun, 18.0) * 0.16 + pow(sun, 3.0) * 0.05);
    if (dir.y < 0.0) col = mix(horizon, horizon * 0.92, clamp(-dir.y * 4.0, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
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
    [1.9, -0.25, -0.1, 0.5],
    [-2.0, -0.3, 0.2, 0.45],
  ];
  for (const [x, y, z, r] of blobs) {
    const g = new IcosahedronGeometry(r * 40, 2).toNonIndexed();
    g.translate(x * 40, y * 40, z * 40);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  merged.scale(1.6, 0.45, 1);
  return merged;
}

/**
 * Two rings of mountain ridges far beyond the terrain, coloured into the haze (farther = paler). They follow the camera across the
 * ground like the sky, so they read as very distant. On the coast the sea side is left flat. Around Bromo they stand behind the
 * caldera (the far wall of the Tengger caldera), so the rings are pushed out with the same angular size.
 */
function ridgeGeometry(theme: Theme, baseY: number): BufferGeometry {
  const N = 360;
  const far = theme.volcanoes ? 1.9 : 1;
  const layers = [
    { r: 1650 * far, scale: far, haze: 0.45, seed: 1 },
    { r: 1250 * far, scale: 0.62 * far, haze: 0.28, seed: 2 },
  ];
  const ridge = new Color(theme.ridge);
  const horizon = new Color(theme.skyHorizon);
  const positions: number[] = [];
  const colors: number[] = [];
  const top = new Color();
  const bottom = new Color();
  for (const layer of layers) {
    const phase = [hash(layer.seed, 1, theme.seed), hash(layer.seed, 2, theme.seed), hash(layer.seed, 3, theme.seed), hash(layer.seed, 4, theme.seed)].map((p) => p * Math.PI * 2);
    const heightAt = (a: number) => {
      const n =
        0.45 * Math.abs(Math.sin(a * 2 + phase[0]!)) +
        0.3 * (0.5 + 0.5 * Math.sin(a * 5 + phase[1]!)) +
        0.17 * Math.abs(Math.sin(a * 11 + phase[2]!)) +
        0.08 * (0.5 + 0.5 * Math.sin(a * 37 + phase[3]!));
      const sea = theme.hasSea ? 1 - smoothstep(-0.35, 0.15, Math.cos(a)) : 1;
      return theme.ridgeHeight * layer.scale * (0.15 + 0.85 * n) * sea;
    };
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const h0 = heightAt(a0);
      const h1 = heightAt(a1);
      // Slopes facing the light a little brighter.
      const lit = 0.92 + 0.16 * Math.sign(h1 - h0) * Math.min(1, Math.abs(h1 - h0) / 6);
      top.copy(ridge).multiplyScalar(lit).lerp(horizon, layer.haze);
      bottom.copy(ridge).lerp(horizon, Math.min(1, layer.haze + 0.3));
      const quad = [
        [a0, baseY - 900, bottom],
        [a1, baseY - 900, bottom],
        [a1, baseY + h1, top],
        [a0, baseY - 900, bottom],
        [a1, baseY + h1, top],
        [a0, baseY + h0, top],
      ] as const;
      for (const [a, y, c] of quad) {
        positions.push(Math.cos(a) * layer.r, y, -Math.sin(a) * layer.r);
        colors.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  return g;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * A volcano as a lathe: [profile] of [radius, height] pairs from the base up, gullies cut by [ribs] around it, coloured base to
 * summit with the light from [sun] baked in (drawn unlit, like the rest of the hazy backdrop).
 */
function volcanoGeometry(
  profile: readonly (readonly [number, number])[],
  ribs: number,
  ribDepth: number,
  base: number,
  summit: number,
  seed: number,
  sun: Vector3,
): BufferGeometry {
  const lathe = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    96,
  ).toNonIndexed();
  const pos = lathe.getAttribute("position");
  const maxY = Math.max(...profile.map((p) => p[1]));
  const ribAt = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const angle = Math.atan2(z, x);
    const rib = Math.abs(Math.sin(angle * ribs + hash(Math.floor(angle * 3), 0, seed) * 2));
    const k = 1 + ribDepth * (rib - 0.5) * Math.min(1, Math.max(0, y) / (maxY * 0.3));
    pos.setXYZ(i, x * k, y, z * k);
    ribAt[i] = rib;
  }
  lathe.computeVertexNormals();
  const normal = lathe.getAttribute("normal");
  const colors = new Float32Array(pos.count * 3);
  const a = new Color(base);
  const b = new Color(summit);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const lit = Math.max(0, normal.getX(i) * sun.x + normal.getY(i) * sun.y + normal.getZ(i) * sun.z);
    c.copy(a)
      .lerp(b, Math.max(0, pos.getY(i)) / maxY)
      .multiplyScalar((0.86 + ribAt[i]! * 0.2) * (0.62 + 0.5 * lit + 0.08 * normal.getY(i)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  lathe.setAttribute("color", new BufferAttribute(colors, 3));
  return lathe;
}

interface Puff {
  sprite: Sprite;
  phase: number;
}

export class World {
  readonly scene = new Scene();
  readonly track: Track;
  readonly theme: Theme;
  private readonly sky: Mesh;
  private readonly skyMaterial: ShaderMaterial;
  private readonly skyGeometry: SphereGeometry;
  private readonly clouds: Group | null;
  private readonly water: Mesh | null;
  private readonly waterNormal: CanvasTexture | null = null;
  private readonly sun: DirectionalLight;
  private readonly sunDir: Vector3;
  /** Far scenery that moves with the camera across the ground: ridges and, on Bromo, the volcanoes. */
  private readonly backdrop = new Group();
  private readonly puffs: Puff[] = [];
  private readonly traffic: Traffic;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly point: TrackPoint = makeTrackPoint();

  constructor(
    readonly route: RouteDef,
    private readonly quality: Quality,
  ) {
    this.track = new Track(route);
    this.theme = THEMES[route.id];
    const theme = this.theme;
    const own: Own = (x) => {
      this.disposables.push(x);
      return x;
    };

    this.scene.fog = new Fog(theme.fog, 70, quality.fogFar);
    this.sunDir = new Vector3(...theme.sunDir).normalize();

    this.scene.add(new HemisphereLight(theme.hemiSky, theme.hemiGround, 1.35));
    this.sun = new DirectionalLight(theme.sun, 2.9);
    this.sun.position.copy(this.sunDir).multiplyScalar(200);
    if (quality.shadowMap > 0) {
      const { shadow } = this.sun;
      this.sun.castShadow = true;
      shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
      shadow.camera.left = -SHADOW_HALF_M;
      shadow.camera.right = SHADOW_HALF_M;
      shadow.camera.top = SHADOW_HALF_M;
      shadow.camera.bottom = -SHADOW_HALF_M;
      shadow.camera.near = 1;
      shadow.camera.far = 400;
      shadow.bias = -0.0004;
      shadow.normalBias = 0.03;
      shadow.camera.updateProjectionMatrix();
    }
    this.scene.add(this.sun, this.sun.target);

    this.skyGeometry = own(new SphereGeometry(1800, 32, 16));
    this.skyMaterial = own(
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
    );
    this.sky = new Mesh(this.skyGeometry, this.skyMaterial);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    if (quality.clouds) {
      this.clouds = new Group();
      const geometry = own(cloudGeometry());
      const material = own(new MeshLambertMaterial({ color: 0xffffff, emissive: new Color(theme.skyHorizon).multiplyScalar(0.6), fog: false }));
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + (i % 3) * 0.2;
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

    this.buildBackdrop(own);
    this.buildGround(own);
    this.buildRoad(own);
    this.buildGantries(own);
    this.scene.add(buildRoadside(this.track, theme, route, own, quality.shadowMap > 0));
    this.traffic = own(new Traffic(this.track, theme.volcanoes, quality.botAvatars >= 6 ? 6 : 3, theme.seed, quality.shadowMap > 0));
    this.scene.add(this.traffic.group);

    if (theme.hasSea) {
      let material: Material;
      if (quality.pbr) {
        this.waterNormal = own(waveNormalTexture());
        this.waterNormal.repeat.set(9000 / 40, 9000 / 40);
        material = new MeshStandardMaterial({
          color: theme.sea,
          roughness: 0.12,
          metalness: 0,
          normalMap: this.waterNormal,
          normalScale: new Vector2(0.55, 0.55),
          transparent: true,
          opacity: 0.93,
        });
      } else {
        material = new MeshBasicMaterial({ color: theme.sea, transparent: true, opacity: 0.9 });
      }
      this.water = new Mesh(own(new PlaneGeometry(9000, 9000)), own(material));
      this.water.rotation.x = -Math.PI / 2;
      this.water.position.y = SEA_LEVEL;
      this.water.receiveShadow = quality.shadowMap > 0;
      this.scene.add(this.water);
    } else {
      this.water = null;
    }
  }

  /** A scene with only the sky, for the image-based light the PBR materials reflect. */
  envScene(): Scene {
    const scene = new Scene();
    const sky = new Mesh(this.skyGeometry, this.skyMaterial);
    sky.frustumCulled = false;
    scene.add(sky);
    return scene;
  }

  /**
   * Heights here are relative to the camera's eye level (`update` lifts the group with the camera): the backdrop is far enough that
   * it should sit at the same angle above the horizon all ride long.
   */
  private buildBackdrop(own: Own): void {
    const { theme, track } = this;
    const ridges = new Mesh(own(ridgeGeometry(theme, -60)), own(new MeshBasicMaterial({ vertexColors: true, fog: false, side: DoubleSide })));
    ridges.frustumCulled = false;
    this.backdrop.add(ridges);

    if (theme.volcanoes) {
      // The caldera lies beyond the end of the climb: Bromo's ash cone and ribbed Batok side by side on the sand sea, Semeru far behind.
      const end = track.at(this.route.lengthM, makeTrackPoint());
      const start = track.at(0, makeTrackPoint());
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const len = Math.hypot(dx, dz);
      const fx = dx / len;
      const fz = dz / len;
      const rx = -fz;
      const rz = fx;
      // Sizes are scaled to the angles the real ones fill from the Penanjakan rim: the caldera floor about 5 degrees below eye level,
      // Bromo's rim and Batok's top near the horizon, Semeru 3 degrees above it.
      const floor = -150;
      const horizon = new Color(theme.skyHorizon);
      const haze = (hex: number, k: number) => new Color(hex).lerp(horizon, k).getHex();
      const place = (geometry: BufferGeometry, along: number, side: number, y: number) => {
        const mesh = new Mesh(own(geometry), volcanoMat);
        mesh.position.set(fx * along + rx * side, y, fz * along + rz * side);
        mesh.frustumCulled = false;
        this.backdrop.add(mesh);
        return mesh;
      };
      const volcanoMat = own(new MeshBasicMaterial({ vertexColors: true, fog: false }));
      // Sand sea (Laut Pasir).
      const sand = new Mesh(own(new CircleGeometry(1250, 48).rotateX(-Math.PI / 2)), own(new MeshBasicMaterial({ color: haze(0x6e675e, 0.3), fog: false })));
      sand.position.set(fx * 1950, floor, fz * 1950);
      this.backdrop.add(sand);
      const bromoX = 1750;
      const bromoSide = 260;
      place(
        volcanoGeometry(
          [
            [520, -10],
            [400, 60],
            [270, 125],
            [165, 158],
            [125, 140],
            [60, 95],
            [0, 85],
          ],
          26,
          0.12,
          haze(0x8a8076, 0.22),
          haze(0x6b625a, 0.2),
          5,
          this.sunDir,
        ),
        bromoX,
        bromoSide,
        floor,
      );
      place(
        volcanoGeometry(
          [
            [430, -10],
            [330, 70],
            [225, 150],
            [120, 210],
            [40, 232],
            [0, 234],
          ],
          34,
          0.22,
          haze(0x6f7a58, 0.22),
          haze(0x5b6648, 0.2),
          9,
          this.sunDir,
        ),
        bromoX - 220,
        bromoSide - 700,
        floor,
      );
      // Semeru: big, far and blue with distance.
      place(
        volcanoGeometry(
          [
            [1500, -20],
            [1000, 170],
            [600, 370],
            [250, 510],
            [80, 560],
            [0, 563],
          ],
          40,
          0.08,
          haze(0x5a636e, 0.42),
          haze(0x7a7d80, 0.36),
          13,
          this.sunDir,
        ),
        3400,
        1100,
        -200,
      );
      // Bromo's ash plume: soft puffs rising from the crater and drifting downwind.
      const puffTex = own(puffTexture());
      for (let i = 0; i < 9; i++) {
        const sprite = new Sprite(own(new SpriteMaterial({ map: puffTex, color: 0xd8d4cc, transparent: true, depthWrite: false, fog: false })));
        sprite.position.set(fx * bromoX + rx * bromoSide, floor + 150, fz * bromoX + rz * bromoSide);
        sprite.userData.base = sprite.position.clone();
        this.backdrop.add(sprite);
        this.puffs.push({ sprite, phase: i / 9 });
      }
    }
    this.scene.add(this.backdrop);
  }

  private buildGround(own: Own): void {
    const grid = buildTerrain(this.track, this.theme);
    const scenery = own(new Scenery(this.track, this.theme, this.quality, this.route.segments));
    const material = own(terrainMaterial(this.theme, own(groundDetailTexture())));
    let chunk = 0;
    for (let r0 = 0; r0 < grid.rows - 1; r0 += ROWS_PER_CHUNK) {
      const r1 = Math.min(grid.rows - 1, r0 + ROWS_PER_CHUNK);
      const geometry = own(chunkGeometry(grid, r0, r1));
      const ground = new Mesh(geometry, material);
      ground.receiveShadow = this.quality.shadowMap > 0;
      this.scene.add(ground);
      const s0 = r0 * 2 * STEP - PRE_M;
      this.scene.add(scenery.buildChunk(s0, s0 + CHUNK_M, chunk));
      chunk++;
    }
  }

  /**
   * The tarmac: a cambered ribbon (6 cm crown) with short skirts down to the verge so it never floats, textured along its length.
   */
  private buildRoad(own: Own): void {
    const { track } = this;
    const n = track.count;
    // Across the road: [lateral offset m, height above the track line m, u].
    const cross = [
      [-(ROAD_HALF + 0.3), -0.16, -0.02],
      [-ROAD_HALF, roadCrown(ROAD_HALF), 0],
      [-ROAD_HALF / 2, roadCrown(ROAD_HALF / 2), 0.25],
      [0, roadCrown(0), 0.5],
      [ROAD_HALF / 2, roadCrown(ROAD_HALF / 2), 0.75],
      [ROAD_HALF, roadCrown(ROAD_HALF), 1],
      [ROAD_HALF + 0.3, -0.16, 1.02],
    ] as const;
    const C = cross.length;
    const positions = new Float32Array(n * C * 3);
    const uvs = new Float32Array(n * C * 2);
    for (let i = 0; i < n; i++) {
      const yaw = track.yaw[i]!;
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      for (let c = 0; c < C; c++) {
        const [lat, dy, u] = cross[c]!;
        const o = (i * C + c) * 3;
        positions[o] = track.x[i]! + rx * lat;
        positions[o + 1] = track.y[i]! + dy;
        positions[o + 2] = track.z[i]! + rz * lat;
        uvs[(i * C + c) * 2] = u;
        uvs[(i * C + c) * 2 + 1] = (i * STEP) / ROAD_TILE_M;
      }
    }
    const index = new Uint32Array((n - 1) * (C - 1) * 6);
    let k = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let c = 0; c < C - 1; c++) {
        const a = i * C + c;
        index[k++] = a;
        index[k++] = a + 1;
        index[k++] = a + C;
        index[k++] = a + 1;
        index[k++] = a + C + 1;
        index[k++] = a + C;
      }
    }
    const geometry = own(new BufferGeometry());
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const { map, bump } = roadTextures();
    own(map);
    own(bump);
    const material = this.quality.pbr
      ? new MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.2, roughness: 0.86, metalness: 0 })
      : new MeshLambertMaterial({ map });
    // The road is one mesh for the whole route, so its bounding sphere always intersects the frustum; the cost is a single draw call.
    const road = new Mesh(geometry, own(material));
    road.receiveShadow = this.quality.shadowMap > 0;
    this.scene.add(road);
  }

  /** Start and finish arches, a chequered finish line, and a banner arch at each segment's start and end. */
  private buildGantries(own: Own): void {
    const postGeometry = own(new BoxGeometry(0.34, 6.2, 0.34));
    const footGeometry = own(new BoxGeometry(0.8, 0.3, 0.8));
    const postMaterial = own(new MeshLambertMaterial({ color: 0xdedbd2 }));
    const bannerGeometry = own(new PlaneGeometry((ROAD_HALF + 0.8) * 2, 1.1));
    const trussGeometry = own(new BoxGeometry((ROAD_HALF + 0.8) * 2 + 0.34, 0.12, 0.3));
    const shadows = this.quality.shadowMap > 0;

    const gantry = (s: number, text: string, fg: string, bg: string, mark: { ring: string; dot: string } | null = null) => {
      const t = this.track.at(s, this.point);
      const group = new Group();
      for (const side of [-1, 1]) {
        const post = new Mesh(postGeometry, postMaterial);
        post.position.set(side * (ROAD_HALF + 0.8), 3.1, 0);
        post.castShadow = shadows;
        group.add(post);
        const foot = new Mesh(footGeometry, postMaterial);
        foot.position.set(side * (ROAD_HALF + 0.8), 0.15, 0);
        group.add(foot);
      }
      for (const y of [5.38, 6.62]) {
        const truss = new Mesh(trussGeometry, postMaterial);
        truss.position.set(0, y, 0);
        truss.castShadow = shadows;
        group.add(truss);
      }
      const banner = new Mesh(bannerGeometry, own(new MeshBasicMaterial({ map: own(bannerTexture(text, fg, bg, mark)), side: DoubleSide })));
      banner.position.set(0, 6.0, 0.02);
      banner.castShadow = shadows;
      group.add(banner);
      group.position.set(t.x, t.y, t.z);
      group.rotation.y = t.yaw;
      this.scene.add(group);
    };

    gantry(0, "START", "#141414", "#f1efe6", { ring: BRAND_INK, dot: BRAND_RING });
    gantry(this.route.lengthM, "FINISH", "#f1efe6", "#141414", { ring: BRAND_RING, dot: BRAND_DOT });

    const finish = new Mesh(own(new PlaneGeometry(ROAD_HALF * 2, 1.6)), own(new MeshBasicMaterial({ map: own(finishTexture()) })));
    const t = this.track.at(this.route.lengthM, this.point);
    finish.rotation.set(-Math.PI / 2, 0, 0);
    const holder = new Group();
    holder.add(finish);
    finish.position.y = 0.11;
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

  /**
   * Per frame: keeps the sky, the sea and the far backdrop centred on the camera, drifts the clouds and the plume, moves the shadow box
   * with [focus] (the rider) and the oncoming traffic past rider distance [riderS].
   */
  update(camera: PerspectiveCamera, timeS: number, dt: number, drift: boolean, focus: Vector3, riderS: number): void {
    const { x, z } = camera.position;
    this.sky.position.set(x, camera.position.y, z);
    this.backdrop.position.set(x, camera.position.y, z);
    if (this.clouds) {
      this.clouds.position.set(x, focus.y, z);
      if (drift) this.clouds.rotation.y = timeS * 0.002;
    }
    if (this.water) {
      this.water.position.set(x, SEA_LEVEL, z);
      if (this.waterNormal) this.waterNormal.offset.set(x / 40 + timeS * 0.012, -z / 40 + timeS * 0.007);
    }
    for (const puff of this.puffs) {
      const t = (puff.phase + timeS * 0.012) % 1;
      const base = puff.sprite.userData.base as Vector3;
      puff.sprite.position.set(base.x + t * 90, base.y + t * 240, base.z + t * 35);
      puff.sprite.scale.setScalar(25 + t * 140);
      (puff.sprite.material as SpriteMaterial).opacity = 0.75 * Math.min(1, t * 6) * (1 - t);
    }
    if (this.sun.castShadow) {
      // Snap to the shadow map's texels so the edges do not crawl as the rider moves.
      const texel = (SHADOW_HALF_M * 2) / this.quality.shadowMap;
      const fx = Math.round(focus.x / texel) * texel;
      const fz = Math.round(focus.z / texel) * texel;
      this.sun.target.position.set(fx, focus.y, fz);
      this.sun.position.set(fx + this.sunDir.x * 150, focus.y + this.sunDir.y * 150, fz + this.sunDir.z * 150);
    }
    this.traffic.update(dt, riderS);
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
    this.sun.shadow.map?.dispose();
    this.scene.clear();
  }
}
