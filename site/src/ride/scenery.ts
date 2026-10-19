import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { farmPatch, groundHeight } from "./terrain.ts";
import { ROAD_HALF, Track, makeTrackPoint, type TrackPoint } from "./track.ts";
import type { SegmentDef } from "./routes.ts";
import type { Quality, Theme, TreeKind } from "./theme.ts";

/** Deterministic PRNG so a route always grows the same trees. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gives every vertex one colour and returns a non-indexed copy (so parts with and without an index merge). */
export function paint(geometry: BufferGeometry, hex: number): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const color = new Color(hex);
  const count = g.getAttribute("position").count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new BufferAttribute(data, 3));
  if (g.getAttribute("uv")) g.deleteAttribute("uv");
  return g;
}

/** Vertical colour ramp: [bottom] at the lowest vertex to [top] at the highest. */
function ramp(geometry: BufferGeometry, bottom: number, top: number): BufferGeometry {
  const g = paint(geometry, bottom);
  const pos = g.getAttribute("position");
  const colors = g.getAttribute("color");
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const a = new Color(bottom);
  const b = new Color(top);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(a).lerp(b, (pos.getY(i) - min.y) / Math.max(1e-6, max.y - min.y));
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

export function at(geometry: BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): BufferGeometry {
  geometry.scale(sx, sy, sz);
  geometry.translate(x, y, z);
  return geometry;
}

/** Pushes vertices in or out a little so primitives stop looking like primitives (deterministic). */
function lumpy(geometry: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position");
  // Same jitter for vertices at the same place, so a lumpy shape stays closed.
  const key = (i: number) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  const offsets = new Map<string, number>();
  const rand = mulberry32(seed);
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let o = offsets.get(k);
    if (o === undefined) offsets.set(k, (o = 1 + (rand() - 0.5) * 2 * amount));
    pos.setXYZ(i, pos.getX(i) * o, pos.getY(i) * (1 + (o - 1) * 0.6), pos.getZ(i) * o);
  }
  g.computeVertexNormals();
  return g;
}

function pineGeometry(): BufferGeometry {
  const parts = [paint(at(new CylinderGeometry(0.12, 0.22, 2.2, 6), 0, 1.1, 0), 0x4e3626)];
  const greens = [0x24502c, 0x2b5d31, 0x316a37, 0x37743c, 0x3f7f43];
  for (let i = 0; i < 5; i++) {
    const r = 1.7 - i * 0.3;
    const cone = lumpy(new ConeGeometry(r, 2.4, 8, 1), 0.08, 31 + i);
    cone.rotateY(i * 0.7);
    parts.push(ramp(at(cone, 0, 2.6 + i * 1.15, 0), greens[i]! - 0x0a0a0a, greens[i]!));
  }
  return mergeGeometries(parts)!;
}

/** Casuarina (cemara gunung): tall and narrow, wispy tiers, a bare lower trunk. The highland tree of Tengger. */
function cemaraGeometry(): BufferGeometry {
  const parts = [paint(at(new CylinderGeometry(0.1, 0.2, 5, 6), 0, 2.5, 0), 0x5a4232)];
  for (let i = 0; i < 7; i++) {
    const r = 1.25 - i * 0.14;
    const tier = lumpy(new ConeGeometry(r, 1.8, 7, 1, true), 0.18, 77 + i);
    tier.rotateY(i * 1.3);
    parts.push(ramp(at(tier, 0, 3.6 + i * 1.05, 0), 0x22402a, i % 2 ? 0x3a6040 : 0x345a3a));
  }
  return mergeGeometries(parts)!;
}

