import { lineCollection, pointCollection, boundsOf, type Bounds, type LatLon } from '@/features/routes/map/geometry';

/** Pure map data for `BikeMap`: GeoJSON builders and camera decisions. No React, no native modules. */

export interface BikePosition extends LatLon {
  /** Degrees clockwise from north; null when the phone does not know (standing still, no compass). */
  headingDeg: number | null;
}

/** Zoom while following: a street-level view that still shows the next junction at ride speed. */
export const FOLLOW_ZOOM = 16;
/** Camera glide between two 1 Hz fixes: a little under the fix interval, so it never queues behind itself. */
export const FOLLOW_EASE_MS = 900;
/** Length of the heading wedge in metres, and its half angle. */
const WEDGE_LENGTH_M = 38;
const WEDGE_HALF_ANGLE_DEG = 32;

const EARTH_RADIUS_M = 6_371_008.8;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The route as a line, or an empty collection for fewer than two points. */
export function routeCollection(route: readonly LatLon[] | null): GeoJSON.FeatureCollection {
  return route && route.length >= 2 ? lineCollection([route]) : EMPTY;
}

export function puckCollection(position: LatLon | null): GeoJSON.FeatureCollection {
  return position ? pointCollection([position]) : EMPTY;
}

/** Point `distanceM` from `from` on a bearing (spherical earth: exact enough over tens of metres). */
export function offsetPoint(from: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const rad = Math.PI / 180;
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = bearingDeg * rad;
  const lat1 = from.lat * rad;
  const lon1 = from.lon * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / rad, lon: lon2 / rad };
}

/** A triangle ahead of the puck showing the direction of travel; empty without a heading. */
export function headingWedge(position: BikePosition | null): GeoJSON.FeatureCollection {
  if (!position || position.headingDeg === null || !Number.isFinite(position.headingDeg)) return EMPTY;
  const tipA = offsetPoint(position, position.headingDeg - WEDGE_HALF_ANGLE_DEG, WEDGE_LENGTH_M);
  const tipB = offsetPoint(position, position.headingDeg + WEDGE_HALF_ANGLE_DEG, WEDGE_LENGTH_M);
  const ring: [number, number][] = [
    [position.lon, position.lat],
    [tipA.lon, tipA.lat],
    [tipB.lon, tipB.lat],
    [position.lon, position.lat],
  ];
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }],
  };
}

export interface FollowStop {
  center: [number, number];
  zoom: number;
  /** Map rotation; 0 keeps north up. */
  bearing: number;
  duration: number;
}

/** Where the camera goes for a fix while following; heading-up rotates the map to the direction of travel when it is known. */
export function followStop(position: BikePosition, headingUp: boolean, zoom: number = FOLLOW_ZOOM): FollowStop {
  const known = position.headingDeg !== null && Number.isFinite(position.headingDeg);
  return {
    center: [position.lon, position.lat],
    zoom,
    bearing: headingUp && known ? normalizeBearing(position.headingDeg as number) : 0,
    duration: FOLLOW_EASE_MS,
  };
}

export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export type InitialView =
  | { center: [number, number]; zoom: number }
  | { bounds: Bounds; padding: { top: number; right: number; bottom: number; left: number } }
  | { center: [number, number]; zoom: number; fallback: true };

const FIT_PADDING = { top: 48, right: 48, bottom: 96, left: 48 } as const;
/** All of Indonesia, when nothing says where the rider is (same as the route map's default). */
const FALLBACK_CENTER: [number, number] = [118, -2.5];
const FALLBACK_ZOOM = 3.8;

/** The camera a fresh map starts with: on the rider, else the route's box, else Indonesia. */
export function initialView(position: LatLon | null, route: readonly LatLon[] | null): InitialView {
  if (position) return { center: [position.lon, position.lat], zoom: FOLLOW_ZOOM };
  const bounds = route ? boundsOf(route) : null;
  if (bounds) return { bounds, padding: { ...FIT_PADDING } };
  return { center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM, fallback: true };
}

/** A pan or zoom by the rider's hand ends follow mode; the camera's own moves do not. */
export function followAfterRegionChange(follow: boolean, userInteraction: boolean): boolean {
  return userInteraction ? false : follow;
}
