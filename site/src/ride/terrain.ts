import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  MeshLambertMaterial,
  NoColorSpace,
  RepeatWrapping,
  type Texture,
} from "three";

import { ROAD_HALF, STEP, Track, PRE_M } from "./track.ts";
import type { Theme } from "./theme.ts";

/** Lateral stations (metres from the road centre) of the terrain grid, per side. */
const STATIONS = [ROAD_HALF, 6, 9, 14, 22, 34, 50, 75, 110, 160, 230, 320, 420];
const COLS = STATIONS.length * 2;
/** Terrain rows are every other track sample. */
const ROW_STRIDE = 2;
export const ROWS_PER_CHUNK = 64;
/** Where the sea starts on the right side, metres from the road centre. */
const BEACH_START = 24;
export const SEA_LEVEL = 0;
const SEA_FLOOR = -5;

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, z * freq, seed + i);
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const HILL_FREQ = 0.0035;
const BUMP_FREQ = 0.012;

/** Ground height at world (wx, wz) beside a road point of height [roadY] and lateral offset [lat]. */
export function groundHeight(theme: Theme, roadY: number, lat: number, wx: number, wz: number): number {
  const a = Math.abs(lat);
  if (a <= ROAD_HALF) return roadY - 0.12;
  let h = roadY - 0.12 - 0.02 * (a - ROAD_HALF);
  const near = smoothstep(ROAD_HALF + 2, ROAD_HALF + 24, a);
  h += near * theme.bumpAmp * (fbm(wx * BUMP_FREQ, wz * BUMP_FREQ, 3, theme.seed) - 0.5) * 2;
  const far = smoothstep(28, 220, a);
  h += far * theme.hillAmp * fbm(wx * HILL_FREQ, wz * HILL_FREQ, 3, theme.seed + 7);
  if (theme.hasSea && lat > 0) {
    h += (SEA_FLOOR - h) * smoothstep(BEACH_START, BEACH_START + 40, lat);
  } else {
    h -= smoothstep(320, 420, a) * 24;
  }
  return h;
}

export interface TerrainGrid {
  rows: number;
  /** Per-vertex data, row-major, COLS per row. */
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** 0..1 per vertex: how much of the ground is farmland (flat open ground away from the road and the trees). */
  farm: Float32Array;
}

export const TERRAIN_COLS = COLS;

/** Lateral offset of terrain column [c] (negative = left of the road). */
export function stationLat(c: number): number {
  return c < STATIONS.length ? -STATIONS[STATIONS.length - 1 - c]! : STATIONS[c - STATIONS.length]!;
}

const tmp = new Color();
const cGrass = new Color();
const cDry = new Color();
const cRock = new Color();
const cSand = new Color();
const cSeabed = new Color();
const cGravel = new Color();