function roundGeometry(): BufferGeometry {
  const branch = (angle: number, tilt: number) =>
    new CylinderGeometry(0.06, 0.1, 1.4, 5).translate(0, 0.7, 0).rotateZ(tilt).rotateY(angle).translate(0, 2.3, 0);
  const parts = [
    paint(at(new CylinderGeometry(0.15, 0.26, 2.6, 7), 0, 1.3, 0), 0x5b4330),
    paint(branch(0.4, 0.6), 0x5b4330),
    paint(branch(2.6, 0.55), 0x5b4330),
    paint(branch(4.5, 0.65), 0x5b4330),
  ];
  const blobs: [number, number, number, number, number][] = [
    [0, 4.2, 0, 1.7, 0x4a8a3a],
    [1.1, 3.7, 0.4, 1.2, 0x3f7c33],
    [-1.0, 3.8, -0.3, 1.25, 0x56963f],
    [0.2, 3.5, -1.1, 1.1, 0x427f36],
    [-0.4, 3.6, 1.0, 1.05, 0x4f8d3c],
    [0.4, 5.0, 0.2, 1.0, 0x5c9d45],
  ];
  blobs.forEach(([x, y, z, r, c], i) => parts.push(ramp(at(lumpy(new IcosahedronGeometry(r, 1), 0.14, 5 + i), x, y, z, 1, 0.85, 1), c - 0x101808, c)));
  return mergeGeometries(parts)!;
}

/** Coconut palm: a trunk that bends as it rises, drooping fronds in three segments each, a cluster of coconuts. */
function palmGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  let x = 0;
  let y = 0;
  const lean = 0.09;
  for (let i = 0; i < 6; i++) {
    const seg = new CylinderGeometry(0.15 - i * 0.008, 0.2 - i * 0.008, 1.25, 7);
    seg.rotateZ(-lean * i);
    seg.translate(x + Math.sin(lean * i) * 0.62, y + 0.62, 0);
    parts.push(paint(seg, i % 2 ? 0x8a6a45 : 0x7d5f3e));
    x += Math.sin(lean * i) * 1.25;
    y += Math.cos(lean * i) * 1.22;
  }
  const crownX = x;
  const crownY = y;
  for (let f = 0; f < 9; f++) {
    const angle = (f / 9) * Math.PI * 2 + (f % 2) * 0.2;
    let fx = 0;
    let fy = 0;
    for (let s = 0; s < 3; s++) {
      const pitch = 0.25 + s * 0.42 + (f % 3) * 0.08;
      const len = 1.15;
      const leaf = new PlaneGeometry(0.62 - s * 0.14, len, 1, 1);
      leaf.rotateX(-Math.PI / 2);
      leaf.translate(0, 0, len / 2);
      leaf.rotateX(pitch);
      leaf.translate(0, fy, fx);
      leaf.rotateY(angle);
      leaf.translate(crownX, crownY, 0);
      parts.push(paint(leaf, s === 0 ? 0x3f8a3d : s === 1 ? 0x4c9a45 : 0x6aa64c));
      fx += Math.cos(pitch) * len;
      fy -= Math.sin(pitch) * len;
    }
  }
  for (let c = 0; c < 4; c++) {
    const a = c * 1.6;
    parts.push(paint(at(new SphereGeometry(0.16, 6, 5), crownX + Math.cos(a) * 0.22, crownY - 0.25, Math.sin(a) * 0.22), 0x6b5a2a));
  }
  return mergeGeometries(parts)!;
}

/** Banana plant (pisang): a short soft trunk and big paddle leaves arching out. */
function bananaGeometry(): BufferGeometry {
  const parts = [ramp(at(new CylinderGeometry(0.12, 0.18, 1.8, 7), 0, 0.9, 0), 0x6f7a3a, 0x8c9a4a)];
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + i * 0.3;
    const leaf = new PlaneGeometry(0.55, 1.7, 1, 2);
    const p = leaf.getAttribute("position");
    // Arch: the tip bends down.
    for (let k = 0; k < p.count; k++) {
      const v = p.getY(k) + 0.85;
      p.setZ(k, -0.25 * v * v);
    }
    leaf.rotateX(-Math.PI / 2 + 0.55 + (i % 3) * 0.12);
    leaf.translate(0, 1.6 + (i % 2) * 0.25, 0.8);
    leaf.rotateY(angle);
    parts.push(paint(leaf, i % 3 ? 0x5a9a3a : 0x6aaa48));
  }
  return mergeGeometries(parts)!;
}

