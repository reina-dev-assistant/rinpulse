import { BufferAttribute, BufferGeometry, Color } from "three";

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
  return { rows, positions, normals, colors };
}

/** Geometry for terrain rows [r0, r1] (inclusive). Triangles wind counter-clockwise seen from above. */
export function chunkGeometry(grid: TerrainGrid, r0: number, r1: number): BufferGeometry {
  const rowCount = r1 - r0 + 1;
  const from = r0 * COLS * 3;
  const to = (r1 + 1) * COLS * 3;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(grid.positions.slice(from, to), 3));
  geometry.setAttribute("normal", new BufferAttribute(grid.normals.slice(from, to), 3));
  geometry.setAttribute("color", new BufferAttribute(grid.colors.slice(from, to), 3));
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

/** Metres of road length covered by one terrain chunk. */
export const CHUNK_M = ROWS_PER_CHUNK * ROW_STRIDE * STEP;
/** Track distance at the start of terrain row [r]. */
export function rowDistance(r: number): number {
  return r * ROW_STRIDE * STEP - PRE_M;
}