export function buildTerrain(track: Track, theme: Theme): TerrainGrid {
  const rows = Math.ceil((track.count - 1) / ROW_STRIDE) + 1;
  const positions = new Float32Array(rows * COLS * 3);
  const colors = new Float32Array(rows * COLS * 3);
  cGrass.set(theme.grass);
  cDry.set(theme.dry);
  cRock.set(theme.rock);
  cSand.set(theme.sand);
  cSeabed.set(theme.seabed);
  cGravel.set(theme.gravel);

  for (let r = 0; r < rows; r++) {
    const i = Math.min(track.count - 1, r * ROW_STRIDE);
    const x = track.x[i]!;
    const z = track.z[i]!;
    const y = track.y[i]!;
    const yaw = track.yaw[i]!;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    for (let c = 0; c < COLS; c++) {
      const lat = stationLat(c);
      const wx = x + rx * lat;
      const wz = z + rz * lat;
      const h = groundHeight(theme, y, lat, wx, wz);
      const o = (r * COLS + c) * 3;
      positions[o] = wx;
      positions[o + 1] = h;
      positions[o + 2] = wz;

      const a = Math.abs(lat);
      const detail = fbm(wx * 0.03, wz * 0.03, 2, theme.seed + 3);
      tmp.copy(cGrass).lerp(cDry, Math.min(1, detail * 0.9 + 0.05));
      const high = smoothstep(0.35, 0.7, (h - y) / Math.max(1, theme.hillAmp));
      if (high > 0) tmp.lerp(cRock, high * 0.8);
      if (theme.hasSea && lat > 0) {
        const sand = smoothstep(BEACH_START - 14, BEACH_START - 4, lat);
        tmp.lerp(cSand, sand);
        tmp.lerp(cSeabed, smoothstep(BEACH_START + 12, BEACH_START + 34, lat));
      }
      if (a < 9) tmp.lerp(cGravel, 1 - smoothstep(ROAD_HALF + 0.5, 9, a));
      const o3 = o;
      colors[o3] = tmp.r;
      colors[o3 + 1] = tmp.g;
      colors[o3 + 2] = tmp.b;
    }
  }

  // Normals from the whole grid so chunk seams stay invisible.
  const normals = new Float32Array(rows * COLS * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const r0 = Math.max(0, r - 1);
      const r1 = Math.min(rows - 1, r + 1);
      const c0 = Math.max(0, c - 1);
      const c1 = Math.min(COLS - 1, c + 1);
      const a = (r1 * COLS + c) * 3;
      const b = (r0 * COLS + c) * 3;
      const d = (r * COLS + c1) * 3;
      const e = (r * COLS + c0) * 3;
      // Tangents along the row axis (u) and across the road (v); their cross product points up.
      const ux = positions[a]! - positions[b]!;
      const uy = positions[a + 1]! - positions[b + 1]!;
      const uz = positions[a + 2]! - positions[b + 2]!;
      const vx = positions[d]! - positions[e]!;
      const vy = positions[d + 1]! - positions[e + 1]!;
      const vz = positions[d + 2]! - positions[e + 2]!;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      // Rows run along -Z forward and columns left to right, which makes this product point down; flip it.
      nx = -nx;
      ny = -ny;
      nz = -nz;
      const len = Math.hypot(nx, ny, nz) || 1;
      const o = (r * COLS + c) * 3;
      normals[o] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = nz / len;
    }
  }
  // Farmland on open ground that is flat enough: paddies need near-level ground, terraces climb the slopes.
  const farm = new Float32Array(rows * COLS);
  if (theme.farmland) {
    const flat = theme.farmland === "paddy" ? [0.93, 0.985] : [0.55, 0.8];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        const o = r * COLS + c;
        const ny = normals[o * 3 + 1]!;
        farm[o] = farmPatch(theme, stationLat(c), positions[o * 3]!, positions[o * 3 + 2]!) * smoothstep(flat[0]!, flat[1]!, ny);
      }
    }
  }
  return { rows, positions, normals, colors, farm };
}

/**
 * 0..1: farmland at world (wx, wz), [lat] metres beside the road, before the slope test. Low-frequency noise makes patches rather
 * than one endless field; scenery keeps trees out of them.
 */
export function farmPatch(theme: Theme, lat: number, wx: number, wz: number): number {
  if (!theme.farmland || (theme.hasSea && lat > 0)) return 0;
  const a = Math.abs(lat);
  return smoothstep(11, 20, a) * (1 - smoothstep(260, 380, a)) * smoothstep(0.3, 0.4, fbm(wx * 0.004, wz * 0.004, 2, theme.seed + 11));
}

/** Geometry for terrain rows [r0, r1] (inclusive). Triangles wind counter-clockwise seen from above. */
export function chunkGeometry(grid: TerrainGrid, r0: number, r1: number): BufferGeometry {
  const rowCount = r1 - r0 + 1;
  const from = r0 * COLS * 3;
  const to = (r1 + 1) * COLS * 3;
  const geometry = new BufferGeometry();
  const positions = grid.positions.slice(from, to);
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(grid.normals.slice(from, to), 3));
  geometry.setAttribute("color", new BufferAttribute(grid.colors.slice(from, to), 3));
  geometry.setAttribute("farm", new BufferAttribute(grid.farm.slice(r0 * COLS, (r1 + 1) * COLS), 1));
  // World-space texture coordinates: the detail texture repeats every DETAIL_TILE_M metres with no seams between chunks.
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0; i < positions.length / 3; i++) {
    uvs[i * 2] = positions[i * 3]! / DETAIL_TILE_M;
    uvs[i * 2 + 1] = positions[i * 3 + 2]! / DETAIL_TILE_M;
  }
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  const index = new Uint32Array((rowCount - 1) * (COLS - 1) * 6);
  let k = 0;
  for (let r = 0; r < rowCount - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c;
      const b = a + 1;
      const d = a + COLS;
      const e = d + 1;
      // Row r is behind row r+1 (forward is increasing s); from above with forward up the screen, columns run left to right.
      index[k++] = a;
      index[k++] = b;
      index[k++] = d;
      index[k++] = b;
      index[k++] = e;
      index[k++] = d;
    }
  }
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

const DETAIL_TILE_M = 6;