/** Bamboo clump (rumpun bambu): thin culms leaning out, feathery tops. */
function bambooGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const tilt = 0.12 + (i % 3) * 0.07;
    const h = 7 + (i % 4) * 0.9;
    const culm = new CylinderGeometry(0.045, 0.06, h, 5);
    culm.translate(0, h / 2, 0);
    culm.rotateZ(-tilt);
    culm.rotateY(a);
    culm.translate(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
    parts.push(ramp(culm, 0x6f8a3a, 0x9aaa52));
    const reach = 0.3 + Math.sin(tilt) * h;
    const tx = Math.cos(a) * reach;
    const tz = -Math.sin(a) * reach;
    parts.push(ramp(at(lumpy(new IcosahedronGeometry(0.9, 0), 0.25, 300 + i), tx, Math.cos(tilt) * h - 0.6, tz, 1, 1.6, 1), 0x4e7d34, 0x6e9a45));
  }
  return mergeGeometries(parts)!;
}

function postGeometry(): BufferGeometry {
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.07, 0.07, 1.0, 6), 0, 0.5, 0), 0xf2f0e8),
    paint(at(new CylinderGeometry(0.075, 0.075, 0.16, 6), 0, 0.82, 0), 0xc4382c),
  ])!;
}

function bushGeometry(): BufferGeometry {
  return mergeGeometries([
    ramp(at(lumpy(new IcosahedronGeometry(0.8, 1), 0.18, 401), 0, 0.45, 0, 1.2, 0.8, 1.2), 0x35602a, 0x55893c),
    ramp(at(lumpy(new IcosahedronGeometry(0.55, 1), 0.2, 402), 0.6, 0.35, 0.3, 1.1, 0.8, 1.1), 0x3a6a2c, 0x5f9442),
  ])!;
}

function rockGeometry(): BufferGeometry {
  return ramp(at(lumpy(new IcosahedronGeometry(0.9, 1), 0.22, 503), 0, 0.3, 0, 1.3, 0.75, 1), 0x6e6a62, 0x9a948a);
}

/** A tuft of grass: blades in a fan, dark at the root and sunlit at the tip. */
function grassGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const blade = new BufferGeometry();
    const h = 0.3 + (i % 3) * 0.1;
    const w = 0.035;
    const bend = 0.08 + (i % 2) * 0.06;
    blade.setAttribute("position", new BufferAttribute(new Float32Array([-w, 0, 0, w, 0, 0, bend, h, 0]), 3));
    blade.computeVertexNormals();
    blade.rotateY((i / 7) * Math.PI * 2 + i);
    blade.translate(Math.cos(i * 2.4) * 0.09, 0, Math.sin(i * 2.4) * 0.09);
    parts.push(ramp(blade, 0x2f4f1f, 0x8fb257));
  }
  const merged = mergeGeometries(parts)!;
  // Normals pointing up: lit like the ground they grow from, not edge-on to the sun.
  const n = merged.getAttribute("normal");
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return merged;
}

/** A roadside warung: wooden stall, tin roof sloping to the front, a counter and a striped awning. Front faces local +X. */
function warungGeometry(): BufferGeometry {
  const roof = new BoxGeometry(3.6, 0.12, 4.4);
  roof.rotateZ(-0.22);
  const awning = new BoxGeometry(1.2, 0.06, 4.2);
  awning.rotateZ(-0.5);
  const parts = [
    paint(at(new BoxGeometry(3, 2.3, 4), 0, 1.15, 0), 0x9a6b43),
    paint(at(new BoxGeometry(0.1, 1.2, 3.2), 1.52, 1.45, 0), 0x2b2118),
    paint(at(new BoxGeometry(0.7, 0.95, 3.6), 1.75, 0.48, 0), 0x6f4b2e),
    paint(at(roof, 0.2, 2.55, 0), 0x8aa1a8),
    paint(at(awning, 2.15, 2.15, 0), 0xd2493b),
    paint(at(new BoxGeometry(0.06, 0.55, 1.6), 1.56, 2.05, 0), 0xf2ead2),
    // Bottles and jars on the counter, a bench in front, hanging snack strips.
    paint(at(new CylinderGeometry(0.06, 0.06, 0.3, 6), 1.8, 1.1, -1.2), 0xe58a2b),
    paint(at(new CylinderGeometry(0.06, 0.06, 0.3, 6), 1.8, 1.1, -0.9), 0x3d8f4a),
    paint(at(new CylinderGeometry(0.16, 0.16, 0.34, 8), 1.8, 1.12, 0.9), 0xd9cfa8),
    paint(at(new BoxGeometry(0.4, 0.08, 2.4), 2.6, 0.45, 0), 0x7a5634),
    paint(at(new BoxGeometry(0.06, 0.4, 0.06), 2.6, 0.22, -1.1), 0x5a3e26),
    paint(at(new BoxGeometry(0.06, 0.4, 0.06), 2.6, 0.22, 1.1), 0x5a3e26),
    paint(at(new BoxGeometry(0.02, 0.6, 0.12), 1.95, 1.7, -0.4), 0xe8b23a),
    paint(at(new BoxGeometry(0.02, 0.6, 0.12), 1.95, 1.7, -0.2), 0xd94a3d),
    paint(at(new BoxGeometry(0.02, 0.6, 0.12), 1.95, 1.7, 0.0), 0x3a7fc4),
  ];
  return mergeGeometries(parts)!;
}

