/**
 * Oncoming traffic in the right-hand lane (Indonesia keeps left): scooters with their riders, family cars, and on Bromo the
 * hardtop jeeps that carry tourists to the crater. Purely cosmetic: vehicles never touch the riders' lane.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, type BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { at, motorGeometry, mulberry32, paint } from "./scenery.ts";
import { Track, makeTrackPoint, ROAD_HALF, roadCrown } from "./track.ts";

const SPAWN_AHEAD_M = 260;
const SPAWN_SPREAD_M = 320;
const DESPAWN_BEHIND_M = 50;

/** A car body along local Z, front at +Z like the scooters; [jeep] for the tall boxy Land Cruiser hardtop. */
function carGeometry(color: number, jeep: boolean): BufferGeometry {
  const wheel = () => new CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2);
  const len = jeep ? 4.4 : 4.2;
  const parts = [
    paint(at(new BoxGeometry(1.7, 0.75, len), 0, 0.72, 0), color),
    paint(at(new BoxGeometry(1.62, jeep ? 0.85 : 0.68, jeep ? 2.8 : 2.4), 0, jeep ? 1.5 : 1.42, jeep ? 0.45 : 0.25), jeep ? color : 0x2c3640),
    paint(at(new BoxGeometry(1.64, jeep ? 0.5 : 0.5, 0.06), 0, jeep ? 1.55 : 1.4, jeep ? -0.97 : -0.98), 0x2c3640),
    paint(at(new BoxGeometry(1.72, 0.18, 0.1), 0, 0.5, -len / 2), 0x9a9ea4),
    paint(at(new BoxGeometry(0.3, 0.14, 0.04), -0.6, 0.85, -len / 2 - 0.01), 0xf4f1e0),
    paint(at(new BoxGeometry(0.3, 0.14, 0.04), 0.6, 0.85, -len / 2 - 0.01), 0xf4f1e0),
    paint(at(new BoxGeometry(0.3, 0.14, 0.04), -0.6, 0.85, len / 2 + 0.01), 0xc4382c),
    paint(at(new BoxGeometry(0.3, 0.14, 0.04), 0.6, 0.85, len / 2 + 0.01), 0xc4382c),
  ];
  if (jeep) {
    parts.push(paint(at(new BoxGeometry(1.5, 0.08, 2.2), 0, 1.98, 0.5), 0x2a2a2a));
    parts.push(paint(at(new CylinderGeometry(0.36, 0.36, 0.22, 12).rotateX(Math.PI / 2), 0, 1.1, len / 2 + 0.12), 0x1c1c1c));
  }
  for (const [x, z] of [
    [-0.82, -len * 0.32],
    [0.82, -len * 0.32],
    [-0.82, len * 0.3],
    [0.82, len * 0.3],
  ] as const) {
    parts.push(paint(at(wheel(), x, 0.33, z), 0x1c1c1c));
  }
  // Built nose at -Z; turned so the nose is at +Z.
  return mergeGeometries(parts)!.rotateY(Math.PI);
}

interface Vehicle {
  mesh: Mesh;
  s: number;
  speedMs: number;
  lat: number;
}

export class Traffic {
  readonly group = new Group();
  private readonly vehicles: Vehicle[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly point = makeTrackPoint();
  private readonly rand: () => number;

  constructor(
    private readonly track: Track,
    bromo: boolean,
    count: number,
    seed: number,
    shadows: boolean,
  ) {
    this.rand = mulberry32(seed * 131 + 3);
    const kinds: { geometry: BufferGeometry; lat: number; speed: [number, number] }[] = [];
    const add = (geometry: BufferGeometry, lat: number, speed: [number, number]) => {
      this.geometries.push(geometry);
      kinds.push({ geometry, lat, speed });
    };
    add(motorGeometry(0xb8322a, 0x2b2b2b), ROAD_HALF - 1.0, [8, 12]);
    add(motorGeometry(0x2f5f9e, 0x0a6580), ROAD_HALF - 1.1, [8, 12]);
    add(motorGeometry(0xe8e4d8, 0xd94a3d), ROAD_HALF - 0.9, [7, 11]);
    if (bromo) {
      add(carGeometry(0x2f5a3a, true), 2.0, [8, 11]);
      add(carGeometry(0x8a2a24, true), 2.0, [8, 11]);
      add(carGeometry(0xd8d4c8, true), 2.0, [8, 11]);
    } else {
      add(carGeometry(0xd8d8da, false), 2.0, [10, 14]);
      add(carGeometry(0x2a2c30, false), 2.0, [10, 14]);
      add(carGeometry(0x9a2a24, false), 2.0, [10, 14]);
    }
    for (let i = 0; i < count; i++) {
      const kind = kinds[i % kinds.length]!;
      const mesh = new Mesh(kind.geometry, this.material);
      mesh.castShadow = shadows;
      mesh.rotation.order = "YXZ";
      this.group.add(mesh);
      this.vehicles.push({ mesh, s: Number.NaN, speedMs: kind.speed[0] + this.rand() * (kind.speed[1] - kind.speed[0]), lat: kind.lat });
    }
  }

  /** Moves the vehicles towards the rider at [riderS] and recycles the ones that went past. */
  update(dt: number, riderS: number): void {
    for (const v of this.vehicles) {
      if (!Number.isFinite(v.s) || v.s < riderS - DESPAWN_BEHIND_M || v.s > riderS + SPAWN_AHEAD_M + SPAWN_SPREAD_M + 50) {
        v.s = riderS + SPAWN_AHEAD_M * (Number.isFinite(v.s) ? 1 : 0.3) + this.rand() * SPAWN_SPREAD_M;
      }
      v.s -= v.speedMs * dt;
      const t = this.track.at(v.s, this.point);
      v.mesh.position.set(t.x + Math.cos(t.yaw) * v.lat, t.y + roadCrown(v.lat), t.z - Math.sin(t.yaw) * v.lat);
      // Local +Z (the nose) points back down the road, towards the riders.
      v.mesh.rotation.set(Math.atan(t.grade / 100), t.yaw, 0);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
