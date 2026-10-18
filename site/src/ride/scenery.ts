import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
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

import { groundHeight } from "./terrain.ts";
import { ROAD_HALF, Track, makeTrackPoint, type TrackPoint } from "./track.ts";
import type { SegmentDef } from "./routes.ts";
import type { Theme, TreeKind } from "./theme.ts";

/** Deterministic PRNG so a route always grows the same trees. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute("position").count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new BufferAttribute(data, 3));
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

function at(geometry: BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): BufferGeometry {
  geometry.scale(sx, sy, sz);
  geometry.translate(x, y, z);
  return geometry;
}

function pineGeometry(): BufferGeometry {
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.14, 0.2, 1.6, 5), 0, 0.8, 0), 0x5a3e2a),
    paint(at(new ConeGeometry(1.5, 3.2, 6), 0, 3.1, 0), 0x2f5d34),
    paint(at(new ConeGeometry(1.15, 2.8, 6), 0, 4.8, 0), 0x356b3a),
    paint(at(new ConeGeometry(0.75, 2.4, 6), 0, 6.3, 0), 0x3d7a42),
  ])!;
}

function roundGeometry(): BufferGeometry {
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.16, 0.24, 2.4, 5), 0, 1.2, 0), 0x5e4630),
    paint(at(new IcosahedronGeometry(1.9, 0), 0, 3.9, 0, 1, 0.85, 1), 0x4c8a3c),
    paint(at(new IcosahedronGeometry(1.2, 0), 0.9, 3.2, 0.4), 0x5a9a46),
  ])!;
}

function palmGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [paint(at(new CylinderGeometry(0.12, 0.22, 6.5, 5), 0, 3.25, 0), 0x8a6a45)];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const frond = new ConeGeometry(0.28, 3.2, 4);
    frond.rotateZ(Math.PI / 2 - 0.45);
    frond.translate(1.5, 0, 0);
    frond.rotateY(angle);
    frond.translate(0, 6.5, 0);
    parts.push(paint(frond, i % 2 ? 0x4f9a45 : 0x3f8a3d));
  }
  return mergeGeometries(parts)!;
}

function postGeometry(): BufferGeometry {
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.07, 0.07, 1.0, 5), 0, 0.5, 0), 0xf2f0e8),
    paint(at(new CylinderGeometry(0.075, 0.075, 0.16, 5), 0, 0.82, 0), 0xc4382c),
  ])!;
}

function bushGeometry(): BufferGeometry {
  return paint(at(new IcosahedronGeometry(0.8, 0), 0, 0.45, 0, 1.2, 0.8, 1.2), 0x4a7d36);
}

function rockGeometry(): BufferGeometry {
  return paint(at(new IcosahedronGeometry(0.9, 0), 0, 0.4, 0, 1.3, 0.8, 1), 0x8c857a);
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
    // Bottles and jars on the counter.
    paint(at(new CylinderGeometry(0.06, 0.06, 0.3, 5), 1.8, 1.1, -1.2), 0xe58a2b),
    paint(at(new CylinderGeometry(0.06, 0.06, 0.3, 5), 1.8, 1.1, -0.9), 0x3d8f4a),
    paint(at(new CylinderGeometry(0.16, 0.16, 0.34, 6), 1.8, 1.12, 0.9), 0xd9cfa8),
  ];
  return mergeGeometries(parts)!;
}

/** A small scooter parked sideways (length along local Z). */
function motorGeometry(color: number): BufferGeometry {
  const wheel = () => new TorusGeometry(0.26, 0.08, 5, 10).rotateY(Math.PI / 2);
  return mergeGeometries([
    paint(at(wheel(), 0, 0.3, 0.62), 0x1c1c1c),
    paint(at(wheel(), 0, 0.3, -0.62), 0x1c1c1c),
    paint(at(new BoxGeometry(0.32, 0.36, 1.0), 0, 0.55, -0.1), color),
    paint(at(new BoxGeometry(0.3, 0.12, 0.62), 0, 0.82, -0.22), 0x26221e),
    paint(at(new BoxGeometry(0.28, 0.75, 0.18), 0, 0.72, 0.5), color),
    paint(at(new CylinderGeometry(0.03, 0.03, 0.6, 4).rotateZ(Math.PI / 2), 0, 1.12, 0.55), 0x2a2a2a),
  ])!;
}