/** A small scooter (length along local Z), optionally with its rider. */
export function motorGeometry(color: number, rider: number | null = null): BufferGeometry {
  const wheel = () => new TorusGeometry(0.24, 0.08, 6, 12).rotateY(Math.PI / 2);
  const parts = [
    paint(at(wheel(), 0, 0.3, 0.62), 0x1c1c1c),
    paint(at(wheel(), 0, 0.3, -0.62), 0x1c1c1c),
    paint(at(new BoxGeometry(0.32, 0.36, 1.0), 0, 0.55, -0.1), color),
    paint(at(new BoxGeometry(0.3, 0.12, 0.62), 0, 0.82, -0.22), 0x26221e),
    paint(at(new BoxGeometry(0.28, 0.75, 0.18), 0, 0.72, 0.5), color),
    paint(at(new BoxGeometry(0.36, 0.06, 0.4), 0, 0.42, 0.18), 0x2a2a2a),
    paint(at(new CylinderGeometry(0.03, 0.03, 0.6, 4).rotateZ(Math.PI / 2), 0, 1.12, 0.55), 0x2a2a2a),
    paint(at(new BoxGeometry(0.14, 0.1, 0.06), 0, 1.0, 0.62), 0xf2efe0),
  ];
  if (rider !== null) {
    parts.push(
      paint(at(new BoxGeometry(0.4, 0.55, 0.26), 0, 1.2, -0.22), rider),
      paint(at(new SphereGeometry(0.15, 8, 6), 0, 1.62, -0.16), 0x9a6a48),
      paint(at(new SphereGeometry(0.17, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), 0, 1.66, -0.16), rider === 0x2b2b2b ? 0xd94a3d : 0x1d1d22),
      paint(at(new CylinderGeometry(0.06, 0.06, 0.55, 5).rotateX(1.1), 0.18, 1.18, 0.12), rider),
      paint(at(new CylinderGeometry(0.06, 0.06, 0.55, 5).rotateX(1.1), -0.18, 1.18, 0.12), rider),
      paint(at(new CylinderGeometry(0.08, 0.07, 0.5, 5).rotateX(1.3), 0.15, 0.85, 0.05), 0x2d3442),
      paint(at(new CylinderGeometry(0.08, 0.07, 0.5, 5).rotateX(1.3), -0.15, 0.85, 0.05), 0x2d3442),
    );
  }
  return mergeGeometries(parts)!;
}

/** Umbul-umbul: a tall curved bamboo pole with a long vertical banner. */
function flagGeometry(color: number): BufferGeometry {
  const banner = new PlaneGeometry(0.55, 3.2, 1, 4);
  const p = banner.getAttribute("position");
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getY(i) * 1.6) * 0.08);
  banner.rotateY(Math.PI / 2);
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.045, 0.06, 6.4, 6), 0, 3.2, 0), 0xc8a865),
    paint(at(banner, 0, 4.2, 0.3), color),
    paint(at(new PlaneGeometry(0.55, 0.5).rotateY(Math.PI / 2), 0, 6.0, 0.3), 0xf4f1e8),
  ])!;
}

