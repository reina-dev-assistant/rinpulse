// Low-poly cyclist on a road bike, built only from three.js primitives.
//
// Local space: +Z forward, +Y up, origin on the ground under the bottom bracket, 1 unit = 1 m.
// The rider's right side is -X (a viewer looking along +Z has +X on their left).
//
// Crank angle convention: 0 = right pedal at the top (12 o'clock), PI/2 = right pedal
// forward (+Z), PI = bottom, 3*PI/2 = back. Increasing angle is the forward pedalling
// direction. The left pedal is always at crankAngle + PI.
import { jerseyLogoTexture } from './brand.ts';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';

export interface AvatarPose {
  /** Accumulated crank angle in radians, 0 = right pedal at the top, increasing = pedalling forward. Left pedal is offset by PI. */
  crankAngle: number;
  /** Accumulated wheel rotation in radians (forward roll). */
  wheelAngle: number;
  /** Standing out of the saddle 0..1 (used on steep climbs); default 0. */
  stand?: number;
  /** Aero tuck 0..1 (used going fast on flat/descents); default 0. */
  tuck?: number;
}

export interface Avatar {
  /** Local space: forward is +Z, up is +Y, origin at the ground point under the bottom bracket. 1 unit = 1 metre. */
  group: Group;
  update(pose: AvatarPose): void;
  /** Recolours the jersey (torso, sleeves, helmet stripe) and the frame in place. */
  setJersey(color: number): void;
  dispose(): void;
}

export interface AvatarOptions {
  /** Jersey colour, 0xRRGGBB. */
  jersey: number;
  /** Ghost look: every material semi-transparent, flat unlit tint, jersey and frame share one cool tint. */
  ghost?: boolean;
  /** Physically based materials: glossy paint, carbon, metal and fabric. Off = plain diffuse. */
  pbr?: boolean;
  /** Every part throws a shadow. */
  shadows?: boolean;
}

const D2R = Math.PI / 180;

const CRANK_LENGTH = 0.1725;
const WHEEL_RADIUS = 0.34;

const BB_Y = 0.27;
const REAR_AXLE_Z = -0.41;
const FRONT_AXLE_Z = 0.59;

const THIGH = 0.46;
const SHIN = 0.46;
const ARM_UPPER = 0.31;
const ARM_FORE = 0.39;
const TORSO = 0.5;

const HIP_X = 0.085;
const HIP_Y = 1.04;
const HIP_Z = -0.215;
const SHOULDER_X = 0.185;
const PEDAL_X = 0.11;
const ANKLE_X = 0.105;
const CRANK_X = 0.08;
const HAND_X = 0.2;

// Ankle position relative to the pedal axle for a level foot (ball of foot over the axle).
const ANKLE_FORWARD = -0.12;
const ANKLE_UP = 0.08;

const LEAN_SEATED = 40 * D2R;
const LEAN_TUCK = 20 * D2R;
const LEAN_STAND = 48 * D2R;
// Hips move forward over the pedals when standing: with the hands fixed on the hoods a rearward
// shift would put the shoulders out of arm reach.
const STAND_RISE = 0.08;
const STAND_SHIFT = 0.1;

const HOOD_Y = 0.895;
const HOOD_Z = 0.55;
const DROP_Y = 0.775;
const DROP_Z = 0.6;

const SWAY = 0.012;

const Y_AXIS = new Vector3(0, 1, 0);
const dir = new Vector3();

/** Orient a unit-length +Y cylinder (pivot at its base) so it spans a -> b, with lateral radii rx, rz. */
function placeLimb(m: Object3D, a: Vector3, b: Vector3, rx: number, rz: number): void {
  dir.subVectors(b, a);
  const len = dir.length();
  m.position.copy(a);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(Y_AXIS, dir.divideScalar(len));
  m.scale.set(rx, len, rz);
}

let jointY = 0;
let jointZ = 0;
let endY = 0;
let endZ = 0;