/** Umbul-umbul: a tall curved bamboo pole with a long vertical banner. */
function flagGeometry(color: number): BufferGeometry {
  const banner = new PlaneGeometry(0.55, 3.2, 1, 1);
  banner.rotateY(Math.PI / 2);
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.045, 0.06, 6.4, 5), 0, 3.2, 0), 0xc8a865),
    paint(at(banner, 0, 4.2, 0.3), color),
    paint(at(new PlaneGeometry(0.55, 0.5).rotateY(Math.PI / 2), 0, 6.0, 0.3), 0xf4f1e8),
  ])!;
}

/** A standing spectator; shirt colour per variant, arm raised on the cheering variant. */
function spectatorGeometry(shirt: number, cheer: boolean): BufferGeometry {
  const arm = new CylinderGeometry(0.05, 0.05, 0.55, 4);
  const parts = [
    paint(at(new CylinderGeometry(0.11, 0.1, 0.8, 5), -0.1, 0.4, 0), 0x2d3442),
    paint(at(new CylinderGeometry(0.11, 0.1, 0.8, 5), 0.1, 0.4, 0), 0x2d3442),
    paint(at(new BoxGeometry(0.44, 0.6, 0.26), 0, 1.1, 0), shirt),
    paint(at(new SphereGeometry(0.15, 6, 5), 0, 1.58, 0), 0x9a6a48),
    paint(at(new SphereGeometry(0.16, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.62, 0), 0x1d1814),
  ];
  if (cheer) {
    parts.push(paint(at(arm.clone().rotateZ(0.35), 0.3, 1.55, 0), shirt));
    parts.push(paint(at(arm.clone().rotateZ(-0.35), -0.3, 1.55, 0), shirt));
  } else {
    parts.push(paint(at(arm.clone(), 0.27, 1.05, 0), shirt));
    parts.push(paint(at(arm.clone(), -0.27, 1.05, 0), shirt));
  }
  return mergeGeometries(parts)!;
}

/** A village house: plastered walls and a terracotta roof. Front faces local +X. */
function houseGeometry(): BufferGeometry {
  const roofA = new BoxGeometry(3.4, 0.14, 7.4);
  roofA.rotateZ(0.5);
  const roofB = new BoxGeometry(3.4, 0.14, 7.4);
  roofB.rotateZ(-0.5);
  return mergeGeometries([
    paint(at(new BoxGeometry(5.2, 2.8, 6.6), 0, 1.4, 0), 0xe9e0cc),
    paint(at(roofA, -1.35, 3.55, 0), 0xa7493a),
    paint(at(roofB, 1.35, 3.55, 0), 0xb4543f),
    paint(at(new BoxGeometry(0.08, 1.9, 1.0), 2.62, 0.95, -1.2), 0x5b3e2a),
    paint(at(new BoxGeometry(0.08, 0.9, 1.1), 2.62, 1.6, 1.4), 0x7aa0b5),
  ])!;
}

const GEOMETRIES = {
  pine: pineGeometry,
  round: roundGeometry,
  palm: palmGeometry,
  post: postGeometry,
  bush: bushGeometry,
  rock: rockGeometry,
  warung: warungGeometry,
  motorRed: () => motorGeometry(0xb8322a),
  motorBlue: () => motorGeometry(0x2f5f9e),
  motorBlack: () => motorGeometry(0x2b2b2b),
  flagRed: () => flagGeometry(0xd6322a),
  flagYellow: () => flagGeometry(0xf0c330),
  flagTeal: () => flagGeometry(0x0a8aa0),
  fanA: () => spectatorGeometry(0xd94a3d, true),
  fanB: () => spectatorGeometry(0x0a6580, false),
  fanC: () => spectatorGeometry(0xf2c230, true),
  fanD: () => spectatorGeometry(0xf1efe6, false),
  house: houseGeometry,
} satisfies Record<TreeKind | string, () => BufferGeometry>;

type Kind = keyof typeof GEOMETRIES;
const MOTORS: Kind[] = ["motorRed", "motorBlue", "motorBlack"];
const FLAGS: Kind[] = ["flagRed", "flagYellow", "flagTeal"];
const FANS: Kind[] = ["fanA", "fanB", "fanC", "fanD"];

export class Scenery {
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly point: TrackPoint = makeTrackPoint();
  private readonly dummy = new Object3D();
  private readonly tint = new Color();

  constructor(
    private readonly track: Track,
    private readonly theme: Theme,
    private readonly treeScale: number,
    private readonly segments: readonly SegmentDef[] = [],
  ) {}

  private geometry(kind: keyof typeof GEOMETRIES): BufferGeometry {
    let g = this.geometries.get(kind);
    if (!g) {
      g = GEOMETRIES[kind]();
      this.geometries.set(kind, g);
    }
    return g;
  }

  /** Everything that grows beside the road between [s0, s1). */
  buildChunk(s0: number, s1: number, chunkIndex: number): Group {
    const group = new Group();
    const rand = mulberry32(this.theme.seed * 1009 + chunkIndex * 7919);
    const placements = new Map<string, Matrix4[]>();
    const tints = new Map<string, number[]>();
    /** `yawJitter` false faces the object along the road, turned by `yawOffset`. */
    const place = (kind: Kind, s: number, lat: number, scale: number, tone: number, yawJitter = true, yawOffset = 0) => {
      const t = this.track.at(s, this.point);
      const wx = t.x + Math.cos(t.yaw) * lat;
      const wz = t.z - Math.sin(t.yaw) * lat;
      const y = groundHeight(this.theme, t.y, lat, wx, wz);
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

    const density = this.theme.treeDensity * this.treeScale;
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
        const depth = 8 + Math.pow(rand(), 1.6) * (this.theme.treeReach - 8);
        const lat = side * depth;
        if (this.theme.hasSea && lat > 22) continue;
        const kind = this.theme.trees[Math.floor(rand() * this.theme.trees.length)]!;
        place(kind, s, lat, 0.75 + rand() * 0.9, 0.82 + rand() * 0.3);
      }
      const bushes = Math.round(((hi - lo) / 100) * density * 0.8);
      for (let i = 0; i < bushes; i++) {
        const s = lo + rand() * (hi - lo);
        const depth = ROAD_HALF + 2.5 + rand() * 18;
        if (this.theme.hasSea && side > 0 && depth > 20) continue;
        const rocky = this.theme.hillAmp > 60 && rand() < 0.5;
        place(rocky ? "rock" : "bush", s, side * depth, 0.6 + rand() * 1.1, 0.85 + rand() * 0.3);
      }
    }

    // Village life: a warung with scooters parked in front every few hundred metres, houses further back.
    const seaSide = this.theme.hasSea ? 1 : 0;
    const stalls = Math.max(1, Math.round(((hi - lo) / 400) * Math.min(1, 0.4 + this.treeScale)));
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
      place("house", s, side * (16 + rand() * 30), 0.85 + rand() * 0.3, 0.85 + rand() * 0.2, false, (side > 0 ? Math.PI : 0) + (rand() - 0.5) * 0.4);
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
    const fansPerSide = Math.round(4 + 14 * this.treeScale);
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
      const mesh = new InstancedMesh(this.geometry(kind as Kind), this.material, matrices.length);
      const toneList = tints.get(kind)!;
      matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        this.tint.setScalar(toneList[i]!);
        mesh.setColorAt(i, this.tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
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
