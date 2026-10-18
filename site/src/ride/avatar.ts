// Low-poly cyclist on a road bike, built only from three.js primitives.
//
// Local space: +Z forward, +Y up, origin on the ground under the bottom bracket, 1 unit = 1 m.
// The rider's right side is -X (a viewer looking along +Z has +X on their left).
//
// Crank angle convention: 0 = right pedal at the top (12 o'clock), PI/2 = right pedal
// forward (+Z), PI = bottom, 3*PI/2 = back. Increasing angle is the forward pedalling
// direction. The left pedal is always at crankAngle + PI.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
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
  dispose(): void;
}

export interface AvatarOptions {
  /** Jersey colour, 0xRRGGBB. */
  jersey: number;
  /** Ghost look: every material semi-transparent, flat unlit tint, jersey and frame share one cool tint. */
  ghost?: boolean;
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
  pedalV: Vector3;
  crankStart: Vector3;
  shoulderV: Vector3;
  elbowV: Vector3;
  handV: Vector3;
}

export function createAvatar(options: AvatarOptions): Avatar {
  const ghost = options.ghost === true;
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
  const material = (color: number | 'vertex'): Material => {
    const m =
      ghostMat ??
      new MeshLambertMaterial(
        color === 'vertex' ? { vertexColors: true, flatShading: true } : { color, flatShading: true },
      );
    mats.add(m);
    return m;
  };

  const jerseyMat = material(options.jersey);
  const skinMat = material(0xdfab8a);
  const shortsMat = material(0x1c1f26);
  const darkMat = material(0x15171c);
  const helmetMat = material(0xf0f1f3);
  const metalMat = material(0x9aa1aa);
  const bikeMat = material('vertex');

  const tubeGeo = track(new CylinderGeometry(1, 1, 1, 6, 1).translate(0, 0.5, 0));
  const taperGeo = track(new CylinderGeometry(0.78, 1, 1, 8, 1).translate(0, 0.5, 0));
  const torsoGeo = track(new CylinderGeometry(1, 0.72, 1, 8, 1).translate(0, 0.5, 0));
  const ballGeo = track(new SphereGeometry(1, 10, 7));
  const helmetGeo = track(new SphereGeometry(1, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62));
  const footGeo = track(new BoxGeometry(0.09, 0.09, 0.26).translate(0, -0.035, 0.06));
  const pedalGeo = track(new BoxGeometry(0.1, 0.02, 0.1));

  const group = new Group();
  const addMesh = (geo: BufferGeometry, mat: Material): Mesh => {
    const m = new Mesh(geo, mat);
    group.add(m);
    return m;
  };

  // Static frame, bars, saddle and chainring baked into one mesh.
  const scratch = new Object3D();
  const frameColor = new Color(options.jersey);
  const darkColor = new Color(0x1c1e22);
  const metalColor = new Color(0x9aa1aa);
  const parts: Part[] = [];
  const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
  const tube = (a: Vector3, b: Vector3, r: number, color: Color): void => {
    placeLimb(scratch, a, b, r, r);
    scratch.updateMatrix();
    parts.push({ geo: tubeGeo, matrix: scratch.matrix.clone(), color });
  };
  const solid = (geo: BufferGeometry, at: Vector3, color: Color): void => {
    parts.push({ geo, matrix: new Matrix4().makeTranslation(at.x, at.y, at.z), color });
  };

  const bb = v(0, BB_Y, 0);
  const seatTop = v(0, 0.79, -0.16);
  const headTop = v(0, 0.775, 0.435);
  const headBottom = v(0, 0.64, 0.47);
  const saddlePos = v(0, 0.95, -0.19);
  const steererTop = v(0, 0.84, 0.425);
  const bar = v(0, 0.84, 0.51);

  tube(bb, seatTop, 0.016, frameColor);
  tube(seatTop, headTop, 0.017, frameColor);
  tube(bb, headBottom, 0.019, frameColor);
  tube(headTop, headBottom, 0.021, frameColor);
  tube(seatTop, v(0, 0.935, -0.2), 0.0125, darkColor);
  tube(headTop, steererTop, 0.015, darkColor);
  tube(steererTop, bar, 0.015, darkColor);
  tube(v(-0.2, 0.84, 0.51), v(0.2, 0.84, 0.51), 0.0125, darkColor);
  tube(v(-0.04, 0.64, 0.47), v(0.04, 0.64, 0.47), 0.012, frameColor);
  for (const s of [-1, 1]) {
    tube(v(s * 0.04, BB_Y, 0), v(s * 0.055, WHEEL_RADIUS, REAR_AXLE_Z), 0.008, frameColor);
    tube(v(s * 0.02, 0.77, -0.165), v(s * 0.055, WHEEL_RADIUS, REAR_AXLE_Z), 0.007, frameColor);
    tube(v(s * 0.04, 0.64, 0.47), v(s * 0.055, WHEEL_RADIUS, FRONT_AXLE_Z), 0.011, frameColor);
    tube(v(s * HAND_X, 0.84, 0.51), v(s * HAND_X, 0.865, 0.585), 0.02, darkColor);
    tube(v(s * HAND_X, 0.835, 0.55), v(s * HAND_X, 0.74, 0.63), 0.0115, darkColor);
    tube(v(s * HAND_X, 0.74, 0.63), v(s * HAND_X, 0.7, 0.575), 0.0115, darkColor);
  }
  solid(track(new BoxGeometry(0.13, 0.05, 0.26)), saddlePos, darkColor);
  solid(track(new CylinderGeometry(0.09, 0.09, 0.008, 16).rotateZ(Math.PI / 2)), v(-0.06, BB_Y, 0), metalColor);

  addMesh(track(merge(parts)), bikeMat);

  // One geometry shared by both wheels: tyre, rim, hub and six crossing spokes.
  const wheelParts: Part[] = [];
  const identity = new Matrix4();
  wheelParts.push({
    geo: track(new TorusGeometry(WHEEL_RADIUS - 0.0125, 0.0125, 6, 28).rotateY(Math.PI / 2)),
    matrix: identity,
    color: new Color(0x14161a),
  });
  wheelParts.push({
    geo: track(new TorusGeometry(0.3, 0.007, 4, 28).rotateY(Math.PI / 2)),
    matrix: identity,
    color: new Color(0xb4bbc4),
  });
  wheelParts.push({
    geo: track(new CylinderGeometry(0.022, 0.022, 0.11, 8).rotateZ(Math.PI / 2)),
    matrix: identity,
    color: metalColor,
  });
  const spokeGeo = track(new BoxGeometry(0.006, 0.6, 0.006));
  for (let k = 0; k < 6; k++) {
    wheelParts.push({ geo: spokeGeo, matrix: new Matrix4().makeRotationX((k * Math.PI) / 6), color: metalColor });
  }
  const wheelGeo = track(merge(wheelParts));
  const rearWheel = addMesh(wheelGeo, bikeMat);
  rearWheel.position.set(0, WHEEL_RADIUS, REAR_AXLE_Z);
  const frontWheel = addMesh(wheelGeo, bikeMat);
  frontWheel.position.set(0, WHEEL_RADIUS, FRONT_AXLE_Z);

  // Rider.
  const pelvis = addMesh(ballGeo, shortsMat);
  pelvis.scale.set(0.14, 0.1, 0.12);
  const torso = addMesh(torsoGeo, jerseyMat);
  const head = addMesh(ballGeo, skinMat);
  head.scale.set(0.085, 0.11, 0.1);
  const helmet = addMesh(helmetGeo, helmetMat);
  helmet.scale.set(0.1, 0.095, 0.125);

  const makeSide = (sign: number): Side => {
    const ball = (mat: Material, r: number): Mesh => {
      const m = addMesh(ballGeo, mat);
      m.scale.setScalar(r);
      return m;
    };
    return {
      sign,
      phase: sign > 0 ? 0 : Math.PI,
      thigh: addMesh(taperGeo, shortsMat),
      shin: addMesh(taperGeo, skinMat),
      knee: ball(skinMat, 0.058),
      foot: addMesh(footGeo, darkMat),
      pedal: addMesh(pedalGeo, darkMat),
      crank: addMesh(tubeGeo, metalMat),
      upper: addMesh(taperGeo, jerseyMat),
      fore: addMesh(taperGeo, skinMat),
      elbow: ball(skinMat, 0.04),
      hand: ball(darkMat, 0.04),
      shoulder: ball(jerseyMat, 0.062),
      hip: new Vector3(),
      kneeV: new Vector3(),
      ankle: new Vector3(),
      pedalV: new Vector3(),
      crankStart: new Vector3(-sign * CRANK_X, BB_Y, 0),
      shoulderV: new Vector3(),
      elbowV: new Vector3(),
      handV: new Vector3(),
    };
  };
  const sides = [makeSide(1), makeSide(-1)];

  const pelvisV = new Vector3();
  const neckV = new Vector3();
  const crankEnd = new Vector3();

  const update = (pose: AvatarPose): void => {
    const stand = clamp01(pose.stand ?? 0);
    const tuck = clamp01(pose.tuck ?? 0) * (1 - stand);
    const lean = LEAN_SEATED + (LEAN_TUCK - LEAN_SEATED) * tuck + (LEAN_STAND - LEAN_SEATED) * stand;
    const leanCos = Math.cos(lean);
    const leanSin = Math.sin(lean);
    const sway = SWAY * Math.sin(pose.crankAngle);

    const hipY = HIP_Y + STAND_RISE * stand;
    const hipZ = HIP_Z + STAND_SHIFT * stand;
    const shoulderY = hipY + TORSO * leanSin;
    const shoulderZ = hipZ + TORSO * leanCos;
    const shoulderSway = -0.5 * sway;

    pelvisV.set(sway, hipY, hipZ);
    pelvis.position.copy(pelvisV);
    neckV.set(shoulderSway, shoulderY, shoulderZ);
    placeLimb(torso, pelvisV, neckV, SHOULDER_X + 0.005, 0.115);

    head.position.set(shoulderSway, shoulderY + 0.1 - 0.03 * tuck, shoulderZ + 0.07 + 0.07 * tuck);
    helmet.position.set(head.position.x, head.position.y + 0.03, head.position.z - 0.005);

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

      const sx = outward * SHOULDER_X + shoulderSway;
      const hx = outward * HAND_X;
      s.shoulderV.set(sx, shoulderY, shoulderZ);
      s.shoulder.position.copy(s.shoulderV);
      solveIk(shoulderY, shoulderZ, handY, handZ, ARM_UPPER, ARM_FORE, -1);
      s.handV.set(hx, endY, endZ);
      s.elbowV.set((sx + hx) * 0.5 + outward * 0.035, jointY, jointZ);
      s.hand.position.copy(s.handV);
      s.elbow.position.copy(s.elbowV);
      placeLimb(s.upper, s.shoulderV, s.elbowV, 0.045, 0.045);
      placeLimb(s.fore, s.elbowV, s.handV, 0.038, 0.038);
    }

    rearWheel.rotation.x = pose.wheelAngle;
    frontWheel.rotation.x = pose.wheelAngle;
  };

  update({ crankAngle: 0, wheelAngle: 0 });

  return {
    group,
    update,
    dispose(): void {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
