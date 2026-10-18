/**
 * Saved routes live as files in `Paths.document/routes`, not in SQLite (the database migrations are shared with the
 * native code). Two files per route: `<id>.json` (facts and a thumbnail, what the list reads) and `<id>.pts.json` (the
 * points, read when a route is opened). The facts file is written last and deleted first, so a route either exists
 * whole or not at all. The file calls are synchronous: a read-modify-write such as `markRouteSent` cannot interleave
 * with another one.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { t } from '@/i18n';

import { untitledRouteName } from './copy';
import type { RouteDraft, RoutePoint, SavedRoute } from './routeModel';
import {
  buildRoute,
  cleanRouteName,
  decodePoints,
  decodeThumb,
  encodePoints,
  isRouteId,
  newRouteId,
  parseMeta,
  type StoredMeta,
  type StoredPoints,
} from './routeStorage';
import { notifyRouteChange } from './routeChanges';

/** A saved route with the few points its list thumbnail is drawn from. */
export interface RouteCard {
  route: SavedRoute;
  thumb: { lat: number; lon: number }[];
}

function routesDir(): Directory {
  const dir = new Directory(Paths.document, 'routes');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const metaFile = (id: string) => new File(routesDir(), `${id}.json`);
const pointsFile = (id: string) => new File(routesDir(), `${id}.pts.json`);

/** The facts of one route; null when the file is missing or damaged. */
function readMeta(file: File): StoredMeta | null {
  if (!file.exists) return null;
  try {
    return parseMeta(JSON.parse(file.textSync()));
  } catch {
    return null;
  }
}

function writeMeta(meta: StoredMeta): void {
  metaFile(meta.route.id).write(JSON.stringify(meta));
}

/** Saved routes with their thumbnails, newest first. A file that cannot be read is left out. */
export async function listRouteCards(): Promise<RouteCard[]> {
  const cards: RouteCard[] = [];
  for (const entry of routesDir().list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.json') || entry.name.endsWith('.pts.json')) continue;
    const meta = readMeta(entry);
    if (meta) cards.push({ route: meta.route, thumb: decodeThumb(meta.thumb) });
  }
  return cards.sort((a, b) => b.route.createdAt - a.route.createdAt);
}

/** Saved routes, newest first. */
export async function listRoutes(): Promise<SavedRoute[]> {
  return (await listRouteCards()).map((card) => card.route);
}

/** One route with its points; null when there is no such route or its points file is damaged. */
export async function loadRoute(id: string): Promise<{ route: SavedRoute; points: RoutePoint[] } | null> {
  if (!isRouteId(id)) return null;
  const meta = readMeta(metaFile(id));
  if (!meta) return null;
  const file = pointsFile(id);
  if (!file.exists) return null;
  try {
    const points = decodePoints(JSON.parse(file.textSync()));
    return points && points.length >= 2 ? { route: meta.route, points } : null;
  } catch {
    return null;
  }
}

/**
 * Stores a draft: cleans the points, computes the stats from the whole line, keeps at most 5000 points. Throws an
 * Error with a readable message when fewer than two usable points are left.
 */
export async function saveRoute(draft: RouteDraft): Promise<SavedRoute> {
  const now = Date.now();
  const { meta, points } = buildRoute(draft, newRouteId(now), now, t('routes:parse.tooFewForSave'), untitledRouteName(now));
  const stored: StoredPoints = { v: 1, pts: encodePoints(points) };
  pointsFile(meta.route.id).write(JSON.stringify(stored));
  writeMeta(meta);
  notifyRouteChange(meta.route.id);
  return meta.route;
}

/** The route under its new name (an empty name keeps the old one); null when there is no such route. */
export async function renameRoute(id: string, name: string): Promise<SavedRoute | null> {
  if (!isRouteId(id)) return null;
  const meta = readMeta(metaFile(id));
  if (!meta) return null;
  const cleaned = cleanRouteName(name);
  if (cleaned === '') return meta.route;
  const route = { ...meta.route, name: cleaned };
  writeMeta({ ...meta, route });
  notifyRouteChange(id);
  return route;
}

export async function deleteRoute(id: string): Promise<void> {
  if (!isRouteId(id)) return;
  const meta = metaFile(id);
  if (meta.exists) meta.delete();
  const points = pointsFile(id);
  if (points.exists) points.delete();
  notifyRouteChange(id);
}

/** Records that the route reached the watch just now; null when there is no such route. */
export async function markRouteSent(id: string): Promise<SavedRoute | null> {
  if (!isRouteId(id)) return null;
  const meta = readMeta(metaFile(id));
  if (!meta) return null;
  const route = { ...meta.route, lastSentAt: Date.now() };
  writeMeta({ ...meta, route });
  return route;
}

/** A route's files are on disk, even when the facts file is damaged (`listRoutes` leaves such a route out, but it is not deleted). */
export function routeFilesExist(id: string): boolean {
  return isRouteId(id) && (metaFile(id).exists || pointsFile(id).exists);
}

/** The facts file as stored, and (when asked) the points file's flat array; null when the facts are missing or damaged, or the points are. For the cloud sync. */
export function readStoredRoute(id: string, withPoints: boolean): { meta: StoredMeta; pts: StoredPoints['pts'] | null } | null {
  if (!isRouteId(id)) return null;
  const meta = readMeta(metaFile(id));
  if (!meta) return null;
  if (!withPoints) return { meta, pts: null };
  const file = pointsFile(id);
  if (!file.exists) return null;
  try {
    const points = decodePoints(JSON.parse(file.textSync()));
    return points && points.length >= 2 ? { meta, pts: encodePoints(points) } : null;
  } catch {
    return null;
  }
}

/** Stores a route that came from the account as it is: same id, same facts. Not reported as a local edit. */
export function writeStoredRoute(meta: StoredMeta, pts: StoredPoints['pts']): void {
  const stored: StoredPoints = { v: 1, pts };
  pointsFile(meta.route.id).write(JSON.stringify(stored));
  writeMeta(meta);
}
