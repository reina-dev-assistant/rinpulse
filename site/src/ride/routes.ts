/**
 * Routes are data: an elevation profile and a plan-view heading profile, both as control points that
 * track.ts interpolates smoothly, plus the segments (sprint and KOM) timed on them. Text lives in i18n.ts
 * under `route.<id>.*` and `segment.<id>`.
 */
export type ThemeId = "pantai" | "bukit" | "kebun" | "bromo";

export type SegmentKind = "sprint" | "kom";

export interface SegmentDef {
  id: string;
  kind: SegmentKind;
  startM: number;
  endM: number;
}

export interface RouteDef {
  id: ThemeId;
  /** Proper noun, the same in both languages. */
  name: string;
  lengthM: number;
  /** [distance m, elevation m above sea level]. */
  elevation: readonly (readonly [number, number])[];
  /** [distance m, heading degrees]; 0 is straight ahead, positive turns right. */
  heading: readonly (readonly [number, number])[];
  segments: readonly SegmentDef[];
}

export const ROUTES: readonly RouteDef[] = [
  {
    id: "pantai",
    name: "Pantai",
    lengthM: 12000,
    elevation: [
      [0, 3],
      [1500, 5],
      [3000, 4],
      [4200, 9],
      [5000, 7],
      [6500, 3],
      [8000, 6],
      [9000, 4],
      [9500, 14],
      [10200, 7],
      [11000, 9],
      [12000, 4],
    ],
    heading: [
      [0, 0],
      [1500, 8],
      [3000, -14],
      [4500, 18],
      [6000, 32],
      [8000, 8],
      [10000, -22],
      [12000, 0],
    ],
    segments: [
      { id: "pantai-sprint-1", kind: "sprint", startM: 2900, endM: 3500 },
      { id: "pantai-kom", kind: "kom", startM: 9100, endM: 10200 },
      { id: "pantai-sprint-2", kind: "sprint", startM: 11000, endM: 11700 },
    ],
  },
  {
    id: "bukit",
    name: "Bukit",
    lengthM: 9000,
    elevation: [
      [0, 40],
      [800, 50],
      [1800, 120],
      [2600, 125],
      [3600, 205],
      [4400, 225],
      [5200, 200],
      [6000, 130],
      [6800, 120],
      [7600, 175],
      [8400, 185],
      [9000, 150],
    ],
    heading: [
      [0, 0],
      [1000, 34],
      [2000, -26],
      [3000, 38],
      [4000, -18],
      [5000, 42],
      [6000, 0],
      [7000, -38],
      [8000, 8],
      [9000, -24],
    ],
    segments: [
      { id: "bukit-kom-1", kind: "kom", startM: 2700, endM: 3600 },
      { id: "bukit-sprint", kind: "sprint", startM: 6100, endM: 6700 },
      { id: "bukit-kom-2", kind: "kom", startM: 6800, endM: 7600 },
    ],
  },
  {
    id: "kebun",
    name: "Kebun",
    lengthM: 3000,
    elevation: [
      [0, 20],
      [500, 28],
      [1000, 22],
      [1500, 34],
      [2000, 24],
      [2500, 30],
      [3000, 22],
    ],
    heading: [
      [0, 0],
      [800, 20],
      [1600, -16],
      [2400, 14],
      [3000, 0],
    ],
    segments: [
      { id: "kebun-kom", kind: "kom", startM: 1050, endM: 1500 },
      { id: "kebun-sprint", kind: "sprint", startM: 2000, endM: 2500 },
    ],
  },
  {
    id: "bromo",
    name: "Bromo",
    lengthM: 8000,
    elevation: [
      [0, 1400],
      [900, 1440],
      [2000, 1535],
      [3000, 1615],
      [3800, 1690],
      [4500, 1705],
      [5500, 1790],
      [6500, 1880],
      [7300, 1935],
      [8000, 1945],
    ],
    heading: [
      [0, 0],
      [700, 40],
      [1500, -45],
      [2300, 50],
      [3100, -40],
      [3900, 10],
      [4600, -20],
      [5400, 55],
      [6100, -55],
      [6800, 50],
      [7500, -30],
      [8000, 0],
    ],
    segments: [
      { id: "bromo-sprint", kind: "sprint", startM: 3800, endM: 4400 },
      { id: "bromo-kom", kind: "kom", startM: 5400, endM: 7300 },
    ],
  },
];

export function routeById(id: string): RouteDef {
  return ROUTES.find((r) => r.id === id) ?? ROUTES[0]!;
}
