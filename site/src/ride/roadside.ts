/**
 * Street furniture along the route: kilometre stones, distance-to-go boards before the finish, a steep-climb warning before each
 * KOM, guard rails and chevron signs on the outside of the sharper bends, and the electricity poles with their sagging wires.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { RouteDef } from "./routes.ts";
import { at, mulberry32, paint } from "./scenery.ts";
import { groundHeight } from "./terrain.ts";
import type { Theme } from "./theme.ts";
import { ROAD_HALF, STEP, Track, makeTrackPoint } from "./track.ts";

/** Bends tighter than this radius get a guard rail on the outside (hill routes only) and, tighter still, chevrons. */
const RAIL_RADIUS_M = 520;
const CHEVRON_RADIUS_M = 380;
const POLE_SPACING_M = 42;
const POLE_LAT = -(ROAD_HALF + 3.2);

type Own = <T extends { dispose(): void }>(x: T) => T;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const FONT = "'Plus Jakarta Sans Variable', system-ui, sans-serif";

export function buildRoadside(track: Track, theme: Theme, route: RouteDef, own: Own, shadows: boolean): Group {
  const group = new Group();
  const point = makeTrackPoint();
  const dummy = new Object3D();
  dummy.rotation.order = "YXZ";
  const vertexMat = own(new MeshLambertMaterial({ vertexColors: true }));

  const ground = (s: number, lat: number) => {
    const t = track.at(s, point);
    const wx = t.x + Math.cos(t.yaw) * lat;
    const wz = t.z - Math.sin(t.yaw) * lat;
    return { x: wx, y: groundHeight(theme, t.y, lat, wx, wz), z: wz, yaw: t.yaw, grade: t.grade, roadY: t.y };
  };

  const postGeo = own(new CylinderGeometry(0.04, 0.04, 1, 6));
  const postMat = own(new MeshLambertMaterial({ color: 0x8c9096 }));
  /** A sign face on a post, facing riders coming up the road; [lat] metres from the centre. */
  const sign = (s: number, lat: number, w: number, h: number, height: number, material: Material, twoPosts = false) => {
    const g = ground(s, lat);
    const holder = new Group();
    holder.position.set(g.x, g.y, g.z);
    holder.rotation.y = g.yaw;
    const face = new Mesh(own(new PlaneGeometry(w, h)), material);
    face.position.y = height;
    face.position.z = 0.04;
    holder.add(face);
    const back = new Mesh(own(new PlaneGeometry(w, h)), postMat);
    back.position.y = height;
    back.rotation.y = Math.PI;
    holder.add(back);
    for (const x of twoPosts ? [-w * 0.35, w * 0.35] : [0]) {
      const post = new Mesh(postGeo, postMat);
      post.position.set(x, height / 2, 0);
      post.scale.y = height;
      post.castShadow = shadows;
      holder.add(post);
    }
    face.castShadow = shadows;
    group.add(holder);
  };

  // Kilometre stones (patok kilometer): white post, red cap, the distance painted on the face.
  const stoneGeo = own(
    mergeGeometries([paint(at(new BoxGeometry(0.42, 0.75, 0.16), 0, 0.375, 0), 0xf2f0e8), paint(at(new CylinderGeometry(0.21, 0.21, 0.16, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2), 0, 0.75, 0), 0xc4382c)])!,
  );
  for (let km = 1; km * 1000 < route.lengthM; km++) {
    const g = ground(km * 1000, -(ROAD_HALF + 1.0));
    const stone = new Mesh(stoneGeo, vertexMat);
    stone.position.set(g.x, g.y, g.z);
    stone.rotation.y = g.yaw;
    stone.castShadow = shadows;
    const label = new Mesh(
      own(new PlaneGeometry(0.38, 0.38)),
      own(
        new MeshLambertMaterial({
          map: own(
            canvasTexture(128, 128, (c) => {
              c.fillStyle = "#f2f0e8";
              c.fillRect(0, 0, 128, 128);
              c.fillStyle = "#1b1b1b";
              c.textAlign = "center";
              c.font = `800 34px ${FONT}`;
              c.fillText("KM", 64, 50);
              c.font = `800 52px ${FONT}`;
              c.fillText(String(km), 64, 106);
            }),
          ),
        }),
      ),
    );
    label.position.set(0, 0.42, 0.085);
    stone.add(label);
    group.add(stone);
  }

  // Distance-to-go boards before the finish, as at a race.
  const board = (text: string, bg: string) =>
    own(
      new MeshLambertMaterial({
        map: own(
          canvasTexture(256, 128, (c) => {
            c.fillStyle = bg;
            c.fillRect(0, 0, 256, 128);
            c.strokeStyle = "#ffffff";
            c.lineWidth = 8;
            c.strokeRect(8, 8, 240, 112);
            c.fillStyle = "#ffffff";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.font = `800 60px ${FONT}`;
            c.fillText(text, 128, 68);
          }),
        ),
      }),
    );
  for (const [m, text] of [
    [1000, "1 KM"],
    [500, "500 M"],
    [200, "200 M"],
  ] as const) {
    if (route.lengthM - m > 100) sign(route.lengthM - m, -(ROAD_HALF + 1.4), 1.6, 0.8, 2.3, board(text, m === 1000 ? "#c4382c" : "#141414"), true);
  }

  // A steep-climb warning (yellow diamond) before each KOM with the segment's steepest grade.
  for (const seg of route.segments) {
    if (seg.kind !== "kom") continue;
    let steepest = 0;
    for (let s = seg.startM; s <= seg.endM; s += STEP) steepest = Math.max(steepest, track.gradeAt(s));
    const text = `${Math.round(steepest)}%`;
    const material = own(
      new MeshLambertMaterial({
        transparent: true,
        alphaTest: 0.5,
        map: own(
          canvasTexture(128, 128, (c) => {
            c.translate(64, 64);
            c.rotate(Math.PI / 4);
            c.fillStyle = "#141414";
            c.fillRect(-44, -44, 88, 88);
            c.fillStyle = "#f2c230";
            c.fillRect(-40, -40, 80, 80);
            c.rotate(-Math.PI / 4);
            c.fillStyle = "#141414";
            c.beginPath();
            c.moveTo(-30, 18);
            c.lineTo(30, 18);
            c.lineTo(30, -12);
            c.closePath();
            c.fill();
            c.font = `800 26px ${FONT}`;
            c.textAlign = "center";
            c.fillText(text, -6, 6);
          }),
        ),
      }),
    );
    sign(Math.max(20, seg.startM - 70), -(ROAD_HALF + 1.3), 0.9, 0.9, 2.1, material);
  }

  // Bends: curvature from the heading change over 16 m (positive turns left).
  const curvature = (s: number) => (track.at(s + 8, point).yaw - track.at(s - 8, point).yaw) / 16;
  const hilly = theme.hillAmp > 60;
  const railBeam = own(paint(new BoxGeometry(0.06, 0.32, STEP + 0.05), 0xb9bec4));
  const railPost = own(paint(at(new BoxGeometry(0.12, 0.75, 0.12), 0, 0.375, -STEP / 2), 0x8c9096));
  const railGeo = own(mergeGeometries([at(railBeam, 0, 0.62, 0), railPost])!);
  const railMatrices: Matrix4[] = [];
  const chevron = (dir: 1 | -1) =>
    own(
      new MeshLambertMaterial({
        map: own(
          canvasTexture(128, 160, (c) => {
            c.fillStyle = "#f2c230";
            c.fillRect(0, 0, 128, 160);
            c.fillStyle = "#141414";
            c.save();
            if (dir < 0) {
              c.translate(128, 0);
              c.scale(-1, 1);
            }
            c.beginPath();
            c.moveTo(30, 20);
            c.lineTo(66, 20);
            c.lineTo(102, 80);
            c.lineTo(66, 140);
            c.lineTo(30, 140);
            c.lineTo(66, 80);
            c.closePath();
            c.fill();
            c.restore();
          }),
        ),
      }),
    );
  const chevronRight = chevron(1);
  const chevronLeft = chevron(-1);
  let lastChevron = -Infinity;
  for (let s = 40; s < route.lengthM + 200; s += STEP) {
    const k = curvature(s);
    const radius = 1 / Math.max(1e-6, Math.abs(k));
    if (radius > RAIL_RADIUS_M || !hilly) continue;
    // Outside of the bend: a right turn (heading decreasing) throws you to the left.
    const outside = k < 0 ? -1 : 1;
    const g = ground(s + STEP / 2, outside * (ROAD_HALF + 0.9));
    dummy.position.set(g.x, Math.max(g.y, g.roadY - 0.15), g.z);
    dummy.rotation.set(Math.atan(g.grade / 100), g.yaw, 0);
    dummy.updateMatrix();
    railMatrices.push(dummy.matrix.clone());
    if (radius < CHEVRON_RADIUS_M && s - lastChevron > 22) {
      lastChevron = s;
      sign(s, outside * (ROAD_HALF + 1.6), 0.5, 0.62, 1.3, k < 0 ? chevronRight : chevronLeft);
    }
  }
  if (railMatrices.length > 0) {
    const rails = new InstancedMesh(railGeo, vertexMat, railMatrices.length);
    railMatrices.forEach((m, i) => rails.setMatrixAt(i, m));
    rails.computeBoundingSphere();
    rails.castShadow = shadows;
    rails.receiveShadow = shadows;
    group.add(rails);
  }

  // Electricity poles on the land side, three wires sagging between them.
  const rand = mulberry32(theme.seed * 31 + 7);
  const poleGeo = own(
    mergeGeometries([
      paint(at(new CylinderGeometry(0.1, 0.17, 9, 7), 0, 4.5, 0), 0x9a9890),
      paint(at(new BoxGeometry(0.1, 0.1, 1.7).rotateY(Math.PI / 2), 0, 8.4, 0), 0x55585c),
      paint(at(new CylinderGeometry(0.05, 0.05, 0.18, 6), -0.7, 8.55, 0), 0xe8e4d8),
      paint(at(new CylinderGeometry(0.05, 0.05, 0.18, 6), 0, 8.55, 0), 0xe8e4d8),
      paint(at(new CylinderGeometry(0.05, 0.05, 0.18, 6), 0.7, 8.55, 0), 0xe8e4d8),
      paint(at(new BoxGeometry(0.5, 0.7, 0.4), 0, 7.1, 0.25), 0x707478),
    ])!,
  );
  const poles: { x: number; y: number; z: number; yaw: number }[] = [];
  for (let s = -40; s < route.lengthM + 260; s += POLE_SPACING_M) {
    const g = ground(s, POLE_LAT);
    poles.push({ x: g.x, y: g.y, z: g.z, yaw: g.yaw });
  }
  const poleMesh = new InstancedMesh(poleGeo, vertexMat, poles.length);
  poles.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    // A little lean on some poles, as they stand in real life.
    dummy.rotation.set((rand() - 0.5) * 0.04, p.yaw, (rand() - 0.5) * 0.04);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
  });
  poleMesh.computeBoundingSphere();
  poleMesh.castShadow = shadows;
  group.add(poleMesh);

  const SEG = 8;
  const wire = new Float32Array((poles.length - 1) * 3 * SEG * 2 * 3);
  let w = 0;
  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i]!;
    const b = poles[i + 1]!;
    for (const off of [-0.7, 0, 0.7]) {
      const ax = a.x + Math.cos(a.yaw) * off;
      const az = a.z - Math.sin(a.yaw) * off;
      const bx = b.x + Math.cos(b.yaw) * off;
      const bz = b.z - Math.sin(b.yaw) * off;
      for (let k = 0; k < SEG; k++) {
        for (const t of [k / SEG, (k + 1) / SEG]) {
          const sag = 4 * 0.55 * t * (1 - t);
          wire[w++] = ax + (bx - ax) * t;
          wire[w++] = a.y + 8.6 + (b.y - a.y) * t - sag;
          wire[w++] = az + (bz - az) * t;
        }
      }
    }
  }
  const wireGeo = own(new BufferGeometry());
  wireGeo.setAttribute("position", new BufferAttribute(wire, 3));
  wireGeo.computeBoundingSphere();
  group.add(new LineSegments(wireGeo, own(new LineBasicMaterial({ color: 0x2a2c2e }))));

  return group;
}