/** Grey ground detail (grass blades, soil grains) multiplied over the vertex colours; linear data, mean about 0.9. */
export function groundDetailTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable: noise on a torus of period 8 cells (and 32 for the fine octave).
      const n = tileNoise(x / 32, y / 32, 8, 5) * 0.6 + tileNoise(x / 8, y / 8, 32, 9) * 0.4;
      const blade = hash2(x, y, 3) > 0.93 ? 0.1 : hash2(x, y, 4) < 0.06 ? -0.12 : 0;
      const v = Math.min(1, Math.max(0, 0.72 + n * 0.3 + blade));
      const o = (y * size + x) * 4;
      img.data[o] = v * 255;
      img.data[o + 1] = Math.min(1, v * 1.03) * 255;
      img.data[o + 2] = v * 0.97 * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Value noise that repeats every [period] cells in both directions. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const p = (v: number) => ((v % period) + period) % period;
  const a = hash2(p(ix), p(iy), seed);
  const b = hash2(p(ix + 1), p(iy), seed);
  const c = hash2(p(ix), p(iy + 1), seed);
  const d = hash2(p(ix + 1), p(iy + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

const FARM_GLSL = /* glsl */ `
float farmHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 farmColor(vec3 w) {
#if FARM_MODE == 1
  // Rice paddies: rotated plots about 26 x 17 m, each at its own stage, with planting rows and grassy dikes (pematang).
  vec2 p = mat2(0.92, -0.39, 0.39, 0.92) * w.xz / vec2(26.0, 17.0);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float h = farmHash(cell);
  vec3 col = h < 0.28 ? vec3(0.52, 0.80, 0.22) : h < 0.5 ? vec3(0.28, 0.56, 0.14) : h < 0.68 ? vec3(0.84, 0.74, 0.32) : h < 0.86 ? vec3(0.46, 0.60, 0.64) : vec3(0.44, 0.62, 0.44);
  float rowsFreq = 17.0 / 0.5;
  float aa = clamp(fwidth(p.y * rowsFreq) * 1.5, 0.0, 1.0);
  col *= 1.0 - 0.14 * (1.0 - aa) * step(0.5, fract(p.y * rowsFreq));
  float edge = min(min(f.x, 1.0 - f.x) * 26.0, min(f.y, 1.0 - f.y) * 17.0);
  col = mix(vec3(0.36, 0.44, 0.22), col, smoothstep(0.45, 0.9, edge));
#else
  // Tengger terraces: bands that follow the contour every 3.2 m of height, a crop per band and plot, soil risers between.
  float band = w.y / 3.2;
  float fb = fract(band);
  vec2 seg = floor(w.xz / 38.0);
  float h = farmHash(vec2(floor(band), seg.x + seg.y * 7.0));
  vec3 col = h < 0.3 ? vec3(0.46, 0.62, 0.36) : h < 0.55 ? vec3(0.33, 0.50, 0.24) : h < 0.8 ? vec3(0.40, 0.55, 0.25) : vec3(0.42, 0.33, 0.24);
  float aa = clamp(fwidth(dot(w.xz, vec2(0.7)) / 0.8) * 1.5, 0.0, 1.0);
  col *= 1.0 - 0.12 * (1.0 - aa) * step(0.5, fract(dot(w.xz, vec2(0.7)) / 0.8));
  col = mix(vec3(0.36, 0.29, 0.21), col, smoothstep(0.0, 0.2, fb));
#endif
  return pow(col, vec3(2.2));
}
`;

/** Lambert ground with the detail texture (fine, plus a coarse pass that hides the tiling) and procedural farmland where `farm` is set. */
export function terrainMaterial(theme: Theme, detail: Texture): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true, map: detail });
  const mode = theme.farmland === "paddy" ? 1 : theme.farmland === "terraces" ? 2 : 0;
  material.defines = { FARM_MODE: mode };
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float farm;\nvarying float vFarm;\nvarying vec3 vGround;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvFarm = farm;\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying float vFarm;\nvarying vec3 vGround;\n${mode ? FARM_GLSL : ""}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= 0.6 + 0.5 * texture2D(map, vMapUv * 0.083).g;
        ${mode ? "diffuseColor.rgb = mix(diffuseColor.rgb, farmColor(vGround) * sampledDiffuseColor.rgb, vFarm);" : ""}`,
      );
  };
  material.customProgramCacheKey = () => `terrain-${mode}`;
  return material;
}

/** Metres of road length covered by one terrain chunk. */
export const CHUNK_M = ROWS_PER_CHUNK * ROW_STRIDE * STEP;
/** Track distance at the start of terrain row [r]. */
export function rowDistance(r: number): number {
  return r * ROW_STRIDE * STEP - PRE_M;
}