/** A standing spectator; shirt colour per variant, arms up on the cheering variant. */
function spectatorGeometry(shirt: number, cheer: boolean, skin: number): BufferGeometry {
  const arm = new CylinderGeometry(0.05, 0.045, 0.55, 5);
  const parts = [
    paint(at(new CylinderGeometry(0.1, 0.08, 0.82, 6), -0.1, 0.41, 0), 0x2d3442),
    paint(at(new CylinderGeometry(0.1, 0.08, 0.82, 6), 0.1, 0.41, 0), 0x2d3442),
    paint(at(new BoxGeometry(0.12, 0.06, 0.24), -0.1, 0.03, 0.04), 0x1d1814),
    paint(at(new BoxGeometry(0.12, 0.06, 0.24), 0.1, 0.03, 0.04), 0x1d1814),
    paint(at(new CylinderGeometry(0.2, 0.17, 0.62, 8), 0, 1.12, 0, 1, 1, 0.65), shirt),
    paint(at(new CylinderGeometry(0.05, 0.06, 0.1, 6), 0, 1.48, 0), skin),
    paint(at(new SphereGeometry(0.13, 10, 8), 0, 1.6, 0, 1, 1.12, 1), skin),
    paint(at(new SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.64, -0.01), 0x1d1814),
  ];
  if (cheer) {
    parts.push(paint(at(arm.clone().rotateZ(0.35), 0.3, 1.6, 0), skin));
    parts.push(paint(at(arm.clone().rotateZ(-0.35), -0.3, 1.6, 0), skin));
  } else {
    parts.push(paint(at(arm.clone(), 0.25, 1.1, 0), skin));
    parts.push(paint(at(arm.clone(), -0.25, 1.1, 0), skin));
  }
  return mergeGeometries(parts)!;
}

/** A village house: plastered walls, a terracotta roof, a front porch on two posts, door and windows. Front faces local +X. */
function houseGeometry(wall: number): BufferGeometry {
  const roofA = new BoxGeometry(3.6, 0.14, 7.8);
  roofA.rotateZ(0.5);
  const roofB = new BoxGeometry(3.6, 0.14, 7.8);
  roofB.rotateZ(-0.5);
  const porch = new BoxGeometry(1.8, 0.1, 4.2);
  porch.rotateZ(-0.18);
  return mergeGeometries([
    paint(at(new BoxGeometry(5.6, 0.3, 7), 0, 0.15, 0), 0x9a958a),
    paint(at(new BoxGeometry(5.2, 2.8, 6.6), 0, 1.7, 0), wall),
    paint(at(roofA, -1.4, 3.85, 0), 0xa7493a),
    paint(at(roofB, 1.4, 3.85, 0), 0xb4543f),
    paint(at(new BoxGeometry(0.4, 1.4, 0.12), 0, 3.6, 3.32), wall),
    paint(at(porch, 3.3, 2.75, 0), 0xa7493a),
    paint(at(new CylinderGeometry(0.07, 0.07, 2.5, 6), 4.0, 1.4, -1.8), 0xf0ebe0),
    paint(at(new CylinderGeometry(0.07, 0.07, 2.5, 6), 4.0, 1.4, 1.8), 0xf0ebe0),
    paint(at(new BoxGeometry(0.08, 1.9, 1.0), 2.62, 1.25, -1.2), 0x5b3e2a),
    paint(at(new BoxGeometry(0.08, 0.9, 1.1), 2.62, 1.9, 1.4), 0x3a4a55),
    paint(at(new BoxGeometry(0.1, 1.0, 1.2), 2.6, 1.9, 1.4), 0xf0ebe0),
    paint(at(new BoxGeometry(0.08, 0.9, 1.1), 2.62, 1.9, 0.3), 0x3a4a55),
  ])!;
}