/**
 * Two-bone IK in the Y-Z plane. Writes the (reach-clamped) end point to endY/endZ and the middle
 * joint to jointY/jointZ. bend = +1 puts the joint toward +Z of the A->B line (knees), -1 away (elbows).
 */
function solveIk(ay: number, az: number, ty: number, tz: number, l1: number, l2: number, bend: number): void {
  let dy = ty - ay;
  let dz = tz - az;
  const d = Math.hypot(dy, dz);
  const reach = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
  const s = d > 1e-9 ? reach / d : 0;
  dy *= s;
  dz *= s;
  endY = ay + dy;
  endZ = az + dz;
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(l1 * l1 - along * along, 0)) * bend;
  const uy = dy / reach;
  const uz = dz / reach;
  jointZ = az + uz * along - uy * h;
  jointY = ay + uy * along + uz * h;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

interface Part {
  geo: BufferGeometry;
  matrix: Matrix4;
  color: Color;
}

/** Bake parts into one non-indexed geometry with a per-vertex colour attribute. */
function merge(parts: Part[]): BufferGeometry {
  const flat = parts.map((p) => p.geo.toNonIndexed().applyMatrix4(p.matrix));
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let at = 0;
  flat.forEach((g, i) => {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const c = parts[i].color;
    pos.set(p.array, at * 3);
    nor.set(n.array, at * 3);
    for (let k = 0; k < p.count; k++) {
      const o = (at + k) * 3;
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
    }
    at += p.count;
    g.dispose();
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  return out;
}

interface Side {
  sign: number; // +1 right (-X), -1 left (+X)
  phase: number;
  thigh: Mesh;
  shin: Mesh;
  sock: Mesh;
  knee: Mesh;
  foot: Mesh;
  pedal: Mesh;
  crank: Mesh;
  upper: Mesh;
  fore: Mesh;
  elbow: Mesh;
  hand: Mesh;
  shoulder: Mesh;
  hip: Vector3;
  kneeV: Vector3;
  ankle: Vector3;
  sockTop: Vector3;
  pedalV: Vector3;
  crankStart: Vector3;
  shoulderV: Vector3;
  elbowV: Vector3;
  handV: Vector3;
}

type Finish = 'fabric' | 'skin' | 'paint' | 'carbon' | 'metal' | 'rubber' | 'lens' | 'shell';

/** Roughness and metalness per surface for the physically based look. */
const FINISH: Record<Finish, [number, number]> = {
  fabric: [0.62, 0],
  skin: [0.6, 0],
  paint: [0.22, 0.35],
  carbon: [0.32, 0.2],
  metal: [0.28, 0.85],
  rubber: [0.85, 0],
  lens: [0.06, 0.6],
  shell: [0.3, 0.05],
};

export function createAvatar(options: AvatarOptions): Avatar {
  const ghost = options.ghost === true;
  const pbr = options.pbr === true;
  const geos: BufferGeometry[] = [];
  const mats = new Set<Material>();
  const track = <T extends BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };

  const ghostMat = ghost
    ? new MeshBasicMaterial({
        color: new Color(0x8fd0ff).lerp(new Color(options.jersey), 0.25),
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
    : null;
  const material = (color: number, finish: Finish, vertexColors = false): MeshStandardMaterial | MeshLambertMaterial | MeshBasicMaterial => {
    const [roughness, metalness] = FINISH[finish];
    const m = ghostMat ?? (pbr ? new MeshStandardMaterial({ color, vertexColors, roughness, metalness }) : new MeshLambertMaterial({ color, vertexColors }));
    mats.add(m);
    return m;
  };

  const jerseyMat = material(options.jersey, 'fabric');
  const torsoMat = material(options.jersey, 'fabric', true);
  const skinMat = material(0xc98f6c, 'skin');
  const shortsMat = material(0x16181e, 'fabric');
  const darkMat = material(0x15171c, 'rubber');
  const shoeMat = material(0xffffff, 'shell', true);
  const gloveMat = material(0xffffff, 'rubber', true);
  const headMat = material(0xffffff, 'shell', true);
  const sockMat = material(0xf4f4f2, 'fabric');
  const metalMat = material(0xaab1ba, 'metal');
  const frameMat = material(options.jersey, 'paint', true);
  const bikeMat = material(0xffffff, 'carbon', true);

  /** A limb or torso shaped by [profile] (radius, 0..1 along its length), revolved; unit length along +Y like `tubeGeo`. */
  const shaped = (profile: readonly (readonly [number, number])[], segments = 14) =>
    track(new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments));
  const tubeGeo = track(new CylinderGeometry(1, 1, 1, 8, 1).translate(0, 0.5, 0));
  // Muscle shapes: quads full above the knee, calves bulging below it, a narrow ankle, shoulders rounder than the wrist.
  const thighGeo = shaped([[0.9, 0], [1.05, 0.12], [1.1, 0.3], [1.02, 0.55], [0.86, 0.8], [0.74, 1]]);
  const shinGeo = shaped([[0.84, 0], [0.98, 0.12], [1.1, 0.3], [1.0, 0.5], [0.74, 0.75], [0.6, 0.92], [0.62, 1]]);
  const upperArmGeo = shaped([[1.0, 0], [1.06, 0.25], [1.0, 0.55], [0.86, 0.85], [0.8, 1]]);
  const foreArmGeo = shaped([[0.95, 0], [1.06, 0.2], [0.96, 0.5], [0.72, 0.9], [0.66, 1]]);
  // Torso from the hips to the neck: waist, rib cage, chest, shoulders closing to the collar. Vertex colours paint the bib
  // shorts' waist, darker side panels, a chest band and the collar over the jersey colour.
  const torsoGeo = shaped([[0.8, 0], [0.72, 0.22], [0.82, 0.5], [0.95, 0.74], [0.97, 0.86], [0.84, 0.95], [0.5, 1]], 20);
  {
    const pos = torsoGeo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const r = Math.hypot(pos.getX(i), pos.getZ(i)) || 1;
      const side = Math.abs(pos.getX(i)) / r;
      let k = side > 0.82 ? 0.45 : 1;
      if (y > 0.6 && y < 0.67) k *= 0.72;
      if (y > 0.95) k = 0.5;
      if (y < 0.12) k = 0.09;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    torsoGeo.setAttribute('color', new BufferAttribute(col, 3));
  }
  const ballGeo = track(new SphereGeometry(1, 16, 11));
  const pedalGeo = track(new BoxGeometry(0.1, 0.02, 0.1));

  /** One baked part: [geo] scaled, turned about X and moved, in [hex]. */
  const bake = (geo: BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, hex: number, rotX = 0): Part => ({
    geo: track(geo),
    matrix: new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationX(rotX)).multiply(new Matrix4().makeScale(sx, sy, sz)),
    color: new Color(hex),
  });
  const unit = () => new SphereGeometry(1, 18, 12);
  const box = () => new BoxGeometry(1, 1, 1);
  const SKIN = 0xc98f6c;
  const HAIR = 0x1e1712;
  // Head, origin at the skull's centre, facing +Z: face, jaw, nose, ears, hair at the nape, an aero-road helmet with vents and
  // straps, wrap-around glasses.
  const headGeo = track(
    merge([
      bake(unit(), 0, 0, 0, 0.083, 0.102, 0.098, SKIN),
      bake(unit(), 0, -0.058, 0.028, 0.064, 0.05, 0.068, SKIN),
      bake(box(), 0, -0.012, 0.098, 0.02, 0.036, 0.026, 0xb87e5c, -0.3),
      bake(unit(), 0.083, -0.008, -0.006, 0.012, 0.03, 0.02, 0xb87e5c),
      bake(unit(), -0.083, -0.008, -0.006, 0.012, 0.03, 0.02, 0xb87e5c),
      bake(unit(), 0, -0.005, -0.045, 0.082, 0.06, 0.068, HAIR),
      bake(new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), 0, 0.028, -0.012, 0.106, 0.102, 0.138, 0xf0f1f3),
      bake(unit(), 0, 0.045, -0.115, 0.07, 0.045, 0.065, 0xf0f1f3),
      ...[-0.045, 0, 0.045].map((x) => bake(box(), x, 0.125, -0.005, 0.016, 0.012, 0.11, 0x2a2c30)),
      ...[-0.03, 0.03].map((x) => bake(box(), x, 0.09, 0.085, 0.022, 0.012, 0.03, 0x2a2c30, 0.6)),
      ...[-1, 1].map((s) => bake(box(), s * 0.078, -0.055, 0.03, 0.006, 0.09, 0.008, 0x1d1d22, -0.5)),
      bake(box(), 0, 0.012, 0.094, 0.172, 0.042, 0.018, 0x1b2026),
      bake(box(), 0, 0.036, 0.092, 0.176, 0.008, 0.02, 0x3a3d42),
      ...[-1, 1].map((s) => bake(box(), s * 0.087, 0.02, 0.045, 0.006, 0.008, 0.1, 0x3a3d42)),
    ]),
  );
  const stripeGeo = track(new BoxGeometry(0.035, 0.02, 0.24));
  // Road shoe, origin at the ankle: white upper and rounded toe, carbon sole with a heel pad, a dial on top.
  const footGeo = track(
    merge([
      bake(box(), 0, -0.032, 0.05, 0.084, 0.066, 0.2, 0xf1f1ef),
      bake(unit(), 0, -0.042, 0.155, 0.043, 0.036, 0.06, 0xf1f1ef),
      bake(unit(), 0, -0.03, -0.04, 0.042, 0.05, 0.035, 0xf1f1ef),
      bake(box(), 0, -0.074, 0.06, 0.088, 0.016, 0.27, 0x1d1e22),
      bake(new CylinderGeometry(1, 1, 1, 12), 0.025, 0.003, 0.05, 0.016, 0.012, 0.016, 0x1d1e22),
      bake(box(), 0, -0.002, 0.11, 0.07, 0.006, 0.05, 0x1d1e22),
    ]),
  );
  // Glove, built along +Y from the wrist (y = 0) with the palm on +Z: oriented along the forearm, +Z faces down onto the hood, so
  // the fingers curl over the front of the hood and the thumb wraps under it.
  const GLOVE = 0x1b1c20;
  const gloveGeo = track(
    merge([
      bake(new CylinderGeometry(1, 1, 1, 12), 0, 0.012, 0, 0.033, 0.03, 0.03, 0x3a3d42),
      bake(unit(), 0, 0.05, 0, 0.038, 0.05, 0.02, GLOVE),
      bake(box(), 0, 0.06, 0.002, 0.074, 0.07, 0.03, GLOVE),
      bake(box(), 0, 0.1, 0.004, 0.078, 0.022, 0.034, GLOVE),
      bake(box(), 0, 0.122, 0.026, 0.074, 0.044, 0.024, GLOVE, 0.95),
      bake(box(), 0, 0.118, 0.052, 0.07, 0.026, 0.02, GLOVE, 1.9),
      bake(box(), 0, 0.05, 0.03, 0.024, 0.06, 0.022, GLOVE, -0.4),
      bake(box(), 0, 0.06, -0.018, 0.05, 0.05, 0.006, 0x6a6e76),
    ]),
  );

  const group = new Group();
  const addMesh = (geo: BufferGeometry, mat: Material): Mesh => {
    const m = new Mesh(geo, mat);
    group.add(m);
    return m;
  };

  // Static frame (painted) and the rest of the bike (vertex coloured) baked into one mesh each.
  const scratch = new Object3D();
  const white = new Color(0xffffff);
  const carbon = new Color(0x1a1b1f);
  const metalColor = new Color(0x9aa1aa);
  const saddleColor = new Color(0x202226);
  const tapeColor = new Color(0x15161a);
  const frameParts: Part[] = [];
  const parts: Part[] = [];
  const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
  const tube = (list: Part[], a: Vector3, b: Vector3, r: number, color: Color): void => {
    placeLimb(scratch, a, b, r, r);
    scratch.updateMatrix();
    list.push({ geo: tubeGeo, matrix: scratch.matrix.clone(), color });
  };
  const solid = (geo: BufferGeometry, at: Vector3, color: Color): void => {
    parts.push({ geo, matrix: new Matrix4().makeTranslation(at.x, at.y, at.z), color });
  };

  const bb = v(0, BB_Y, 0);
  const seatTop = v(0, 0.79, -0.16);
  const headTop = v(0, 0.775, 0.435);
  const headBottom = v(0, 0.64, 0.47);
  const steererTop = v(0, 0.84, 0.425);
  const bar = v(0, 0.84, 0.51);

  tube(frameParts, bb, seatTop, 0.017, white);
  tube(frameParts, seatTop, headTop, 0.018, white);
  tube(frameParts, bb, headBottom, 0.022, white);
  tube(frameParts, headTop, headBottom, 0.023, white);
  tube(frameParts, v(-0.04, 0.64, 0.47), v(0.04, 0.64, 0.47), 0.012, white);
  for (const s of [-1, 1]) {
    tube(frameParts, v(s * 0.04, BB_Y, 0), v(s * 0.055, WHEEL_RADIUS, REAR_AXLE_Z), 0.009, white);
    tube(frameParts, v(s * 0.02, 0.77, -0.165), v(s * 0.055, WHEEL_RADIUS, REAR_AXLE_Z), 0.008, white);
    tube(frameParts, v(s * 0.04, 0.64, 0.47), v(s * 0.055, WHEEL_RADIUS, FRONT_AXLE_Z), 0.012, white);
  }
  tube(parts, seatTop, v(0, 0.935, -0.2), 0.0135, carbon);
  tube(parts, headTop, steererTop, 0.016, carbon);
  tube(parts, steererTop, bar, 0.016, carbon);
  tube(parts, v(-0.2, 0.84, 0.51), v(0.2, 0.84, 0.51), 0.013, tapeColor);
  for (const s of [-1, 1]) {
    tube(parts, v(s * HAND_X, 0.84, 0.51), v(s * HAND_X, 0.865, 0.585), 0.02, tapeColor);
    tube(parts, v(s * HAND_X, 0.835, 0.55), v(s * HAND_X, 0.74, 0.63), 0.0125, tapeColor);
    tube(parts, v(s * HAND_X, 0.74, 0.63), v(s * HAND_X, 0.7, 0.575), 0.0125, tapeColor);
    // Brake hoods and levers.
    solid(track(new BoxGeometry(0.032, 0.05, 0.07)), v(s * HAND_X, 0.875, 0.6), carbon);
    tube(parts, v(s * HAND_X, 0.86, 0.625), v(s * HAND_X, 0.76, 0.64), 0.006, metalColor);
  }
  // Saddle: a wide back, a narrow nose.
  solid(track(new BoxGeometry(0.14, 0.045, 0.12)), v(0, 0.95, -0.24), saddleColor);
  solid(track(new BoxGeometry(0.06, 0.04, 0.16)), v(0, 0.948, -0.11), saddleColor);
  // Drivetrain on the right (-X): chainring, cassette, the chain between them, the rear derailleur.
  solid(track(new CylinderGeometry(0.1, 0.1, 0.008, 24).rotateZ(Math.PI / 2)), v(-0.06, BB_Y, 0), metalColor);
  solid(track(new CylinderGeometry(0.07, 0.07, 0.006, 20).rotateZ(Math.PI / 2)), v(-0.052, BB_Y, 0), carbon);
  solid(track(new CylinderGeometry(0.052, 0.04, 0.035, 16).rotateZ(Math.PI / 2)), v(-0.045, WHEEL_RADIUS, REAR_AXLE_Z), metalColor);
  tube(parts, v(-0.058, BB_Y + 0.1, 0), v(-0.055, WHEEL_RADIUS + 0.05, REAR_AXLE_Z), 0.004, metalColor);
  tube(parts, v(-0.058, BB_Y - 0.1, 0), v(-0.055, WHEEL_RADIUS - 0.09, REAR_AXLE_Z + 0.02), 0.004, metalColor);
  solid(track(new BoxGeometry(0.02, 0.09, 0.04)), v(-0.07, WHEEL_RADIUS - 0.07, REAR_AXLE_Z + 0.01), carbon);
  // A bottle in its cage on the down tube.
  const dtA = bb.clone().lerp(headBottom, 0.3).add(v(0, 0.045, -0.03));
  const dtB = bb.clone().lerp(headBottom, 0.68).add(v(0, 0.045, -0.03));
  tube(parts, dtA, dtB, 0.034, new Color(0x2a9db8));
  tube(parts, dtB, dtB.clone().add(dtB.clone().sub(dtA).multiplyScalar(0.12)), 0.014, carbon);

  addMesh(track(merge(frameParts)), frameMat);
  addMesh(track(merge(parts)), bikeMat);

  // One geometry shared by both wheels: tyre, deep carbon rim with decal rings, hub and 18 spokes.
  const wheelParts: Part[] = [];
  const identity = new Matrix4();
  wheelParts.push({
    geo: track(new TorusGeometry(WHEEL_RADIUS - 0.0125, 0.0125, 8, 40).rotateY(Math.PI / 2)),
    matrix: identity,
    color: new Color(0x16171a),
  });
  const rimProfile = [new Vector2(0.27, -0.0115), new Vector2(0.314, -0.0125), new Vector2(0.314, 0.0125), new Vector2(0.27, 0.0115), new Vector2(0.27, -0.0115)];
  wheelParts.push({ geo: track(new LatheGeometry(rimProfile, 40).rotateZ(Math.PI / 2)), matrix: identity, color: new Color(0x1f2024) });
  const decalGeo = track(new TorusGeometry(0.29, 0.002, 4, 40).rotateY(Math.PI / 2));
  wheelParts.push({ geo: decalGeo, matrix: new Matrix4().makeTranslation(0.0128, 0, 0), color: new Color(0xd8dade) });
  wheelParts.push({ geo: decalGeo, matrix: new Matrix4().makeTranslation(-0.0128, 0, 0), color: new Color(0xd8dade) });
  wheelParts.push({ geo: track(new CylinderGeometry(0.02, 0.02, 0.1, 10).rotateZ(Math.PI / 2)), matrix: identity, color: metalColor });
  const spokeGeo = track(new BoxGeometry(0.0025, 0.255, 0.0025).translate(0, 0.14, 0));
  for (let k = 0; k < 18; k++) {
    const side = k % 2 ? 0.018 : -0.018;
    wheelParts.push({ geo: spokeGeo, matrix: new Matrix4().makeRotationX((k * Math.PI * 2) / 18).premultiply(new Matrix4().makeTranslation(side, 0, 0)), color: metalColor });
  }
  const wheelGeo = track(merge(wheelParts));
  const rearWheel = addMesh(wheelGeo, bikeMat);
  rearWheel.position.set(0, WHEEL_RADIUS, REAR_AXLE_Z);
  const frontWheel = addMesh(wheelGeo, bikeMat);
  frontWheel.position.set(0, WHEEL_RADIUS, FRONT_AXLE_Z);

  // Rider.
  const pelvis = addMesh(ballGeo, shortsMat);
  pelvis.scale.set(0.14, 0.1, 0.12);
  const torso = addMesh(torsoGeo, torsoMat);
  const neck = addMesh(tubeGeo, skinMat);
  const head = new Group();
  group.add(head);
  head.add(new Mesh(headGeo, headMat));
  const stripe = new Mesh(stripeGeo, jerseyMat);
  stripe.position.set(0, 0.133, -0.02);
  head.add(stripe);
  // JoyoFit print across the back of the jersey, placed on the torso every frame (the torso mesh is scaled, a child would stretch).
  const logoTexture = ghost ? null : jerseyLogoTexture();
  const logo = logoTexture ? addMesh(track(new PlaneGeometry(0.15, 0.047)), material(0xffffff, 'fabric')) : null;
  if (logo && logoTexture) {
    const m = logo.material as MeshStandardMaterial;
    m.map = logoTexture;
    m.transparent = true;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
  }
  const backNormal = new Vector3();
  const basis = new Matrix4();
  const LEFT = new Vector3(-1, 0, 0);

  const makeSide = (sign: number): Side => {
    const ball = (mat: Material, r: number): Mesh => {
      const m = addMesh(ballGeo, mat);
      m.scale.setScalar(r);
      return m;
    };
    return {
      sign,
      phase: sign > 0 ? 0 : Math.PI,
      thigh: addMesh(thighGeo, shortsMat),
      shin: addMesh(shinGeo, skinMat),
      sock: addMesh(tubeGeo, sockMat),
      knee: ball(skinMat, 0.058),
      foot: addMesh(footGeo, shoeMat),
      pedal: addMesh(pedalGeo, darkMat),
      crank: addMesh(tubeGeo, metalMat),
      upper: addMesh(upperArmGeo, jerseyMat),
      fore: addMesh(foreArmGeo, skinMat),
      elbow: ball(skinMat, 0.04),
      hand: addMesh(gloveGeo, gloveMat),
      shoulder: ball(jerseyMat, 0.05),
      hip: new Vector3(),
      kneeV: new Vector3(),
      ankle: new Vector3(),
      sockTop: new Vector3(),
      pedalV: new Vector3(),
      crankStart: new Vector3(-sign * CRANK_X, BB_Y, 0),
      shoulderV: new Vector3(),
      elbowV: new Vector3(),
      handV: new Vector3(),
    };
  };
  const sides = [makeSide(1), makeSide(-1)];

  if (options.shadows) group.traverse((o) => (o.castShadow = true));

  const pelvisV = new Vector3();
  const neckV = new Vector3();
  const headBase = new Vector3();
  const torsoAxis = new Vector3();
  const crankEnd = new Vector3();

  const update = (pose: AvatarPose): void => {
    const stand = clamp01(pose.stand ?? 0);
    const tuck = clamp01(pose.tuck ?? 0) * (1 - stand);
    const lean = LEAN_SEATED + (LEAN_TUCK - LEAN_SEATED) * tuck + (LEAN_STAND - LEAN_SEATED) * stand;
    const leanCos = Math.cos(lean);
    const leanSin = Math.sin(lean);
    // Hips rock with each pedal stroke, much more out of the saddle.
    const sway = SWAY * (1 + stand * 2.5) * Math.sin(pose.crankAngle);

    const hipY = HIP_Y + STAND_RISE * stand;
    const hipZ = HIP_Z + STAND_SHIFT * stand;
    const shoulderY = hipY + TORSO * leanSin;
    const shoulderZ = hipZ + TORSO * leanCos;
    const shoulderSway = -0.5 * sway;

    pelvisV.set(sway, hipY, hipZ);
    pelvis.position.copy(pelvisV);
    neckV.set(shoulderSway, shoulderY, shoulderZ);
    placeLimb(torso, pelvisV, neckV, SHOULDER_X + 0.005, 0.115);
    if (logo) {
      // Across the shoulder blades: two thirds up the torso, on its back surface, reading left to right from behind.
      torsoAxis.subVectors(neckV, pelvisV);
      const len = torsoAxis.length();
      torsoAxis.divideScalar(len);
      backNormal.set(0, torsoAxis.z, -torsoAxis.y);
      logo.position.copy(pelvisV).addScaledVector(torsoAxis, len * 0.66).addScaledVector(backNormal, 0.106);
      logo.quaternion.setFromRotationMatrix(basis.makeBasis(LEFT, torsoAxis, backNormal));
    }

    head.position.set(shoulderSway, shoulderY + 0.1 - 0.03 * tuck, shoulderZ + 0.07 + 0.07 * tuck);
    // The torso leans forward but the eyes stay on the road: chin up a little, more in the tuck.
    head.rotation.x = -0.12 - 0.1 * tuck;
    headBase.set(head.position.x, head.position.y - 0.06, head.position.z - 0.03);
    placeLimb(neck, neckV, headBase, 0.045, 0.045);

    const handY = HOOD_Y + (DROP_Y - HOOD_Y) * tuck;
    const handZ = HOOD_Z + (DROP_Z - HOOD_Z) * tuck;

    for (const s of sides) {
      const outward = -s.sign;
      const angle = pose.crankAngle + s.phase;
      const pedalY = BB_Y + CRANK_LENGTH * Math.cos(angle);
      const pedalZ = CRANK_LENGTH * Math.sin(angle);
      const pitch = 0.22 * Math.sin(angle - 0.8);
      const pc = Math.cos(pitch);
      const ps = Math.sin(pitch);

      s.pedalV.set(outward * PEDAL_X, pedalY, pedalZ);
      s.pedal.position.copy(s.pedalV);
      s.pedal.rotation.x = pitch;
      s.foot.rotation.x = pitch;

      crankEnd.set(outward * CRANK_X, pedalY, pedalZ);
      placeLimb(s.crank, s.crankStart, crankEnd, 0.008, 0.016);

      s.hip.set(outward * HIP_X + sway, hipY, hipZ);
      solveIk(
        hipY,
        hipZ,
        pedalY + ANKLE_UP * pc - ANKLE_FORWARD * ps,
        pedalZ + ANKLE_UP * ps + ANKLE_FORWARD * pc,
        THIGH,
        SHIN,
        1,
      );
      s.ankle.set(outward * ANKLE_X, endY, endZ);
      s.kneeV.set(outward * (HIP_X + ANKLE_X) * 0.5 + sway * 0.5, jointY, jointZ);
      s.knee.position.copy(s.kneeV);
      s.foot.position.copy(s.ankle);
      placeLimb(s.thigh, s.hip, s.kneeV, 0.075, 0.075);
      placeLimb(s.shin, s.kneeV, s.ankle, 0.055, 0.055);
      // Sock: the lowest 12 cm of the shin.
      s.sockTop.subVectors(s.kneeV, s.ankle).setLength(0.12).add(s.ankle);
      placeLimb(s.sock, s.ankle, s.sockTop, 0.047, 0.047);

      // The arm hangs from the torso's upper corner, a little below its top and just inside its edge, so the jersey's shoulder line
      // runs over the joint instead of the arm sprouting from above it.
      torsoAxis.subVectors(neckV, pelvisV).normalize();
      const sx = outward * (SHOULDER_X - 0.022) + shoulderSway;
      const hx = outward * HAND_X;
      s.shoulderV.set(sx, shoulderY, shoulderZ).addScaledVector(torsoAxis, -0.06);
      s.shoulder.position.copy(s.shoulderV);
      solveIk(s.shoulderV.y, s.shoulderV.z, handY, handZ, ARM_UPPER, ARM_FORE, -1);
      s.handV.set(hx, endY, endZ);
      s.elbowV.set((sx + hx) * 0.5 + outward * 0.035, jointY, jointZ);
      // Glove along the forearm, its palm centred on the hood.
      dir.subVectors(s.handV, s.elbowV).normalize();
      s.hand.quaternion.setFromUnitVectors(Y_AXIS, dir);
      s.hand.position.copy(s.handV).addScaledVector(dir, -0.06);
      s.elbow.position.copy(s.elbowV);
      placeLimb(s.upper, s.shoulderV, s.elbowV, 0.046, 0.046);
      placeLimb(s.fore, s.elbowV, s.handV, 0.037, 0.037);
    }

    rearWheel.rotation.x = pose.wheelAngle;
    frontWheel.rotation.x = pose.wheelAngle;
  };

  update({ crankAngle: 0, wheelAngle: 0 });

  return {
    group,
    update,
    setJersey(color: number): void {
      if (ghost) return;
      jerseyMat.color.set(color);
      torsoMat.color.set(color);
      frameMat.color.set(color);
    },
    dispose(): void {
      for (const g of geos) g.dispose();
      logoTexture?.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