/** A village musholla: a small white prayer hall with a green dome and a slim minaret. Front faces local +X. */
function mosqueGeometry(): BufferGeometry {
  return mergeGeometries([
    paint(at(new BoxGeometry(7.4, 0.4, 7.4), 0, 0.2, 0), 0xb0aca0),
    paint(at(new BoxGeometry(6.6, 3.4, 6.6), 0, 2.1, 0), 0xf3f0e6),
    paint(at(new BoxGeometry(7.2, 0.3, 7.2), 0, 3.9, 0), 0x2f7a4a),
    paint(at(new CylinderGeometry(1.6, 1.8, 0.8, 12), 0, 4.4, 0), 0xf3f0e6),
    paint(at(new SphereGeometry(1.75, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 4.8, 0), 0x2f8a52),
    paint(at(new ConeGeometry(0.12, 0.8, 6), 0, 6.9, 0), 0xe8c35a),
    paint(at(new CylinderGeometry(0.45, 0.55, 9, 8), -2.6, 4.5, 2.6), 0xf3f0e6),
    paint(at(new CylinderGeometry(0.6, 0.6, 0.4, 8), -2.6, 8.2, 2.6), 0x2f7a4a),
    paint(at(new ConeGeometry(0.5, 1.4, 8), -2.6, 9.6, 2.6), 0x2f8a52),
    paint(at(new BoxGeometry(0.1, 2.2, 1.6), 3.32, 1.5, 0), 0x2f7a4a),
    paint(at(new BoxGeometry(0.1, 1.2, 0.9), 3.32, 2.0, -2.0), 0x3a4a55),
    paint(at(new BoxGeometry(0.1, 1.2, 0.9), 3.32, 2.0, 2.0), 0x3a4a55),
  ])!;
}

const SKINS = [0x9a6a48, 0x7d5338, 0xb07c58];

const GEOMETRIES = {
  pine: pineGeometry,
  cemara: cemaraGeometry,
  round: roundGeometry,
  palm: palmGeometry,
  banana: bananaGeometry,
  bamboo: bambooGeometry,
  post: postGeometry,
  bush: bushGeometry,
  rock: rockGeometry,
  grass: grassGeometry,
  warung: warungGeometry,
  motorRed: () => motorGeometry(0xb8322a),
  motorBlue: () => motorGeometry(0x2f5f9e),
  motorBlack: () => motorGeometry(0x2b2b2b),
  flagRed: () => flagGeometry(0xd6322a),
  flagYellow: () => flagGeometry(0xf0c330),
  flagTeal: () => flagGeometry(0x0a8aa0),
  fanA: () => spectatorGeometry(0xd94a3d, true, SKINS[0]!),
  fanB: () => spectatorGeometry(0x0a6580, false, SKINS[1]!),
  fanC: () => spectatorGeometry(0xf2c230, true, SKINS[2]!),
  fanD: () => spectatorGeometry(0xf1efe6, false, SKINS[0]!),
  fanE: () => spectatorGeometry(0x2f8f4e, true, SKINS[1]!),
  houseWhite: () => houseGeometry(0xe9e0cc),
  houseMint: () => houseGeometry(0xcfe3cf),
  houseYellow: () => houseGeometry(0xf0dfa8),
  mosque: mosqueGeometry,
} satisfies Record<TreeKind | string, () => BufferGeometry>;

type Kind = keyof typeof GEOMETRIES;
const MOTORS: Kind[] = ["motorRed", "motorBlue", "motorBlack"];
const FLAGS: Kind[] = ["flagRed", "flagYellow", "flagTeal"];
const FANS: Kind[] = ["fanA", "fanB", "fanC", "fanD", "fanE"];
const HOUSES: Kind[] = ["houseWhite", "houseMint", "houseYellow"];
/** Kinds that throw a shadow when the quality allows it (grass and posts do not). */
const SHADOW_KINDS: Partial<Record<Kind, true>> = {
  pine: true,
  cemara: true,
  round: true,
  palm: true,
  banana: true,
  bamboo: true,
  warung: true,
  houseWhite: true,
  houseMint: true,
  houseYellow: true,
  mosque: true,
  fanA: true,
  fanB: true,
  fanC: true,
  fanD: true,
  fanE: true,
  flagRed: true,
  flagYellow: true,
  flagTeal: true,
};

export class Scenery {
  readonly material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly point: TrackPoint = makeTrackPoint();
  private readonly dummy = new Object3D();
  private readonly tint = new Color();

  constructor(
    private readonly track: Track,
    private readonly theme: Theme,
    private readonly quality: Quality,
    private readonly segments: readonly SegmentDef[] = [],
  ) {}

  private geometry(kind: Kind): BufferGeometry {
    let g = this.geometries.get(kind);
    if (!g) {
      g = GEOMETRIES[kind]();
      this.geometries.set(kind, g);
    }
    return g;
  }

  /** Everything that grows or stands beside the road between [s0, s1). */
  buildChunk(s0: number, s1: number, chunkIndex: number): Group {
    const group = new Group();
    const rand = mulberry32(this.theme.seed * 1009 + chunkIndex * 7919);
    const placements = new Map<Kind, Matrix4[]>();
    const tints = new Map<Kind, number[]>();
    const { theme } = this;
    const treeScale = this.quality.treeScale;
    /** `yawJitter` false faces the object along the road, turned by `yawOffset`. */
    const place = (kind: Kind, s: number, lat: number, scale: number, tone: number, yawJitter = true, yawOffset = 0) => {
      const t = this.track.at(s, this.point);
      const wx = t.x + Math.cos(t.yaw) * lat;
      const wz = t.z - Math.sin(t.yaw) * lat;
      const y = groundHeight(theme, t.y, lat, wx, wz);
      this.dummy.position.set(wx, y, wz);
      this.dummy.rotation.set(0, yawJitter ? rand() * Math.PI * 2 : t.yaw + yawOffset, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      let list = placements.get(kind);
      if (!list) placements.set(kind, (list = []));
      list.push(this.dummy.matrix.clone());
      let tl = tints.get(kind);
      if (!tl) tints.set(kind, (tl = []));
      tl.push(tone);
    };
    const inFarm = (s: number, lat: number) => {
      const t = this.track.at(s, this.point);
      return farmPatch(theme, lat, t.x + Math.cos(t.yaw) * lat, t.z - Math.sin(t.yaw) * lat) > 0.3;
    };

    const density = theme.treeDensity * treeScale;
    const lo = Math.max(s0, -40);
    const hi = Math.min(s1, this.track.lengthM + 300);

    for (let s = lo; s < hi; s += 25) {
      place("post", s, -(ROAD_HALF + 1.4), 1, 1, false);
      place("post", s, ROAD_HALF + 1.4, 1, 1, false);
    }

    for (const side of [-1, 1]) {
      const count = Math.round(((hi - lo) / 100) * density);
      for (let i = 0; i < count; i++) {
        const s = lo + rand() * (hi - lo);
        const depth = 8 + Math.pow(rand(), 1.6) * (theme.treeReach - 8);
        const lat = side * depth;
        if (theme.hasSea && lat > 22) continue;
        // Farms stay open; the odd tree on a dike is fine.
        if (inFarm(s, lat) && rand() < 0.92) continue;
        const kind = theme.trees[Math.floor(rand() * theme.trees.length)]!;
        place(kind, s, lat, 0.75 + rand() * 0.9, 0.82 + rand() * 0.3);
      }
      const bushes = Math.round(((hi - lo) / 100) * density * 0.8);
      for (let i = 0; i < bushes; i++) {
        const s = lo + rand() * (hi - lo);
        const depth = ROAD_HALF + 2.5 + rand() * 18;
        if (theme.hasSea && side > 0 && depth > 20) continue;
        const rocky = theme.hillAmp > 60 && rand() < 0.5;
        place(rocky ? "rock" : "bush", s, side * depth, 0.6 + rand() * 1.1, 0.85 + rand() * 0.3);
      }
      // Grass on the verge, thickest close to the tarmac.
      const tufts = Math.round(((hi - lo) / 100) * this.quality.grass);
      for (let i = 0; i < tufts; i++) {
        const s = lo + rand() * (hi - lo);
        const depth = ROAD_HALF + 0.6 + Math.pow(rand(), 1.8) * 16;
        if (theme.hasSea && side > 0 && depth > 12) continue;
        place("grass", s, side * depth, 0.7 + rand() * 0.9, 0.75 + rand() * 0.45);
      }
    }

    // Village life: a warung with scooters parked in front every few hundred metres, houses further back.
    const seaSide = theme.hasSea ? 1 : 0;
    const stalls = Math.max(1, Math.round(((hi - lo) / 400) * Math.min(1, 0.4 + treeScale)));
    for (let i = 0; i < stalls; i++) {
      const s = lo + 30 + rand() * Math.max(0, hi - lo - 60);
      if (s < 80 || s > this.track.lengthM - 120 || this.nearGantry(s, 40)) continue;
      const side = seaSide ? -1 : rand() < 0.5 ? -1 : 1;
      // Front (+X) towards the road.
      place("warung", s, side * (ROAD_HALF + 6.5), 1, 0.9 + rand() * 0.15, false, side > 0 ? Math.PI : 0);
      const bikes = 1 + Math.floor(rand() * 3);
      for (let b = 0; b < bikes; b++) {
        place(MOTORS[Math.floor(rand() * MOTORS.length)]!, s - 2.5 + b * 1.6, side * (ROAD_HALF + 3.3), 1, 1, false, (rand() - 0.5) * 0.3);
      }
    }
    const houses = Math.round(((hi - lo) / 100) * density * 0.12);
    for (let i = 0; i < houses; i++) {
      const side = seaSide ? -1 : rand() < 0.5 ? -1 : 1;
      const s = lo + rand() * (hi - lo);
      place(HOUSES[Math.floor(rand() * HOUSES.length)]!, s, side * (16 + rand() * 30), 0.85 + rand() * 0.3, 0.88 + rand() * 0.16, false, (side > 0 ? Math.PI : 0) + (rand() - 0.5) * 0.4);
    }
    // A musholla now and then, set back from the road.
    if (rand() < 0.35) {
      const s = lo + 60 + rand() * Math.max(0, hi - lo - 120);
      const side = seaSide ? -1 : rand() < 0.5 ? -1 : 1;
      if (s > 60 && s < this.track.lengthM - 60 && !this.nearGantry(s, 60)) place("mosque", s, side * (22 + rand() * 10), 1, 1, false, side > 0 ? Math.PI : 0);
    }

    // Umbul-umbul and a crowd where the racing is: the finish, every segment's end, and the start.
    const hot = [this.track.lengthM, ...this.segments.map((g) => g.endM)];
    for (const end of [...hot, 60]) {
      for (let s = end - 90; s <= end + 10; s += 9) {
        if (s < lo || s >= hi) continue;
        place(FLAGS[Math.floor(rand() * FLAGS.length)]!, s, -(ROAD_HALF + 2.2), 1, 1, false, (rand() - 0.5) * 0.4);
        place(FLAGS[Math.floor(rand() * FLAGS.length)]!, s, ROAD_HALF + 2.2, 1, 1, false, (rand() - 0.5) * 0.4);
      }
    }
    const fansPerSide = Math.round(4 + 14 * treeScale);
    for (const end of hot) {
      for (const side of [-1, 1]) {
        if (seaSide && side > 0 && end !== this.track.lengthM) continue;
        for (let f = 0; f < fansPerSide; f++) {
          const s = end - 50 + rand() * 65;
          if (s < lo || s >= hi) continue;
          const lat = side * (ROAD_HALF + 2.8 + rand() * 2.6);
          // Facing the road: local +Z is the road direction, so turn a quarter towards it.
          place(FANS[Math.floor(rand() * FANS.length)]!, s, lat, 0.92 + rand() * 0.16, 0.9 + rand() * 0.15, false, side * (Math.PI / 2) + (rand() - 0.5) * 0.6);
        }
      }
    }

    for (const [kind, matrices] of placements) {
      const mesh = new InstancedMesh(this.geometry(kind), this.material, matrices.length);
      const toneList = tints.get(kind)!;
      matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        this.tint.setScalar(toneList[i]!);
        mesh.setColorAt(i, this.tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = this.quality.sceneryShadows && SHADOW_KINDS[kind] === true;
      group.add(mesh);
    }
    return group;
  }

  private nearGantry(s: number, within: number): boolean {
    return this.segments.some((g) => Math.abs(g.startM - s) < within || Math.abs(g.endM - s) < within);
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    this.material.dispose();
  }
}
